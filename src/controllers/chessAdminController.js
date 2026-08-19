const mongoose = require('mongoose');
const ChessPlayer = require('../models/ChessPlayer');
const ChessMatch = require('../models/ChessMatch');
const ChessRound = require('../models/ChessRound');
const ChessConfiguration = require('../models/ChessConfiguration');
const memoryStore = require('../utils/chessMemoryDb');
const { getConfiguration } = require('../services/scoringService');
const { generateRoundPairings } = require('../services/pairingService');
const { submitResult, overrideResult, startMatch, cancelMatch } = require('../services/matchService');
const { recalculateAllStandings } = require('../services/standingsService');

const isDbConnected = () => mongoose.connection.readyState === 1;

// Admin Dashboard Analytics
exports.getDashboardStats = async (req, res, next) => {
  try {
    const config = await getConfiguration();

    if (isDbConnected()) {
      const totalPlayers = await ChessPlayer.countDocuments();
      const pendingPlayers = await ChessPlayer.countDocuments({ status: 'Registered' });
      const approvedPlayers = await ChessPlayer.countDocuments({ status: { $in: ['Approved', 'Active'] } });

      const totalMatches = await ChessMatch.countDocuments();
      const scheduledMatches = await ChessMatch.countDocuments({ status: 'scheduled' });
      const liveMatches = await ChessMatch.countDocuments({ status: 'live' });
      const completedMatches = await ChessMatch.countDocuments({ status: 'completed' });

      const departments = await ChessPlayer.distinct('department');

      return res.json({
        success: true,
        message: 'Dashboard statistics retrieved.',
        data: {
          totalRegistrations: totalPlayers,
          totalPlayers,
          approvedPlayers,
          pendingRegistrations: pendingPlayers,
          pendingPlayers,
          totalMatches,
          scheduledMatches,
          liveMatches,
          completedMatches,
          currentRound: config.currentRound,
          registrationOpen: config.registrationOpen,
          totalDepartments: departments.length,
          departments
        }
      });
    }

    // In-Memory Fallback
    const totalPlayers = memoryStore.players.length;
    const pendingPlayers = memoryStore.players.filter(p => p.status === 'Registered').length;
    const approvedPlayers = memoryStore.players.filter(p => ['Approved', 'Active'].includes(p.status)).length;

    const totalMatches = memoryStore.matches.length;
    const scheduledMatches = memoryStore.matches.filter(m => m.status === 'scheduled').length;
    const liveMatches = memoryStore.matches.filter(m => m.status === 'live').length;
    const completedMatches = memoryStore.matches.filter(m => m.status === 'completed').length;

    const depts = Array.from(new Set(memoryStore.players.map(p => p.department)));

    res.json({
      success: true,
      message: 'Dashboard statistics retrieved (In-Memory).',
      data: {
        totalRegistrations: totalPlayers,
        totalPlayers,
        approvedPlayers,
        pendingRegistrations: pendingPlayers,
        pendingPlayers,
        totalMatches,
        scheduledMatches,
        liveMatches,
        completedMatches,
        currentRound: memoryStore.configuration.currentRound,
        registrationOpen: memoryStore.configuration.registrationOpen,
        totalDepartments: depts.length,
        departments: depts
      }
    });
  } catch (err) {
    next(err);
  }
};

// Admin Get Players
exports.getAdminPlayers = async (req, res, next) => {
  try {
    const { status, department, search } = req.query;

    if (isDbConnected()) {
      const filter = {};
      if (status && status !== 'all') filter.status = status;
      if (department && department !== 'all') filter.department = department;

      if (search) {
        filter.$or = [
          { fullName: { $regex: search, $options: 'i' } },
          { playerId: { $regex: search, $options: 'i' } },
          { email: { $regex: search, $options: 'i' } }
        ];
      }

      const players = await ChessPlayer.find(filter).sort({ createdAt: -1 });
      return res.json({ success: true, count: players.length, data: players });
    }

    let players = [...memoryStore.players];
    if (status && status !== 'all') players = players.filter(p => p.status === status);
    if (department && department !== 'all') players = players.filter(p => p.department === department);
    if (search) {
      const q = search.toLowerCase();
      players = players.filter(p => p.fullName.toLowerCase().includes(q) || p.playerId.toLowerCase().includes(q));
    }

    res.json({ success: true, count: players.length, data: players });
  } catch (err) {
    next(err);
  }
};

// Admin Update Player (PATCH/PUT)
exports.updatePlayer = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { fullName, department, status, phone, adminNotes } = req.body;

    if (isDbConnected()) {
      const player = await ChessPlayer.findById(id);
      if (!player) {
        return res.status(404).json({ success: false, message: 'Player not found.' });
      }

      if (fullName) player.fullName = fullName.trim();
      if (department) player.department = department.trim();
      if (phone !== undefined) player.phone = phone.trim();
      if (adminNotes !== undefined) player.adminNotes = adminNotes;

      if (status) {
        if (status === 'approved') player.status = 'Approved';
        else if (status === 'rejected') player.status = 'Rejected';
        else if (status === 'pending') player.status = 'Registered';
        else player.status = status;
      }

      await player.save();
      await recalculateAllStandings();

      return res.json({
        success: true,
        message: `Player ${player.fullName} updated successfully.`,
        data: player
      });
    }

    const player = memoryStore.players.find(p => p._id === id || p.playerId === id);
    if (!player) {
      return res.status(404).json({ success: false, message: 'Player not found.' });
    }

    if (fullName) player.fullName = fullName.trim();
    if (department) player.department = department.trim();
    if (phone !== undefined) player.phone = phone.trim();
    if (status) {
      if (status === 'approved') player.status = 'Approved';
      else if (status === 'rejected') player.status = 'Rejected';
      else if (status === 'pending') player.status = 'Registered';
      else player.status = status;
    }

    await recalculateAllStandings();

    res.json({
      success: true,
      message: `Player ${player.fullName} updated successfully.`,
      data: player
    });
  } catch (err) {
    next(err);
  }
};

// Admin Delete Player
exports.deletePlayer = async (req, res, next) => {
  try {
    const { id } = req.params;

    if (isDbConnected()) {
      const player = await ChessPlayer.findById(id);
      if (!player) {
        return res.status(404).json({ success: false, message: 'Player not found.' });
      }

      await ChessMatch.deleteMany({
        $or: [{ player1: player._id }, { player2: player._id }]
      });

      await ChessPlayer.findByIdAndDelete(id);
      await recalculateAllStandings();

      return res.json({
        success: true,
        message: 'Player and associated match records deleted.'
      });
    }

    const idx = memoryStore.players.findIndex(p => p._id === id || p.playerId === id);
    if (idx === -1) {
      return res.status(404).json({ success: false, message: 'Player not found.' });
    }

    memoryStore.players.splice(idx, 1);
    await recalculateAllStandings();

    res.json({
      success: true,
      message: 'Player deleted successfully.'
    });
  } catch (err) {
    next(err);
  }
};

// Admin Generate Matches
exports.generateMatches = async (req, res, next) => {
  try {
    const { round } = req.body;
    const matches = await generateRoundPairings(round);

    res.status(201).json({
      success: true,
      message: `Generated ${matches.length} match pairings for current round.`,
      data: matches
    });
  } catch (err) {
    res.status(400).json({
      success: false,
      message: err.message || 'Error generating match pairings.'
    });
  }
};

// Admin Get Matches
exports.getAdminMatches = async (req, res, next) => {
  try {
    const { round, status } = req.query;

    if (isDbConnected()) {
      const filter = {};
      if (round && round !== 'all') filter.round = Number(round);
      if (status && status !== 'all') filter.status = status;

      const matches = await ChessMatch.find(filter)
        .populate('player1', 'fullName playerId department rank')
        .populate('player2', 'fullName playerId department rank')
        .sort({ round: 1, createdAt: 1 });

      return res.json({ success: true, count: matches.length, data: matches });
    }

    let matches = [...memoryStore.matches];
    if (round && round !== 'all') matches = matches.filter(m => m.round === Number(round));
    if (status && status !== 'all') matches = matches.filter(m => m.status === status);

    res.json({ success: true, count: matches.length, data: matches });
  } catch (err) {
    next(err);
  }
};

// Admin Update Match Status / Start Match (PATCH/PUT)
exports.updateMatch = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status, action } = req.body;

    if (action === 'start' || status === 'live') {
      const match = await startMatch(id);
      return res.json({
        success: true,
        message: 'Match started.',
        data: match
      });
    }

    if (action === 'cancel' || status === 'cancelled') {
      const match = await cancelMatch(id);
      return res.json({
        success: true,
        message: 'Match cancelled.',
        data: match
      });
    }

    if (isDbConnected()) {
      const match = await ChessMatch.findById(id);
      if (!match) {
        return res.status(404).json({ success: false, message: 'Match not found.' });
      }
      if (status) match.status = status;
      await match.save();
      return res.json({ success: true, message: 'Match updated.', data: match });
    }

    const match = memoryStore.matches.find(m => m._id === id || m.matchId === id);
    if (!match) {
      return res.status(404).json({ success: false, message: 'Match not found.' });
    }
    if (status) match.status = status;

    res.json({ success: true, message: 'Match updated.', data: match });
  } catch (err) {
    next(err);
  }
};

// Admin Submit / Enter Match Result (POST/PUT)
exports.submitMatchResult = async (req, res, next) => {
  try {
    const { id } = req.params;
    const match = await submitResult(id, req.body);

    res.json({
      success: true,
      message: 'Match result submitted and standings updated.',
      data: match
    });
  } catch (err) {
    next(err);
  }
};

// Admin Override Result
exports.overrideMatchResult = async (req, res, next) => {
  try {
    const { id } = req.params;
    const match = await overrideResult(id, req.body);

    res.json({
      success: true,
      message: 'Match result overridden by admin.',
      data: match
    });
  } catch (err) {
    next(err);
  }
};

// Admin Standings API
exports.getAdminStandings = async (req, res, next) => {
  try {
    const standings = await recalculateAllStandings();
    res.json({
      success: true,
      count: standings.length,
      data: standings
    });
  } catch (err) {
    next(err);
  }
};

// Admin Update Configuration / Settings
exports.updateSettings = async (req, res, next) => {
  try {
    const { matchDuration, currentRound, registrationOpen, piecePoints, tournamentPoints } = req.body;
    let config = await getConfiguration();

    if (isDbConnected()) {
      if (matchDuration !== undefined) config.matchDuration = matchDuration;
      if (currentRound !== undefined) config.currentRound = currentRound;
      if (registrationOpen !== undefined) config.registrationOpen = registrationOpen;

      if (piecePoints) {
        config.piecePoints = { ...config.piecePoints, ...piecePoints, king: 0 };
      }
      if (tournamentPoints) {
        config.tournamentPoints = { ...config.tournamentPoints, ...tournamentPoints };
      }

      await config.save();
      await recalculateAllStandings();

      return res.json({
        success: true,
        message: 'Tournament settings updated successfully.',
        data: config
      });
    }

    if (matchDuration !== undefined) memoryStore.configuration.matchDuration = matchDuration;
    if (currentRound !== undefined) memoryStore.configuration.currentRound = currentRound;
    if (registrationOpen !== undefined) memoryStore.configuration.registrationOpen = registrationOpen;
    if (piecePoints) {
      memoryStore.configuration.piecePoints = { ...memoryStore.configuration.piecePoints, ...piecePoints, king: 0 };
    }
    if (tournamentPoints) {
      memoryStore.configuration.tournamentPoints = { ...memoryStore.configuration.tournamentPoints, ...tournamentPoints };
    }

    await recalculateAllStandings();

    res.json({
      success: true,
      message: 'Tournament settings updated successfully.',
      data: memoryStore.configuration
    });
  } catch (err) {
    next(err);
  }
};

// Admin Reset Tournament Data
exports.resetTournamentData = async (req, res, next) => {
  try {
    if (isDbConnected()) {
      await ChessMatch.deleteMany({});
      await ChessPlayer.deleteMany({});
      await ChessRound.deleteMany({});
      let config = await ChessConfiguration.findOne();
      if (config) {
        config.currentRound = 1;
        config.registrationOpen = true;
        await config.save();
      }
    }

    memoryStore.players = [];
    memoryStore.matches = [];
    memoryStore.rounds = [];
    memoryStore.configuration.currentRound = 1;
    memoryStore.configuration.registrationOpen = true;

    res.json({
      success: true,
      message: 'Chess tournament data reset successfully. All registrations and matches cleared.'
    });
  } catch (err) {
    next(err);
  }
};
