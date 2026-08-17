const { generateDynamicBracket } = require('../services/drawEngine');
const Tournament = require('../models/Tournament');
const Match = require('../models/Match');
const AuditLog = require('../models/AuditLog');

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

    const matches = await Match.find({ tournamentId: tournId, category })
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

module.exports = {
  generateCategoryDraw,
  getBracketTree,
  publishAndLockDraw
};
