const Tournament = require('../models/Tournament');
const Participant = require('../models/Participant');
const Registration = require('../models/Registration');
const Team = require('../models/Team');
const Match = require('../models/Match');
const AuditLog = require('../models/AuditLog');

// High level tournament stats overview
const getOverviewStats = async (req, res, next) => {
  try {
    const tournament = await Tournament.findOne().sort({ createdAt: -1 });
    if (!tournament) {
      return res.json({ success: true, stats: null });
    }

    const [
      totalParticipants,
      maleParticipants,
      femaleParticipants,
      totalRegistrations,
      pendingRegistrations,
      approvedRegistrations,
      totalTeams,
      totalMatches,
      completedMatches,
      liveMatches,
      readyMatches,
      waitingMatches
    ] = await Promise.all([
      Participant.countDocuments(),
      Participant.countDocuments({ gender: 'male' }),
      Participant.countDocuments({ gender: 'female' }),
      Registration.countDocuments({ tournamentId: tournament._id }),
      Registration.countDocuments({ tournamentId: tournament._id, status: 'pending' }),
      Registration.countDocuments({ tournamentId: tournament._id, status: 'approved' }),
      Team.countDocuments({ tournamentId: tournament._id, isApproved: true }),
      Match.countDocuments({ tournamentId: tournament._id }),
      Match.countDocuments({ tournamentId: tournament._id, status: 'completed' }),
      Match.countDocuments({ tournamentId: tournament._id, status: 'live' }),
      Match.countDocuments({ tournamentId: tournament._id, status: 'scheduled', isBye: false }),
      Match.countDocuments({ tournamentId: tournament._id, status: 'pending', isBye: false })
    ]);

    // Categories breakdown
    const categories = ['boys_singles', 'girls_singles', 'boys_doubles', 'girls_doubles', 'mixed_doubles'];
    const categoriesData = {};

    for (const cat of categories) {
      const [catTeams, catMatches, catDone, catLive] = await Promise.all([
        Team.countDocuments({ tournamentId: tournament._id, category: cat, isApproved: true }),
        Match.countDocuments({ tournamentId: tournament._id, category: cat }),
        Match.countDocuments({ tournamentId: tournament._id, category: cat, status: 'completed' }),
        Match.countDocuments({ tournamentId: tournament._id, category: cat, status: 'live' })
      ]);

      categoriesData[cat] = {
        teams: catTeams,
        matches: catMatches,
        completed: catDone,
        live: catLive,
        isDrawPublished: tournament.drawsPublished ? Boolean(tournament.drawsPublished[cat]) : false,
        isDrawLocked: tournament.drawsLocked ? Boolean(tournament.drawsLocked[cat]) : false
      };
    }

    // Category champions (winners of Finals match in completed status)
    const champions = {};
    for (const cat of categories) {
      const finalsMatch = await Match.findOne({
        tournamentId: tournament._id,
        category: cat,
        roundName: 'Finals',
        status: 'completed'
      }).populate({
        path: 'winnerTeam',
        populate: [{ path: 'player1' }, { path: 'player2' }]
      });

      if (finalsMatch && finalsMatch.winnerTeam) {
        champions[cat] = {
          team: finalsMatch.winnerTeam,
          match: finalsMatch
        };
      }
    }

    res.json({
      success: true,
      stats: {
        tournament,
        totalParticipants,
        maleParticipants,
        femaleParticipants,
        totalRegistrations,
        pendingRegistrations,
        approvedRegistrations,
        totalTeams,
        totalMatches,
        completedMatches,
        liveMatches,
        readyMatches,
        waitingMatches,
        isBoardOccupied: liveMatches > 0,
        categories: categoriesData,
        champions
      }
    });
  } catch (error) {
    next(error);
  }
};

// Admin: Get Audit Logs
const getAuditLogs = async (req, res, next) => {
  try {
    const logs = await AuditLog.find().sort({ createdAt: -1 }).limit(100);
    res.json({ success: true, count: logs.length, logs });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getOverviewStats,
  getAuditLogs
};
