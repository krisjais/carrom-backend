const { generateDynamicBracket, attachManualMatchesToActiveRound } = require('../services/drawEngine');
const Tournament = require('../models/Tournament');
const Match = require('../models/Match');
const CarromBoard = require('../models/CarromBoard');
const AuditLog = require('../models/AuditLog');
const { recalculateEstimatedTimes } = require('../services/scheduleEngine');

const ALLOWED_DRAW_CATEGORIES = ['boys_singles', 'girls_singles', 'boys_doubles', 'girls_doubles', 'mixed_doubles'];

// Generate dynamic knockout draw for a category
const generateCategoryDraw = async (req, res, next) => {
  try {
    const { category, tournamentId } = req.body;
    if (!category) {
      return res.status(400).json({ success: false, message: 'Category is required.' });
    }

    let tournId = tournamentId;
    if (!tournId) {
      const activeTourn = await Tournament.findOne().sort({ createdAt: -1 });
      if (!activeTourn) return res.status(400).json({ success: false, message: 'No active tournament found.' });
      tournId = activeTourn._id;
    }

    const result = await generateDynamicBracket(tournId, category, req.user._id);

    res.json({
      success: true,
      message: `Dynamic knockout draw generated successfully for ${category.replace('_', ' ').toUpperCase()}.`,
      result
    });
  } catch (error) {
    next(error);
  }
};

// Generate a bracket with the admin's chosen entries paired in its first match.
const generateManualCategoryDraw = async (req, res, next) => {
  try {
    const { category, team1Id, team2Id, tournamentId } = req.body || {};
    if (!ALLOWED_DRAW_CATEGORIES.includes(category)) {
      return res.status(400).json({ success: false, message: 'Select a valid tournament category.' });
    }
    if (!team1Id || !team2Id || String(team1Id) === String(team2Id)) {
      return res.status(400).json({ success: false, message: 'Select two different entries for the manual match.' });
    }

    let tournId = tournamentId;
    if (!tournId) {
      const activeTourn = await Tournament.findOne().sort({ createdAt: -1 });
      if (!activeTourn) return res.status(400).json({ success: false, message: 'No active tournament found.' });
      tournId = activeTourn._id;
    }

    const existingMatchCount = await Match.countDocuments({ tournamentId: tournId, category });
    if (existingMatchCount > 0) {
      return res.status(409).json({ success: false, message: 'A draw already exists. Use Add Late Match to add entries to its active round.' });
    }

    const result = await generateDynamicBracket(tournId, category, req.user._id, [team1Id, team2Id]);
    res.status(201).json({
      success: true,
      message: `Manual Match #1 created for ${category.replace('_', ' ').toUpperCase()}. Remaining approved entries were paired into the bracket, with any BYE assigned automatically.`,
      result
    });
  } catch (error) {
    next(error);
  }
};

// Get complete structured bracket tree for a category
const getBracketTree = async (req, res, next) => {
  try {
    const { category } = req.params;
    const { tournamentId } = req.query;

    let tournId = tournamentId;
    if (!tournId) {
      const activeTourn = await Tournament.findOne().sort({ createdAt: -1 });
      if (!activeTourn) return res.status(400).json({ success: false, message: 'No active tournament found.' });
      tournId = activeTourn._id;
    }

    const allMatches = await Match.find({ tournamentId: tournId, category })
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
      .sort({ roundNumber: 1, matchIndexInRound: 1 });

    const matches = allMatches;

    // Group by rounds
    const roundsMap = {};
    matches.forEach((m) => {
      if (!roundsMap[m.roundNumber]) {
        roundsMap[m.roundNumber] = {
          roundNumber: m.roundNumber,
          roundName: m.roundName,
          matches: []
        };
      }
      roundsMap[m.roundNumber].matches.push(m);
    });

    const rounds = Object.values(roundsMap).sort((a, b) => a.roundNumber - b.roundNumber);

    const tournament = await Tournament.findById(tournId);
    const isLocked = tournament && tournament.drawsLocked ? Boolean(tournament.drawsLocked[category]) : false;
    const isPublished = tournament && tournament.drawsPublished ? Boolean(tournament.drawsPublished[category]) : false;

    res.json({
      success: true,
      category,
      isLocked,
      isPublished,
      totalMatches: matches.length,
      totalRounds: rounds.length,
      rounds,
      rawMatches: matches
    });
  } catch (error) {
    next(error);
  }
};

// Admin: Move late fixtures created by the previous standalone flow into the current bracket round
const attachLateMatches = async (req, res, next) => {
  try {
    const { category } = req.params;
    const allowedCategories = ['boys_singles', 'girls_singles', 'boys_doubles', 'girls_doubles', 'mixed_doubles'];
    if (!allowedCategories.includes(category)) {
      return res.status(400).json({ success: false, message: 'Select a valid tournament category.' });
    }

    const tournament = await Tournament.findOne().sort({ createdAt: -1 });
    if (!tournament) {
      return res.status(404).json({ success: false, message: 'No active tournament found.' });
    }
    const result = await attachManualMatchesToActiveRound(tournament._id, category);
    if (result.migratedCount > 0) {
      await AuditLog.create({
        action: 'ATTACH_LATE_MATCHES_TO_BRACKET',
        performedBy: req.user._id,
        performedByName: req.user.fullName || 'Admin',
        entityType: 'CategoryDraw',
        entityId: category,
        details: { category, ...result },
        reason: `Moved ${result.migratedCount} late-entry match(es) into ${result.roundName}.`
      });
    }

    res.json({
      success: true,
      migratedCount: result.migratedCount,
      roundNumber: result.roundNumber,
      roundName: result.roundName
    });
  } catch (error) {
    next(error);
  }
};

// Admin: Clear one category's draw so it can be generated again
const deleteCategoryMatches = async (req, res, next) => {
  try {
    const { category } = req.params;
    if (!ALLOWED_DRAW_CATEGORIES.includes(category)) {
      return res.status(400).json({ success: false, message: 'Select a valid tournament category.' });
    }

    const tournament = await Tournament.findOne().sort({ createdAt: -1 });
    if (!tournament) {
      return res.status(404).json({ success: false, message: 'No active tournament found.' });
    }

    const categoryMatches = await Match.find({ tournamentId: tournament._id, category }).select('_id status');
    const liveMatchCount = categoryMatches.filter((match) => match.status === 'live').length;
    if (liveMatchCount > 0) {
      return res.status(409).json({
        success: false,
        message: 'Matches cannot be deleted while a match in this category is live. Finish or stop the live match first.'
      });
    }

    const matchIds = categoryMatches.map((match) => match._id);
    const deleteResult = await Match.deleteMany({ tournamentId: tournament._id, category });

    if (matchIds.length > 0) {
      await CarromBoard.updateMany(
        { tournamentId: tournament._id, currentMatchId: { $in: matchIds }, status: 'live' },
        { $set: { currentMatchId: null, status: 'available' } }
      );
      await CarromBoard.updateMany(
        { tournamentId: tournament._id, currentMatchId: { $in: matchIds }, status: { $ne: 'live' } },
        { $set: { currentMatchId: null } }
      );
    }

    if (!tournament.drawsLocked) tournament.drawsLocked = {};
    if (!tournament.drawsPublished) tournament.drawsPublished = {};
    tournament.drawsLocked[category] = false;
    tournament.drawsPublished[category] = false;
    tournament.markModified('drawsLocked');
    tournament.markModified('drawsPublished');
    await tournament.save();
    await recalculateEstimatedTimes(tournament._id);

    await AuditLog.create({
      action: 'DELETE_CATEGORY_MATCHES',
      performedBy: req.user._id,
      performedByName: req.user.fullName || 'Admin',
      entityType: 'CategoryDraw',
      entityId: category,
      details: { category, deletedCount: deleteResult.deletedCount },
      reason: `Deleted all matches and unlocked the ${category.replace('_', ' ')} draw for regeneration.`
    });

    res.json({
      success: true,
      deletedCount: deleteResult.deletedCount,
      message: `Deleted ${deleteResult.deletedCount} match(es). The draw is unlocked and ready to generate again.`
    });
  } catch (error) {
    next(error);
  }
};

// Admin: Publish and lock draw
const publishAndLockDraw = async (req, res, next) => {
  try {
    const { category, tournamentId } = req.body;
    if (!category) {
      return res.status(400).json({ success: false, message: 'Category is required.' });
    }

    let tournId = tournamentId;
    if (!tournId) {
      const activeTourn = await Tournament.findOne().sort({ createdAt: -1 });
      if (!activeTourn) return res.status(400).json({ success: false, message: 'No active tournament found.' });
      tournId = activeTourn._id;
    }

    const matchesCount = await Match.countDocuments({ tournamentId: tournId, category });
    if (matchesCount === 0) {
      return res.status(400).json({
        success: false,
        message: 'Cannot lock draw: No matches have been generated for this category yet.'
      });
    }

    const tournament = await Tournament.findById(tournId);
    if (!tournament.drawsLocked) tournament.drawsLocked = {};
    if (!tournament.drawsPublished) tournament.drawsPublished = {};

    tournament.drawsLocked[category] = true;
    tournament.drawsPublished[category] = true;
    tournament.markModified('drawsLocked');
    tournament.markModified('drawsPublished');
    await tournament.save();

    await AuditLog.create({
      action: 'PUBLISH_AND_LOCK_DRAW',
      performedBy: req.user._id,
      performedByName: req.user.fullName,
      entityType: 'CategoryDraw',
      entityId: category,
      details: { category },
      reason: `Admin published and locked the draw for ${category}`
    });

    res.json({
      success: true,
      message: `Draw for ${category.replace('_', ' ').toUpperCase()} has been published and locked.`,
      drawsLocked: tournament.drawsLocked,
      drawsPublished: tournament.drawsPublished
    });
  } catch (error) {
    next(error);
  }
};

// Admin: Advance completed round to next round (e.g. Round 1 -> Quarterfinals)
const advanceRound = async (req, res, next) => {
  try {
    const { category, roundNumber, tournamentId, autoConfirmLeaders } = req.body;
    if (!category) {
      return res.status(400).json({ success: false, message: 'Category is required.' });
    }

    let tournId = tournamentId;
    if (!tournId) {
      const activeTourn = await Tournament.findOne().sort({ createdAt: -1 });
      if (!activeTourn) return res.status(400).json({ success: false, message: 'No active tournament found.' });
      tournId = activeTourn._id;
    }

    const rNum = roundNumber ? parseInt(roundNumber, 10) : 1;

    // Find playable matches in this round
    const matches = await Match.find({
      tournamentId: tournId,
      category,
      roundNumber: rNum,
      isBye: false
    });

    if (matches.length === 0) {
      return res.status(400).json({ success: false, message: `No matches found in Round ${rNum}.` });
    }

    // Check incomplete matches
    const incomplete = matches.filter((m) => m.status !== 'completed' || !m.winnerTeam);

    if (incomplete.length > 0) {
      if (autoConfirmLeaders) {
        // Auto-confirm with current score leaders or team1 as fallback
        for (const m of incomplete) {
          const t1Won = m.finalScore?.team1BoardsWon || 0;
          const t2Won = m.finalScore?.team2BoardsWon || 0;
          let winnerId = m.team1;
          if (t2Won > t1Won) winnerId = m.team2;
          else if (t1Won > t2Won) winnerId = m.team1;

          m.winnerTeam = winnerId;
          m.status = 'completed';
          m.isResultConfirmed = true;
          m.actualEndTime = new Date();
          m.queuePosition = null;
          await m.save();
        }
      } else {
        const matchNames = incomplete.map((m) => `M#${m.matchNumber}`).join(', ');
        return res.status(400).json({
          success: false,
          message: `Cannot advance yet: ${incomplete.length} match(es) in Round ${rNum} (${matchNames}) are not confirmed completed. Confirm results in the Scorekeeper desk or enable auto-confirm.`,
          incompleteCount: incomplete.length,
          incompleteMatches: incomplete
        });
      }
    }

    // Progress to next round
    const { progressCategoryToNextRound } = require('../services/drawEngine');
    const advanced = await progressCategoryToNextRound(tournId, category, rNum);

    if (!advanced) {
      return res.status(400).json({
        success: false,
        message: `Could not advance Round ${rNum}. Please ensure all match winners are confirmed.`
      });
    }

    await AuditLog.create({
      action: 'ADVANCE_TOURNAMENT_ROUND',
      performedBy: req.user._id,
      performedByName: req.user.fullName,
      entityType: 'CategoryDraw',
      entityId: category,
      details: { category, advancedFromRound: rNum },
      reason: `Admin advanced ${category} from Round ${rNum} to next round`
    });

    res.json({
      success: true,
      message: `Round ${rNum} winners successfully advanced to Round ${rNum + 1}! Next-round matchups are now populated and ready in queue.`
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  generateCategoryDraw,
  generateManualCategoryDraw,
  getBracketTree,
  attachLateMatches,
  deleteCategoryMatches,
  publishAndLockDraw,
  advanceRound
};
