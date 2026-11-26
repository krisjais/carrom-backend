const mongoose = require('mongoose');
const Match = require('../models/Match');
const Tournament = require('../models/Tournament');
const Team = require('../models/Team');
const Participant = require('../models/Participant');
const CarromBoard = require('../models/CarromBoard');
const AuditLog = require('../models/AuditLog');
const {
  updateMatchLiveScore,
  confirmMatchWinner,
  correctMatchResult
} = require('../services/scoringEngine');
const {
  canStartMatch,
  recalculateEstimatedTimes,
  enqueueNewlyReadyMatch
} = require('../services/scheduleEngine');
const {
  getCurrentBracketRoundNumber,
  ensureFollowupRoundCapacity,
  attachManualMatchesToActiveRound,
  progressCategoryToNextRound
} = require('../services/drawEngine');
const { emitMatchUpdate, emitCarromLive } = require('../socket');

// Get all matches with filtering
const getMatches = async (req, res, next) => {
  try {
    const { category, status, roundNumber, tournamentId } = req.query;

    let query = {};
    if (category) query.category = category;
    if (status) query.status = status;
    if (roundNumber) query.roundNumber = Number(roundNumber);

    let tournId = tournamentId;
    if (!tournId) {
      const activeTourn = await Tournament.findOne().sort({ createdAt: -1 });
      if (activeTourn) tournId = activeTourn._id;
    }
    if (tournId) query.tournamentId = tournId;

    const matches = await Match.find(query)
      .populate({
        path: 'team1',
        populate: [{ path: 'player1' }, { path: 'player2' }]
      })
      .populate({
        path: 'team2',
        populate: [{ path: 'player1' }, { path: 'player2' }]
      })
      .populate({
        path: 'winnerTeam',
        populate: [{ path: 'player1' }, { path: 'player2' }]
      })
      .sort({ queuePosition: 1, scheduledTime: 1, roundNumber: 1, matchNumber: 1 });

    res.json({ success: true, count: matches.length, matches });
  } catch (error) {
    next(error);
  }
};

// Admin: Add late entries to the currently active round in a generated draw
const createAdditionalMatch = async (req, res, next) => {
  try {
    const { category, team1Id, team2Id } = req.body || {};
    const allowedCategories = ['boys_singles', 'girls_singles', 'boys_doubles', 'girls_doubles', 'mixed_doubles'];
    const hasTeam2 = Boolean(team2Id);

    if (!allowedCategories.includes(category)) {
      return res.status(400).json({ success: false, message: 'Select a valid tournament category.' });
    }
    if (!mongoose.Types.ObjectId.isValid(team1Id) || (hasTeam2 && !mongoose.Types.ObjectId.isValid(team2Id))) {
      return res.status(400).json({ success: false, message: 'Select a valid entry or pair.' });
    }
    if (hasTeam2 && String(team1Id) === String(team2Id)) {
      return res.status(400).json({ success: false, message: 'Choose two different entries.' });
    }

    const tournament = await Tournament.findOne().sort({ createdAt: -1 });
    if (!tournament) {
      return res.status(404).json({ success: false, message: 'No active tournament found.' });
    }
    const existingMatchCount = await Match.countDocuments({ tournamentId: tournament._id, category });
    const isFirstManualMatch = existingMatchCount === 0;
    if (isFirstManualMatch && !hasTeam2) {
      return res.status(400).json({
        success: false,
        message: 'Choose two approved entries to create the first manual match.'
      });
    }

    const selectedTeamIds = hasTeam2 ? [team1Id, team2Id] : [team1Id];
    const selectedTeams = await Team.find({
      _id: { $in: selectedTeamIds },
      tournamentId: tournament._id,
      category,
      isApproved: true
    });
    if (selectedTeams.length !== selectedTeamIds.length) {
      return res.status(400).json({
        success: false,
        message: 'Every selected entry must be approved in this category and active tournament.'
      });
    }

    if (!isFirstManualMatch) {
      await attachManualMatchesToActiveRound(tournament._id, category);
    }

    const categoryMatches = await Match.find({ tournamentId: tournament._id, category })
      .sort({ roundNumber: 1, matchIndexInRound: 1 });
    const assignedTeamIds = new Set(
      categoryMatches.flatMap((match) => [match.team1, match.team2]).filter(Boolean).map((id) => String(id))
    );
    if (selectedTeamIds.some((id) => assignedTeamIds.has(String(id)))) {
      return res.status(400).json({
        success: false,
        message: 'One or more selected entries are already assigned to a tournament match.'
      });
    }

    if (!hasTeam2) {
      const approvedTeams = await Team.find({
        tournamentId: tournament._id,
        category,
        isApproved: true
      }).select('_id');
      const unassignedTeams = approvedTeams.filter((team) => !assignedTeamIds.has(String(team._id)));
      if (unassignedTeams.length !== 1 || String(unassignedTeams[0]?._id) !== String(team1Id)) {
        return res.status(400).json({
          success: false,
          message: 'A BYE can be added only when exactly one approved entry is left. Select two entries to create a match.'
        });
      }
    }

    const currentRoundNumber = isFirstManualMatch
      ? 1
      : getCurrentBracketRoundNumber(categoryMatches)
        || categoryMatches
          .filter((match) => !match.isBye && match.status !== 'completed')
          .map((match) => match.roundNumber)
          .sort((a, b) => a - b)[0]
        || categoryMatches
          .filter((match) => !match.isBye)
          .map((match) => match.roundNumber)
          .sort((a, b) => b - a)[0];
    if (!currentRoundNumber) {
      return res.status(400).json({
        success: false,
        message: 'There is no active bracket round for this category.'
      });
    }
    const currentRoundMatches = categoryMatches.filter((match) => match.roundNumber === currentRoundNumber);
    const currentRoundName = currentRoundMatches[0]?.roundName || `Round ${currentRoundNumber}`;

    const [latestCategoryMatch, boards] = await Promise.all([
      Match.findOne({ tournamentId: tournament._id, category }).sort({ matchNumber: -1 }).select('matchNumber'),
      hasTeam2
        ? CarromBoard.find({ tournamentId: tournament._id, status: { $ne: 'maintenance' } }).sort({ boardNumber: 1 })
        : Promise.resolve([])
    ]);
    const targetBoard = boards.find((board) => board.assignedCategory === category)
      || boards.find((board) => board.assignedCategory === 'all')
      || boards[0];
    const duration = tournament.scheduleSettings?.roundDurationMinutes
      || tournament.scheduleSettings?.matchDurationMinutes
      || 20;

    let match = await Match.create({
      tournamentId: tournament._id,
      category,
      roundNumber: currentRoundNumber,
      roundName: currentRoundName,
      matchNumber: (latestCategoryMatch?.matchNumber || 0) + 1,
      matchIndexInRound: currentRoundMatches.reduce((max, currentMatch) => Math.max(max, currentMatch.matchIndexInRound || 0), -1) + 1,
      team1: team1Id,
      team2: hasTeam2 ? team2Id : null,
      isManual: true,
      isBye: !hasTeam2,
      status: hasTeam2 ? 'pending' : 'bye',
      winnerTeam: hasTeam2 ? null : team1Id,
      isResultConfirmed: !hasTeam2,
      boardName: targetBoard?.name || 'Carrom Board 1',
      carromBoardNumber: targetBoard?.boardNumber || 1,
      queuePosition: null,
      roundDurationMinutes: duration,
      durationMinutes: duration,
      boards: hasTeam2 ? undefined : []
    });

    try {
      await ensureFollowupRoundCapacity(
        tournament._id,
        category,
        currentRoundNumber,
        currentRoundMatches.length + 1,
        currentRoundName
      );
    } catch (error) {
      await Match.deleteOne({ _id: match._id });
      throw error;
    }

    if (hasTeam2) {
      match = await enqueueNewlyReadyMatch(tournament._id, match);
    } else {
      await progressCategoryToNextRound(tournament._id, category, currentRoundNumber);
    }

    const populatedMatch = await Match.findById(match._id)
      .populate({ path: 'team1', populate: [{ path: 'player1' }, { path: 'player2' }] })
      .populate({ path: 'team2', populate: [{ path: 'player1' }, { path: 'player2' }] })
      .populate({ path: 'winnerTeam', populate: [{ path: 'player1' }, { path: 'player2' }] });

    await AuditLog.create({
      action: isFirstManualMatch ? 'CREATE_MANUAL_MATCH' : 'CREATE_ADDITIONAL_MATCH',
      performedBy: req.user._id,
      performedByName: req.user.fullName || 'Admin',
      entityType: 'Match',
      entityId: match._id.toString(),
      details: { category, matchNumber: match.matchNumber, team1Id, team2Id: hasTeam2 ? team2Id : null, isBye: !hasTeam2, isFirstManualMatch },
      reason: isFirstManualMatch
        ? `Created the first manual ${category.replace('_', ' ')} match in ${currentRoundName}; other entries remain unpaired.`
        : hasTeam2
          ? `Added a manual ${category.replace('_', ' ')} match to ${currentRoundName}.`
          : `Added a manual BYE for ${category.replace('_', ' ')} to ${currentRoundName}.`
    });

    emitMatchUpdate(match._id, 'carrom:match_updated', populatedMatch);
    emitCarromLive('carrom:match_updated', populatedMatch);

    res.status(201).json({
      success: true,
      message: isFirstManualMatch
        ? `Manual Match #${match.matchNumber} created in ${currentRoundName}. Other approved entries remain unpaired until you add their matches.`
        : hasTeam2
          ? `Manual Match #${match.matchNumber} added to ${currentRoundName}. Its winner will advance through the bracket. The live match continues uninterrupted.`
          : `Late entry added as a BYE in ${currentRoundName}. The entry will advance automatically when the round is ready.`,
      match: populatedMatch
    });
  } catch (error) {
    next(error);
  }
};

// Helper to clamp live match timer if round time completed
const checkAndClampMatchTimer = async (match) => {
  if (!match || match.status !== 'live' || !match.actualStartTime) {
    return match;
  }
  const allowedSecs = (Number(match.roundDurationMinutes || match.durationMinutes || 20) + Number(match.extraTimeMinutes || 0)) * 60;
  let currentElapsed = Number(match.timeElapsedBeforePause || 0);
  if (!match.isTimerPaused) {
    const sessionElapsed = Math.max(0, Math.floor((Date.now() - new Date(match.actualStartTime).getTime()) / 1000));
    currentElapsed += sessionElapsed;
  }

  if (currentElapsed >= allowedSecs) {
    if (!match.isTimerPaused || match.timeElapsedBeforePause !== allowedSecs) {
      match.isTimerPaused = true;
      match.timeElapsedBeforePause = allowedSecs;
      match.timerPausedAt = match.timerPausedAt || new Date();
      await match.save();
    }
  }
  return match;
};

// Get Live Match, Next Match, Ready Queue, and Arena State
const getLiveMatches = async (req, res, next) => {
  try {
    let tournId = req.query.tournamentId;
    if (!tournId) {
      const activeTourn = await Tournament.findOne().sort({ createdAt: -1 });
      if (activeTourn) tournId = activeTourn._id;
    }

    // All LIVE matches across all Carrom Boards
    const liveMatches = await Match.find({
      tournamentId: tournId,
      status: 'live'
    })
      .populate({
        path: 'team1',
        populate: [{ path: 'player1' }, { path: 'player2' }]
      })
      .populate({
        path: 'team2',
        populate: [{ path: 'player1' }, { path: 'player2' }]
      });

    for (const lm of liveMatches) {
      await checkAndClampMatchTimer(lm);
    }

    const currentMatch = liveMatches.length > 0 ? liveMatches[0] : null;

    // Fetch Carrom Boards & sync with active matches
    let boards = await CarromBoard.find({ tournamentId: tournId }).sort({ boardNumber: 1 });
    if (boards.length === 0) {
      boards = await CarromBoard.insertMany([
        {
          tournamentId: tournId,
          boardNumber: 1,
          name: 'Carrom Board 1 - Main Court',
          status: 'available',
          assignedCategory: 'all'
        },
        {
          tournamentId: tournId,
          boardNumber: 2,
          name: 'Carrom Board 2',
          status: 'available',
          assignedCategory: 'all'
        }
      ]);
    }

    const populatedBoards = boards.map((b) => {
      const activeMatch = liveMatches.find((m) => (m.carromBoardNumber || 1) === b.boardNumber);
      const bObj = b.toObject();
      bObj.status = activeMatch ? 'live' : (b.status === 'maintenance' ? 'maintenance' : 'available');
      bObj.currentMatch = activeMatch || null;
      return bObj;
    });

    // READY Queue: Playable matches with known teams waiting for any Carrom Board
    const readyQueue = await Match.find({
      tournamentId: tournId,
      status: 'scheduled',
      isBye: false,
      team1: { $ne: null },
      team2: { $ne: null }
    })
      .populate({
        path: 'team1',
        populate: [{ path: 'player1' }, { path: 'player2' }]
      })
      .populate({
        path: 'team2',
        populate: [{ path: 'player1' }, { path: 'player2' }]
      })
      .sort({ queuePosition: 1, scheduledTime: 1 });

    // Next match in line
    const nextMatch = readyQueue.length > 0 ? readyQueue[0] : null;
    let nextMatchReadiness = null;
    if (nextMatch) {
      nextMatchReadiness = await canStartMatch(nextMatch._id);
    }

    // WAITING matches: not yet ready because previous round opponents not decided
    const waitingMatchesCount = await Match.countDocuments({
      tournamentId: tournId,
      status: 'pending',
      isBye: false,
      $or: [{ team1: null }, { team2: null }]
    });

    const recentlyCompleted = await Match.find({
      tournamentId: tournId,
      status: 'completed'
    })
      .populate({
        path: 'team1',
        populate: [{ path: 'player1' }, { path: 'player2' }]
      })
      .populate({
        path: 'team2',
        populate: [{ path: 'player1' }, { path: 'player2' }]
      })
      .populate('winnerTeam')
      .limit(6)
      .sort({ actualEndTime: -1, updatedAt: -1 });

    res.json({
      success: true,
      boards: populatedBoards,
      currentMatch,
      nextMatch,
      nextMatchReadiness,
      readyQueue,
      waitingMatchesCount,
      completedMatches: recentlyCompleted,
      isBoardOccupied: liveMatches.length > 0,
      liveMatches,
      upcomingMatches: readyQueue.slice(0, 8),
      recentlyCompleted
    });
  } catch (error) {
    next(error);
  }
};

// Get single match detail
const getMatchById = async (req, res, next) => {
  try {
    const { id } = req.params;
    const match = await Match.findById(id)
      .populate({
        path: 'team1',
        populate: [{ path: 'player1' }, { path: 'player2' }]
      })
      .populate({
        path: 'team2',
        populate: [{ path: 'player1' }, { path: 'player2' }]
      })
      .populate({
        path: 'winnerTeam',
        populate: [{ path: 'player1' }, { path: 'player2' }]
      })
      .populate('nextMatchId');

    if (!match) {
      return res.status(404).json({ success: false, message: 'Match not found.' });
    }

    if (match.status === 'live') {
      await checkAndClampMatchTimer(match);
    }

    let readiness = null;
    if (match.status === 'scheduled') {
      readiness = await canStartMatch(match._id);
    }

    res.json({ success: true, match, readiness });
  } catch (error) {
    next(error);
  }
};

// Admin: Start Match on a specific Carrom Board (Supports multi-board parallel courts)
const startMatch = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { durationMinutes, roundDurationMinutes, carromBoardNumber, boardName, force, forceStart } = req.body || {};
    const targetBoardNumber = Number(carromBoardNumber) || 1;
    const targetBoardName = boardName || `Carrom Board ${targetBoardNumber}`;

    const readiness = await canStartMatch(id, targetBoardNumber, { force: force || forceStart });

    if (!readiness.canStart) {
      return res.status(400).json({
        success: false,
        message: readiness.reason,
        isPlayerConflict: readiness.isPlayerConflict || false,
        conflictingMatch: readiness.conflictingMatch,
        conflictingBoard: readiness.conflictingBoard,
        readiness
      });
    }

    const match = readiness.match;
    const tournament = await Tournament.findById(match.tournamentId);
    const configuredDuration = Number(
      roundDurationMinutes ||
      durationMinutes ||
      match.roundDurationMinutes ||
      match.durationMinutes ||
      tournament?.scheduleSettings?.roundDurationMinutes ||
      tournament?.scheduleSettings?.matchDurationMinutes ||
      20
    );

    match.status = 'live';
    match.actualStartTime = new Date();
    match.boardName = targetBoardName;
    match.carromBoardNumber = targetBoardNumber;
    match.roundDurationMinutes = configuredDuration;
    match.durationMinutes = configuredDuration;
    match.isTimerPaused = false;
    match.timerPausedAt = null;
    match.timeElapsedBeforePause = 0;
    match.extraTimeMinutes = 0;
    await match.save();

    // Sync CarromBoard status
    await CarromBoard.findOneAndUpdate(
      { tournamentId: match.tournamentId, boardNumber: targetBoardNumber },
      { status: 'live', currentMatchId: match._id, name: targetBoardName },
      { upsert: true, new: true }
    );

    // Recalculate estimated times for remaining queue
    await recalculateEstimatedTimes(match.tournamentId);

    await AuditLog.create({
      action: 'START_MATCH',
      performedBy: req.user._id,
      performedByName: req.user.fullName || 'Admin',
      entityType: 'Match',
      entityId: match._id.toString(),
      details: {
        matchNumber: match.matchNumber,
        category: match.category,
        roundName: match.roundName,
        team1: match.team1?.name,
        team2: match.team2?.name,
        actualStartTime: match.actualStartTime,
        roundDurationMinutes: configuredDuration,
        carromBoardNumber: targetBoardNumber,
        boardName: targetBoardName
      },
      reason: `Started Match #${match.matchNumber} as LIVE on ${targetBoardName} (Board #${targetBoardNumber}) with ${configuredDuration} min round time.`
    });

    emitMatchUpdate(match._id, 'match:started', { matchId: match._id, match });
    emitCarromLive('carrom:match_started', { matchId: match._id, match });

    res.json({
      success: true,
      message: `Match #${match.matchNumber} is now LIVE on ${targetBoardName} (${configuredDuration} min round).`,
      match
    });
  } catch (error) {
    next(error);
  }
};

// Admin: Update Match Timer (Pause, Resume, Add Extra Time, Change Duration, Reset)
const updateMatchTimer = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { action, extraMinutes, durationMinutes, roundDurationMinutes } = req.body || {};

    const match = await Match.findById(id).populate('team1 team2');
    if (!match) {
      return res.status(404).json({ success: false, message: 'Match not found.' });
    }

    const now = new Date();

    const allowedSecs = (Number(match.roundDurationMinutes || match.durationMinutes || 20) + Number(match.extraTimeMinutes || 0)) * 60;

    switch (action) {
      case 'pause': {
        if (!match.isTimerPaused && match.actualStartTime) {
          const currentSessionElapsed = Math.floor((now.getTime() - new Date(match.actualStartTime).getTime()) / 1000);
          match.timeElapsedBeforePause = Math.min(allowedSecs, (match.timeElapsedBeforePause || 0) + Math.max(0, currentSessionElapsed));
          match.isTimerPaused = true;
          match.timerPausedAt = now;
        }
        break;
      }
      case 'resume': {
        if (match.isTimerPaused) {
          // Only allow resuming if there is remaining time
          if ((match.timeElapsedBeforePause || 0) < allowedSecs) {
            match.isTimerPaused = false;
            match.timerPausedAt = null;
            match.actualStartTime = now;
          }
        }
        break;
      }
      case 'expire':
      case 'time_completed': {
        match.timeElapsedBeforePause = allowedSecs;
        match.isTimerPaused = true;
        match.timerPausedAt = now;
        break;
      }
      case 'add_time': {
        const added = Number(extraMinutes) || 2;
        match.extraTimeMinutes = (match.extraTimeMinutes || 0) + added;
        break;
      }
      case 'set_duration': {
        const newDur = Number(roundDurationMinutes || durationMinutes);
        if (newDur && newDur > 0) {
          match.roundDurationMinutes = newDur;
          match.durationMinutes = newDur;
        }
        break;
      }
      case 'reset': {
        match.actualStartTime = now;
        match.isTimerPaused = false;
        match.timerPausedAt = null;
        match.timeElapsedBeforePause = 0;
        match.extraTimeMinutes = 0;
        break;
      }
      default:
        return res.status(400).json({ success: false, message: 'Invalid timer action. Supported: pause, resume, add_time, set_duration, reset, expire.' });
    }

    await match.save();

    emitMatchUpdate(match._id, 'match:timer_updated', { matchId: match._id, match, action });
    emitCarromLive('carrom:timer_updated', { matchId: match._id, match, action });

    res.json({
      success: true,
      message: `Match timer updated (${action}).`,
      match
    });
  } catch (error) {
    next(error);
  }
};

// Admin: Update live board scoring & manual board winner
const updateScore = async (req, res, next) => {
  try {
    const { id } = req.params;
    const updatedMatch = await updateMatchLiveScore(id, req.body, req.user);

    emitMatchUpdate(id, 'carrom:score_updated', { matchId: id, match: updatedMatch });
    emitCarromLive('carrom:score_updated', { matchId: id, match: updatedMatch });

    res.json({ success: true, message: 'Match score updated.', match: updatedMatch });
  } catch (error) {
    next(error);
  }
};

// Admin: Confirm match winner
const confirmMatch = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { winnerTeamId } = req.body || {};
    const result = await confirmMatchWinner(id, req.user, winnerTeamId);

    if (result.match && !result.match.isWalkover) {
      await CarromBoard.findOneAndUpdate(
        { tournamentId: result.match.tournamentId, boardNumber: result.match.carromBoardNumber || 1 },
        { status: 'available', currentMatchId: null }
      );
    }

    emitMatchUpdate(id, 'match:completed', { matchId: id, match: result.match, winnerTeamId });
    emitCarromLive('carrom:match_completed', { matchId: id, match: result.match, winnerTeamId });

    res.json({
      success: true,
      message: result.match.isWalkover
        ? 'Walkover awarded. The remaining entry advances when the round is ready.'
        : 'Match winner confirmed and advanced to bracket.',
      match: result.match,
      roundAdvanced: result.roundAdvanced,
      nextReadyMatch: result.nextReadyMatch
    });
  } catch (error) {
    next(error);
  }
};

// Admin: Correct result
const correctMatch = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { boards, reason } = req.body;
    const correctedMatch = await correctMatchResult(id, { boards }, reason, req.user);

    emitMatchUpdate(id, 'carrom:score_updated', { matchId: id, match: correctedMatch });
    emitCarromLive('carrom:score_updated', { matchId: id, match: correctedMatch });

    res.json({
      success: true,
      message: 'Match result corrected successfully.',
      match: correctedMatch
    });
  } catch (error) {
    next(error);
  }
};

// Admin: Adjust match estimated schedule time & round duration
const scheduleMatch = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { scheduledTime, roundDurationMinutes, durationMinutes } = req.body;

    const match = await Match.findById(id);
    if (!match) {
      return res.status(404).json({ success: false, message: 'Match not found.' });
    }

    if (scheduledTime !== undefined) match.scheduledTime = scheduledTime ? new Date(scheduledTime) : null;
    if (roundDurationMinutes !== undefined || durationMinutes !== undefined) {
      const dur = Number(roundDurationMinutes || durationMinutes);
      if (dur > 0) {
        match.roundDurationMinutes = dur;
        match.durationMinutes = dur;
      }
    }
    match.boardName = 'Main Carrom Board';
    match.carromBoardNumber = 1;

    if (match.status === 'pending' && match.team1 && match.team2) {
      match.status = 'scheduled';
    }

    await match.save();

    res.json({ success: true, message: 'Match schedule updated.', match });
  } catch (error) {
    next(error);
  }
};

// Admin: Stop LIVE Match (Revert mistakenly started match back to scheduled status)
const stopLiveMatch = async (req, res, next) => {
  try {
    const { id } = req.params;
    const match = await Match.findById(id).populate('team1 team2');
    if (!match) {
      return res.status(404).json({ success: false, message: 'Match not found.' });
    }

    if (match.status !== 'live') {
      return res.status(400).json({
        success: false,
        message: `Match #${match.matchNumber} is currently in '${match.status}' status and cannot be stopped from live.`
      });
    }

    match.status = 'scheduled';
    match.actualStartTime = null;
    match.isTimerPaused = false;
    match.timerPausedAt = null;
    match.timeElapsedBeforePause = 0;
    match.extraTimeMinutes = 0;
    match.boards = [
      { boardNumber: 1, team1Score: 0, team2Score: 0, queenPocketedBy: 'none', queenCovered: false, team1Fouls: 0, team2Fouls: 0, boardWinner: null },
      { boardNumber: 2, team1Score: 0, team2Score: 0, queenPocketedBy: 'none', queenCovered: false, team1Fouls: 0, team2Fouls: 0, boardWinner: null },
      { boardNumber: 3, team1Score: 0, team2Score: 0, queenPocketedBy: 'none', queenCovered: false, team1Fouls: 0, team2Fouls: 0, boardWinner: null }
    ];
    match.finalScore = { team1BoardsWon: 0, team2BoardsWon: 0 };
    match.winnerTeam = null;

    await match.save();

    // Revert CarromBoard to available
    await CarromBoard.findOneAndUpdate(
      { tournamentId: match.tournamentId, boardNumber: match.carromBoardNumber || 1 },
      { status: 'available', currentMatchId: null }
    );

    // Recalculate estimated times for remaining queue
    await recalculateEstimatedTimes(match.tournamentId);

    await AuditLog.create({
      action: 'STOP_LIVE_MATCH',
      performedBy: req.user._id,
      performedByName: req.user.fullName || 'Admin',
      entityType: 'Match',
      entityId: match._id.toString(),
      details: {
        matchNumber: match.matchNumber,
        category: match.category,
        roundName: match.roundName,
        team1: match.team1?.name,
        team2: match.team2?.name
      },
      reason: `Admin stopped live match #${match.matchNumber} and returned it to scheduled queue.`
    });

    emitMatchUpdate(match._id, 'match:stopped', { matchId: match._id, match });
    emitCarromLive('carrom:match_stopped', { matchId: match._id, match });

    res.json({
      success: true,
      message: `Match #${match.matchNumber} has been stopped from LIVE and returned to the scheduled queue.`,
      match
    });
  } catch (error) {
    next(error);
  }
};

// Admin: Substitute player/partner or update team name in a match
const substituteMatchPartner = async (req, res, next) => {
  try {
    const { id } = req.params;
    const {
      slot, // 'team1' | 'team2'
      teamId, // Optional: swap with an entirely different Team document
      newName, // Optional: custom team name
      newPartnerName, // Optional: custom partner string
      newParticipantId, // Optional: replacement participant ObjectId
      targetPlayerSlot, // Optional: 'player1' or 'player2'
      matchNumber, // Optional fallback lookup
      category, // Optional fallback lookup
      targetTeamId, // Optional fallback lookup
      reason
    } = req.body;

    if (!slot || (slot !== 'team1' && slot !== 'team2')) {
      return res.status(400).json({ success: false, message: 'Slot must be "team1" or "team2".' });
    }

    let match = null;
    if (mongoose.Types.ObjectId.isValid(id)) {
      match = await Match.findById(id);
    }

    // Fallback 1: Locate by matchNumber + category in active tournament if match._id was stale
    if (!match && matchNumber && category) {
      const activeTourn = await Tournament.findOne().sort({ createdAt: -1 });
      if (activeTourn) {
        match = await Match.findOne({
          tournamentId: activeTourn._id,
          category,
          matchNumber: Number(matchNumber)
        });
      }
    }

    // Fallback 2: Locate by targetTeamId in active tournament
    if (!match && targetTeamId && mongoose.Types.ObjectId.isValid(targetTeamId)) {
      const activeTourn = await Tournament.findOne().sort({ createdAt: -1 });
      if (activeTourn) {
        match = await Match.findOne({
          tournamentId: activeTourn._id,
          $or: [{ team1: targetTeamId }, { team2: targetTeamId }]
        }).sort({ roundNumber: -1 });
      }
    }

    // Fallback 3: If match still not found (e.g. deleted/re-drawn) but targetTeamId exists, update the Team directly
    if (!match && targetTeamId && mongoose.Types.ObjectId.isValid(targetTeamId)) {
      const team = await Team.findById(targetTeamId).populate('player1').populate('player2');
      if (team) {
        const oldTeamName = team.name;
        if (newParticipantId) {
          const replacement = await Participant.findById(newParticipantId);
          if (!replacement) {
            return res.status(404).json({ success: false, message: 'Replacement participant not found.' });
          }
          const isSingles = team.category.includes('singles');
          if (isSingles || targetPlayerSlot === 'player1') {
            team.player1 = replacement._id;
          } else {
            team.player2 = replacement._id;
          }
        }
        if (newPartnerName !== undefined) {
          team.rawPartnerName = (newPartnerName || '').trim();
        }
        if (newName && newName.trim()) {
          team.name = newName.trim();
        } else {
          await team.populate('player1');
          await team.populate('player2');
          if (team.player1 && team.player2) {
            team.name = `${team.player1.fullName} & ${team.player2.fullName}`;
          } else if (team.player1 && team.rawPartnerName) {
            team.name = `${team.player1.fullName} & ${team.rawPartnerName}`;
          } else if (team.player1) {
            team.name = team.player1.fullName;
          }
        }
        await team.save();
        return res.json({
          success: true,
          message: `Team updated successfully! Active name: "${team.name}"`,
          team,
          match: null
        });
      }
    }

    if (!match) {
      return res.status(404).json({ success: false, message: 'Match not found.' });
    }

    let affectedTeamName = '';

    // Option 1: Reassign slot to a completely different approved Team
    if (teamId) {
      const targetTeam = await Team.findById(teamId);
      if (!targetTeam) {
        return res.status(404).json({ success: false, message: 'Replacement team not found.' });
      }

      const oldTeamId = match[slot];
      match[slot] = targetTeam._id;

      // If match was completed and winner was old team, update winner reference
      if (match.status === 'completed' && match.winnerTeam && oldTeamId && match.winnerTeam.toString() === oldTeamId.toString()) {
        match.winnerTeam = targetTeam._id;
        if (match.nextMatchId && match.nextMatchSlot) {
          await Match.findByIdAndUpdate(match.nextMatchId, { [match.nextMatchSlot]: targetTeam._id });
        }
      }

      await match.save();
      affectedTeamName = targetTeam.name;

      if (req.user) {
        await AuditLog.create({
          action: 'SUBSTITUTE_MATCH_TEAM',
          performedBy: req.user._id,
          performedByName: req.user.fullName || 'Admin',
          entityType: 'Match',
          entityId: match._id.toString(),
          details: { matchNumber: match.matchNumber, slot, newTeam: targetTeam.name },
          reason: reason || `Admin reassigned Match #${match.matchNumber} ${slot} to team ${targetTeam.name}`
        });
      }
    } else {
      // Option 2: Update the partner/player/name on the existing Team document
      const currentTeamId = match[slot];
      if (!currentTeamId) {
        return res.status(400).json({ success: false, message: `No team is currently assigned to ${slot} in this match.` });
      }

      const team = await Team.findById(currentTeamId).populate('player1').populate('player2');
      if (!team) {
        return res.status(404).json({ success: false, message: 'Team record not found.' });
      }

      const oldTeamName = team.name;

      // If replacing with another registered participant
      if (newParticipantId) {
        const replacement = await Participant.findById(newParticipantId);
        if (!replacement) {
          return res.status(404).json({ success: false, message: 'Replacement participant not found.' });
        }

        const isSingles = team.category.includes('singles');
        if (isSingles || targetPlayerSlot === 'player1') {
          team.player1 = replacement._id;
        } else {
          // Doubles / Mixed doubles partner (player2)
          team.player2 = replacement._id;
        }
      }

      if (newPartnerName !== undefined) {
        team.rawPartnerName = (newPartnerName || '').trim();
      }

      // Final display name update
      if (newName && newName.trim()) {
        team.name = newName.trim();
      } else {
        await team.populate('player1');
        await team.populate('player2');
        if (team.player1 && team.player2) {
          team.name = `${team.player1.fullName} & ${team.player2.fullName}`;
        } else if (team.player1 && team.rawPartnerName) {
          team.name = `${team.player1.fullName} & ${team.rawPartnerName}`;
        } else if (team.player1) {
          team.name = team.player1.fullName;
        }
      }

      await team.save();
      affectedTeamName = team.name;

      if (req.user) {
        await AuditLog.create({
          action: 'SUBSTITUTE_MATCH_PARTNER',
          performedBy: req.user._id,
          performedByName: req.user.fullName || 'Admin',
          entityType: 'Match',
          entityId: match._id.toString(),
          details: {
            matchNumber: match.matchNumber,
            slot,
            oldName: oldTeamName,
            newName: team.name,
            rawPartnerName: team.rawPartnerName
          },
          reason: reason || `Admin substituted partner for Match #${match.matchNumber} (${slot}): "${oldTeamName}" -> "${team.name}"`
        });
      }
    }

    const populatedMatch = await Match.findById(match._id)
      .populate({
        path: 'team1',
        populate: [{ path: 'player1' }, { path: 'player2' }]
      })
      .populate({
        path: 'team2',
        populate: [{ path: 'player1' }, { path: 'player2' }]
      })
      .populate({
        path: 'winnerTeam',
        populate: [{ path: 'player1' }, { path: 'player2' }]
      });

    emitMatchUpdate(match._id, 'carrom:match_updated', populatedMatch);
    emitCarromLive('carrom:match_updated', populatedMatch);

    res.json({
      success: true,
      message: `Match #${match.matchNumber} updated successfully! Active name: "${affectedTeamName}"`,
      match: populatedMatch
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getMatches,
  createAdditionalMatch,
  getLiveMatches,
  getMatchById,
  startMatch,
  stopLiveMatch,
  updateMatchTimer,
  updateScore,
  confirmMatch,
  correctMatch,
  scheduleMatch,
  substituteMatchPartner
};

