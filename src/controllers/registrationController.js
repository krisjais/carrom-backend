const Registration = require('../models/Registration');
const Participant = require('../models/Participant');
const Tournament = require('../models/Tournament');
const Team = require('../models/Team');
const Match = require('../models/Match');
const AuditLog = require('../models/AuditLog');
const User = require('../models/User');

const {
  validatePartnerRequest,
  enrichRegistrationsWithValidation,
  getTournamentEntryValidationReport
} = require('../services/partnerValidationEngine');

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

// Public / Participant submission
const submitRegistration = async (req, res, next) => {
  try {
    const {
      fullName,
      gender,
      department,
      participateSingles,
      participateDoubles,
      participateMixedDoubles,
      doublesPartnerName,
      mixedDoublesPartnerName,
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
      : !!cleanDoublesPartner;
    let isMixed = participateMixedDoubles !== undefined
      ? normalizeBooleanParticipation(participateMixedDoubles, false)
      : !!cleanMixedPartner;

    // Validate that at least ONE division is chosen
    if (!isSingles && !isDoubles && !isMixed) {
      return res.status(400).json({
        success: false,
        message: 'Please select at least one division to participate in (Singles, Doubles, or Mixed Doubles).'
      });
    }

    // Partner validation:
    // If Doubles is chosen, partner is REQUIRED
    if (isDoubles && !cleanDoublesPartner) {
      return res.status(400).json({
        success: false,
        message: `${gender === 'male' ? 'Boys' : 'Girls'} Doubles Partner Full Name is required when participating in Doubles.`
      });
    }

    // If Mixed Doubles is chosen, partner is REQUIRED
    if (isMixed && !cleanMixedPartner) {
      return res.status(400).json({
        success: false,
        message: 'Mixed Doubles Partner Full Name is required when participating in Mixed Doubles.'
      });
    }

    const cleanFullName = fullName.trim();
    const cleanDepartment = department.trim();
    const finalDoublesPartner = isDoubles ? cleanDoublesPartner : '';
    const finalMixedPartner = isMixed ? cleanMixedPartner : '';

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

    // Check duplicate registration
    let participant = await Participant.findOne({
      fullName: { $regex: new RegExp(`^${cleanFullName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') }
    });

    if (participant) {
      const existing = await Registration.findOne({
        participantId: participant._id,
        tournamentId: tournId
      });
      if (existing) {
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
        email: '',
        phone: '',
        isApproved: false
      });
    }

    const registration = await Registration.create({
      participantId: participant._id,
      tournamentId: tournId,
      gender,
      participateSingles: isSingles,
      participateDoubles: isDoubles,
      participateMixedDoubles: isMixed,
      doublesPartnerName: finalDoublesPartner,
      mixedDoublesPartnerName: finalMixedPartner,
      status: 'pending'
    });

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
      .sort({ createdAt: -1 });

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
      mixedDoublesPartnerName,
      adminNotes
    } = req.body;

    const registration = await Registration.findById(id).populate('participantId');
    if (!registration) {
      return res.status(404).json({ success: false, message: 'Registration record not found.' });
    }

    if (participateSingles !== undefined) registration.participateSingles = !!participateSingles;
    if (participateDoubles !== undefined) registration.participateDoubles = !!participateDoubles;
    if (participateMixedDoubles !== undefined) registration.participateMixedDoubles = !!participateMixedDoubles;

    if (doublesPartnerName !== undefined) {
      registration.doublesPartnerName = registration.participateDoubles ? sanitizePartnerName(doublesPartnerName) : '';
    } else if (!registration.participateDoubles) {
      registration.doublesPartnerName = '';
    }

    if (mixedDoublesPartnerName !== undefined) {
      registration.mixedDoublesPartnerName = registration.participateMixedDoubles ? sanitizePartnerName(mixedDoublesPartnerName) : '';
    } else if (!registration.participateMixedDoubles) {
      registration.mixedDoublesPartnerName = '';
    }

    if (adminNotes !== undefined) registration.adminNotes = adminNotes;
    await registration.save();

    if (registration.participantId) {
      const p = registration.participantId;
      if (fullName) p.fullName = fullName.trim();
      if (department) p.department = department.trim();
      await p.save();
    }

    await AuditLog.create({
      action: 'ADMIN_EDIT_REGISTRATION',
      performedBy: req.user._id,
      performedByName: req.user.fullName,
      entityType: 'Registration',
      entityId: registration._id.toString(),
      details: {
        participant: registration.participantId?.fullName,
        doublesPartnerName,
        mixedDoublesPartnerName
      },
      reason: 'Admin modified registration details.'
    });

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
          phone: '',
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
      participateSingles,
      participateDoubles,
      participateMixedDoubles,
      boysDoublesPartner,
      girlsDoublesPartner,
      doublesPartnerName,
      mixedDoublesPartnerName,
      mixedDoublesPartner,
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
      : !!candidateDoubles;
    let isMixed = participateMixedDoubles !== undefined
      ? normalizeBooleanParticipation(participateMixedDoubles, false)
      : !!candidateMixed;
    let isSingles = participateSingles !== undefined
      ? normalizeBooleanParticipation(participateSingles, true)
      : true;

    let assignedDoubles = isDoubles ? candidateDoubles : '';
    let assignedMixed = isMixed ? candidateMixed : '';

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
        existingReg.mixedDoublesPartnerName = assignedMixed;
        if (normalizedGender) existingReg.gender = normalizedGender;
        await existingReg.save();

        if (cleanDept && participant.department !== cleanDept) {
          participant.department = cleanDept;
          await participant.save();
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
          mixedDoublesPartnerName: assignedMixed,
          status: 'pending'
        });

        if (cleanDept && participant.department !== cleanDept) {
          participant.department = cleanDept;
          await participant.save();
        }

        return res.json({
          success: true,
          message: `Player "${participant.fullName}" added to tournament.`,
          registration: reg,
          participant
        });
      }
    }

    // Create new Participant & Registration
    participant = await Participant.create({
      fullName: cleanName,
      gender: normalizedGender,
      studentId: '',
      department: cleanDept,
      email: '',
      phone: '',
      isApproved: false
    });

    const registration = await Registration.create({
      participantId: participant._id,
      tournamentId: tournId,
      gender: normalizedGender,
      participateSingles: isSingles,
      participateDoubles: isDoubles,
      participateMixedDoubles: isMixed,
      doublesPartnerName: assignedDoubles,
      mixedDoublesPartnerName: assignedMixed,
      status: 'pending'
    });

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

module.exports = {
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
  adminAddPlayer
};
