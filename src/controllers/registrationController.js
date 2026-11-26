const Registration = require('../models/Registration');
const Participant = require('../models/Participant');
const Tournament = require('../models/Tournament');
const Team = require('../models/Team');
const Match = require('../models/Match');
const AuditLog = require('../models/AuditLog');
const User = require('../models/User');
const { emitCarromLive } = require('../socket');

const {
  validatePartnerRequest,
  enrichRegistrationsWithValidation,
  getTournamentEntryValidationReport,
  ensurePartnerRegistration
} = require('../services/partnerValidationEngine');

const ensureParticipantUserAccount = async ({ participant, email = '', password = '', phone = '' }) => {
  if (!participant) return null;
  const cleanEmail = String(email || participant.email || '').toLowerCase().trim();
  const cleanPassword = String(password || '').trim();
  const cleanPhone = String(phone || participant.phone || '').trim();

  if (!cleanPassword && !cleanEmail && !cleanPhone) return null;

  const slugBase = String(participant.fullName || 'player').toLowerCase().replace(/[^a-z0-9]/g, '') || 'player';
  const fallbackEmail = `${slugBase}.${String(participant._id).slice(-4)}@carrom.edu`;
  const loginEmail = cleanEmail || fallbackEmail;
  const loginPassword = cleanPassword || cleanPhone || 'carrom2026';

  let user = participant.userId ? await User.findById(participant.userId) : null;
  if (!user) {
    user = await User.findOne({
      $or: [{ participantRef: participant._id }, { email: loginEmail }]
    });
  }

  if (user) {
    if (cleanEmail && cleanEmail !== user.email) {
      const conflict = await User.findOne({ email: cleanEmail, _id: { $ne: user._id } });
      if (!conflict) user.email = cleanEmail;
    }
    if (cleanPassword) {
      user.password = cleanPassword;
    }
    if (!user.participantRef) {
      user.participantRef = participant._id;
    }
    await user.save();
  } else {
    user = await User.create({
      username: `${slugBase}_${String(participant._id).slice(-4)}`.toLowerCase(),
      email: loginEmail,
      password: loginPassword,
      role: 'participant',
      fullName: participant.fullName,
      participantRef: participant._id
    });
  }

  let updatedParticipant = false;
  if (!participant.userId || participant.userId.toString() !== user._id.toString()) {
    participant.userId = user._id;
    updatedParticipant = true;
  }
  if (!participant.email || (cleanEmail && participant.email.toLowerCase() !== cleanEmail)) {
    participant.email = user.email;
    updatedParticipant = true;
  }
  if (updatedParticipant) {
    await participant.save();
  }
  return user;
};

// Global helpers for participation and partner name sanitization
const sanitizePartnerName = (val) => {
  if (!val) return '';
  const s = String(val).replace(/\s+/g, ' ').trim();
  const lower = s.toLowerCase();
  if (['yes', 'no', 'true', 'false', '0', '1', 'none', 'n/a', 'na', '-', 'nil', 'null', 'undefined'].includes(lower)) {
    return '';
  }
  return s;
};

const normalizeBooleanParticipation = (val, defaultVal = false) => {
  if (val === undefined || val === null || val === '') return defaultVal;
  if (typeof val === 'boolean') return val;
  const s = String(val).trim().toLowerCase();
  if (['yes', 'true', '1', 'y'].includes(s)) return true;
  if (['no', 'false', '0', 'n', 'none', 'na', 'n/a', '-'].includes(s)) return false;
  return defaultVal;
};

// Shared helper: resolves & validates a selected partner against existing Participant records
const resolveAndValidatePartner = async ({
  partnerId,
  partnerName,
  registrantId = null,
  registrantName = '',
  registrantGender,
  category, // 'boys_doubles' | 'girls_doubles' | 'mixed_doubles'
  tournamentId,
  requireExisting = false
}) => {
  const cleanName = sanitizePartnerName(partnerName);
  if (!partnerId && !cleanName) return { partner: null, partnerName: '', partnerId: null };

  let partner = null;
  if (partnerId) {
    partner = await Participant.findById(partnerId).lean();
    if (!partner) {
      const err = new Error('Selected partner does not exist in registered participants.');
      err.statusCode = 400;
      throw err;
    }
  } else if (cleanName) {
    const escaped = cleanName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    partner = await Participant.findOne({ fullName: { $regex: new RegExp(`^${escaped}$`, 'i') } }).lean();
    if (requireExisting && !partner) {
      const err = new Error(`Partner "${cleanName}" must be selected from existing registered participants.`);
      err.statusCode = 400;
      throw err;
    }
  }

  if (!partner) {
    return { partner: null, partnerName: cleanName, partnerId: null };
  }

  if (registrantId && partner._id.toString() === registrantId.toString()) {
    const err = new Error('A participant cannot be selected as their own partner.');
    err.statusCode = 400;
    throw err;
  }
  if (registrantName && partner.fullName.toLowerCase().trim() === registrantName.toLowerCase().trim()) {
    const err = new Error('A participant cannot be selected as their own partner.');
    err.statusCode = 400;
    throw err;
  }

  if (category === 'boys_doubles' && (registrantGender !== 'male' || partner.gender !== 'male')) {
    const err = new Error('Boys Doubles requires both partners to be male.');
    err.statusCode = 400;
    throw err;
  }
  if (category === 'girls_doubles' && (registrantGender !== 'female' || partner.gender !== 'female')) {
    const err = new Error('Girls Doubles requires both partners to be female.');
    err.statusCode = 400;
    throw err;
  }
  if (category === 'mixed_doubles') {
    const isOpposite =
      (registrantGender === 'male' && partner.gender === 'female') ||
      (registrantGender === 'female' && partner.gender === 'male');
    if (!isOpposite) {
      const err = new Error('Mixed Doubles requires one male and one female partner.');
      err.statusCode = 400;
      throw err;
    }
  }

  if (tournamentId) {
    const existingTeam = await Team.findOne({
      tournamentId,
      category,
      isApproved: true,
      $or: [{ player1: partner._id }, { player2: partner._id }]
    }).lean();

    if (
      existingTeam &&
      (!registrantId ||
        (existingTeam.player1?.toString() !== registrantId.toString() &&
          existingTeam.player2?.toString() !== registrantId.toString()))
    ) {
      const err = new Error(
        `${partner.fullName} is already paired in "${existingTeam.name}" for ${category.replace('_', ' ').toUpperCase()}.`
      );
      err.statusCode = 400;
      throw err;
    }
  }

  return {
    partner,
    partnerName: partner.fullName,
    partnerId: partner._id
  };
};

// Search existing registered participants eligible as Doubles / Mixed Doubles partners
const searchPartnerCandidates = async (req, res, next) => {
  try {
    const {
      q = '',
      category = '',
      playerGender = '',
      excludeId = '',
      tournamentId = ''
    } = req.query;

    let tournId = tournamentId;
    if (!tournId) {
      const activeTourn = await Tournament.findOne().sort({ createdAt: -1 }).lean();
      if (!activeTourn) {
        return res.json({ success: true, count: 0, candidates: [] });
      }
      tournId = activeTourn._id;
    }

    // Determine required partner gender based on category and playerGender
    let requiredGender = '';
    let targetTeamCategory = category;
    if (category === 'boys_doubles') {
      requiredGender = 'male';
    } else if (category === 'girls_doubles') {
      requiredGender = 'female';
    } else if (category === 'doubles') {
      if (playerGender === 'male' || playerGender === 'female') {
        requiredGender = playerGender;
        targetTeamCategory = playerGender === 'male' ? 'boys_doubles' : 'girls_doubles';
      }
    } else if (category === 'mixed_doubles') {
      if (playerGender === 'male') requiredGender = 'female';
      else if (playerGender === 'female') requiredGender = 'male';
    }

    const regQuery = { tournamentId: tournId, status: { $ne: 'rejected' } };
    if (requiredGender) regQuery.gender = requiredGender;

    const [registrations, categoryTeams] = await Promise.all([
      Registration.find(regQuery).populate('participantId').lean(),
      targetTeamCategory && ['boys_doubles', 'girls_doubles', 'mixed_doubles'].includes(targetTeamCategory)
        ? Team.find({ tournamentId: tournId, category: targetTeamCategory, isApproved: true }).lean()
        : Promise.resolve([])
    ]);

    // Map participantId -> existing paired team name in target category
    const pairedTeamMap = new Map();
    for (const t of categoryTeams) {
      if (t.player1) pairedTeamMap.set(t.player1.toString(), t.name);
      if (t.player2) pairedTeamMap.set(t.player2.toString(), t.name);
    }

    const searchLower = String(q || '').trim().toLowerCase();
    const excludeStr = excludeId ? String(excludeId).trim() : '';
    const seenIds = new Set();
    const candidates = [];

    for (const reg of registrations) {
      const p = reg.participantId;
      if (!p || !p._id) continue;
      const pid = p._id.toString();
      if (seenIds.has(pid)) continue;
      if (excludeStr && pid === excludeStr) continue;
      if (requiredGender && p.gender !== requiredGender) continue;

      if (searchLower) {
        const matchesName = p.fullName?.toLowerCase().includes(searchLower);
        const matchesDept = p.department?.toLowerCase().includes(searchLower);
        const matchesStudentId = p.studentId?.toLowerCase().includes(searchLower);
        if (!matchesName && !matchesDept && !matchesStudentId) continue;
      }

      seenIds.add(pid);
      const pairedTeamName = pairedTeamMap.get(pid) || '';

      candidates.push({
        _id: p._id,
        fullName: p.fullName,
        gender: p.gender,
        department: p.department,
        isApproved: Boolean(p.isApproved),
        registrationStatus: reg.status,
        participateSingles: reg.participateSingles !== false,
        participateDoubles: Boolean(reg.participateDoubles),
        participateMixedDoubles: Boolean(reg.participateMixedDoubles),
        isAlreadyPaired: Boolean(pairedTeamName),
        pairedTeamName
      });
    }

    candidates.sort((a, b) => {
      if (a.isAlreadyPaired !== b.isAlreadyPaired) return a.isAlreadyPaired ? 1 : -1;
      return a.fullName.localeCompare(b.fullName);
    });

    res.json({
      success: true,
      count: candidates.length,
      candidates
    });
  } catch (error) {
    next(error);
  }
};

// Public / Participant submission
const submitRegistration = async (req, res, next) => {
  try {
    const {
      fullName,
      gender,
      department,
      email,
      phone,
      password,
      participateSingles,
      participateDoubles,
      participateMixedDoubles,
      doublesPartnerName,
      doublesPartnerId,
      mixedDoublesPartnerName,
      mixedDoublesPartnerId,
      tournamentId
    } = req.body;

    if (!fullName || !gender || !department) {
      return res.status(400).json({
        success: false,
        message: 'Full Legal Name, Gender, and Department are required.'
      });
    }

    // Determine division participation flags
    const cleanDoublesPartner = sanitizePartnerName(doublesPartnerName);
    const cleanMixedPartner = sanitizePartnerName(mixedDoublesPartnerName);

    let isSingles = participateSingles !== undefined
      ? normalizeBooleanParticipation(participateSingles, true)
      : true;
    let isDoubles = participateDoubles !== undefined
      ? normalizeBooleanParticipation(participateDoubles, false)
      : Boolean(doublesPartnerId || cleanDoublesPartner);
    let isMixed = participateMixedDoubles !== undefined
      ? normalizeBooleanParticipation(participateMixedDoubles, false)
      : Boolean(mixedDoublesPartnerId || cleanMixedPartner);

    // Validate that at least ONE division is chosen
    if (!isSingles && !isDoubles && !isMixed) {
      return res.status(400).json({
        success: false,
        message: 'Please select at least one division to participate in (Singles, Doubles, or Mixed Doubles).'
      });
    }

    // Partner validation:
    if (isDoubles && !doublesPartnerId && !cleanDoublesPartner) {
      return res.status(400).json({
        success: false,
        message: `${gender === 'male' ? 'Boys' : 'Girls'} Doubles Partner selection is required when participating in Doubles.`
      });
    }

    if (isMixed && !mixedDoublesPartnerId && !cleanMixedPartner) {
      return res.status(400).json({
        success: false,
        message: 'Mixed Doubles Partner selection is required when participating in Mixed Doubles.'
      });
    }

    const cleanFullName = fullName.replace(/\s+/g, ' ').trim();
    const cleanDepartment = department.replace(/\s+/g, ' ').trim();
    const cleanPhone = String(phone || '').trim();
    const cleanEmail = String(email || '').toLowerCase().trim();
    const cleanPassword = String(password || '').trim();

    let tournId = tournamentId;
    if (!tournId) {
      const activeTourn = await Tournament.findOne().sort({ createdAt: -1 });
      if (!activeTourn) return res.status(400).json({ success: false, message: 'No active tournament found.' });
      tournId = activeTourn._id;
    }

    // Check if tournament registration is open
    const tourn = await Tournament.findById(tournId);
    if (tourn && (tourn.status === 'registration_closed' || tourn.status === 'completed')) {
      return res.status(400).json({ success: false, message: 'Registration for this tournament is currently closed.' });
    }

    // Check duplicate registration first so we have participant._id for self-check
    let participant = await Participant.findOne({
      fullName: { $regex: new RegExp(`^${cleanFullName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') }
    });

    const doublesCat = gender === 'male' ? 'boys_doubles' : 'girls_doubles';
    let resolvedDoubles = { partner: null, partnerName: '', partnerId: null };
    let resolvedMixed = { partner: null, partnerName: '', partnerId: null };

    try {
      if (isDoubles) {
        resolvedDoubles = await resolveAndValidatePartner({
          partnerId: doublesPartnerId,
          partnerName: cleanDoublesPartner,
          registrantId: participant?._id || null,
          registrantName: cleanFullName,
          registrantGender: gender,
          category: doublesCat,
          tournamentId: tournId,
          requireExisting: Boolean(doublesPartnerId)
        });
      }
      if (isMixed) {
        resolvedMixed = await resolveAndValidatePartner({
          partnerId: mixedDoublesPartnerId,
          partnerName: cleanMixedPartner,
          registrantId: participant?._id || null,
          registrantName: cleanFullName,
          registrantGender: gender,
          category: 'mixed_doubles',
          tournamentId: tournId,
          requireExisting: Boolean(mixedDoublesPartnerId)
        });
      }
    } catch (valErr) {
      return res.status(valErr.statusCode || 400).json({
        success: false,
        message: valErr.message
      });
    }

    const finalDoublesPartner = isDoubles ? resolvedDoubles.partnerName : '';
    const finalDoublesPartnerId = isDoubles ? resolvedDoubles.partnerId : null;
    const finalMixedPartner = isMixed ? resolvedMixed.partnerName : '';
    const finalMixedPartnerId = isMixed ? resolvedMixed.partnerId : null;

    if (participant) {
      const existing = await Registration.findOne({
        participantId: participant._id,
        tournamentId: tournId
      });
      if (existing) {
        // If this participant was previously auto-created as a partner and is pending, allow them to update & complete their registration
        if (existing.isAutoCreatedPartner && existing.status === 'pending') {
          existing.participateSingles = isSingles;
          existing.participateDoubles = isDoubles;
          existing.participateMixedDoubles = isMixed;
          if (finalDoublesPartner) existing.doublesPartnerName = finalDoublesPartner;
          if (finalDoublesPartnerId) existing.doublesPartnerId = finalDoublesPartnerId;
          if (finalMixedPartner) existing.mixedDoublesPartnerName = finalMixedPartner;
          if (finalMixedPartnerId) existing.mixedDoublesPartnerId = finalMixedPartnerId;
          existing.isAutoCreatedPartner = false;
          await existing.save();

          if (cleanDepartment && participant.department !== cleanDepartment) {
            participant.department = cleanDepartment;
          }
          if (cleanPhone && !participant.phone) {
            participant.phone = cleanPhone;
          }
          if (cleanEmail && (!participant.email || participant.email.endsWith('@carrom.edu'))) {
            participant.email = cleanEmail;
          }
          await participant.save();

          await ensureParticipantUserAccount({
            participant,
            email: cleanEmail,
            password: cleanPassword,
            phone: cleanPhone
          });

          if (isDoubles && finalDoublesPartner) {
            await ensurePartnerRegistration({
              registrant: participant,
              category: 'doubles',
              partnerName: finalDoublesPartner,
              tournamentId: tournId,
              isApproved: false
            });
          }

          if (isMixed && finalMixedPartner) {
            await ensurePartnerRegistration({
              registrant: participant,
              category: 'mixed_doubles',
              partnerName: finalMixedPartner,
              tournamentId: tournId,
              isApproved: false
            });
          }

          emitCarromLive('carrom:roster_updated', { action: 'submit_registration', participantId: participant._id });
          return res.status(200).json({
            success: true,
            code: 'REGISTRATION_SUBMITTED',
            message: 'Your partner registration has been updated and completed successfully. Your entry is now pending admin approval.',
            registration: existing,
            participant
          });
        }

        return res.status(409).json({
          success: false,
          code: 'ALREADY_REGISTERED',
          message: `${cleanFullName} is already registered for this tournament.`
        });
      }
    } else {
      participant = await Participant.create({
        fullName: cleanFullName,
        gender,
        studentId: '',
        department: cleanDepartment,
        email: cleanEmail,
        phone: cleanPhone,
        isApproved: false
      });
    }

    // Create/link login User account if email, phone, or password was provided
    await ensureParticipantUserAccount({
      participant,
      email: cleanEmail,
      password: cleanPassword,
      phone: cleanPhone
    });

    const registration = await Registration.create({
      participantId: participant._id,
      tournamentId: tournId,
      gender,
      participateSingles: isSingles,
      participateDoubles: isDoubles,
      participateMixedDoubles: isMixed,
      doublesPartnerName: finalDoublesPartner,
      doublesPartnerId: finalDoublesPartnerId,
      mixedDoublesPartnerName: finalMixedPartner,
      mixedDoublesPartnerId: finalMixedPartnerId,
      status: 'pending'
    });

    // Link existing partner or register missing legacy partner without creating duplicates
    if (isDoubles && finalDoublesPartner) {
      await ensurePartnerRegistration({
        registrant: participant,
        category: 'doubles',
        partnerName: finalDoublesPartner,
        tournamentId: tournId,
        isApproved: false
      });
    }

    if (isMixed && finalMixedPartner) {
      await ensurePartnerRegistration({
        registrant: participant,
        category: 'mixed_doubles',
        partnerName: finalMixedPartner,
        tournamentId: tournId,
        isApproved: false
      });
    }

    emitCarromLive('carrom:roster_updated', { action: 'submit_registration', participantId: participant._id });
    res.status(201).json({
      success: true,
      code: 'REGISTRATION_SUBMITTED',
      message: 'Tournament registration submitted successfully. Your entry is now pending admin approval.',
      registration,
      participant
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        code: 'DUPLICATE_REGISTRATION',
        message: 'REGISTRATION ALREADY EXISTS: A registration for this athlete already exists.'
      });
    }
    next(error);
  }
};

// Public Lookup: Check registration and partner status by Full Name or ID
const lookupRegistrationByStudentId = async (req, res, next) => {
  try {
    const rawQuery = req.params.query || req.params.studentId;
    if (!rawQuery) {
      return res.status(400).json({ success: false, message: 'Athlete name is required.' });
    }

    const cleanQuery = rawQuery.trim();
    let participant = null;

    // Check by exact name match (case-insensitive)
    participant = await Participant.findOne({
      fullName: { $regex: new RegExp(`^${cleanQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') }
    });

    // Fallback: partial match or studentId/MongoId
    if (!participant && cleanQuery.length >= 3) {
      const mongoose = require('mongoose');
      if (mongoose.Types.ObjectId.isValid(cleanQuery)) {
        participant = await Participant.findById(cleanQuery);
      }
      if (!participant) {
        participant = await Participant.findOne({
          $or: [
            { fullName: { $regex: new RegExp(cleanQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') } },
            { studentId: cleanQuery.toUpperCase() }
          ]
        });
      }
    }

    if (!participant) {
      return res.status(404).json({
        success: false,
        message: `No registration found for "${cleanQuery}".`
      });
    }

    const registration = await Registration.findOne({ participantId: participant._id })
      .populate('tournamentId')
      .sort({ createdAt: -1 });

    if (!registration) {
      return res.status(404).json({
        success: false,
        message: `No active tournament registration found for ${participant.fullName}.`
      });
    }

    const tournId = registration.tournamentId?._id || registration.tournamentId;
    const doublesCat = participant.gender === 'male' ? 'boys_doubles' : 'girls_doubles';

    const isSingles = registration.participateSingles !== undefined ? registration.participateSingles : true;
    const cleanDoubles = sanitizePartnerName(registration.doublesPartnerName);
    const cleanMixed = sanitizePartnerName(registration.mixedDoublesPartnerName);

    const isDoubles = registration.participateDoubles !== undefined ? registration.participateDoubles : !!cleanDoubles;
    const isMixed = registration.participateMixedDoubles !== undefined ? registration.participateMixedDoubles : !!cleanMixed;

    const [doublesValidation, mixedDoublesValidation] = await Promise.all([
      isDoubles
        ? validatePartnerRequest(
            participant,
            cleanDoubles,
            '',
            doublesCat,
            tournId
          )
        : Promise.resolve({
            isValid: true,
            status: 'not_participating',
            message: 'Not participating in Doubles (Optional)',
            requestedName: '',
            partner: null,
            team: null,
            canPair: false
          }),
      isMixed
        ? validatePartnerRequest(
            participant,
            cleanMixed,
            '',
            'mixed_doubles',
            tournId
          )
        : Promise.resolve({
            isValid: true,
            status: 'not_participating',
            message: 'Not participating in Mixed Doubles (Optional)',
            requestedName: '',
            partner: null,
            team: null,
            canPair: false
          })
    ]);

    const enrolledEvents = [];
    if (isSingles) {
      enrolledEvents.push(participant.gender === 'male' ? 'Boys Singles' : 'Girls Singles');
    }
    if (isDoubles) {
      enrolledEvents.push(participant.gender === 'male' ? 'Boys Doubles' : 'Girls Doubles');
    }
    if (isMixed) {
      enrolledEvents.push('Mixed Doubles');
    }

    res.json({
      success: true,
      participant,
      registration,
      doublesValidation,
      mixedDoublesValidation,
      events: enrolledEvents
    });
  } catch (error) {
    next(error);
  }
};

// Admin: Get all registrations with filtering and partner validation enrichment
const getAllRegistrations = async (req, res, next) => {
  try {
    const { status, gender, search, tournamentId } = req.query;

    let query = {};
    if (status) query.status = status;
    if (gender) query.gender = gender;

    let tournId = tournamentId;
    if (!tournId) {
      const activeTourn = await Tournament.findOne().sort({ createdAt: -1 });
      if (activeTourn) tournId = activeTourn._id;
    }
    if (tournId) query.tournamentId = tournId;

    let registrations = await Registration.find(query)
      .populate('participantId')
      .sort({ createdAt: -1 })
      .lean();

    if (search) {
      const s = search.toLowerCase();
      registrations = registrations.filter((r) => {
        const p = r.participantId;
        if (!p) return false;
        return (
          p.fullName.toLowerCase().includes(s) ||
          (p.studentId && p.studentId.toLowerCase().includes(s)) ||
          p.department.toLowerCase().includes(s) ||
          (r.doublesPartnerName && r.doublesPartnerName.toLowerCase().includes(s)) ||
          (r.mixedDoublesPartnerName && r.mixedDoublesPartnerName.toLowerCase().includes(s))
        );
      });
    }

    const enrichedRegistrations = await enrichRegistrationsWithValidation(registrations, tournId);

    res.json({ success: true, count: enrichedRegistrations.length, registrations: enrichedRegistrations });
  } catch (error) {
    next(error);
  }
};

// Admin: Get tournament partner validation summary report
const getValidationSummary = async (req, res, next) => {
  try {
    let tournId = req.query.tournamentId;
    if (!tournId) {
      const activeTourn = await Tournament.findOne().sort({ createdAt: -1 });
      if (activeTourn) tournId = activeTourn._id;
    }

    const report = await getTournamentEntryValidationReport(tournId);
    res.json({ success: true, report });
  } catch (error) {
    next(error);
  }
};

// Participant: View own registration, approved teams & match schedule
const getMyRegistration = async (req, res, next) => {
  try {
    if (!req.user || req.user.role !== 'participant') {
      return res.status(403).json({ success: false, message: 'Participant portal access only.' });
    }

    const participant = await Participant.findOne({
      $or: [{ userId: req.user._id }, { email: req.user.email }, { fullName: req.user.fullName }]
    });

    if (!participant) {
      return res.status(404).json({ success: false, message: 'No participant record found.' });
    }

    const registration = await Registration.findOne({ participantId: participant._id })
      .populate('tournamentId')
      .sort({ createdAt: -1 });

    const teams = await Team.find({
      $or: [{ player1: participant._id }, { player2: participant._id }]
    }).populate('player1').populate('player2');

    const teamIds = teams.map((t) => t._id);

    const matches = await Match.find({
      $or: [{ team1: { $in: teamIds } }, { team2: { $in: teamIds } }]
    })
      .populate('team1')
      .populate('team2')
      .populate('winnerTeam')
      .sort({ roundNumber: 1, matchNumber: 1 });

    res.json({
      success: true,
      participant,
      registration,
      teams,
      matches
    });
  } catch (error) {
    next(error);
  }
};

// Admin: Update registration status (Approve / Reject)
const updateRegistrationStatus = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status, adminNotes } = req.body;

    if (!['pending', 'approved', 'rejected'].includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid status.' });
    }

    const registration = await Registration.findById(id).populate('participantId');
    if (!registration) {
      return res.status(404).json({ success: false, message: 'Registration record not found.' });
    }

    registration.status = status;
    if (adminNotes !== undefined) registration.adminNotes = adminNotes;
    await registration.save();

    // If approved, update participant approved status and auto-pair all entries
    if (registration.participantId) {
      await Participant.findByIdAndUpdate(registration.participantId._id, {
        isApproved: status === 'approved'
      });

      if (status === 'approved') {
        const cleanDoubles = sanitizePartnerName(registration.doublesPartnerName);
        const cleanMixed = sanitizePartnerName(registration.mixedDoublesPartnerName);

        if (registration.participateDoubles && cleanDoubles) {
          const doublesPartner = await Participant.findOne({
            fullName: { $regex: new RegExp(`^${cleanDoubles.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') }
          });
          if (doublesPartner) {
            const partnerReg = await Registration.findOne({
              participantId: doublesPartner._id,
              tournamentId: registration.tournamentId
            });
            // If partner was auto-created or is pending without singles, auto-approve them with the primary registrant
            if (partnerReg && partnerReg.status !== 'approved' && !partnerReg.participateSingles) {
              partnerReg.status = 'approved';
              await partnerReg.save();
              doublesPartner.isApproved = true;
              await doublesPartner.save();
            }
          }
        }

        if (registration.participateMixedDoubles && cleanMixed) {
          const mixedPartner = await Participant.findOne({
            fullName: { $regex: new RegExp(`^${cleanMixed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') }
          });
          if (mixedPartner) {
            const partnerReg = await Registration.findOne({
              participantId: mixedPartner._id,
              tournamentId: registration.tournamentId
            });
            if (partnerReg && partnerReg.status !== 'approved' && !partnerReg.participateSingles) {
              partnerReg.status = 'approved';
              await partnerReg.save();
              mixedPartner.isApproved = true;
              await mixedPartner.save();
            }
          }
        }

        const { syncAndAutoPairTournamentEntries } = require('../services/partnerValidationEngine');
        await syncAndAutoPairTournamentEntries(registration.tournamentId);
      }
    }

    await AuditLog.create({
      action: 'UPDATE_REGISTRATION_STATUS',
      performedBy: req.user._id,
      performedByName: req.user.fullName,
      entityType: 'Registration',
      entityId: registration._id.toString(),
      details: {
        participant: registration.participantId ? registration.participantId.fullName : 'Unknown',
        newStatus: status
      },
      reason: `Admin updated registration status to ${status}.`
    });

    emitCarromLive('carrom:roster_updated', { action: 'update_status', status, registrationId: registration._id });
    res.json({ success: true, message: `Registration ${status} successfully.`, registration });
  } catch (error) {
    next(error);
  }
};

// Admin: Edit registration details (Admin Override for genuine mistakes)
const adminEditRegistration = async (req, res, next) => {
  try {
    const {
      id
    } = req.params;
    const {
      fullName,
      department,
      participateSingles,
      participateDoubles,
      participateMixedDoubles,
      doublesPartnerName,
      doublesPartnerId,
      mixedDoublesPartnerName,
      mixedDoublesPartnerId,
      adminNotes
    } = req.body;

    const registration = await Registration.findById(id).populate('participantId');
    if (!registration) {
      return res.status(404).json({ success: false, message: 'Registration record not found.' });
    }

    const participant = registration.participantId;
    const prevName = participant?.fullName || '';
    const nextName = fullName ? fullName.replace(/\s+/g, ' ').trim() : prevName;
    const doublesCat = (participant?.gender || registration.gender) === 'male' ? 'boys_doubles' : 'girls_doubles';

    if (participateSingles !== undefined) registration.participateSingles = !!participateSingles;
    if (participateDoubles !== undefined) registration.participateDoubles = !!participateDoubles;
    if (participateMixedDoubles !== undefined) registration.participateMixedDoubles = !!participateMixedDoubles;

    // Validate & resolve Doubles partner selection if participating
    if (!registration.participateDoubles) {
      registration.doublesPartnerName = '';
      registration.doublesPartnerId = null;
    } else if (doublesPartnerId !== undefined || doublesPartnerName !== undefined) {
      try {
        const resolved = await resolveAndValidatePartner({
          partnerId: doublesPartnerId || null,
          partnerName: doublesPartnerName || '',
          registrantId: participant?._id || null,
          registrantName: nextName,
          registrantGender: participant?.gender || registration.gender,
          category: doublesCat,
          tournamentId: registration.tournamentId,
          requireExisting: Boolean(doublesPartnerId)
        });
        registration.doublesPartnerId = resolved.partnerId;
        registration.doublesPartnerName = resolved.partnerName;
      } catch (valErr) {
        return res.status(valErr.statusCode || 400).json({ success: false, message: valErr.message });
      }
    }

    // Validate & resolve Mixed Doubles partner selection if participating
    if (!registration.participateMixedDoubles) {
      registration.mixedDoublesPartnerName = '';
      registration.mixedDoublesPartnerId = null;
    } else if (mixedDoublesPartnerId !== undefined || mixedDoublesPartnerName !== undefined) {
      try {
        const resolved = await resolveAndValidatePartner({
          partnerId: mixedDoublesPartnerId || null,
          partnerName: mixedDoublesPartnerName || '',
          registrantId: participant?._id || null,
          registrantName: nextName,
          registrantGender: participant?.gender || registration.gender,
          category: 'mixed_doubles',
          tournamentId: registration.tournamentId,
          requireExisting: Boolean(mixedDoublesPartnerId)
        });
        registration.mixedDoublesPartnerId = resolved.partnerId;
        registration.mixedDoublesPartnerName = resolved.partnerName;
      } catch (valErr) {
        return res.status(valErr.statusCode || 400).json({ success: false, message: valErr.message });
      }
    }

    if (adminNotes !== undefined) registration.adminNotes = adminNotes;
    await registration.save();

    if (participant) {
      if (fullName) participant.fullName = nextName;
      if (department) participant.department = department.replace(/\s+/g, ' ').trim();
      await participant.save();

      // Propagate participant name change across Teams and partner Registrations
      if (fullName && nextName !== prevName) {
        const linkedTeams = await Team.find({
          tournamentId: registration.tournamentId,
          $or: [{ player1: participant._id }, { player2: participant._id }]
        }).populate('player1').populate('player2');

        for (const t of linkedTeams) {
          const updatedName = t.player2
            ? `${t.player1?.fullName || ''} & ${t.player2?.fullName || ''}`
            : t.player1?.fullName || nextName;
          if (t.name !== updatedName) {
            t.name = updatedName;
            await t.save();
          }
        }

        await Promise.all([
          Registration.updateMany(
            { tournamentId: registration.tournamentId, doublesPartnerId: participant._id },
            { $set: { doublesPartnerName: nextName } }
          ),
          Registration.updateMany(
            { tournamentId: registration.tournamentId, mixedDoublesPartnerId: participant._id },
            { $set: { mixedDoublesPartnerName: nextName } }
          )
        ]);
      }
    }

    // Auto-link/sync partner(s) if added/edited
    if (participant && registration.participateDoubles && registration.doublesPartnerName) {
      await ensurePartnerRegistration({
        registrant: participant,
        category: 'doubles',
        partnerName: registration.doublesPartnerName,
        tournamentId: registration.tournamentId,
        isApproved: registration.status === 'approved'
      });
    }

    if (participant && registration.participateMixedDoubles && registration.mixedDoublesPartnerName) {
      await ensurePartnerRegistration({
        registrant: participant,
        category: 'mixed_doubles',
        partnerName: registration.mixedDoublesPartnerName,
        tournamentId: registration.tournamentId,
        isApproved: registration.status === 'approved'
      });
    }

    // Sync Team rosters if this registration is already approved
    if (registration.status === 'approved') {
      const { syncAndAutoPairTournamentEntries } = require('../services/partnerValidationEngine');
      await syncAndAutoPairTournamentEntries(registration.tournamentId);
    }

    await AuditLog.create({
      action: 'ADMIN_EDIT_REGISTRATION',
      performedBy: req.user._id,
      performedByName: req.user.fullName,
      entityType: 'Registration',
      entityId: registration._id.toString(),
      details: {
        participant: participant?.fullName,
        doublesPartnerName: registration.doublesPartnerName,
        mixedDoublesPartnerName: registration.mixedDoublesPartnerName
      },
      reason: 'Admin modified registration details.'
    });

    emitCarromLive('carrom:roster_updated', { action: 'admin_edit_registration', registrationId: registration._id });
    res.json({
      success: true,
      message: 'Registration updated successfully by admin.',
      registration
    });
  } catch (error) {
    next(error);
  }
};

// Admin: Delete registration and participant
const deleteRegistration = async (req, res, next) => {
  try {
    const { id } = req.params;
    const registration = await Registration.findById(id).populate('participantId');
    if (!registration) {
      return res.status(404).json({ success: false, message: 'Registration not found.' });
    }

    const participant = registration.participantId;
    const participantName = participant ? participant.fullName : 'Unknown';

    if (participant) {
      await Team.deleteMany({
        $or: [{ player1: participant._id }, { player2: participant._id }]
      });

      if (participant.userId) {
        await User.findByIdAndDelete(participant.userId);
      }
      if (participant.email) {
        await User.deleteMany({ email: participant.email.toLowerCase() });
      }

      await Participant.findByIdAndDelete(participant._id);
    }

    await Registration.findByIdAndDelete(id);

    await AuditLog.create({
      action: 'DELETE_REGISTRATION',
      performedBy: req.user._id,
      performedByName: req.user.fullName,
      entityType: 'Registration',
      entityId: id,
      details: {
        participant: participantName,
        department: participant?.department
      },
      reason: `Admin deleted registration for ${participantName}.`
    });

    emitCarromLive('carrom:roster_updated', { action: 'delete_registration', registrationId: id });
    res.json({
      success: true,
      message: `Registration for ${participantName} deleted successfully.`
    });
  } catch (error) {
    next(error);
  }
};

// Admin: Bulk delete registrations (selected IDs or all)
const bulkDeleteRegistrations = async (req, res, next) => {
  try {
    const { ids, tournamentId } = req.body || {};
    let tournId = tournamentId;
    if (!tournId) {
      const activeTourn = await Tournament.findOne().sort({ createdAt: -1 });
      if (activeTourn) tournId = activeTourn._id;
    }

    let query = {};
    if (tournId) query.tournamentId = tournId;
    if (ids && Array.isArray(ids) && ids.length > 0) {
      query._id = { $in: ids };
    }

    const registrations = await Registration.find(query).populate('participantId');
    const count = registrations.length;

    for (const reg of registrations) {
      const p = reg.participantId;
      if (p) {
        await Team.deleteMany({
          $or: [{ player1: p._id }, { player2: p._id }]
        });

        if (p.userId) {
          await User.findByIdAndDelete(p.userId);
        }
        if (p.email) {
          await User.deleteMany({ email: p.email.toLowerCase() });
        }

        await Participant.findByIdAndDelete(p._id);
      }
      await Registration.findByIdAndDelete(reg._id);
    }

    // If deleting all, unlock tournament draws
    if (!ids || ids.length === 0) {
      const tournament = await Tournament.findById(tournId);
      if (tournament) {
        tournament.drawsLocked = {
          boys_singles: false,
          girls_singles: false,
          boys_doubles: false,
          girls_doubles: false,
          mixed_doubles: false
        };
        tournament.drawsPublished = {
          boys_singles: false,
          girls_singles: false,
          boys_doubles: false,
          girls_doubles: false,
          mixed_doubles: false
        };
        tournament.markModified('drawsLocked');
        tournament.markModified('drawsPublished');
        await tournament.save();
      }
      await Match.deleteMany({ tournamentId: tournId });
    }

    if (req.user) {
      await AuditLog.create({
        action: 'BULK_DELETE_REGISTRATIONS',
        performedBy: req.user._id,
        performedByName: req.user.fullName,
        entityType: 'Registration',
        entityId: tournId ? tournId.toString() : 'ALL',
        details: { deletedCount: count },
        reason: `Admin bulk deleted ${count} registrations and participant records.`
      });
    }

    emitCarromLive('carrom:roster_updated', { action: 'bulk_delete', deletedCount: count });
    res.json({
      success: true,
      message: `Successfully deleted ${count} participant registration(s).`,
      deletedCount: count
    });
  } catch (error) {
    next(error);
  }
};

// Admin: Bulk Import participants from CSV data (Supporting all 5 tournament divisions)
const importParticipants = async (req, res, next) => {
  try {
    const { participants, tournamentId } = req.body || {};

    if (!participants || !Array.isArray(participants) || participants.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No participant data provided for import.'
      });
    }

    let tournId = tournamentId;
    if (!tournId) {
      const activeTourn = await Tournament.findOne().sort({ createdAt: -1 });
      if (!activeTourn) {
        return res.status(400).json({
          success: false,
          message: 'No active tournament found.'
        });
      }
      tournId = activeTourn._id;
    }

    const imported = [];
    const skipped = [];
    const errors = [];

    // Helper to sanitize partner names (never allow boolean strings)
    const sanitizePartner = (val) => {
      if (!val) return '';
      const s = String(val).replace(/\s+/g, ' ').trim();
      const lower = s.toLowerCase();
      if (['yes', 'no', 'true', 'false', '0', '1', 'none', 'n/a', 'na', '-', 'nil', 'null', 'undefined'].includes(lower)) {
        return '';
      }
      return s;
    };

    const normalizeBool = (val, defaultVal = false) => {
      if (val === undefined || val === null || val === '') return defaultVal;
      if (typeof val === 'boolean') return val;
      const s = String(val).trim().toLowerCase();
      if (['yes', 'true', '1', 'y'].includes(s)) return true;
      if (['no', 'false', '0', 'n', 'none', 'na', 'n/a', '-'].includes(s)) return false;
      return defaultVal;
    };

    // Process each participant row
    for (let i = 0; i < participants.length; i++) {
      const raw = participants[i];
      const rowNum = i + 1;

      // Extract and clean fields with flexible alias support
      const rawName = (raw.fullName || raw.name || raw.athlete || raw.player || '').replace(/\s+/g, ' ').trim();
      const rawGender = (raw.gender || raw.sex || '').trim().toLowerCase();
      const rawDept = (raw.department || raw.dept || raw.major || raw.branch || '').replace(/\s+/g, ' ').trim();
      const rawPhone = String(raw.phone || raw.whatsapp || raw.mobile || raw.contact || '').replace(/\s+/g, ' ').trim();

      // Partner fields strictly sanitized (cannot be Yes/No/True/False)
      const rawBoysDoubles = sanitizePartner(raw.boysDoublesPartner || raw.boysPartner || raw.boysDoubles);
      const rawGirlsDoubles = sanitizePartner(raw.girlsDoublesPartner || raw.girlsPartner || raw.girlsDoubles);
      const rawUnifiedDoubles = sanitizePartner(raw.doublesPartnerName || raw.doublesPartner || raw.partner);
      const rawMixed = sanitizePartner(raw.mixedDoublesPartner || raw.mixedDoublesPartnerName || raw.mixedPartner || raw.mixedDoubles);

      // 1. Validation: Full Name
      if (!rawName) {
        errors.push({ row: rowNum, name: 'Unknown', reason: 'Missing Full Name' });
        continue;
      }

      // 2. Validation & Normalization: Gender
      let normalizedGender = '';
      if (['m', 'male', 'boy', 'boys'].includes(rawGender)) {
        normalizedGender = 'male';
      } else if (['f', 'female', 'girl', 'girls'].includes(rawGender)) {
        normalizedGender = 'female';
      } else {
        errors.push({ row: rowNum, name: rawName, reason: `Invalid gender: "${raw.gender}". Must be Male or Female.` });
        continue;
      }

      // 3. Validation: Department
      if (!rawDept) {
        errors.push({ row: rowNum, name: rawName, reason: 'Missing Department / Major' });
        continue;
      }

      // 4. Gender compatibility with Boys/Girls Doubles
      let candidateDoublesPartner = '';
      if (normalizedGender === 'male') {
        if (rawGirlsDoubles) {
          errors.push({
            row: rowNum,
            name: rawName,
            reason: `Invalid Girls Doubles partner "${rawGirlsDoubles}": Male player cannot participate in Girls Doubles.`
          });
          continue;
        }
        candidateDoublesPartner = rawBoysDoubles || rawUnifiedDoubles;
      } else {
        if (rawBoysDoubles) {
          errors.push({
            row: rowNum,
            name: rawName,
            reason: `Invalid Boys Doubles partner "${rawBoysDoubles}": Female player cannot participate in Boys Doubles.`
          });
          continue;
        }
        candidateDoublesPartner = rawGirlsDoubles || rawUnifiedDoubles;
      }
      const candidateMixedPartner = rawMixed;

      // Division participation detection from CSV
      // Singles
      let isSingles = true;
      const rawSinglesCol = raw.participateSingles ?? raw.singles ?? raw.singlesEvent ?? raw.singlesOnly;
      if (rawSinglesCol !== undefined && rawSinglesCol !== null && rawSinglesCol !== '') {
        isSingles = normalizeBool(rawSinglesCol, true);
      } else if (raw.doublesOnly || raw.mixedOnly) {
        if (raw.doublesOnly && String(raw.doublesOnly).toLowerCase() === 'yes') isSingles = false;
        if (raw.mixedOnly && String(raw.mixedOnly).toLowerCase() === 'yes') isSingles = false;
      }

      // Doubles
      let isDoubles = false;
      const rawDoublesCol = raw.participateDoubles ?? raw.doubles;
      if (rawDoublesCol !== undefined && rawDoublesCol !== null && rawDoublesCol !== '') {
        isDoubles = normalizeBool(rawDoublesCol, false);
      } else {
        isDoubles = !!candidateDoublesPartner;
      }

      // Mixed Doubles
      let isMixed = false;
      const rawMixedCol = raw.participateMixedDoubles ?? raw.mixed;
      if (rawMixedCol !== undefined && rawMixedCol !== null && rawMixedCol !== '') {
        isMixed = normalizeBool(rawMixedCol, false);
      } else {
        isMixed = !!candidateMixedPartner;
      }

      // Ensure participation in at least one division
      if (!isSingles && !isDoubles && !isMixed) {
        isSingles = true;
      }

      // Enforce data rule: if not participating, partner fields MUST be empty
      const assignedDoublesPartner = isDoubles ? candidateDoublesPartner : '';
      const assignedMixedPartner = isMixed ? candidateMixedPartner : '';

      // Validate partner requirement when participating
      if (isDoubles && !assignedDoublesPartner) {
        errors.push({
          row: rowNum,
          name: rawName,
          reason: `Participate Doubles is Yes but ${normalizedGender === 'male' ? 'Boys' : 'Girls'} Doubles Partner is missing.`
        });
        continue;
      }

      if (isMixed && !assignedMixedPartner) {
        errors.push({
          row: rowNum,
          name: rawName,
          reason: 'Participate Mixed Doubles is Yes but Mixed Doubles Partner is missing.'
        });
        continue;
      }

      try {
        // 5. Duplicate Check: Search existing Participant by exact Name (case-insensitive)
        const escapedName = rawName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        let participant = await Participant.findOne({
          fullName: { $regex: new RegExp(`^${escapedName}$`, 'i') }
        });

        if (participant) {
          // Check if already registered in the current tournament
          const existingReg = await Registration.findOne({
            participantId: participant._id,
            tournamentId: tournId
          });

          if (existingReg) {
            if (existingReg.status === 'approved') {
              // Already approved -> skip to protect locked tournament entries
              skipped.push({
                row: rowNum,
                name: participant.fullName,
                reason: `Already registered and approved in tournament`
              });
              continue;
            }

            // Pending registration -> update participation and partner nominations
            existingReg.participateSingles = isSingles;
            existingReg.participateDoubles = isDoubles;
            existingReg.participateMixedDoubles = isMixed;
            existingReg.doublesPartnerName = assignedDoublesPartner;
            existingReg.mixedDoublesPartnerName = assignedMixedPartner;
            if (normalizedGender) existingReg.gender = normalizedGender;
            await existingReg.save();

            if (rawDept && participant.department !== rawDept) {
              participant.department = rawDept;
              await participant.save();
            }

            if (isDoubles && assignedDoublesPartner) {
              await ensurePartnerRegistration({
                registrant: participant,
                category: 'doubles',
                partnerName: assignedDoublesPartner,
                tournamentId: tournId,
                isApproved: false
              });
            }
            if (isMixed && assignedMixedPartner) {
              await ensurePartnerRegistration({
                registrant: participant,
                category: 'mixed_doubles',
                partnerName: assignedMixedPartner,
                tournamentId: tournId,
                isApproved: false
              });
            }

            imported.push({
              row: rowNum,
              name: participant.fullName,
              gender: normalizedGender,
              department: participant.department,
              updated: true
            });
            continue;
          } else {
            // Participant existed in database from past records, create registration for this tournament
            await Registration.create({
              participantId: participant._id,
              tournamentId: tournId,
              gender: normalizedGender,
              participateSingles: isSingles,
              participateDoubles: isDoubles,
              participateMixedDoubles: isMixed,
              doublesPartnerName: assignedDoublesPartner,
              mixedDoublesPartnerName: assignedMixedPartner,
              status: 'pending'
            });

            if (rawDept && participant.department !== rawDept) {
              participant.department = rawDept;
              await participant.save();
            }

            if (isDoubles && assignedDoublesPartner) {
              await ensurePartnerRegistration({
                registrant: participant,
                category: 'doubles',
                partnerName: assignedDoublesPartner,
                tournamentId: tournId,
                isApproved: false
              });
            }
            if (isMixed && assignedMixedPartner) {
              await ensurePartnerRegistration({
                registrant: participant,
                category: 'mixed_doubles',
                partnerName: assignedMixedPartner,
                tournamentId: tournId,
                isApproved: false
              });
            }

            imported.push({
              row: rowNum,
              name: participant.fullName,
              gender: normalizedGender,
              department: participant.department
            });
            continue;
          }
        }

        // 6. Create new Participant record (Simple profile, no password/login account)
        participant = await Participant.create({
          fullName: rawName,
          gender: normalizedGender,
          studentId: '',
          department: rawDept,
          email: '',
          phone: rawPhone,
          isApproved: false
        });

        // 7. Create new Registration record in standard pending status
        await Registration.create({
          participantId: participant._id,
          tournamentId: tournId,
          gender: normalizedGender,
          participateSingles: isSingles,
          participateDoubles: isDoubles,
          participateMixedDoubles: isMixed,
          doublesPartnerName: assignedDoublesPartner,
          mixedDoublesPartnerName: assignedMixedPartner,
          status: 'pending'
        });

        if (isDoubles && assignedDoublesPartner) {
          await ensurePartnerRegistration({
            registrant: participant,
            category: 'doubles',
            partnerName: assignedDoublesPartner,
            tournamentId: tournId,
            isApproved: false
          });
        }
        if (isMixed && assignedMixedPartner) {
          await ensurePartnerRegistration({
            registrant: participant,
            category: 'mixed_doubles',
            partnerName: assignedMixedPartner,
            tournamentId: tournId,
            isApproved: false
          });
        }

        imported.push({
          row: rowNum,
          name: participant.fullName,
          gender: normalizedGender,
          department: participant.department
        });
      } catch (rowErr) {
        errors.push({
          row: rowNum,
          name: rawName,
          reason: rowErr.message || 'Database error processing record'
        });
      }
    }

    // 8. Record Admin Audit Log
    if (req.user) {
      await AuditLog.create({
        action: 'IMPORT_PARTICIPANTS',
        performedBy: req.user._id,
        performedByName: req.user.fullName,
        entityType: 'Registration',
        entityId: tournId.toString(),
        details: {
          totalReceived: participants.length,
          importedCount: imported.length,
          skippedCount: skipped.length,
          rejectedCount: errors.length
        },
        reason: `Admin imported ${imported.length} player(s) from CSV bulk data across 5 divisions.`
      });
    }

    emitCarromLive('carrom:roster_updated', { action: 'import_participants', imported: imported.length });
    res.json({
      success: true,
      message: `Import complete: ${imported.length} players imported, ${skipped.length} duplicates skipped, ${errors.length} rejected.`,
      summary: {
        total: participants.length,
        imported: imported.length,
        skipped: skipped.length,
        rejected: errors.length,
        importedPlayers: imported,
        skippedPlayers: skipped,
        errors
      }
    });
  } catch (error) {
    next(error);
  }
};

// Admin: Add a single player manually
const adminAddPlayer = async (req, res, next) => {
  try {
    const {
      fullName,
      gender,
      department,
      email,
      password,
      phone,
      participateSingles,
      participateDoubles,
      participateMixedDoubles,
      boysDoublesPartner,
      girlsDoublesPartner,
      doublesPartnerName,
      doublesPartnerId,
      mixedDoublesPartnerName,
      mixedDoublesPartner,
      mixedDoublesPartnerId,
      tournamentId
    } = req.body;

    if (!fullName || !gender || !department) {
      return res.status(400).json({
        success: false,
        message: 'Full Name, Gender, and Department are required.'
      });
    }

    const cleanName = fullName.replace(/\s+/g, ' ').trim();
    const cleanDept = department.replace(/\s+/g, ' ').trim();
    const cleanPhone = String(phone || '').trim();
    const gLower = gender.toLowerCase().trim();
    let normalizedGender = '';
    if (['m', 'male', 'boy', 'boys'].includes(gLower)) normalizedGender = 'male';
    else if (['f', 'female', 'girl', 'girls'].includes(gLower)) normalizedGender = 'female';
    else {
      return res.status(400).json({
        success: false,
        message: `Invalid gender "${gender}". Expected Male or Female.`
      });
    }

    let candidateDoubles = (normalizedGender === 'male' ? (boysDoublesPartner || doublesPartnerName) : (girlsDoublesPartner || doublesPartnerName)) || '';
    candidateDoubles = sanitizePartnerName(candidateDoubles);

    let candidateMixed = sanitizePartnerName(mixedDoublesPartnerName || mixedDoublesPartner || '');

    let isDoubles = participateDoubles !== undefined
      ? normalizeBooleanParticipation(participateDoubles, false)
      : Boolean(doublesPartnerId || candidateDoubles);
    let isMixed = participateMixedDoubles !== undefined
      ? normalizeBooleanParticipation(participateMixedDoubles, false)
      : Boolean(mixedDoublesPartnerId || candidateMixed);
    let isSingles = participateSingles !== undefined
      ? normalizeBooleanParticipation(participateSingles, true)
      : true;

    if (!isSingles && !isDoubles && !isMixed) {
      return res.status(400).json({
        success: false,
        message: 'Please select at least one division to participate in.'
      });
    }

    let tournId = tournamentId;
    if (!tournId) {
      const activeTourn = await Tournament.findOne().sort({ createdAt: -1 });
      if (!activeTourn) {
        return res.status(400).json({ success: false, message: 'No active tournament found.' });
      }
      tournId = activeTourn._id;
    }

    // Check if participant already exists by name
    const escapedName = cleanName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    let participant = await Participant.findOne({
      fullName: { $regex: new RegExp(`^${escapedName}$`, 'i') }
    });

    const doublesCat = normalizedGender === 'male' ? 'boys_doubles' : 'girls_doubles';
    let resolvedDoubles = { partner: null, partnerName: '', partnerId: null };
    let resolvedMixed = { partner: null, partnerName: '', partnerId: null };

    try {
      if (isDoubles) {
        resolvedDoubles = await resolveAndValidatePartner({
          partnerId: doublesPartnerId,
          partnerName: candidateDoubles,
          registrantId: participant?._id || null,
          registrantName: cleanName,
          registrantGender: normalizedGender,
          category: doublesCat,
          tournamentId: tournId,
          requireExisting: Boolean(doublesPartnerId)
        });
      }
      if (isMixed) {
        resolvedMixed = await resolveAndValidatePartner({
          partnerId: mixedDoublesPartnerId,
          partnerName: candidateMixed,
          registrantId: participant?._id || null,
          registrantName: cleanName,
          registrantGender: normalizedGender,
          category: 'mixed_doubles',
          tournamentId: tournId,
          requireExisting: Boolean(mixedDoublesPartnerId)
        });
      }
    } catch (valErr) {
      return res.status(valErr.statusCode || 400).json({ success: false, message: valErr.message });
    }

    const assignedDoubles = isDoubles ? resolvedDoubles.partnerName : '';
    const assignedDoublesId = isDoubles ? resolvedDoubles.partnerId : null;
    const assignedMixed = isMixed ? resolvedMixed.partnerName : '';
    const assignedMixedId = isMixed ? resolvedMixed.partnerId : null;

    if (participant) {
      const existingReg = await Registration.findOne({
        participantId: participant._id,
        tournamentId: tournId
      });

      if (existingReg) {
        if (existingReg.status === 'approved') {
          return res.status(400).json({
            success: false,
            message: `Athlete "${participant.fullName}" is already registered and approved in this tournament.`
          });
        }

        // Update pending registration
        existingReg.participateSingles = isSingles;
        existingReg.participateDoubles = isDoubles;
        existingReg.participateMixedDoubles = isMixed;
        existingReg.doublesPartnerName = assignedDoubles;
        existingReg.doublesPartnerId = assignedDoublesId;
        existingReg.mixedDoublesPartnerName = assignedMixed;
        existingReg.mixedDoublesPartnerId = assignedMixedId;
        if (normalizedGender) existingReg.gender = normalizedGender;
        await existingReg.save();

        if (cleanDept && participant.department !== cleanDept) {
          participant.department = cleanDept;
          await participant.save();
        }

        if (isDoubles && assignedDoubles) {
          await ensurePartnerRegistration({
            registrant: participant,
            category: 'doubles',
            partnerName: assignedDoubles,
            tournamentId: tournId,
            isApproved: false
          });
        }
        if (isMixed && assignedMixed) {
          await ensurePartnerRegistration({
            registrant: participant,
            category: 'mixed_doubles',
            partnerName: assignedMixed,
            tournamentId: tournId,
            isApproved: false
          });
        }

        return res.json({
          success: true,
          message: `Player "${participant.fullName}" updated in pending registrations.`,
          registration: existingReg,
          participant
        });
      } else {
        // Create registration for this tournament
        const reg = await Registration.create({
          participantId: participant._id,
          tournamentId: tournId,
          gender: normalizedGender,
          participateSingles: isSingles,
          participateDoubles: isDoubles,
          participateMixedDoubles: isMixed,
          doublesPartnerName: assignedDoubles,
          doublesPartnerId: assignedDoublesId,
          mixedDoublesPartnerName: assignedMixed,
          mixedDoublesPartnerId: assignedMixedId,
          status: 'pending'
        });

        if (cleanDept && participant.department !== cleanDept) {
          participant.department = cleanDept;
          await participant.save();
        }

        if (isDoubles && assignedDoubles) {
          await ensurePartnerRegistration({
            registrant: participant,
            category: 'doubles',
            partnerName: assignedDoubles,
            tournamentId: tournId,
            isApproved: false
          });
        }
        if (isMixed && assignedMixed) {
          await ensurePartnerRegistration({
            registrant: participant,
            category: 'mixed_doubles',
            partnerName: assignedMixed,
            tournamentId: tournId,
            isApproved: false
          });
        }

        return res.json({
          success: true,
          message: `Player "${participant.fullName}" added to tournament.`,
          registration: reg,
          participant
        });
      }
    }

    const cleanEmailInput = String(email || '').toLowerCase().trim();
    const cleanPassInput = String(password || '').trim();

    // Create new Participant & Registration
    participant = await Participant.create({
      fullName: cleanName,
      gender: normalizedGender,
      studentId: '',
      department: cleanDept,
      email: cleanEmailInput,
      phone: cleanPhone,
      isApproved: false
    });

    await ensureParticipantUserAccount({
      participant,
      email: cleanEmailInput,
      password: cleanPassInput,
      phone: cleanPhone
    });

    const registration = await Registration.create({
      participantId: participant._id,
      tournamentId: tournId,
      gender: normalizedGender,
      participateSingles: isSingles,
      participateDoubles: isDoubles,
      participateMixedDoubles: isMixed,
      doublesPartnerName: assignedDoubles,
      doublesPartnerId: assignedDoublesId,
      mixedDoublesPartnerName: assignedMixed,
      mixedDoublesPartnerId: assignedMixedId,
      status: 'pending'
    });

    if (isDoubles && assignedDoubles) {
      await ensurePartnerRegistration({
        registrant: participant,
        category: 'doubles',
        partnerName: assignedDoubles,
        tournamentId: tournId,
        isApproved: false
      });
    }
    if (isMixed && assignedMixed) {
      await ensurePartnerRegistration({
        registrant: participant,
        category: 'mixed_doubles',
        partnerName: assignedMixed,
        tournamentId: tournId,
        isApproved: false
      });
    }

    if (req.user) {
      await AuditLog.create({
        action: 'ADMIN_ADD_PLAYER',
        performedBy: req.user._id,
        performedByName: req.user.fullName,
        entityType: 'Registration',
        entityId: registration._id.toString(),
        details: {
          participant: cleanName,
          gender: normalizedGender,
          department: cleanDept,
          doublesPartnerName: assignedDoubles,
          mixedDoublesPartnerName: assignedMixed
        },
        reason: `Admin manually added player ${cleanName}.`
      });
    }

    emitCarromLive('carrom:roster_updated', { action: 'admin_add_player', participantId: participant._id });
    res.json({
      success: true,
      message: `Player "${cleanName}" added successfully.`,
      registration,
      participant
    });
  } catch (error) {
    next(error);
  }
};

const { seedBreakdownData } = require('../services/breakdownSeedService');

// Admin: Seed verified gender/format breakdown dataset (47 participants)
const seedBreakdown = async (req, res, next) => {
  try {
    const summary = await seedBreakdownData(req.user);
    emitCarromLive('carrom:roster_updated', { action: 'seed_breakdown' });
    res.json({
      success: true,
      message: `Seeded ${summary.uniqueParticipants.total} participants and ${summary.teams.total} approved category entries.`,
      summary
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  searchPartnerCandidates,
  submitRegistration,
  lookupRegistrationByStudentId,
  getAllRegistrations,
  getMyRegistration,
  updateRegistrationStatus,
  adminEditRegistration,
  deleteRegistration,
  bulkDeleteRegistrations,
  getValidationSummary,
  importParticipants,
  adminAddPlayer,
  seedBreakdown
};
