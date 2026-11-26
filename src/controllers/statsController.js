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

// Public: Unified deduplicated participant directory across Singles, Doubles, Mixed Doubles, Matches & Leaderboard
const getParticipantsDirectory = async (req, res, next) => {
  try {
    const tournament = await Tournament.findOne().sort({ createdAt: -1 }).lean();
    if (!tournament) {
      return res.json({ success: true, count: 0, participants: [], leaderboard: [] });
    }

    const { category = '', gender = '', search = '' } = req.query;

    const [registrations, teams, matches] = await Promise.all([
      Registration.find({ tournamentId: tournament._id })
        .populate('participantId')
        .lean(),
      Team.find({ tournamentId: tournament._id, isApproved: true })
        .populate('player1')
        .populate('player2')
        .lean(),
      Match.find({ tournamentId: tournament._id, isBye: false })
        .select('category roundName matchNumber status team1 team2 winnerTeam finalScore scheduledTime')
        .lean()
    ]);

    // Index teams by participant _id -> per category
    const participantTeamsMap = new Map();
    const teamById = new Map();
    for (const t of teams) {
      teamById.set(t._id.toString(), t);
      const pIds = [t.player1?._id?.toString(), t.player2?._id?.toString()].filter(Boolean);
      for (const pid of pIds) {
        if (!participantTeamsMap.has(pid)) participantTeamsMap.set(pid, []);
        participantTeamsMap.get(pid).push(t);
      }
    }

    // Index matches by teamId
    const matchesByTeamId = new Map();
    for (const m of matches) {
      const t1 = m.team1?.toString();
      const t2 = m.team2?.toString();
      if (t1) {
        if (!matchesByTeamId.has(t1)) matchesByTeamId.set(t1, []);
        matchesByTeamId.get(t1).push(m);
      }
      if (t2 && t2 !== t1) {
        if (!matchesByTeamId.has(t2)) matchesByTeamId.set(t2, []);
        matchesByTeamId.get(t2).push(m);
      }
    }

    // Build deduplicated participant entries (one entry per unique Participant._id)
    const seenParticipantIds = new Set();
    let entries = [];

    for (const reg of registrations) {
      const p = reg.participantId;
      if (!p || !p._id) continue;
      const pid = p._id.toString();
      if (seenParticipantIds.has(pid)) continue;
      seenParticipantIds.add(pid);

      const pTeams = participantTeamsMap.get(pid) || [];
      const singlesTeam = pTeams.find((t) => t.category === 'boys_singles' || t.category === 'girls_singles') || null;
      const doublesTeam = pTeams.find((t) => t.category === 'boys_doubles' || t.category === 'girls_doubles') || null;
      const mixedTeam = pTeams.find((t) => t.category === 'mixed_doubles') || null;

      const getPartnerFromTeam = (team) => {
        if (!team) return null;
        if (team.player1?._id?.toString() === pid) return team.player2 || null;
        if (team.player2?._id?.toString() === pid) return team.player1 || null;
        return null;
      };

      const doublesPartnerObj = getPartnerFromTeam(doublesTeam);
      const mixedPartnerObj = getPartnerFromTeam(mixedTeam);

      const categories = [];
      if (reg.participateSingles !== false) categories.push(p.gender === 'male' ? 'boys_singles' : 'girls_singles');
      if (reg.participateDoubles) categories.push(p.gender === 'male' ? 'boys_doubles' : 'girls_doubles');
      if (reg.participateMixedDoubles) categories.push('mixed_doubles');

      // Gather all matches across this participant's teams without duplicates
      const seenMatchIds = new Set();
      const playerMatches = [];
      let wins = 0;
      let completedMatches = 0;
      let boardsWon = 0;

      for (const team of pTeams) {
        const tid = team._id.toString();
        const teamMatches = matchesByTeamId.get(tid) || [];
        for (const m of teamMatches) {
          const mid = m._id.toString();
          if (seenMatchIds.has(mid)) continue;
          seenMatchIds.add(mid);

          const isT1 = m.team1?.toString() === tid;
          const oppId = isT1 ? m.team2?.toString() : m.team1?.toString();
          const oppTeam = oppId ? teamById.get(oppId) : null;
          const isWinner = Boolean(m.winnerTeam && m.winnerTeam.toString() === tid);

          if (m.status === 'completed') {
            completedMatches++;
            if (isWinner) wins++;
            boardsWon += isT1 ? (m.finalScore?.team1BoardsWon || 0) : (m.finalScore?.team2BoardsWon || 0);
          }

          playerMatches.push({
            _id: m._id,
            matchNumber: m.matchNumber,
            category: m.category,
            roundName: m.roundName,
            status: m.status,
            teamName: team.name,
            opponentName: oppTeam?.name || 'TBD',
            isWinner,
            scheduledTime: m.scheduledTime || null
          });
        }
      }

      entries.push({
        _id: pid,
        registrationId: reg._id,
        fullName: p.fullName,
        gender: p.gender,
        department: p.department,
        status: reg.status,
        participateSingles: reg.participateSingles !== false,
        participateDoubles: Boolean(reg.participateDoubles),
        participateMixedDoubles: Boolean(reg.participateMixedDoubles),
        categories,
        doublesPartner: reg.participateDoubles
          ? {
              paired: Boolean(doublesTeam && doublesPartnerObj),
              partnerId: doublesPartnerObj?._id || reg.doublesPartnerId || null,
              partnerName: doublesPartnerObj?.fullName || reg.doublesPartnerName || '',
              teamId: doublesTeam?._id || null,
              teamName: doublesTeam?.name || ''
            }
          : null,
        mixedDoublesPartner: reg.participateMixedDoubles
          ? {
              paired: Boolean(mixedTeam && mixedPartnerObj),
              partnerId: mixedPartnerObj?._id || reg.mixedDoublesPartnerId || null,
              partnerName: mixedPartnerObj?.fullName || reg.mixedDoublesPartnerName || '',
              teamId: mixedTeam?._id || null,
              teamName: mixedTeam?.name || ''
            }
          : null,
        singlesTeamId: singlesTeam?._id || null,
        stats: {
          matchesPlayed: completedMatches,
          totalMatches: playerMatches.length,
          wins,
          boardsWon,
          points: wins * 3 + boardsWon
        },
        matches: playerMatches
      });
    }

    // Apply optional filters
    if (gender) {
      entries = entries.filter((e) => e.gender === gender.toLowerCase());
    }
    if (category) {
      if (category === 'singles') {
        entries = entries.filter((e) => e.participateSingles);
      } else if (category === 'doubles') {
        entries = entries.filter((e) => e.participateDoubles);
      } else {
        entries = entries.filter((e) => e.categories.includes(category));
      }
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      entries = entries.filter(
        (e) =>
          e.fullName.toLowerCase().includes(q) ||
          (e.department && e.department.toLowerCase().includes(q)) ||
          (e.doublesPartner?.partnerName && e.doublesPartner.partnerName.toLowerCase().includes(q)) ||
          (e.mixedDoublesPartner?.partnerName && e.mixedDoublesPartner.partnerName.toLowerCase().includes(q))
      );
    }

    entries.sort((a, b) => a.fullName.localeCompare(b.fullName));

    const leaderboard = [...entries]
      .sort((a, b) => b.stats.wins - a.stats.wins || b.stats.boardsWon - a.stats.boardsWon || a.fullName.localeCompare(b.fullName));

    res.json({
      success: true,
      count: entries.length,
      participants: entries,
      leaderboard
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
  getParticipantsDirectory,
  getAuditLogs
};
