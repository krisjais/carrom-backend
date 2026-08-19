const Team = require('../models/Team');
const Participant = require('../models/Participant');
const Tournament = require('../models/Tournament');
const Registration = require('../models/Registration');
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

    const approvedRegistrations = await Registration.find({
      tournamentId: tournId,
      status: 'approved'
    }).populate('participantId');

    let createdCount = 0;

    for (const reg of approvedRegistrations) {
      const p = reg.participantId;
      if (!p) continue;

      const singlesCat = p.gender === 'male' ? 'boys_singles' : 'girls_singles';

      if (!category || category === singlesCat) {
        const existingSingles = await Team.findOne({
          tournamentId: tournId,
          category: singlesCat,
          player1: p._id
        });

        if (!existingSingles) {
          await Team.create({
            name: p.fullName,
            tournamentId: tournId,
            category: singlesCat,
            player1: p._id,
            player2: null,
            isApproved: true
          });
          createdCount++;
        }
      }
    }

    // If doubles or mixed requested or all categories
    if (!category || category.includes('doubles')) {
      const { enrichRegistrationsWithValidation } = require('../services/partnerValidationEngine');
      const enriched = await enrichRegistrationsWithValidation(approvedRegistrations, tournId);

      for (const reg of enriched) {
        const p1 = reg.participantId;
        if (!p1) continue;

        // Doubles
        if ((!category || category === 'boys_doubles' || category === 'girls_doubles') && reg.doublesValidation?.isMatched) {
          const p2 = reg.doublesValidation.matchedParticipant;
          const doublesCat = p1.gender === 'male' ? 'boys_doubles' : 'girls_doubles';
          if (!category || category === doublesCat) {
            const existingTeam = await Team.findOne({
              tournamentId: tournId,
              category: doublesCat,
              $or: [{ player1: p1._id }, { player2: p1._id }, { player1: p2._id }, { player2: p2._id }]
            });

            if (!existingTeam) {
              await Team.create({
                name: `${p1.fullName} & ${p2.fullName}`,
                tournamentId: tournId,
                category: doublesCat,
                player1: p1._id,
                player2: p2._id,
                isApproved: true
              });
              createdCount++;
            }
          }
        }

        // Mixed Doubles
        if ((!category || category === 'mixed_doubles') && reg.mixedValidation?.isMatched) {
          const p2 = reg.mixedValidation.matchedParticipant;
          const existingMixed = await Team.findOne({
            tournamentId: tournId,
            category: 'mixed_doubles',
            $or: [{ player1: p1._id }, { player2: p1._id }, { player1: p2._id }, { player2: p2._id }]
          });

          if (!existingMixed) {
            await Team.create({
              name: `${p1.fullName} & ${p2.fullName}`,
              tournamentId: tournId,
              category: 'mixed_doubles',
              player1: p1._id,
              player2: p2._id,
              isApproved: true
            });
            createdCount++;
          }
        }
      }
    }

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

    res.json({
      success: true,
      message: `Roster synced successfully! Added ${createdCount} new team entries from approved registrations.`,
      createdCount
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getTeams,
  createDoublesPair,
  deleteTeam,
  deleteAllTeams,
  autoPopulateTeams
};
