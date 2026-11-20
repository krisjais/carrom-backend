const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const ChessPlayer = require('../models/ChessPlayer');
const ChessMatch = require('../models/ChessMatch');
const ChessRound = require('../models/ChessRound');
const memoryStore = require('../utils/chessMemoryDb');
const { getConfiguration } = require('../services/scoringService');
const { recalculateAllStandings } = require('../services/standingsService');
const { emitMatchUpdate, emitChessLive } = require('../socket');

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

// Player Registration API (With Secure Password Creation)
exports.registerPlayer = async (req, res, next) => {
  try {
    const { fullName, email, phone, department, password } = req.body;

    if (!fullName || !email || !department) {
      return res.status(400).json({
        success: false,
        message: 'Full Name, Email, and Department are required.'
      });
    }

    if (!password || password.trim().length < 4) {
      return res.status(400).json({
        success: false,
        message: 'Please create a secure password (minimum 4 characters).'
      });
    }

    const validDepts = ['First Year', 'Second Year', 'IT Team', 'MJ Team', 'HR Team', 'Staff'];
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
        password: password.trim(),
        phone: phone ? phone.trim() : '',
        department: department.trim(),
        status: 'Registered'
      });

      return res.status(201).json({
        success: true,
        message: 'Player registered successfully. You can now log in with your password!',
        data: {
          _id: player._id,
          playerId: player.playerId,
          fullName: player.fullName,
          email: player.email,
          department: player.department,
          status: player.status
        }
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
    const salt = bcrypt.genSaltSync(10);
    const hashedPassword = bcrypt.hashSync(password.trim(), salt);

    const player = {
      _id: `mem_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
      playerId,
      fullName: fullName.trim(),
      email: cleanEmail,
      password: hashedPassword,
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
      message: 'Player registered successfully. You can now log in with your password!',
      data: {
        _id: player._id,
        playerId: player.playerId,
        fullName: player.fullName,
        email: player.email,
        department: player.department,
        status: player.status
      }
    });
  } catch (err) {
    next(err);
  }
};

// Player Login API (Competitor authentication via Player ID/Email AND Password)
exports.playerLogin = async (req, res, next) => {
  try {
    const { identifier, email, playerId, phone, password } = req.body;
    const rawInput = identifier || email || playerId || phone || '';
    if (!rawInput.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Please provide your Player ID (e.g. CHS-001) or registered Email.'
      });
    }

    if (!password || !password.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Please enter your account password.'
      });
    }

    const clean = rawInput.trim();
    const cleanLower = clean.toLowerCase();

    let player = null;
    if (isDbConnected()) {
      // Find by exact Player ID (case-insensitive) OR Email OR Phone
      player = await ChessPlayer.findOne({
        $or: [
          { playerId: { $regex: new RegExp(`^${clean.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') } },
          { email: cleanLower },
          { phone: clean }
        ]
      });
    } else {
      player = memoryStore.players.find(
        p => (p.playerId && p.playerId.toLowerCase() === cleanLower) ||
             (p.email && p.email.toLowerCase() === cleanLower) ||
             (p.phone && p.phone === clean)
      );
    }

    if (!player) {
      return res.status(404).json({
        success: false,
        message: `No competitor profile found matching "${clean}". Please check your Player ID or register first.`
      });
    }

    // Verify password if player has one
    if (player.password) {
      const isMatch = typeof player.comparePassword === 'function'
        ? await player.comparePassword(password.trim())
        : await bcrypt.compare(password.trim(), player.password);

      if (!isMatch) {
        return res.status(401).json({
          success: false,
          message: 'Incorrect password. Please verify your credentials and try again.'
        });
      }
    }

    const token = jwt.sign(
      {
        id: player._id || player.playerId,
        playerId: player.playerId,
        fullName: player.fullName,
        email: player.email,
        role: 'chess_player'
      },
      process.env.JWT_SECRET || 'carrom_championship_super_secure_jwt_secret_key_2026',
      { expiresIn: '30d' }
    );

    // Fetch this player's active and upcoming matches
    const playerIdStr = (player._id || player.playerId).toString();
    let currentMatch = null;
    let matchHistory = [];

    if (isDbConnected()) {
      const allMatches = await ChessMatch.find({
        $or: [
          { player1: player._id },
          { player2: player._id },
          { byePlayer: player._id }
        ]
      })
        .populate('player1', 'fullName playerId department rank')
        .populate('player2', 'fullName playerId department rank')
        .populate('byePlayer', 'fullName playerId department')
        .populate('winnerPlayer', 'fullName playerId department')
        .sort({ round: -1, createdAt: -1 });

      currentMatch =
        allMatches.find(m => m.status === 'live') ||
        allMatches.find(m => m.status === 'scheduled') ||
        allMatches[0] ||
        null;
      matchHistory = allMatches;
    } else {
      const allMatches = memoryStore.matches.filter(m => {
        const p1Id = (m.player1?._id || m.player1 || m.byePlayer?._id || m.byePlayer)?.toString();
        const p2Id = (m.player2?._id || m.player2)?.toString();
        return p1Id === playerIdStr || p2Id === playerIdStr;
      });
      currentMatch =
        allMatches.find(m => m.status === 'live') ||
        allMatches.find(m => m.status === 'scheduled') ||
        allMatches[0] ||
        null;
      matchHistory = allMatches;
    }

    // Determine player's piece color in their current match
    let pieceColor = 'spectator';
    if (currentMatch) {
      const p1Id = (currentMatch.player1?._id || currentMatch.player1 || currentMatch.byePlayer?._id || currentMatch.byePlayer)?.toString();
      const p2Id = (currentMatch.player2?._id || currentMatch.player2)?.toString();
      if (p1Id === playerIdStr) pieceColor = 'white';
      else if (p2Id === playerIdStr) pieceColor = 'black';
    }

    res.json({
      success: true,
      message: `Welcome back, ${player.fullName}!`,
      token,
      data: {
        player,
        pieceColor,
        currentMatch,
        matchHistory
      }
    });
  } catch (err) {
    next(err);
  }
};

// Get Full Player Dashboard (Current match, dual clock state, standings)
exports.getPlayerDashboard = async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!id) {
      return res.status(400).json({ success: false, message: 'Player identifier is required.' });
    }

    const clean = id.trim();
    const cleanLower = clean.toLowerCase();

    let player = null;
    if (isDbConnected()) {
      if (mongoose.Types.ObjectId.isValid(clean)) {
        player = await ChessPlayer.findById(clean);
      }
      if (!player) {
        player = await ChessPlayer.findOne({
          $or: [
            { playerId: { $regex: new RegExp(`^${clean.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') } },
            { email: cleanLower }
          ]
        });
      }
    } else {
      player = memoryStore.players.find(
        p => (p._id && p._id.toString() === clean) ||
             (p.playerId && p.playerId.toLowerCase() === cleanLower) ||
             (p.email && p.email.toLowerCase() === cleanLower)
      );
    }

    if (!player) {
      return res.status(404).json({ success: false, message: 'Player not found.' });
    }

    const playerIdStr = (player._id || player.playerId).toString();
    let currentMatch = null;
    let matchHistory = [];

    if (isDbConnected()) {
      const allMatches = await ChessMatch.find({
        $or: [
          { player1: player._id },
          { player2: player._id },
          { byePlayer: player._id }
        ]
      })
        .populate('player1', 'fullName playerId department rank')
        .populate('player2', 'fullName playerId department rank')
        .populate('byePlayer', 'fullName playerId department')
        .populate('winnerPlayer', 'fullName playerId department')
        .sort({ round: -1, createdAt: -1 });

      currentMatch =
        allMatches.find(m => m.status === 'live') ||
        allMatches.find(m => m.status === 'scheduled') ||
        allMatches[0] ||
        null;
      matchHistory = allMatches;
    } else {
      const allMatches = memoryStore.matches.filter(m => {
        const p1Id = (m.player1?._id || m.player1 || m.byePlayer?._id || m.byePlayer)?.toString();
        const p2Id = (m.player2?._id || m.player2)?.toString();
        return p1Id === playerIdStr || p2Id === playerIdStr;
      });
      currentMatch =
        allMatches.find(m => m.status === 'live') ||
        allMatches.find(m => m.status === 'scheduled') ||
        allMatches[0] ||
        null;
      matchHistory = allMatches;
    }

    let pieceColor = 'spectator';
    if (currentMatch) {
      const p1Id = (currentMatch.player1?._id || currentMatch.player1 || currentMatch.byePlayer?._id || currentMatch.byePlayer)?.toString();
      const p2Id = (currentMatch.player2?._id || currentMatch.player2)?.toString();
      if (p1Id === playerIdStr) pieceColor = 'white';
      else if (p2Id === playerIdStr) pieceColor = 'black';
    }

    res.json({
      success: true,
      data: {
        player,
        pieceColor,
        currentMatch,
        matchHistory
      }
    });
  } catch (err) {
    next(err);
  }
};

// Update / Sync Match Dual Clock (from mobile phone tap or admin)
exports.updateMatchClock = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { activeTurn, whiteTimeRemaining, blackTimeRemaining, movesCount, isClockRunning, status } = req.body;

    let match = null;
    if (isDbConnected()) {
      if (mongoose.Types.ObjectId.isValid(id)) {
        match = await ChessMatch.findById(id);
      }
      if (!match) {
        match = await ChessMatch.findOne({ matchId: id });
      }
      if (!match) {
        match = await ChessMatch.findOne({ matchId: new RegExp(`^${id}$`, 'i') });
      }
      if (!match) {
        return res.status(404).json({ success: false, message: 'Match not found.' });
      }

      if (activeTurn !== undefined) match.activeTurn = activeTurn;
      if (typeof whiteTimeRemaining === 'number') match.whiteTimeRemaining = Math.max(0, Math.round(whiteTimeRemaining));
      if (typeof blackTimeRemaining === 'number') match.blackTimeRemaining = Math.max(0, Math.round(blackTimeRemaining));
      if (typeof movesCount === 'number') match.movesCount = movesCount;
      if (typeof isClockRunning === 'boolean') match.isClockRunning = isClockRunning;
      if (status) match.status = status;
      match.lastClockUpdate = new Date();

      if ((status === 'live' || isClockRunning) && !match.actualStartTime) {
        match.actualStartTime = new Date();
      }

      await match.save();
      await match.populate('player1 player2 byePlayer');

      emitMatchUpdate(match._id, 'chess:clock_updated', match);
      emitChessLive('chess:match_updated', match);

      return res.json({ success: true, message: 'Clock synced.', data: match });
    }

    match = memoryStore.matches.find(m => m._id === id || m.matchId === id || (m.matchId && m.matchId.toLowerCase() === String(id).toLowerCase()));
    if (!match) {
      return res.status(404).json({ success: false, message: 'Match not found.' });
    }
    if (activeTurn !== undefined) match.activeTurn = activeTurn;
    if (typeof whiteTimeRemaining === 'number') match.whiteTimeRemaining = Math.max(0, Math.round(whiteTimeRemaining));
    if (typeof blackTimeRemaining === 'number') match.blackTimeRemaining = Math.max(0, Math.round(blackTimeRemaining));
    if (typeof movesCount === 'number') match.movesCount = movesCount;
    if (typeof isClockRunning === 'boolean') match.isClockRunning = isClockRunning;
    if (status) match.status = status;
    match.lastClockUpdate = new Date();

    emitMatchUpdate(match._id, 'chess:clock_updated', match);
    emitChessLive('chess:match_updated', match);

    res.json({ success: true, message: 'Clock synced.', data: match });
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
      let query = mongoose.Types.ObjectId.isValid(id) ? { _id: id } : { matchId: id };
      let match = await ChessMatch.findOne(query).populate('player1').populate('player2').populate('byePlayer');
      if (!match && !mongoose.Types.ObjectId.isValid(id)) {
        match = await ChessMatch.findOne({ matchId: new RegExp(`^${id}$`, 'i') }).populate('player1').populate('player2').populate('byePlayer');
      }
      if (!match) {
        return res.status(404).json({ success: false, message: 'Match not found.' });
      }
      return res.json({ success: true, data: { match, settings: config } });
    }

    const cleanId = String(id).toLowerCase();
    const match = memoryStore.matches.find(
      m => m._id === id || m.matchId === id || (m.matchId && m.matchId.toLowerCase() === cleanId)
    );
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
