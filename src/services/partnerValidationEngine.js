const Participant = require('../models/Participant');
const Registration = require('../models/Registration');
const Team = require('../models/Team');

/**
 * Validates a requested partner for a specific category
 *
 * Rules:
 * 1. The partner exists in the participant database (case-insensitive name match).
 * 2. The partner has the correct gender for the category (Boys=male, Girls=female, Mixed=1 male + 1 female).
 * 3. Both participants are approved.
 * 4. Mutual reference or approved Team pairing.
 * 5. Neither participant is already assigned to another team in the same doubles category.
 * 6. Team contains exactly two participants.
 */
const validatePartnerRequest = async (participant, requestedPartnerName, category, tournamentId, allParticipantsMap = null, allTeamsMap = null, allRegistrationsMap = null) => {
  if (!requestedPartnerName || !requestedPartnerName.trim()) {
    return {
      isValid: false,
      status: 'none',
      message: 'No partner requested',
      partner: null,
      team: null
    };
  }

  const cleanName = requestedPartnerName.trim().toLowerCase();

  // 1. Find requested partner in database
  let partner = null;
  if (allParticipantsMap) {
    partner = allParticipantsMap.get(cleanName) || null;
  } else {
    partner = await Participant.findOne({
      fullName: { $regex: new RegExp(`^${cleanName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') }
    });
  }

  if (!partner) {
    return {
      isValid: false,
      status: 'invalid_not_found',
      message: 'INVALID PARTNER: Partner not found / not registered',
      requestedName: requestedPartnerName,
      partner: null,
      team: null
    };
  }

  // 2. Gender validation
  if (category === 'boys_doubles') {
    if (participant.gender !== 'male' || partner.gender !== 'male') {
      return {
        isValid: false,
        status: 'invalid_gender',
        message: 'INVALID GENDER: Both players in Boys Doubles must be male',
        partner,
        team: null
      };
    }
  } else if (category === 'girls_doubles') {
    if (participant.gender !== 'female' || partner.gender !== 'female') {
      return {
        isValid: false,
        status: 'invalid_gender',
        message: 'INVALID GENDER: Both players in Girls Doubles must be female',
        partner,
        team: null
      };
    }
  } else if (category === 'mixed_doubles') {
    const isMixed = (participant.gender === 'male' && partner.gender === 'female') ||
                    (participant.gender === 'female' && partner.gender === 'male');
    if (!isMixed) {
      return {
        isValid: false,
        status: 'invalid_gender',
        message: 'INVALID GENDER: Mixed Doubles requires exactly 1 male + 1 female',
        partner,
        team: null
      };
    }
  }

  // 3. Approval check
  if (!participant.isApproved || !partner.isApproved) {
    return {
      isValid: false,
      status: 'not_approved',
      message: !partner.isApproved ? `PARTNER PENDING: ${partner.fullName} is awaiting registration approval` : 'Participant awaiting approval',
      partner,
      team: null
    };
  }

  // 4. Check if an approved Team already exists for this pair in this category
  let existingTeam = null;
  if (allTeamsMap && tournamentId) {
    const categoryTeams = allTeamsMap.get(`${tournamentId}_${category}`) || [];
    existingTeam = categoryTeams.find((t) =>
      (t.player1?._id?.toString() === participant._id?.toString() && t.player2?._id?.toString() === partner._id?.toString()) ||
      (t.player1?._id?.toString() === partner._id?.toString() && t.player2?._id?.toString() === participant._id?.toString())
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
      message: `Approved Team (${existingTeam.name})`,
      partner,
      team: existingTeam
    };
  }

  // 5. Check if either participant is already on another team in this category
  let conflictTeam = null;
  if (allTeamsMap && tournamentId) {
    const categoryTeams = allTeamsMap.get(`${tournamentId}_${category}`) || [];
    conflictTeam = categoryTeams.find((t) =>
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
      message: `PARTNER CONFLICT: A player is already in team "${conflictTeam.name}"`,
      partner,
      team: conflictTeam
    };
  }

  // 6. Check mutual partner request in registrations
  let isMutual = false;
  if (allRegistrationsMap && tournamentId) {
    const partnerReg = allRegistrationsMap.get(`${tournamentId}_${partner._id.toString()}`);
    if (partnerReg) {
      const partnerField = category === 'mixed_doubles' ? partnerReg.mixedDoublesPartnerName : partnerReg.doublesPartnerName;
      if (partnerField && partnerField.trim().toLowerCase() === participant.fullName.trim().toLowerCase()) {
        isMutual = true;
      }
    }
  } else if (tournamentId) {
    const partnerReg = await Registration.findOne({
      tournamentId,
      participantId: partner._id
    });
    if (partnerReg) {
      const partnerField = category === 'mixed_doubles' ? partnerReg.mixedDoublesPartnerName : partnerReg.doublesPartnerName;
      if (partnerField && partnerField.trim().toLowerCase() === participant.fullName.trim().toLowerCase()) {
        isMutual = true;
      }
    }
  }

  if (isMutual) {
    return {
      isValid: true,
      status: 'valid_mutual',
      message: 'Mutual Partner Match (Ready for Admin Pair Approval)',
      partner,
      team: null
    };
  }

  return {
    isValid: false,
    status: 'unmatched',
    message: `UNMATCHED: Waiting for ${partner.fullName} to request ${participant.fullName} or Admin pairing`,
    partner,
    team: null
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
    participantsByName.set(p.fullName.trim().toLowerCase(), p);
  });

  const teams = await Team.find({ tournamentId, isApproved: true });
  const teamsMap = new Map();
  ['boys_doubles', 'girls_doubles', 'mixed_doubles'].forEach((cat) => {
    teamsMap.set(`${tournamentId}_${cat}`, teams.filter((t) => t.category === cat));
  });

  const allRegs = await Registration.find({ tournamentId });
  const regsMap = new Map();
  allRegs.forEach((r) => {
    regsMap.set(`${tournamentId}_${r.participantId?.toString()}`, r);
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
        doublesCat,
        tournamentId,
        participantsByName,
        teamsMap,
        regsMap
      );

      regObj.mixedDoublesValidation = await validatePartnerRequest(
        p,
        reg.mixedDoublesPartnerName,
        'mixed_doubles',
        tournamentId,
        participantsByName,
        teamsMap,
        regsMap
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

    // Doubles check
    if (reg.doublesValidation?.status === 'invalid_not_found') {
      invalidPartnerRequests.push({
        participantName: p.fullName,
        studentId: p.studentId,
        gender: p.gender,
        category: p.gender === 'male' ? 'Boys Doubles' : 'Girls Doubles',
        requestedPartnerName: reg.doublesPartnerName,
        reason: 'Partner not found / not registered'
      });
    } else if (reg.doublesValidation?.status === 'unmatched') {
      unmatchedPartnerRequests.push({
        participantName: p.fullName,
        studentId: p.studentId,
        gender: p.gender,
        category: p.gender === 'male' ? 'Boys Doubles' : 'Girls Doubles',
        requestedPartnerName: reg.doublesPartnerName,
        reason: reg.doublesValidation.message
      });
    }

    // Mixed Doubles check
    if (reg.mixedDoublesValidation?.status === 'invalid_not_found') {
      invalidPartnerRequests.push({
        participantName: p.fullName,
        studentId: p.studentId,
        gender: p.gender,
        category: 'Mixed Doubles',
        requestedPartnerName: reg.mixedDoublesPartnerName,
        reason: 'Partner not found / not registered'
      });
    } else if (reg.mixedDoublesValidation?.status === 'unmatched') {
      unmatchedPartnerRequests.push({
        participantName: p.fullName,
        studentId: p.studentId,
        gender: p.gender,
        category: 'Mixed Doubles',
        requestedPartnerName: reg.mixedDoublesPartnerName,
        reason: reg.mixedDoublesValidation.message
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
