const Team = require('../models/Team');
const Participant = require('../models/Participant');
const Tournament = require('../models/Tournament');
const Registration = require('../models/Registration');
const AuditLog = require('../models/AuditLog');
const { emitCarromLive } = require('../socket');

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
      .sort({ category: 1, name: 1 })
      .lean();

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

    if (!player1.isApproved || !player2.isApproved) {
      return res.status(400).json({
        success: false,
        message: 'Both participants must have approved registration status before forming a tournament doubles team.'
      });
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

    // Ensure both participants' registrations reflect enrollment & linked partner in this category
    const isMixed = category === 'mixed_doubles';
    if (isMixed) {
      await Promise.all([
        Registration.updateOne(
          { participantId: player1._id, tournamentId: tournId },
          { $set: { participateMixedDoubles: true, mixedDoublesPartnerId: player2._id, mixedDoublesPartnerName: player2.fullName } }
        ),
        Registration.updateOne(
          { participantId: player2._id, tournamentId: tournId },
          { $set: { participateMixedDoubles: true, mixedDoublesPartnerId: player1._id, mixedDoublesPartnerName: player1.fullName } }
        )
      ]);
    } else {
      await Promise.all([
        Registration.updateOne(
          { participantId: player1._id, tournamentId: tournId },
          { $set: { participateDoubles: true, doublesPartnerId: player2._id, doublesPartnerName: player2.fullName } }
        ),
        Registration.updateOne(
          { participantId: player2._id, tournamentId: tournId },
          { $set: { participateDoubles: true, doublesPartnerId: player1._id, doublesPartnerName: player1.fullName } }
        )
      ]);
    }

    await AuditLog.create({
      action: 'CREATE_DOUBLES_TEAM',
      performedBy: req.user._id,
      performedByName: req.user.fullName,
      entityType: 'Team',
      entityId: team._id.toString(),
      details: { teamName: team.name, category, p1: player1.fullName, p2: player2.fullName },
      reason: `Admin created and approved doubles team in ${category}`
    });

    const populatedTeam = await Team.findById(team._id).populate('player1').populate('player2').lean();
    emitCarromLive('carrom:roster_updated', { category, action: 'create_pair', teamId: team._id });

    res.status(201).json({
      success: true,
      message: 'Doubles team created and approved successfully.',
      team: populatedTeam
    });
  } catch (error) {
    next(error);
  }
};

const Match = require('../models/Match');

// Admin: Delete a team
const deleteTeam = async (req, res, next) => {
  try {
    const { id } = req.params;
    const team = await Team.findById(id);
    if (!team) {
      return res.status(404).json({ success: false, message: 'Team not found.' });
    }

    const tournament = await Tournament.findById(team.tournamentId);
    if (tournament) {
      // If draw was locked/generated, unlock and remove uncompleted matches for this category
      if (tournament.drawsLocked && tournament.drawsLocked[team.category]) {
        tournament.drawsLocked[team.category] = false;
        if (tournament.drawsPublished) tournament.drawsPublished[team.category] = false;
        tournament.markModified('drawsLocked');
        tournament.markModified('drawsPublished');
        await tournament.save();
      }
      // Remove matches for this category so bracket can be cleanly re-generated
      await Match.deleteMany({ tournamentId: tournament._id, category: team.category });
    }

    await Team.findByIdAndDelete(id);

    if (req.user) {
      await AuditLog.create({
        action: 'DELETE_TEAM',
        performedBy: req.user._id,
        performedByName: req.user.fullName,
        entityType: 'Team',
        entityId: id,
        details: { teamName: team.name, category: team.category },
        reason: `Admin deleted team ${team.name}`
      });
    }

    emitCarromLive('carrom:roster_updated', { category: team.category, action: 'delete_team', teamId: id });
    res.json({ success: true, message: `Team "${team.name}" removed successfully.` });
  } catch (error) {
    next(error);
  }
};

// Admin: Delete all teams (optionally by category or across all categories)
const deleteAllTeams = async (req, res, next) => {
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

    const tournament = await Tournament.findById(tournId);
    if (tournament) {
      if (category) {
        if (!tournament.drawsLocked) tournament.drawsLocked = {};
        if (!tournament.drawsPublished) tournament.drawsPublished = {};
        tournament.drawsLocked[category] = false;
        tournament.drawsPublished[category] = false;
        tournament.markModified('drawsLocked');
        tournament.markModified('drawsPublished');
        await tournament.save();

        // Clean up matches for this category
        await Match.deleteMany({ tournamentId: tournId, category });
      } else {
        const categories = ['boys_singles', 'girls_singles', 'boys_doubles', 'girls_doubles', 'mixed_doubles'];
        if (!tournament.drawsLocked) tournament.drawsLocked = {};
        if (!tournament.drawsPublished) tournament.drawsPublished = {};
        categories.forEach((c) => {
          tournament.drawsLocked[c] = false;
          tournament.drawsPublished[c] = false;
        });
        tournament.markModified('drawsLocked');
        tournament.markModified('drawsPublished');
        await tournament.save();

        // Clean up all matches across tournament
        await Match.deleteMany({ tournamentId: tournId });
      }
    }

    const deleteResult = await Team.deleteMany(query);

    if (req.user) {
      await AuditLog.create({
        action: 'DELETE_ALL_TEAMS',
        performedBy: req.user._id,
        performedByName: req.user.fullName,
        entityType: 'Team',
        entityId: tournId ? tournId.toString() : 'ALL',
        details: { category: category || 'all', deletedCount: deleteResult.deletedCount },
        reason: `Admin deleted all teams in ${category || 'all categories'}`
      });
    }

    res.json({
      success: true,
      message: `Successfully deleted ${deleteResult.deletedCount} teams/players.`,
      deletedCount: deleteResult.deletedCount
    });
  } catch (error) {
    next(error);
  }
};

// Admin: Auto-populate teams from approved registrations
const autoPopulateTeams = async (req, res, next) => {
  try {
    const { category, tournamentId } = req.body;
    let tournId = tournamentId;
    if (!tournId) {
      const activeTourn = await Tournament.findOne().sort({ createdAt: -1 });
      if (!activeTourn) return res.status(400).json({ success: false, message: 'No active tournament found.' });
      tournId = activeTourn._id;
    }

    const { syncAndAutoPairTournamentEntries } = require('../services/partnerValidationEngine');
    const result = await syncAndAutoPairTournamentEntries(tournId, category);

    const createdCount = result.createdCount || 0;

    if (req.user) {
      await AuditLog.create({
        action: 'AUTO_POPULATE_TEAMS',
        performedBy: req.user._id,
        performedByName: req.user.fullName,
        entityType: 'Team',
        entityId: tournId.toString(),
        details: { category: category || 'all', createdCount },
        reason: `Admin synced roster from approved registrations`
      });
    }

    emitCarromLive('carrom:roster_updated', { category: category || 'all', action: 'auto_populate', createdCount });
    res.json({
      success: true,
      message: `Roster synced successfully! Added ${createdCount} new team entries from approved registrations.`,
      createdCount
    });
  } catch (error) {
    next(error);
  }
};

// Admin: Update a team's players (strictly linked to existing registered participants)
const updateTeam = async (req, res, next) => {
  try {
    const { id } = req.params;
    const {
      name,
      player1Id,
      player2Id,
      replacePlayerId,
      newParticipantId,
      reason
    } = req.body;

    const team = await Team.findById(id).populate('player1').populate('player2');
    if (!team) {
      return res.status(404).json({ success: false, message: 'Team not found.' });
    }

    const oldName = team.name;
    const isDoublesCategory = ['boys_doubles', 'girls_doubles', 'mixed_doubles'].includes(team.category);

    let nextPlayer1Id = team.player1?._id?.toString() || team.player1?.toString() || null;
    let nextPlayer2Id = team.player2?._id?.toString() || team.player2?.toString() || null;

    if (replacePlayerId && newParticipantId) {
      if (nextPlayer1Id === replacePlayerId.toString()) {
        nextPlayer1Id = newParticipantId.toString();
      } else if (nextPlayer2Id === replacePlayerId.toString()) {
        nextPlayer2Id = newParticipantId.toString();
      } else {
        nextPlayer2Id = newParticipantId.toString();
      }
    } else if (newParticipantId && !player1Id && player2Id === undefined) {
      if (isDoublesCategory) {
        nextPlayer2Id = newParticipantId.toString();
      } else {
        nextPlayer1Id = newParticipantId.toString();
      }
    }

    if (player1Id) nextPlayer1Id = player1Id.toString();
    if (player2Id !== undefined) nextPlayer2Id = player2Id ? player2Id.toString() : null;

    if (!nextPlayer1Id) {
      return res.status(400).json({ success: false, message: 'Primary player is required.' });
    }
    if (isDoublesCategory && !nextPlayer2Id) {
      return res.status(400).json({ success: false, message: 'Both players are required for a doubles team.' });
    }
    if (isDoublesCategory && nextPlayer1Id === nextPlayer2Id) {
      return res.status(400).json({ success: false, message: 'A participant cannot be paired with themselves.' });
    }

    const [p1, p2] = await Promise.all([
      Participant.findById(nextPlayer1Id),
      nextPlayer2Id ? Participant.findById(nextPlayer2Id) : Promise.resolve(null)
    ]);

    if (!p1 || (isDoublesCategory && !p2)) {
      return res.status(404).json({ success: false, message: 'Selected participant record was not found.' });
    }

    // Enforce category gender rules
    if (team.category === 'boys_singles' && p1.gender !== 'male') {
      return res.status(400).json({ success: false, message: 'Boys Singles requires a male participant.' });
    }
    if (team.category === 'girls_singles' && p1.gender !== 'female') {
      return res.status(400).json({ success: false, message: 'Girls Singles requires a female participant.' });
    }
    if (team.category === 'boys_doubles' && (p1.gender !== 'male' || p2.gender !== 'male')) {
      return res.status(400).json({ success: false, message: 'Both players in Boys Doubles must be male.' });
    }
    if (team.category === 'girls_doubles' && (p1.gender !== 'female' || p2.gender !== 'female')) {
      return res.status(400).json({ success: false, message: 'Both players in Girls Doubles must be female.' });
    }
    if (team.category === 'mixed_doubles') {
      const hasMale = p1.gender === 'male' || p2.gender === 'male';
      const hasFemale = p1.gender === 'female' || p2.gender === 'female';
      if (!hasMale || !hasFemale) {
        return res.status(400).json({ success: false, message: 'Mixed Doubles requires exactly one male and one female participant.' });
      }
    }

    // Prevent duplicate team assignment in the same category
    const playerIdsToCheck = [p1._id, p2?._id].filter(Boolean);
    const conflictTeam = await Team.findOne({
      _id: { $ne: team._id },
      tournamentId: team.tournamentId,
      category: team.category,
      $or: [
        { player1: { $in: playerIdsToCheck } },
        { player2: { $in: playerIdsToCheck } }
      ]
    }).lean();

    if (conflictTeam) {
      return res.status(400).json({
        success: false,
        message: `Duplicate assignment prevented: A selected participant is already assigned to team "${conflictTeam.name}" in ${team.category.replace('_', ' ').toUpperCase()}.`
      });
    }

    team.player1 = p1._id;
    team.player2 = p2 ? p2._id : null;
    team.rawPartnerName = '';
    team.name = name && name.trim()
      ? name.trim()
      : p2
      ? `${p1.fullName} & ${p2.fullName}`
      : p1.fullName;

    await team.save();

    // Keep linked Registration records in sync with the updated team pairing
    if (isDoublesCategory && p2) {
      if (team.category === 'mixed_doubles') {
        await Promise.all([
          Registration.updateOne(
            { participantId: p1._id, tournamentId: team.tournamentId },
            { $set: { participateMixedDoubles: true, mixedDoublesPartnerId: p2._id, mixedDoublesPartnerName: p2.fullName } }
          ),
          Registration.updateOne(
            { participantId: p2._id, tournamentId: team.tournamentId },
            { $set: { participateMixedDoubles: true, mixedDoublesPartnerId: p1._id, mixedDoublesPartnerName: p1.fullName } }
          )
        ]);
      } else {
        await Promise.all([
          Registration.updateOne(
            { participantId: p1._id, tournamentId: team.tournamentId },
            { $set: { participateDoubles: true, doublesPartnerId: p2._id, doublesPartnerName: p2.fullName } }
          ),
          Registration.updateOne(
            { participantId: p2._id, tournamentId: team.tournamentId },
            { $set: { participateDoubles: true, doublesPartnerId: p1._id, doublesPartnerName: p1.fullName } }
          )
        ]);
      }
    }

    if (req.user) {
      await AuditLog.create({
        action: 'UPDATE_TEAM',
        performedBy: req.user._id,
        performedByName: req.user.fullName,
        entityType: 'Team',
        entityId: team._id.toString(),
        details: {
          category: team.category,
          oldName,
          newName: team.name
        },
        reason: reason || `Admin updated team/partner: "${oldName}" -> "${team.name}"`
      });
    }

    const updatedTeam = await Team.findById(team._id).populate('player1').populate('player2').lean();
    emitCarromLive('carrom:roster_updated', { category: team.category, action: 'update_team', teamId: team._id });

    res.json({
      success: true,
      message: `Team updated successfully to "${updatedTeam.name}".`,
      team: updatedTeam
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getTeams,
  createDoublesPair,
  updateTeam,
  deleteTeam,
  deleteAllTeams,
  autoPopulateTeams
};
