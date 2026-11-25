const Match = require('../models/Match');
const Team = require('../models/Team');
const Tournament = require('../models/Tournament');
const Participant = require('../models/Participant');
const CarromBoard = require('../models/CarromBoard');

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
 * Validates all pre-conditions before a match can be started on a specific Carrom Board.
 * Supports multiple concurrent boards (Board 1, Board 2, Board 3, etc.)
 * Supports admin forceStart override to bypass participant overlap warnings.
 */
const canStartMatch = async (matchId, targetBoardNumber = 1, options = {}) => {
  const { force = false, forceStart = false } = options || {};
  const isForced = Boolean(force || forceStart);

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
    return { canStart: false, reason: `Match is already LIVE on Carrom Board #${match.carromBoardNumber || 1}.` };
  }

  if (!match.team1 || !match.team2) {
    return { canStart: false, reason: 'Match is WAITING: Both opponents must be determined before starting.' };
  }

  const boardNum = Number(targetBoardNumber) || match.carromBoardNumber || 1;

  // 1. Check if ANY match is currently LIVE on THIS specific board
  const liveOnBoard = await Match.findOne({
    tournamentId: match.tournamentId,
    status: 'live',
    carromBoardNumber: boardNum,
    _id: { $ne: match._id }
  }).populate('team1').populate('team2');

  if (liveOnBoard) {
    return {
      canStart: false,
      reason: `Carrom Board #${boardNum} is currently occupied by Match #${liveOnBoard.matchNumber} (${liveOnBoard.team1?.name || 'T1'} vs ${liveOnBoard.team2?.name || 'T2'}). Complete or vacate that board first, or launch on another available board.`
    };
  }

  // 2. Check participant live conflict across ALL other active boards (unless admin forceStart override):
  if (!isForced) {
    const startingParticipantIds = getMatchParticipantIds(match).filter(Boolean);
    const otherLiveMatches = await Match.find({
      tournamentId: match.tournamentId,
      status: 'live',
      _id: { $ne: match._id }
    })
      .populate({ path: 'team1', populate: [{ path: 'player1' }, { path: 'player2' }] })
      .populate({ path: 'team2', populate: [{ path: 'player1' }, { path: 'player2' }] });

    for (const lm of otherLiveMatches) {
      const liveIds = getMatchParticipantIds(lm).filter(Boolean);
      const overlappingId = startingParticipantIds.find((id) => id && liveIds.includes(id));
      if (overlappingId) {
        return {
          canStart: false,
          isPlayerConflict: true,
          conflictingMatch: lm.matchNumber,
          conflictingBoard: lm.carromBoardNumber || 1,
          reason: `A contestant in this match is currently playing live on Board #${lm.carromBoardNumber || 1} (Match #${lm.matchNumber}). A player cannot participate in two concurrent matches.`
        };
      }
    }

    // 3. Check participant rest availability
    const restCheck = await checkMatchRestAvailability(match.tournamentId, match);
    if (!restCheck.isRested) {
      return {
        canStart: false,
        isRestConflict: true,
        reason: restCheck.reason,
        restingPlayerName: restCheck.restingPlayerName
      };
    }
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

  // Fetch all active boards for multi-court timeline calculation
  const boards = await CarromBoard.find({ tournamentId, status: { $ne: 'maintenance' } }).sort({ boardNumber: 1 });
  const boardMap = new Map();
  boards.forEach((b) => boardMap.set(b.boardNumber, b.name));

  // Determine baseline available time per board
  const boardFreeTimes = new Map();

  // Check live matches per board
  const liveMatches = await Match.find({ tournamentId, status: 'live' });
  for (const lm of liveMatches) {
    const bNum = lm.carromBoardNumber || 1;
    const liveStart = lm.actualStartTime ? new Date(lm.actualStartTime).getTime() : Date.now();
    const liveDur = lm.roundDurationMinutes || lm.durationMinutes || durationMin;
    const liveEstEnd = liveStart + liveDur * 60 * 1000;
    boardFreeTimes.set(bNum, new Date(Math.max(Date.now(), liveEstEnd + breakMin * 60 * 1000)));
  }

  // Check last completed matches per board
  const completedMatches = await Match.find({ tournamentId, status: 'completed' }).sort({ actualEndTime: -1, updatedAt: -1 });
  for (const cm of completedMatches) {
    const bNum = cm.carromBoardNumber || 1;
    if (!boardFreeTimes.has(bNum) && cm.actualEndTime) {
      const lastEnd = new Date(cm.actualEndTime).getTime();
      boardFreeTimes.set(bNum, new Date(Math.max(Date.now(), lastEnd + breakMin * 60 * 1000, configuredStart.getTime())));
    }
  }

  const getBoardFreeTime = (bNum) => {
    return boardFreeTimes.get(bNum) || new Date(Math.max(Date.now(), configuredStart.getTime()));
  };

  // Player finish time tracker for estimated cross-category scheduling
  const playerEstimatedFreeAt = {};

  for (const m of readyMatches) {
    const pIds = getMatchParticipantIds(m);
    const mDuration = m.roundDurationMinutes || m.durationMinutes || durationMin;
    const bNum = m.carromBoardNumber || 1;
    const boardTime = getBoardFreeTime(bNum);

    // Earliest time all players in this match are free from previous estimated matches
    let matchEarliestStart = boardTime.getTime();

    for (const pId of pIds) {
      if (playerEstimatedFreeAt[pId]) {
        if (playerEstimatedFreeAt[pId] > matchEarliestStart) {
          matchEarliestStart = playerEstimatedFreeAt[pId];
        }
      }
    }

    const estimatedStart = new Date(Math.max(boardTime.getTime(), matchEarliestStart));
    const estimatedEnd = new Date(estimatedStart.getTime() + mDuration * 60 * 1000);

    m.scheduledTime = estimatedStart;
    m.roundDurationMinutes = mDuration;
    m.durationMinutes = mDuration;
    m.carromBoardNumber = bNum;
    m.boardName = boardMap.get(bNum) || m.boardName || `Carrom Board ${bNum}`;
    await m.save();

    // Update player free times for subsequent queue estimates
    for (const pId of pIds) {
      playerEstimatedFreeAt[pId] = estimatedEnd.getTime();
    }

    // Board becomes free for next match after estimatedEnd + break
    boardFreeTimes.set(bNum, new Date(estimatedEnd.getTime() + breakMin * 60 * 1000));
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
  if (!matchDoc.carromBoardNumber) {
    matchDoc.carromBoardNumber = 1;
    matchDoc.boardName = 'Carrom Board 1';
  }
  if (!matchDoc.roundDurationMinutes) {
    matchDoc.roundDurationMinutes = durationMin;
    matchDoc.durationMinutes = durationMin;
  }
  await matchDoc.save();

  await recalculateEstimatedTimes(tournamentId);
  return matchDoc;
};

/**
 * Generates/reschedules sequential schedule across selected or all categories
 * Supports:
 * - Specific category filtering ('all' vs 'boys_singles', etc.)
 * - Rescheduling only the current playable round for each category
 * - Holding later bracket rounds until their winners advance
 * - Restarting the active round from 0-0 when requested
 * - Intelligent court distribution across Board 1, Board 2, etc.
 */
const generateSequentialSchedule = async (tournamentId, settings = {}, adminUserId = null) => {
  const tournament = await Tournament.findById(tournamentId);
  if (!tournament) throw new Error('Tournament not found.');

  const roundDuration = Number(
    settings.roundDurationMinutes ||
    settings.matchDurationMinutes ||
    tournament.scheduleSettings?.roundDurationMinutes ||
    tournament.scheduleSettings?.matchDurationMinutes ||
    20
  );

  if (settings.startTime) tournament.scheduleSettings.startTime = new Date(settings.startTime);
  tournament.scheduleSettings.roundDurationMinutes = roundDuration;
  tournament.scheduleSettings.matchDurationMinutes = roundDuration;
  if (settings.breakTimeMinutes !== undefined) tournament.scheduleSettings.breakTimeMinutes = Number(settings.breakTimeMinutes);
  if (settings.minRestTimeMinutes !== undefined) tournament.scheduleSettings.minRestTimeMinutes = Number(settings.minRestTimeMinutes);

  const selectedCategory = settings.category && settings.category !== 'all' ? settings.category : null;
  const restartMatches = settings.restartMatches === true || settings.restartMatches === 'true';

  const categoryFilter = selectedCategory ? { category: selectedCategory } : {};
  const scopedMatches = await Match.find({ tournamentId, ...categoryFilter })
    .select('category roundNumber isBye status winnerTeam');
  const categoryIds = [...new Set(scopedMatches.map((match) => match.category))];
  const currentRoundByCategory = new Map();

  for (const match of scopedMatches) {
    if (match.roundNumber <= 0 || match.isBye || (match.status === 'completed' && match.winnerTeam)) continue;
    const currentRound = currentRoundByCategory.get(match.category);
    if (currentRound === undefined || match.roundNumber < currentRound) {
      currentRoundByCategory.set(match.category, match.roundNumber);
    }
  }

  const schedulableStages = [];
  for (const category of categoryIds) {
    const currentRound = currentRoundByCategory.get(category);
    if (currentRound !== undefined) {
      schedulableStages.push({ category, roundNumber: currentRound });
      continue;
    }

    if (scopedMatches.some((match) => match.category === category && match.roundNumber === 0 && !match.isBye)) {
      schedulableStages.push({ category, roundNumber: 0 });
    }
  }

  const defaultBoards = [
    { boardNumber: 1, team1Score: 0, team2Score: 0, queenPocketedBy: 'none', queenCovered: false, team1Fouls: 0, team2Fouls: 0, boardWinner: null },
    { boardNumber: 2, team1Score: 0, team2Score: 0, queenPocketedBy: 'none', queenCovered: false, team1Fouls: 0, team2Fouls: 0, boardWinner: null },
    { boardNumber: 3, team1Score: 0, team2Score: 0, queenPocketedBy: 'none', queenCovered: false, team1Fouls: 0, team2Fouls: 0, boardWinner: null }
  ];

  for (const [category, currentRound] of currentRoundByCategory.entries()) {
    const futureFilter = { tournamentId, category, roundNumber: { $gt: currentRound } };
    const futureLiveMatch = await Match.findOne({ ...futureFilter, status: 'live' }).select('matchNumber');
    if (futureLiveMatch) {
      throw new Error(`Cannot reschedule Round ${currentRound} while later-round Match #${futureLiveMatch.matchNumber} is live.`);
    }
  }

  tournament.markModified('scheduleSettings');
  await tournament.save();

  for (const [category, currentRound] of currentRoundByCategory.entries()) {
    const futureFilter = { tournamentId, category, roundNumber: { $gt: currentRound } };
    await Match.updateMany(
      { ...futureFilter, isBye: false, status: 'scheduled' },
      { $set: { status: 'pending', queuePosition: null, scheduledTime: null } }
    );

    if (restartMatches) {
      const resetFutureFields = {
        winnerTeam: null,
        isResultConfirmed: false,
        queuePosition: null,
        scheduledTime: null,
        actualStartTime: null,
        actualEndTime: null,
        boards: defaultBoards,
        finalScore: { team1BoardsWon: 0, team2BoardsWon: 0 },
        isTimerPaused: false,
        timerPausedAt: null,
        timeElapsedBeforePause: 0,
        elapsedTimeSeconds: 0,
        extraTimeMinutes: 0
      };

      await Match.updateMany(
        { ...futureFilter, isManual: { $ne: true }, isBye: false },
        { $set: { ...resetFutureFields, team1: null, team2: null, status: 'pending' } }
      );
      await Match.updateMany(
        { ...futureFilter, isManual: { $ne: true }, isBye: true },
        { $set: { ...resetFutureFields, team1: null, team2: null, status: 'bye', isResultConfirmed: true, boards: [] } }
      );
    }
  }

  // Base match query for matches with known teams and not BYE
  const matchFilter = {
    tournamentId,
    isBye: false,
    team1: { $ne: null },
    team2: { $ne: null }
  };

  if (selectedCategory) {
    matchFilter.category = selectedCategory;
  }
  matchFilter.$or = schedulableStages;

  // If NOT restarting, we only reschedule uncompleted matches
  if (!restartMatches) {
    matchFilter.status = { $ne: 'completed' };
  }

  const playableMatches = schedulableStages.length > 0
    ? await Match.find(matchFilter).sort({ roundNumber: 1, category: 1, matchNumber: 1 })
    : [];

  // Get active courts/boards
  const boards = await CarromBoard.find({ tournamentId, status: { $ne: 'maintenance' } }).sort({ boardNumber: 1 });
  const boardCount = boards.length || 1;

  let qPos = 1;
  let restartedCount = 0;

  for (let i = 0; i < playableMatches.length; i++) {
    const m = playableMatches[i];

    if (restartMatches) {
      // Free any CarromBoard where this match was active
      await CarromBoard.updateMany(
        { tournamentId, currentMatchId: m._id },
        { status: 'available', currentMatchId: null }
      );

      m.status = 'scheduled';
      m.boards = defaultBoards;
      m.team1Score = 0;
      m.team2Score = 0;
      m.team1BoardsWon = 0;
      m.team2BoardsWon = 0;
      m.winner = null;
      m.winnerTeam = null;
      m.resultType = null;
      m.actualStartTime = null;
      m.actualEndTime = null;
      m.isTimerPaused = false;
      m.timerPausedAt = null;
      m.timeElapsedBeforePause = 0;
      m.elapsedTimeSeconds = 0;
      m.extraTimeMinutes = 0;
      restartedCount++;
    } else {
      m.status = m.status === 'live' ? 'live' : 'scheduled';
    }

    m.queuePosition = qPos++;
    m.roundDurationMinutes = roundDuration;
    m.durationMinutes = roundDuration;

    // Distribute court/board if multiple courts exist
    if (settings.targetBoardNumber) {
      const bNum = Number(settings.targetBoardNumber);
      const bObj = boards.find((b) => b.boardNumber === bNum);
      m.carromBoardNumber = bNum;
      m.boardName = bObj?.name || `Carrom Board ${bNum}`;
    } else if (settings.distributeCourts !== false && boardCount > 1) {
      // Check if any board has assignedCategory matching this match's category
      const catBoard = boards.find((b) => b.assignedCategory === m.category);
      if (catBoard) {
        m.carromBoardNumber = catBoard.boardNumber;
        m.boardName = catBoard.name;
      } else {
        // Distribute round-robin among boards assigned to 'all' or all boards
        const eligibleBoards = boards.filter((b) => b.assignedCategory === 'all' || b.assignedCategory === m.category);
        const pool = eligibleBoards.length > 0 ? eligibleBoards : boards;
        const assignedB = pool[i % pool.length];
        m.carromBoardNumber = assignedB.boardNumber;
        m.boardName = assignedB.name;
      }
    } else {
      m.carromBoardNumber = boards[0]?.boardNumber || 1;
      m.boardName = boards[0]?.name || 'Carrom Board 1';
    }

    await m.save();
  }

  // Ensure all matches with TBD/null teams remain pending (WAITING)
  const pendingFilter = {
    tournamentId,
    isBye: false,
    $or: [{ team1: null }, { team2: null }]
  };
  if (selectedCategory) pendingFilter.category = selectedCategory;

  await Match.updateMany(
    pendingFilter,
    {
      $set: {
        status: 'pending',
        queuePosition: null,
        scheduledTime: null
      }
    }
  );

  // Recalculate estimated times
  await recalculateEstimatedTimes(tournamentId);

  return {
    success: true,
    totalQueued: playableMatches.length,
    restartedCount,
    category: selectedCategory || 'all',
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
