const Tournament = require('../models/Tournament');
const Participant = require('../models/Participant');
const Registration = require('../models/Registration');
const Team = require('../models/Team');
const Match = require('../models/Match');
const AuditLog = require('../models/AuditLog');

// High level tournament stats overview
const getOverviewStats = async (req, res, next) => {
  try {
    const tournament = await Tournament.findOne().sort({ createdAt: -1 }).lean();
    if (!tournament) {
      return res.json({ success: true, stats: null });
    }

    const categories = ['boys_singles', 'girls_singles', 'boys_doubles', 'girls_doubles', 'mixed_doubles'];

    const [
      participantGenderAgg,
      regStatusAgg,
      teamCategoryAgg,
      matchStatsAgg,
      finalsMatches
    ] = await Promise.all([
      Participant.aggregate([
        { $group: { _id: '$gender', count: { $sum: 1 } } }
      ]),
      Registration.aggregate([
        { $match: { tournamentId: tournament._id } },
        { $group: { _id: '$status', count: { $sum: 1 } } }
      ]),
      Team.aggregate([
        { $match: { tournamentId: tournament._id, isApproved: true } },
        { $group: { _id: '$category', count: { $sum: 1 } } }
      ]),
      Match.aggregate([
        { $match: { tournamentId: tournament._id } },
        {
          $group: {
            _id: '$category',
            total: { $sum: 1 },
            completed: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] } },
            live: { $sum: { $cond: [{ $eq: ['$status', 'live'] }, 1, 0] } },
            ready: { $sum: { $cond: [{ $and: [{ $eq: ['$status', 'scheduled'] }, { $eq: ['$isBye', false] }] }, 1, 0] } },
            waiting: { $sum: { $cond: [{ $and: [{ $eq: ['$status', 'pending'] }, { $eq: ['$isBye', false] }] }, 1, 0] } }
          }
        }
      ]),
      Match.find({
        tournamentId: tournament._id,
        roundName: 'Finals',
        status: 'completed',
        winnerTeam: { $ne: null }
      })
        .populate({
          path: 'winnerTeam',
          populate: [{ path: 'player1' }, { path: 'player2' }]
        })
        .lean()
    ]);

    const genderMap = new Map(participantGenderAgg.map((g) => [g._id, g.count]));
    const maleParticipants = genderMap.get('male') || 0;
    const femaleParticipants = genderMap.get('female') || 0;
    const totalParticipants = participantGenderAgg.reduce((acc, g) => acc + g.count, 0);

    const regMap = new Map(regStatusAgg.map((r) => [r._id, r.count]));
    const pendingRegistrations = regMap.get('pending') || 0;
    const approvedRegistrations = regMap.get('approved') || 0;
    const totalRegistrations = regStatusAgg.reduce((acc, r) => acc + r.count, 0);

    const teamMap = new Map(teamCategoryAgg.map((t) => [t._id, t.count]));
    const totalTeams = teamCategoryAgg.reduce((acc, t) => acc + t.count, 0);

    const matchMap = new Map(matchStatsAgg.map((m) => [m._id, m]));
    let totalMatches = 0;
    let completedMatches = 0;
    let liveMatches = 0;
    let readyMatches = 0;
    let waitingMatches = 0;

    const categoriesData = {};
    for (const cat of categories) {
      const m = matchMap.get(cat) || { total: 0, completed: 0, live: 0, ready: 0, waiting: 0 };
      totalMatches += m.total;
      completedMatches += m.completed;
      liveMatches += m.live;
      readyMatches += m.ready;
      waitingMatches += m.waiting;

      categoriesData[cat] = {
        teams: teamMap.get(cat) || 0,
        matches: m.total,
        completed: m.completed,
        live: m.live,
        isDrawPublished: tournament.drawsPublished ? Boolean(tournament.drawsPublished[cat]) : false,
        isDrawLocked: tournament.drawsLocked ? Boolean(tournament.drawsLocked[cat]) : false
      };
    }

    const champions = {};
    for (const finalsMatch of finalsMatches) {
      if (finalsMatch.winnerTeam && !champions[finalsMatch.category]) {
        champions[finalsMatch.category] = {
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
    const logs = await AuditLog.find().sort({ createdAt: -1 }).limit(100).lean();
    res.json({ success: true, count: logs.length, logs });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getOverviewStats,
  getAuditLogs
};
