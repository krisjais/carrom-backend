const Match = require('../models/Match');
const Tournament = require('../models/Tournament');
const AuditLog = require('../models/AuditLog');
const {
  updateMatchLiveScore,
  confirmMatchWinner,
  correctMatchResult
} = require('../services/scoringEngine');
const {
  canStartMatch,
  recalculateEstimatedTimes
} = require('../services/scheduleEngine');

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

// Get Live Match, Next Match, Ready Queue, and Arena State
const getLiveMatches = async (req, res, next) => {
  try {
    let tournId = req.query.tournamentId;
    if (!tournId) {
      const activeTourn = await Tournament.findOne().sort({ createdAt: -1 });
      if (activeTourn) tournId = activeTourn._id;
    }

    // At most 1 LIVE match on Main Carrom Board
    const currentMatch = await Match.findOne({
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

    // READY Queue: Playable matches with known teams waiting for Main Carrom Board
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

    // Next match in line for Main Carrom Board
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
      currentMatch,
      nextMatch,
      nextMatchReadiness,
      readyQueue,
      waitingMatchesCount,
      completedMatches: recentlyCompleted,
      isBoardOccupied: Boolean(currentMatch),
      // Legacy aliases for backward-compatible views
      liveMatches: currentMatch ? [currentMatch] : [],
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

    let readiness = null;
    if (match.status === 'scheduled') {
      readiness = await canStartMatch(match._id);
    }

    res.json({ success: true, match, readiness });
  } catch (error) {
    next(error);
  }
};

// Admin: Start Match on Main Carrom Board (Enforces single live match constraint & player rest)
const startMatch = async (req, res, next) => {
  try {
    const { id } = req.params;
    const readiness = await canStartMatch(id);

    if (!readiness.canStart) {
      return res.status(400).json({
        success: false,
        message: readiness.reason,
        readiness
      });
    }

    const match = readiness.match;
    match.status = 'live';
    match.actualStartTime = new Date();
    match.boardName = 'Main Carrom Board';
    match.carromBoardNumber = 1;
    await match.save();

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
        actualStartTime: match.actualStartTime
      },
      reason: `Started Match #${match.matchNumber} as LIVE on Main Carrom Board.`
    });

    res.json({
      success: true,
      message: `Match #${match.matchNumber} is now LIVE on Main Carrom Board.`,
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
    res.json({
      success: true,
      message: 'Match winner confirmed and advanced to bracket.',
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
    res.json({
      success: true,
      message: 'Match result corrected successfully.',
      match: correctedMatch
    });
  } catch (error) {
    next(error);
  }
};

// Admin: Adjust match estimated schedule time
const scheduleMatch = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { scheduledTime } = req.body;

    const match = await Match.findById(id);
    if (!match) {
      return res.status(404).json({ success: false, message: 'Match not found.' });
    }

    if (scheduledTime !== undefined) match.scheduledTime = scheduledTime ? new Date(scheduledTime) : null;
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
    match.boards = [
      { boardNumber: 1, team1Score: 0, team2Score: 0, queenPocketedBy: 'none', queenCovered: false, team1Fouls: 0, team2Fouls: 0, boardWinner: null },
      { boardNumber: 2, team1Score: 0, team2Score: 0, queenPocketedBy: 'none', queenCovered: false, team1Fouls: 0, team2Fouls: 0, boardWinner: null },
      { boardNumber: 3, team1Score: 0, team2Score: 0, queenPocketedBy: 'none', queenCovered: false, team1Fouls: 0, team2Fouls: 0, boardWinner: null }
    ];
    match.finalScore = { team1BoardsWon: 0, team2BoardsWon: 0 };
    match.winnerTeam = null;

    await match.save();

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

    res.json({
      success: true,
      message: `Match #${match.matchNumber} has been stopped from LIVE and returned to the scheduled queue.`,
      match
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getMatches,
  getLiveMatches,
  getMatchById,
  startMatch,
  stopLiveMatch,
  updateScore,
  confirmMatch,
  correctMatch,
  scheduleMatch
};

