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
 * Validates a requested partner for a specific category
 */
const validatePartnerRequest = async (
  participant,
  requestedPartnerName,
  requestedPartnerStudentId,
  category,
  tournamentId,
  allParticipantsByName = null,
  allTeamsMap = null
) => {
  const reqName = (requestedPartnerName || '').trim();

  // 1. No partner requested
  if (!reqName) {
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

  // 2. Find partner in participant database by name
  let partner = null;
  const cleanName = normalizeText(reqName);

  if (allParticipantsByName) {
    partner = allParticipantsByName.get(cleanName) || null;
  } else {
    partner = await Participant.findOne({
      fullName: { $regex: new RegExp(`^${cleanName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') }
    });
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
  const participants = await Participant.find();
  const participantsByName = new Map();

  participants.forEach((p) => {
    if (p.fullName) participantsByName.set(normalizeText(p.fullName), p);
  });

  const teams = await Team.find({ tournamentId, isApproved: true });
  const teamsMap = new Map();
  ['boys_doubles', 'girls_doubles', 'mixed_doubles'].forEach((cat) => {
    teamsMap.set(`${tournamentId}_${cat}`, teams.filter((t) => t.category === cat));
  });

  const enriched = [];
  for (const reg of registrations) {
    const regObj = reg.toObject ? reg.toObject() : { ...reg };
    const p = reg.participantId;

    if (p) {
      const doublesCat = p.gender === 'male' ? 'boys_doubles' : 'girls_doubles';

      regObj.doublesValidation = await validatePartnerRequest(
        p,
        reg.doublesPartnerName,
        reg.doublesPartnerStudentId,
        doublesCat,
        tournamentId,
        participantsByName,
        teamsMap
      );

      regObj.mixedDoublesValidation = await validatePartnerRequest(
        p,
        reg.mixedDoublesPartnerName,
        reg.mixedDoublesPartnerStudentId,
        'mixed_doubles',
        tournamentId,
        participantsByName,
        teamsMap
      );
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

    if (reg.doublesValidation?.status === 'partner_not_registered') {
      unmatchedPartnerRequests.push({
        participantName: p.fullName,
        gender: p.gender,
        category: p.gender === 'male' ? 'Boys Doubles' : 'Girls Doubles',
        requestedPartnerName: reg.doublesPartnerName,
        reason: 'Partner has not registered yet.'
      });
    }

    if (reg.mixedDoublesValidation?.status === 'partner_not_registered') {
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

module.exports = {
  validatePartnerRequest,
  enrichRegistrationsWithValidation,
  getTournamentEntryValidationReport
};
