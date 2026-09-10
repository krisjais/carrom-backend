const Match = require('../models/Match');
const Team = require('../models/Team');
const Tournament = require('../models/Tournament');
const Participant = require('../models/Participant');

/**
 * Extracts all unique participant IDs from a populated match
 */
const getMatchParticipantIds = (match) => {
  const participantIds = [];
  if (match.team1) {
    if (match.team1.player1) participantIds.push(match.team1.player1._id ? match.team1.player1._id.toString() : match.team1.player1.toString());
    if (match.team1.player2) participantIds.push(match.team1.player2._id ? match.team1.player2._id.toString() : match.team1.player2.toString());
  }
  if (match.team2) {
    if (match.team2.player1) participantIds.push(match.team2.player1._id ? match.team2.player1._id.toString() : match.team2.player1.toString());
    if (match.team2.player2) participantIds.push(match.team2.player2._id ? match.team2.player2._id.toString() : match.team2.player2.toString());
  }
  return [...new Set(participantIds)];
};

/**
 * Checks if all participants in a match are available (not currently active in another live match)
 */
const checkMatchRestAvailability = async (tournamentId, matchDoc) => {
  // Ensure teams & players are populated
  let populatedMatch = matchDoc;
  if (!populatedMatch.team1?.player1 || (populatedMatch.team1?.isDoubles && !populatedMatch.team1?.player2)) {
    populatedMatch = await Match.findById(matchDoc._id)
      .populate({ path: 'team1', populate: [{ path: 'player1' }, { path: 'player2' }] })
      .populate({ path: 'team2', populate: [{ path: 'player1' }, { path: 'player2' }] });
  }

  if (!populatedMatch || !populatedMatch.team1 || !populatedMatch.team2) {
    return { isRested: false, reason: 'Match opponents not determined yet.' };
  }

  const participantIds = getMatchParticipantIds(populatedMatch);

  for (const pId of participantIds) {
    // Find all teams this participant is part of in this tournament
    const participantTeams = await Team.find({
      tournamentId,
      $or: [{ player1: pId }, { player2: pId }]
    }).select('_id');
    const teamIds = participantTeams.map((t) => t._id);

    // Check if participant is currently in an ongoing LIVE match
    const liveMatch = await Match.findOne({
      tournamentId,
      _id: { $ne: matchDoc._id },
      status: 'live',
      $or: [{ team1: { $in: teamIds } }, { team2: { $in: teamIds } }]
    });

    if (liveMatch) {
      const participant = await Participant.findById(pId);
      const pName = participant ? participant.fullName : 'Participant';
      return {
        isRested: false,
        restingPlayerName: pName,
        isCurrentlyLive: true,
        reason: `${pName} is currently playing in Match #${liveMatch.matchNumber} on Main Carrom Board.`
      };
    }
  }

  return { isRested: true };
};

/**
 * Validates all pre-conditions before a match can be started on the Main Carrom Board
 */
const canStartMatch = async (matchId) => {
  const match = await Match.findById(matchId)
    .populate({ path: 'team1', populate: [{ path: 'player1' }, { path: 'player2' }] })
    .populate({ path: 'team2', populate: [{ path: 'player1' }, { path: 'player2' }] });

  if (!match) {
    return { canStart: false, reason: 'Match not found.' };
  }

  if (match.isBye) {
    return { canStart: false, reason: 'Cannot start a BYE match. BYE is an automatic advancement.' };
  }

  if (match.status === 'completed') {
    return { canStart: false, reason: 'Match is already completed.' };
  }

  if (match.status === 'live') {
    return { canStart: false, reason: 'Match is already LIVE on the Main Carrom Board.' };
  }

  if (!match.team1 || !match.team2) {
    return { canStart: false, reason: 'Match is WAITING: Both opponents must be determined before starting.' };
  }

  // 1. Check if ANY match is currently LIVE tournament-wide
  const liveMatch = await Match.findOne({
    tournamentId: match.tournamentId,
    status: 'live',
    _id: { $ne: match._id }
  }).populate('team1').populate('team2');

  if (liveMatch) {
    return {
      canStart: false,
      reason: `At most 1 LIVE match is permitted tournament-wide. Main Carrom Board is currently occupied by Match #${liveMatch.matchNumber} (${liveMatch.team1?.name || 'T1'} vs ${liveMatch.team2?.name || 'T2'}). Complete the current match first.`
    };
  }

  // 2. Check participant live availability
  const restCheck = await checkMatchRestAvailability(match.tournamentId, match);
  if (!restCheck.isRested) {
    return {
      canStart: false,
      reason: restCheck.reason,
      restingPlayerName: restCheck.restingPlayerName
    };
  }

  return { canStart: true, match };
};

/**
 * Recalculates estimated start times for all READY matches in strict queuePosition order
 * Note: queuePosition is NEVER altered by this calculation!
 */
const recalculateEstimatedTimes = async (tournamentId) => {
  const tournament = await Tournament.findById(tournamentId);
  if (!tournament) return;

  const durationMin = tournament.scheduleSettings?.roundDurationMinutes || tournament.scheduleSettings?.matchDurationMinutes || 20;
  const breakMin = tournament.scheduleSettings?.breakTimeMinutes || 5;
  const configuredStart = tournament.scheduleSettings?.startTime ? new Date(tournament.scheduleSettings.startTime) : new Date();

  // Find all READY matches ordered strictly by queuePosition
  const readyMatches = await Match.find({
    tournamentId,
    status: 'scheduled',
    isBye: false,
    team1: { $ne: null },
    team2: { $ne: null }
  })
    .populate({ path: 'team1', populate: [{ path: 'player1' }, { path: 'player2' }] })
    .populate({ path: 'team2', populate: [{ path: 'player1' }, { path: 'player2' }] })
    .sort({ queuePosition: 1, createdAt: 1 });

  if (readyMatches.length === 0) return [];

  // Determine baseline available time for Main Carrom Board
  let currentBoardTime;
  const liveMatch = await Match.findOne({ tournamentId, status: 'live' });
  const lastCompleted = await Match.findOne({ tournamentId, status: 'completed' }).sort({ actualEndTime: -1, updatedAt: -1 });

  if (liveMatch) {
    const liveStart = liveMatch.actualStartTime ? new Date(liveMatch.actualStartTime).getTime() : Date.now();
    const liveDur = liveMatch.roundDurationMinutes || liveMatch.durationMinutes || durationMin;
    const liveEstEnd = liveStart + liveDur * 60 * 1000;
    currentBoardTime = new Date(Math.max(Date.now(), liveEstEnd + breakMin * 60 * 1000));
  } else if (lastCompleted && lastCompleted.actualEndTime) {
    const lastEnd = new Date(lastCompleted.actualEndTime).getTime();
    currentBoardTime = new Date(Math.max(Date.now(), lastEnd + breakMin * 60 * 1000, configuredStart.getTime()));
  } else {
    currentBoardTime = new Date(Math.max(Date.now(), configuredStart.getTime()));
  }

  // Player finish time tracker for estimated cross-category scheduling
  const playerEstimatedFreeAt = {};

  for (const m of readyMatches) {
    const pIds = getMatchParticipantIds(m);
    const mDuration = m.roundDurationMinutes || m.durationMinutes || durationMin;

    // Earliest time all players in this match are free from previous estimated matches
    let matchEarliestStart = currentBoardTime.getTime();

    for (const pId of pIds) {
      if (playerEstimatedFreeAt[pId]) {
        if (playerEstimatedFreeAt[pId] > matchEarliestStart) {
          matchEarliestStart = playerEstimatedFreeAt[pId];
        }
      }
    }

    const estimatedStart = new Date(Math.max(currentBoardTime.getTime(), matchEarliestStart));
    const estimatedEnd = new Date(estimatedStart.getTime() + mDuration * 60 * 1000);

    m.scheduledTime = estimatedStart;
    m.roundDurationMinutes = mDuration;
    m.durationMinutes = mDuration;
    m.boardName = 'Main Carrom Board';
    m.carromBoardNumber = 1;
    await m.save();

    // Update player free times for subsequent queue estimates
    for (const pId of pIds) {
      playerEstimatedFreeAt[pId] = estimatedEnd.getTime();
    }

    // Board becomes free for next match after estimatedEnd + break
    currentBoardTime = new Date(estimatedEnd.getTime() + breakMin * 60 * 1000);
  }

  return readyMatches;
};

/**
 * Appends a newly-ready match to the end of the READY queue in FIFO order
 */
const enqueueNewlyReadyMatch = async (tournamentId, matchDoc) => {
  if (!matchDoc || matchDoc.isBye || matchDoc.status === 'completed') return matchDoc;
  if (!matchDoc.team1 || !matchDoc.team2) return matchDoc; // Still WAITING

  const tournament = await Tournament.findById(tournamentId);
  const durationMin = tournament?.scheduleSettings?.roundDurationMinutes || tournament?.scheduleSettings?.matchDurationMinutes || 20;

  // Find max queuePosition among currently ready matches
  const maxPositionMatch = await Match.findOne({
    tournamentId,
    status: 'scheduled',
    _id: { $ne: matchDoc._id }
  }).sort({ queuePosition: -1 });

  const nextPos = (maxPositionMatch?.queuePosition || 0) + 1;

  matchDoc.queuePosition = nextPos;
  matchDoc.status = 'scheduled';
  matchDoc.boardName = 'Main Carrom Board';
  matchDoc.carromBoardNumber = 1;
  if (!matchDoc.roundDurationMinutes) {
    matchDoc.roundDurationMinutes = durationMin;
    matchDoc.durationMinutes = durationMin;
  }
  await matchDoc.save();

  await recalculateEstimatedTimes(tournamentId);
  return matchDoc;
};

/**
 * Generates initial sequential schedule for all playable Round 1 matches across all published categories
 */
const generateSequentialSchedule = async (tournamentId, settings = {}, adminUserId = null) => {
  const tournament = await Tournament.findById(tournamentId);
  if (!tournament) throw new Error('Tournament not found.');

  const roundDuration = Number(settings.roundDurationMinutes || settings.matchDurationMinutes || tournament.scheduleSettings.roundDurationMinutes || tournament.scheduleSettings.matchDurationMinutes || 20);

  if (settings.startTime) tournament.scheduleSettings.startTime = new Date(settings.startTime);
  tournament.scheduleSettings.roundDurationMinutes = roundDuration;
  tournament.scheduleSettings.matchDurationMinutes = roundDuration;
  if (settings.breakTimeMinutes !== undefined) tournament.scheduleSettings.breakTimeMinutes = Number(settings.breakTimeMinutes);
  if (settings.minRestTimeMinutes !== undefined) tournament.scheduleSettings.minRestTimeMinutes = Number(settings.minRestTimeMinutes);

  tournament.markModified('scheduleSettings');
  await tournament.save();

  // Find all matches that have known teams and are not completed or bye
  const playableMatches = await Match.find({
    tournamentId,
    isBye: false,
    status: { $ne: 'completed' },
    team1: { $ne: null },
    team2: { $ne: null }
  }).sort({ roundNumber: 1, category: 1, matchNumber: 1 });

  // Assign sequential queuePositions 1..N
  let qPos = 1;
  for (const m of playableMatches) {
    m.queuePosition = qPos++;
    m.status = m.status === 'live' ? 'live' : 'scheduled';
    m.boardName = 'Main Carrom Board';
    m.carromBoardNumber = 1;
    m.roundDurationMinutes = roundDuration;
    m.durationMinutes = roundDuration;
    await m.save();
  }

  // Ensure all matches with TBD/null teams remain pending (WAITING)
  await Match.updateMany(
    {
      tournamentId,
      isBye: false,
      $or: [{ team1: null }, { team2: null }]
    },
    {
      $set: {
        status: 'pending',
        queuePosition: null,
        scheduledTime: null,
        boardName: 'Main Carrom Board',
        carromBoardNumber: 1
      }
    }
  );

  // Recalculate estimated times
  await recalculateEstimatedTimes(tournamentId);

  return {
    success: true,
    totalQueued: playableMatches.length,
    scheduleSettings: tournament.scheduleSettings
  };
};

module.exports = {
  getMatchParticipantIds,
  checkMatchRestAvailability,
  canStartMatch,
  recalculateEstimatedTimes,
  enqueueNewlyReadyMatch,
  generateSequentialSchedule
};
