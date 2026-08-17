const Team = require('../models/Team');
const Participant = require('../models/Participant');
const Tournament = require('../models/Tournament');
const AuditLog = require('../models/AuditLog');

// Get teams with optional category filter
const getTeams = async (req, res, next) => {
  try {
    const { category, tournamentId } = req.query;
    let query = {};
    if (category) query.category = category;

    let tournId = tournamentId;
    if (!tournId) {
      const activeTourn = await Tournament.findOne().sort({ createdAt: -1 });
      if (activeTourn) tournId = activeTourn._id;
    }
    if (tournId) query.tournamentId = tournId;

    const teams = await Team.find(query)
      .populate('player1')
      .populate('player2')
      .sort({ category: 1, name: 1 });

    res.json({ success: true, count: teams.length, teams });
  } catch (error) {
    next(error);
  }
};

// Admin: Create and approve a doubles/mixed doubles team
const createDoublesPair = async (req, res, next) => {
  try {
    const { player1Id, player2Id, category, teamName, tournamentId } = req.body;

    if (!player1Id || !player2Id || !category) {
      return res.status(400).json({ success: false, message: 'Player 1, Player 2 and Category are required.' });
    }

    if (player1Id === player2Id) {
      return res.status(400).json({ success: false, message: 'Player 1 and Player 2 must be different participants.' });
    }

    let tournId = tournamentId;
    if (!tournId) {
      const activeTourn = await Tournament.findOne().sort({ createdAt: -1 });
      if (!activeTourn) return res.status(400).json({ success: false, message: 'No active tournament found.' });
      tournId = activeTourn._id;
    }

    const [player1, player2] = await Promise.all([
      Participant.findById(player1Id),
      Participant.findById(player2Id)
    ]);

    if (!player1 || !player2) {
      return res.status(404).json({ success: false, message: 'One or both participants not found.' });
    }

    // Gender validation for category
    if (category === 'boys_doubles') {
      if (player1.gender !== 'male' || player2.gender !== 'male') {
        return res.status(400).json({ success: false, message: 'Both players in Boys Doubles must be male.' });
      }
    } else if (category === 'girls_doubles') {
      if (player1.gender !== 'female' || player2.gender !== 'female') {
        return res.status(400).json({ success: false, message: 'Both players in Girls Doubles must be female.' });
      }
    } else if (category === 'mixed_doubles') {
      const hasMale = player1.gender === 'male' || player2.gender === 'male';
      const hasFemale = player1.gender === 'female' || player2.gender === 'female';
      if (!hasMale || !hasFemale) {
        return res.status(400).json({ success: false, message: 'Mixed Doubles team must have one male and one female player.' });
      }
    }

    // Guard: Check if player1 or player2 already belongs to an approved team in this category
    const existingTeamForP1 = await Team.findOne({
      tournamentId: tournId,
      category,
      $or: [{ player1: player1._id }, { player2: player1._id }]
    });

    if (existingTeamForP1) {
      return res.status(400).json({
        success: false,
        message: `${player1.fullName} is already registered in another team in ${category.replace('_', ' ').toUpperCase()}.`
      });
    }

    const existingTeamForP2 = await Team.findOne({
      tournamentId: tournId,
      category,
      $or: [{ player1: player2._id }, { player2: player2._id }]
    });

    if (existingTeamForP2) {
      return res.status(400).json({
        success: false,
        message: `${player2.fullName} is already registered in another team in ${category.replace('_', ' ').toUpperCase()}.`
      });
    }

    const generatedName = teamName ? teamName.trim() : `${player1.fullName} & ${player2.fullName}`;

    const team = await Team.create({
      name: generatedName,
      tournamentId: tournId,
      category,
      player1: player1._id,
      player2: player2._id,
      isApproved: true
    });

    await AuditLog.create({
      action: 'CREATE_DOUBLES_TEAM',
      performedBy: req.user._id,
      performedByName: req.user.fullName,
      entityType: 'Team',
      entityId: team._id.toString(),
      details: { teamName: team.name, category, p1: player1.fullName, p2: player2.fullName },
      reason: `Admin created and approved doubles team in ${category}`
    });

    const populatedTeam = await Team.findById(team._id).populate('player1').populate('player2');

    res.status(201).json({
      success: true,
      message: 'Doubles team created and approved successfully.',
      team: populatedTeam
    });
  } catch (error) {
    next(error);
  }
};

// Admin: Delete a team
const deleteTeam = async (req, res, next) => {
  try {
    const { id } = req.params;
    const team = await Team.findById(id);
    if (!team) {
      return res.status(404).json({ success: false, message: 'Team not found.' });
    }

    // Check if draw is locked
    const tournament = await Tournament.findById(team.tournamentId);
    if (tournament && tournament.drawsLocked && tournament.drawsLocked[team.category]) {
      return res.status(400).json({ success: false, message: 'Cannot delete team after draw has been locked.' });
    }

    await Team.findByIdAndDelete(id);

    res.json({ success: true, message: 'Team removed successfully.' });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getTeams,
  createDoublesPair,
  deleteTeam
};
