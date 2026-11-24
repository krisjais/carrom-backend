const Participant = require('../models/Participant');
const Registration = require('../models/Registration');
const Team = require('../models/Team');

/**
 * Normalizes a string for comparison (lowercase, trimmed, collapsed whitespace)
 */
const normalizeText = (text) => {
  return (text || '').toLowerCase().replace(/\s+/g, ' ').trim();
};

/**
 * Sanitizes partner names to prevent boolean literals or empty strings from being treated as names
 */
const sanitizePartnerName = (val) => {
  if (!val) return '';
  const s = String(val).replace(/\s+/g, ' ').trim();
  const lower = s.toLowerCase();
  if (['yes', 'no', 'true', 'false', '0', '1', 'none', 'n/a', 'na', '-', 'nil', 'null', 'undefined'].includes(lower)) {
    return '';
  }
  return s;
};

/**
 * Checks if two names are reasonably matching
 */
const isNameMatch = (name1, name2) => {
  const n1 = normalizeText(name1);
  const n2 = normalizeText(name2);
  if (!n1 || !n2) return false;
  if (n1 === n2) return true;

  const parts1 = n1.split(' ').filter(Boolean);
  const parts2 = n2.split(' ').filter(Boolean);

  if (parts1.length > 0 && parts2.length > 0) {
    const common = parts1.filter((p) => parts2.includes(p));
    if (common.length >= Math.min(parts1.length, parts2.length)) return true;
  }

  return false;
};

/**
 * Ensures that a nominated partner is registered for the tournament.
 * If the partner does not exist, creates a Participant and Registration (with participateSingles: false, isAutoCreatedPartner: true).
 * If the partner exists but has no registration for this tournament, creates one.
 * If the partner is already registered, ensures their participation flags and reciprocal partner names are set.
 */
const ensurePartnerRegistration = async ({
  registrant,
  category, // 'doubles' | 'mixed_doubles'
  partnerName,
  tournamentId,
  isApproved = false
}) => {
  const cleanName = sanitizePartnerName(partnerName);
  if (!cleanName || !registrant) return null;

  // Partner cannot be the registrant themselves
  if (registrant.fullName && cleanName.toLowerCase() === registrant.fullName.toLowerCase().trim()) {
    return null;
  }

  // Determine partner gender
  let partnerGender = registrant.gender;
  if (category === 'mixed_doubles') {
    partnerGender = registrant.gender === 'male' ? 'female' : 'male';
  }

  const escapedName = cleanName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  let partner = await Participant.findOne({
    fullName: { $regex: new RegExp(`^${escapedName}$`, 'i') }
  });

  if (!partner) {
    partner = await Participant.create({
      fullName: cleanName,
      gender: partnerGender,
      studentId: '',
      department: registrant.department || 'General',
      email: '',
      phone: '',
      isApproved: !!isApproved
    });
  } else if (isApproved && !partner.isApproved) {
    partner.isApproved = true;
    await partner.save();
  }

  let partnerReg = await Registration.findOne({
    participantId: partner._id,
    tournamentId
  });

  const isDoublesEvent = category === 'doubles';
  const isMixedEvent = category === 'mixed_doubles';

  if (!partnerReg) {
    partnerReg = await Registration.create({
      participantId: partner._id,
      tournamentId,
      gender: partner.gender || partnerGender,
      participateSingles: false,
      participateDoubles: isDoublesEvent,
      participateMixedDoubles: isMixedEvent,
      doublesPartnerName: isDoublesEvent ? registrant.fullName : '',
      mixedDoublesPartnerName: isMixedEvent ? registrant.fullName : '',
      status: isApproved ? 'approved' : 'pending',
      isAutoCreatedPartner: true
    });
  } else {
    let modified = false;
    if (isDoublesEvent) {
      if (!partnerReg.participateDoubles) {
        partnerReg.participateDoubles = true;
        modified = true;
      }
      if (!partnerReg.doublesPartnerName) {
        partnerReg.doublesPartnerName = registrant.fullName;
        modified = true;
      }
    }
    if (isMixedEvent) {
      if (!partnerReg.participateMixedDoubles) {
        partnerReg.participateMixedDoubles = true;
        modified = true;
      }
      if (!partnerReg.mixedDoublesPartnerName) {
        partnerReg.mixedDoublesPartnerName = registrant.fullName;
        modified = true;
      }
    }
    if (isApproved && partnerReg.status !== 'approved') {
      partnerReg.status = 'approved';
      modified = true;
    }
    if (modified) {
      await partnerReg.save();
    }
  }

  return { partner, registration: partnerReg };
};

/**
 * Validates a requested partner for a specific category
 */
const validatePartnerRequest = async (
  participant,
  requestedPartnerName,
  requestedPartnerStudentId,
  category,
  tournamentId,
  allParticipantsByName = null,
  allTeamsMap = null,
  requestedPartnerId = null,
  allParticipantsById = null
) => {
  const reqName = sanitizePartnerName(requestedPartnerName);
  const reqIdStr = requestedPartnerId ? requestedPartnerId.toString() : '';

  // 1. No partner requested
  if (!reqName && !reqIdStr) {
    return {
      isValid: false,
      status: 'none',
      message: 'No partner requested (Singles only)',
      requestedName: '',
      partner: null,
      team: null,
      canPair: false
    };
  }

  // 2. Find partner in participant database by ID first, then by name
  let partner = null;
  const cleanName = normalizeText(reqName);

  if (reqIdStr) {
    if (allParticipantsById) {
      partner = allParticipantsById.get(reqIdStr) || null;
    } else {
      partner = await Participant.findById(reqIdStr).lean();
    }
  }

  if (!partner && cleanName) {
    if (allParticipantsByName) {
      partner = allParticipantsByName.get(cleanName) || null;
    } else {
      partner = await Participant.findOne({
        fullName: { $regex: new RegExp(`^${cleanName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') }
      }).lean();
    }
  }

  // If partner does not exist yet
  if (!partner) {
    return {
      isValid: false,
      status: 'partner_not_registered',
      message: 'Partner has not registered yet.',
      requestedName: reqName,
      partner: null,
      team: null,
      canPair: false
    };
  }

  // Cannot partner with oneself
  if (partner._id.toString() === participant._id.toString()) {
    return {
      isValid: false,
      status: 'invalid_self',
      message: 'Invalid Partner: Cannot nominate yourself as partner',
      requestedName: reqName,
      partner: null,
      team: null,
      canPair: false
    };
  }

  // 3. Gender compatibility
  if (category === 'boys_doubles') {
    if (participant.gender !== 'male' || partner.gender !== 'male') {
      return {
        isValid: false,
        status: 'invalid_gender',
        message: 'Invalid gender: Both players in Boys Doubles must be male',
        requestedName: reqName,
        partner,
        team: null,
        canPair: false
      };
    }
  } else if (category === 'girls_doubles') {
    if (participant.gender !== 'female' || partner.gender !== 'female') {
      return {
        isValid: false,
        status: 'invalid_gender',
        message: 'Invalid gender: Both players in Girls Doubles must be female',
        requestedName: reqName,
        partner,
        team: null,
        canPair: false
      };
    }
  } else if (category === 'mixed_doubles') {
    const isMixed =
      (participant.gender === 'male' && partner.gender === 'female') ||
      (participant.gender === 'female' && partner.gender === 'male');
    if (!isMixed) {
      return {
        isValid: false,
        status: 'invalid_gender',
        message: 'Invalid gender: Mixed Doubles requires exactly 1 male + 1 female',
        requestedName: reqName,
        partner,
        team: null,
        canPair: false
      };
    }
  }

  // 4. Check if Team is ALREADY formed and approved
  let existingTeam = null;
  if (allTeamsMap && tournamentId) {
    const categoryTeams = allTeamsMap.get(`${tournamentId}_${category}`) || [];
    existingTeam = categoryTeams.find(
      (t) =>
        (t.player1?._id?.toString() === participant._id?.toString() &&
          t.player2?._id?.toString() === partner._id?.toString()) ||
        (t.player1?._id?.toString() === partner._id?.toString() &&
          t.player2?._id?.toString() === participant._id?.toString())
    );
  } else if (tournamentId) {
    existingTeam = await Team.findOne({
      tournamentId,
      category,
      isApproved: true,
      $or: [
        { player1: participant._id, player2: partner._id },
        { player1: partner._id, player2: participant._id }
      ]
    });
  }

  if (existingTeam) {
    return {
      isValid: true,
      status: 'valid_paired',
      message: `Team paired & approved (${existingTeam.name})`,
      requestedName: reqName,
      partner,
      team: existingTeam,
      canPair: false // already paired
    };
  }

  // 5. Check if either player is already on another team in this category
  let conflictTeam = null;
  if (allTeamsMap && tournamentId) {
    const categoryTeams = allTeamsMap.get(`${tournamentId}_${category}`) || [];
    conflictTeam = categoryTeams.find(
      (t) =>
        t.player1?._id?.toString() === participant._id?.toString() ||
        t.player2?._id?.toString() === participant._id?.toString() ||
        t.player1?._id?.toString() === partner._id?.toString() ||
        t.player2?._id?.toString() === partner._id?.toString()
    );
  } else if (tournamentId) {
    conflictTeam = await Team.findOne({
      tournamentId,
      category,
      isApproved: true,
      $or: [
        { player1: participant._id },
        { player2: participant._id },
        { player1: partner._id },
        { player2: partner._id }
      ]
    });
  }

  if (conflictTeam) {
    return {
      isValid: false,
      status: 'already_paired',
      message: `Partner conflict: A player is already in team "${conflictTeam.name}"`,
      requestedName: reqName,
      partner,
      team: conflictTeam,
      canPair: false
    };
  }

  // 6. Approval check
  if (!participant.isApproved || !partner.isApproved) {
    return {
      isValid: false,
      status: 'pending_approval',
      message: !partner.isApproved
        ? `${partner.fullName} is awaiting registration approval`
        : 'Participant awaiting approval',
      requestedName: reqName,
      partner,
      team: null,
      canPair: false
    };
  }

  // 7. Ready to Pair!
  return {
    isValid: true,
    status: 'partner_registered',
    message: `Partner registered & verified (${partner.fullName}). Ready to pair.`,
    requestedName: reqName,
    partner,
    team: null,
    canPair: true
  };
};

/**
 * Validates and enriches a list of registration documents
 */
const enrichRegistrationsWithValidation = async (registrations, tournamentId) => {
  if (!registrations || registrations.length === 0) return [];

  // Pre-fetch all participants and teams for batch lookup
  const [participants, teams] = await Promise.all([
    Participant.find().lean(),
    Team.find({ tournamentId, isApproved: true }).lean()
  ]);
  const participantsByName = new Map();
  const participantsById = new Map();

  participants.forEach((p) => {
    if (p.fullName) participantsByName.set(normalizeText(p.fullName), p);
    if (p._id) participantsById.set(p._id.toString(), p);
  });

  const teamsMap = new Map();
  ['boys_doubles', 'girls_doubles', 'mixed_doubles'].forEach((cat) => {
    teamsMap.set(`${tournamentId}_${cat}`, teams.filter((t) => t.category === cat));
  });

  const enriched = [];
  for (const reg of registrations) {
    const regObj = reg.toObject ? reg.toObject() : { ...reg };
    const p = reg.participantId;

    // Sanitize partner names
    const cleanDoubles = sanitizePartnerName(regObj.doublesPartnerName);
    const cleanMixed = sanitizePartnerName(regObj.mixedDoublesPartnerName);

    // Determine participation flags with backward-compatible defaults and migration safety:
    // If participation flag explicitly exists, preserve it!
    // Only infer from partner presence if flag is missing/undefined.
    const participateSingles = regObj.participateSingles !== undefined ? !!regObj.participateSingles : true;
    const participateDoubles = regObj.participateDoubles !== undefined ? !!regObj.participateDoubles : !!cleanDoubles;
    const participateMixedDoubles = regObj.participateMixedDoubles !== undefined ? !!regObj.participateMixedDoubles : !!cleanMixed;

    regObj.participateSingles = participateSingles;
    regObj.participateDoubles = participateDoubles;
    regObj.participateMixedDoubles = participateMixedDoubles;
    regObj.doublesPartnerName = participateDoubles ? cleanDoubles : '';
    regObj.mixedDoublesPartnerName = participateMixedDoubles ? cleanMixed : '';

    if (p) {
      const doublesCat = p.gender === 'male' ? 'boys_doubles' : 'girls_doubles';

      if (participateDoubles) {
        regObj.doublesValidation = await validatePartnerRequest(
          p,
          cleanDoubles,
          reg.doublesPartnerStudentId,
          doublesCat,
          tournamentId,
          participantsByName,
          teamsMap,
          regObj.doublesPartnerId || null,
          participantsById
        );
      } else {
        regObj.doublesValidation = {
          isValid: true,
          status: 'not_participating',
          message: 'Not participating in Doubles (Optional)',
          requestedName: '',
          partner: null,
          team: null,
          canPair: false
        };
      }

      if (participateMixedDoubles) {
        regObj.mixedDoublesValidation = await validatePartnerRequest(
          p,
          cleanMixed,
          reg.mixedDoublesPartnerId ? '' : reg.mixedDoublesPartnerStudentId,
          'mixed_doubles',
          tournamentId,
          participantsByName,
          teamsMap,
          regObj.mixedDoublesPartnerId || null,
          participantsById
        );
      } else {
        regObj.mixedDoublesValidation = {
          isValid: true,
          status: 'not_participating',
          message: 'Not participating in Mixed Doubles (Optional)',
          requestedName: '',
          partner: null,
          team: null,
          canPair: false
        };
      }

      // Enrolled events array
      const events = [];
      if (participateSingles) {
        events.push(p.gender === 'male' ? 'Boys Singles' : 'Girls Singles');
      }
      if (participateDoubles) {
        events.push(p.gender === 'male' ? 'Boys Doubles' : 'Girls Doubles');
      }
      if (participateMixedDoubles) {
        events.push('Mixed Doubles');
      }
      regObj.enrolledEvents = events;
    }

    enriched.push(regObj);
  }

  return enriched;
};

/**
 * Returns summary statistics of participant partner requests
 */
const getTournamentEntryValidationReport = async (tournamentId) => {
  const [
    totalParticipants,
    maleParticipants,
    femaleParticipants,
    boysSinglesEntries,
    girlsSinglesEntries,
    boysDoublesTeams,
    girlsDoublesTeams,
    mixedDoublesTeams,
    allRegistrations
  ] = await Promise.all([
    Participant.countDocuments(),
    Participant.countDocuments({ gender: 'male' }),
    Participant.countDocuments({ gender: 'female' }),
    Team.countDocuments({ tournamentId, category: 'boys_singles', isApproved: true }),
    Team.countDocuments({ tournamentId, category: 'girls_singles', isApproved: true }),
    Team.countDocuments({ tournamentId, category: 'boys_doubles', isApproved: true }),
    Team.countDocuments({ tournamentId, category: 'girls_doubles', isApproved: true }),
    Team.countDocuments({ tournamentId, category: 'mixed_doubles', isApproved: true }),
    Registration.find({ tournamentId }).populate('participantId')
  ]);

  const enriched = await enrichRegistrationsWithValidation(allRegistrations, tournamentId);

  const invalidPartnerRequests = [];
  const unmatchedPartnerRequests = [];

  enriched.forEach((reg) => {
    const p = reg.participantId;
    if (!p) return;

    // Only flag unmatched partner if the participant actually chose to participate in Doubles
    if (reg.participateDoubles && reg.doublesValidation?.status === 'partner_not_registered') {
      unmatchedPartnerRequests.push({
        participantName: p.fullName,
        gender: p.gender,
        category: p.gender === 'male' ? 'Boys Doubles' : 'Girls Doubles',
        requestedPartnerName: reg.doublesPartnerName,
        reason: 'Partner has not registered yet.'
      });
    }

    // Only flag unmatched partner if the participant actually chose to participate in Mixed Doubles
    if (reg.participateMixedDoubles && reg.mixedDoublesValidation?.status === 'partner_not_registered') {
      unmatchedPartnerRequests.push({
        participantName: p.fullName,
        gender: p.gender,
        category: 'Mixed Doubles',
        requestedPartnerName: reg.mixedDoublesPartnerName,
        reason: 'Partner has not registered yet.'
      });
    }
  });

  const totalApprovedEntries =
    boysSinglesEntries +
    girlsSinglesEntries +
    boysDoublesTeams +
    girlsDoublesTeams +
    mixedDoublesTeams;

  return {
    totalRegisteredParticipants: totalParticipants,
    maleParticipants,
    femaleParticipants,
    boysSinglesEntries,
    girlsSinglesEntries,
    boysDoublesTeams,
    girlsDoublesTeams,
    mixedDoublesTeams,
    totalApprovedTournamentEntries: totalApprovedEntries,
    invalidPartnerRequests,
    unmatchedPartnerRequests
  };
};

/**
 * Synchronizes Singles entries and auto-pairs approved Doubles & Mixed Doubles teams
 */
const syncAndAutoPairTournamentEntries = async (tournamentId, category = null) => {
  const Tournament = require('../models/Tournament');
  let tournId = tournamentId;
  if (!tournId) {
    const activeTourn = await Tournament.findOne().sort({ createdAt: -1 });
    if (!activeTourn) return { success: false, createdCount: 0, message: 'No active tournament found.' };
    tournId = activeTourn._id;
  }

  const [approvedRegistrations, existingTeams] = await Promise.all([
    Registration.find({
      tournamentId: tournId,
      status: 'approved'
    })
      .populate('participantId')
      .lean(),
    Team.find({ tournamentId: tournId }).lean()
  ]);

  const singlesPlayersByCat = new Map();
  const teamMemberKeys = new Set();
  for (const t of existingTeams) {
    if (t.category === 'boys_singles' || t.category === 'girls_singles') {
      if (!singlesPlayersByCat.has(t.category)) singlesPlayersByCat.set(t.category, new Set());
      if (t.player1) singlesPlayersByCat.get(t.category).add(t.player1.toString());
    } else {
      if (t.player1) teamMemberKeys.add(`${t.category}:${t.player1.toString()}`);
      if (t.player2) teamMemberKeys.add(`${t.category}:${t.player2.toString()}`);
    }
  }

  const teamsToInsert = [];

  // 1. Sync Singles Entries ONLY for participants who opted into Singles
  for (const reg of approvedRegistrations) {
    const p = reg.participantId;
    if (!p || !p.isApproved) continue;

    const isSingles = reg.participateSingles !== undefined ? reg.participateSingles : true;
    if (!isSingles) continue;

    const singlesCat = p.gender === 'male' ? 'boys_singles' : 'girls_singles';

    if (!category || category === singlesCat) {
      const catSet = singlesPlayersByCat.get(singlesCat) || new Set();
      const pId = p._id.toString();

      if (!catSet.has(pId)) {
        catSet.add(pId);
        singlesPlayersByCat.set(singlesCat, catSet);
        teamsToInsert.push({
          name: p.fullName,
          tournamentId: tournId,
          category: singlesCat,
          player1: p._id,
          player2: null,
          isApproved: true
        });
      }
    }
  }

  // 2. Sync Doubles & Mixed Doubles Teams (Only if both participants opted in & nominated each other)
  if (!category || category.includes('doubles')) {
    const enriched = await enrichRegistrationsWithValidation(approvedRegistrations, tournId);
    const regByParticipantId = new Map();
    for (const r of enriched) {
      if (r.participantId?._id) regByParticipantId.set(r.participantId._id.toString(), r);
    }

    for (const reg of enriched) {
      const p1 = reg.participantId;
      if (!p1 || !p1.isApproved) continue;

      // Doubles (Boys Doubles or Girls Doubles)
      if (
        reg.participateDoubles &&
        (!category || category === 'boys_doubles' || category === 'girls_doubles') &&
        reg.doublesValidation?.partner &&
        reg.doublesValidation.partner.isApproved
      ) {
        const p2 = reg.doublesValidation.partner;
        const doublesCat = p1.gender === 'male' ? 'boys_doubles' : 'girls_doubles';

        const p2Reg = regByParticipantId.get(p2._id.toString());
        const p2ParticipatesDoubles = p2Reg?.participateDoubles !== undefined ? p2Reg.participateDoubles : true;

        const key1 = `${doublesCat}:${p1._id.toString()}`;
        const key2 = `${doublesCat}:${p2._id.toString()}`;

        if (
          p2ParticipatesDoubles &&
          (!category || category === doublesCat) &&
          p1.gender === p2.gender &&
          p1._id.toString() !== p2._id.toString() &&
          !teamMemberKeys.has(key1) &&
          !teamMemberKeys.has(key2)
        ) {
          teamMemberKeys.add(key1);
          teamMemberKeys.add(key2);
          teamsToInsert.push({
            name: `${p1.fullName} & ${p2.fullName}`,
            tournamentId: tournId,
            category: doublesCat,
            player1: p1._id,
            player2: p2._id,
            isApproved: true
          });
        }
      }

      // Mixed Doubles
      if (
        reg.participateMixedDoubles &&
        (!category || category === 'mixed_doubles') &&
        reg.mixedDoublesValidation?.partner &&
        reg.mixedDoublesValidation.partner.isApproved
      ) {
        const p2 = reg.mixedDoublesValidation.partner;
        const isMixedGenders =
          (p1.gender === 'male' && p2.gender === 'female') ||
          (p1.gender === 'female' && p2.gender === 'male');

        const p2Reg = regByParticipantId.get(p2._id.toString());
        const p2ParticipatesMixed = p2Reg?.participateMixedDoubles !== undefined ? p2Reg.participateMixedDoubles : true;

        const key1 = `mixed_doubles:${p1._id.toString()}`;
        const key2 = `mixed_doubles:${p2._id.toString()}`;

        if (
          p2ParticipatesMixed &&
          isMixedGenders &&
          p1._id.toString() !== p2._id.toString() &&
          !teamMemberKeys.has(key1) &&
          !teamMemberKeys.has(key2)
        ) {
          teamMemberKeys.add(key1);
          teamMemberKeys.add(key2);
          teamsToInsert.push({
            name: `${p1.fullName} & ${p2.fullName}`,
            tournamentId: tournId,
            category: 'mixed_doubles',
            player1: p1._id,
            player2: p2._id,
            isApproved: true
          });
        }
      }
    }
  }

  if (teamsToInsert.length > 0) {
    await Team.insertMany(teamsToInsert);
  }

  return { success: true, createdCount: teamsToInsert.length };
};

module.exports = {
  validatePartnerRequest,
  enrichRegistrationsWithValidation,
  getTournamentEntryValidationReport,
  syncAndAutoPairTournamentEntries,
  ensurePartnerRegistration
};
