const mongoose = require('mongoose');
const ChessPlayer = require('../models/ChessPlayer');
const ChessMatch = require('../models/ChessMatch');
const ChessRound = require('../models/ChessRound');
const memoryStore = require('../utils/chessMemoryDb');
const { getConfiguration } = require('../services/scoringService');
const { recalculateAllStandings } = require('../services/standingsService');

const isDbConnected = () => mongoose.connection.readyState === 1;

// Get public tournament info & settings
exports.getSettings = async (req, res, next) => {
  try {
    const config = await getConfiguration();
    const registeredCount = isDbConnected()
      ? await ChessPlayer.countDocuments({ status: { $in: ['Approved', 'Active', 'Registered'] } })
      : memoryStore.players.filter(p => ['Approved', 'Active', 'Registered'].includes(p.status)).length;

    const matchesCount = isDbConnected()
      ? await ChessMatch.countDocuments()
      : memoryStore.matches.length;

    res.json({
      success: true,
      message: 'Chess tournament settings retrieved.',
      data: {
        ...(typeof config.toObject === 'function' ? config.toObject() : config),
        registeredCount,
        matchesCount
      }
    });
  } catch (err) {
    next(err);
  }
};

// Player Registration API
exports.registerPlayer = async (req, res, next) => {
  try {
    const { fullName, email, phone, department } = req.body;

    if (!fullName || !email || !department) {
      return res.status(400).json({
        success: false,
        message: 'Full Name, Email, and Department are required.'
      });
    }

    const validDepts = ['First Year', 'Second Year', 'IT Team', 'MJ Team', 'HR Team'];
    if (!validDepts.includes(department.trim())) {
      return res.status(400).json({
        success: false,
        message: `Department must be one of: ${validDepts.join(', ')}`
      });
    }

    const cleanEmail = email.toLowerCase().trim();

    if (isDbConnected()) {
      const existing = await ChessPlayer.findOne({ email: cleanEmail });
      if (existing) {
        return res.status(400).json({
          success: false,
          message: `A player with email ${email} is already registered.`
        });
      }

      if (phone) {
        const existingPhone = await ChessPlayer.findOne({ phone: phone.trim() });
        if (existingPhone) {
          return res.status(400).json({
            success: false,
            message: `A player with phone number ${phone} is already registered.`
          });
        }
      }

      const totalCount = await ChessPlayer.countDocuments();
      const playerId = `CHS-${String(totalCount + 1).padStart(3, '0')}`;

      const player = await ChessPlayer.create({
        playerId,
        fullName: fullName.trim(),
        email: cleanEmail,
        phone: phone ? phone.trim() : '',
        department: department.trim(),
        status: 'Registered'
      });

      return res.status(201).json({
        success: true,
        message: 'Player registered successfully. Application pending approval.',
        data: player
      });
    }

    // In-Memory Fallback when MongoDB is offline
    const existingMemory = memoryStore.players.find(p => p.email === cleanEmail);
    if (existingMemory) {
      return res.status(400).json({
        success: false,
        message: `A player with email ${email} is already registered.`
      });
    }

    const playerId = `CHS-${String(memoryStore.players.length + 1).padStart(3, '0')}`;
    const player = {
      _id: `mem_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
      playerId,
      fullName: fullName.trim(),
      email: cleanEmail,
      phone: phone ? phone.trim() : '',
      department: department.trim(),
      status: 'Registered',
      matchesPlayed: 0,
      wins: 0,
      draws: 0,
      losses: 0,
      materialPoints: 0,
      tournamentPoints: 0,
      rank: memoryStore.players.length + 1,
      createdAt: new Date()
    };

    memoryStore.players.push(player);

    res.status(201).json({
      success: true,
      message: 'Player registered successfully. Application pending approval.',
      data: player
    });
  } catch (err) {
    next(err);
  }
};

// Get Public Players List
exports.getPlayers = async (req, res, next) => {
  try {
    const { department, search, status } = req.query;

    if (isDbConnected()) {
      const filter = {};
      filter.status = status ? status : { $in: ['Approved', 'Active', 'Completed'] };

      if (department && department !== 'all') filter.department = department;
      if (search) {
        filter.$or = [
          { fullName: { $regex: search, $options: 'i' } },
          { playerId: { $regex: search, $options: 'i' } },
          { department: { $regex: search, $options: 'i' } }
        ];
      }

      const players = await ChessPlayer.find(filter).sort({ rank: 1, tournamentPoints: -1, materialPoints: -1 });
      return res.json({ success: true, count: players.length, data: players });
    }

    // In-Memory Fallback
    let players = [...memoryStore.players];
    if (status) players = players.filter(p => p.status === status);
    else players = players.filter(p => ['Approved', 'Active', 'Completed', 'Registered'].includes(p.status));

    if (department && department !== 'all') players = players.filter(p => p.department === department);
    if (search) {
      const q = search.toLowerCase();
      players = players.filter(p => p.fullName.toLowerCase().includes(q) || p.playerId.toLowerCase().includes(q));
    }

    res.json({
      success: true,
      count: players.length,
      data: players
    });
  } catch (err) {
    next(err);
  }
};

// Get Single Player Profile & Match History
exports.getPlayerById = async (req, res, next) => {
  try {
    const { id } = req.params;

    if (isDbConnected()) {
      const player = await ChessPlayer.findById(id);
      if (!player) {
        return res.status(404).json({ success: false, message: 'Player not found.' });
      }

      const matchHistory = await ChessMatch.find({
        $or: [{ player1: player._id }, { player2: player._id }]
      })
        .populate('player1', 'fullName playerId department')
        .populate('player2', 'fullName playerId department')
        .sort({ round: 1, createdAt: -1 });

      return res.json({ success: true, data: { player, matchHistory } });
    }

    const player = memoryStore.players.find(p => p._id === id || p.playerId === id);
    if (!player) {
      return res.status(404).json({ success: false, message: 'Player not found.' });
    }

    const matchHistory = memoryStore.matches.filter(m => m.player1 === player._id || m.player2 === player._id);

    res.json({
      success: true,
      data: { player, matchHistory }
    });
  } catch (err) {
    next(err);
  }
};

// Get Public Matches List
exports.getMatches = async (req, res, next) => {
  try {
    const { round, status, search } = req.query;

    if (isDbConnected()) {
      const filter = {};
      if (round && round !== 'all') filter.round = Number(round);
      if (status && status !== 'all') filter.status = status;

      let matches = await ChessMatch.find(filter)
        .populate('player1', 'fullName playerId department rank')
        .populate('player2', 'fullName playerId department rank')
        .sort({ round: 1, createdAt: 1 });

      if (search) {
        const q = search.toLowerCase();
        matches = matches.filter(
          (m) =>
            m.matchId.toLowerCase().includes(q) ||
            m.player1?.fullName.toLowerCase().includes(q) ||
            m.player2?.fullName.toLowerCase().includes(q)
        );
      }

      return res.json({ success: true, count: matches.length, data: matches });
    }

    let matches = [...memoryStore.matches];
    if (round && round !== 'all') matches = matches.filter(m => m.round === Number(round));
    if (status && status !== 'all') matches = matches.filter(m => m.status === status);

    res.json({
      success: true,
      count: matches.length,
      data: matches
    });
  } catch (err) {
    next(err);
  }
};

// Get Single Match Detail
exports.getMatchById = async (req, res, next) => {
  try {
    const { id } = req.params;
    const config = await getConfiguration();

    if (isDbConnected()) {
      const match = await ChessMatch.findById(id).populate('player1').populate('player2');
      if (!match) {
        return res.status(404).json({ success: false, message: 'Match not found.' });
      }
      return res.json({ success: true, data: { match, settings: config } });
    }

    const match = memoryStore.matches.find(m => m._id === id || m.matchId === id);
    if (!match) {
      return res.status(404).json({ success: false, message: 'Match not found.' });
    }

    res.json({ success: true, data: { match, settings: config } });
  } catch (err) {
    next(err);
  }
};

// Get Standings
exports.getStandings = async (req, res, next) => {
  try {
    const standings = await recalculateAllStandings();
    const { department, search } = req.query;

    let filtered = standings;
    if (department && department !== 'all') {
      filtered = filtered.filter(p => p.department === department);
    }

    if (search) {
      const q = search.toLowerCase();
      filtered = filtered.filter(
        p => p.fullName.toLowerCase().includes(q) || p.playerId.toLowerCase().includes(q)
      );
    }

    res.json({
      success: true,
      count: filtered.length,
      data: filtered
    });
  } catch (err) {
    next(err);
  }
};

// Get Tournament Rounds List
exports.getRounds = async (req, res, next) => {
  try {
    if (isDbConnected()) {
      const rounds = await ChessRound.find().sort({ roundNumber: 1 });
      return res.json({ success: true, count: rounds.length, data: rounds });
    }

    res.json({
      success: true,
      count: memoryStore.rounds.length,
      data: memoryStore.rounds
    });
  } catch (err) {
    next(err);
  }
};
