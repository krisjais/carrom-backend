const ChessPlayer = require('../models/ChessPlayer');
const ChessMatch = require('../models/ChessMatch');
const ChessSettings = require('../models/ChessSettings');

// Helper to get or create default settings
const getOrCreateSettings = async () => {
  let settings = await ChessSettings.findOne();
  if (!settings) {
    settings = await ChessSettings.create({
      tournamentName: 'Chess Championship 2026',
      tournamentTagline: 'Think ahead. Play smart. Finish strong.',
      matchDuration: 10,
      piecePoints: { pawn: 1, knight: 3, bishop: 3, rook: 5, queen: 9, king: 0 },
      tournamentPoints: { win: 3, draw: 1, loss: 0 },
      currentRound: 1,
      registrationOpen: true
    });
  }
  return settings;
};

// Calculate material points based on captured pieces and settings
const calculateMaterialScore = (captured, settings) => {
  if (!captured) return 0;
  const pts = settings.piecePoints || { pawn: 1, knight: 3, bishop: 3, rook: 5, queen: 9 };
  return (
    (captured.pawns || 0) * (pts.pawn || 1) +
    (captured.knights || 0) * (pts.knight || 3) +
    (captured.bishops || 0) * (pts.bishop || 3) +
    (captured.rooks || 0) * (pts.rook || 5) +
    (captured.queens || 0) * (pts.queen || 9)
  );
};

// Recalculate standings for all approved players
const recalculateStandings = async () => {
  const settings = await getOrCreateSettings();
  const players = await ChessPlayer.find({ status: 'approved' });

  for (const player of players) {
    const pMatches = await ChessMatch.find({
      $or: [{ player1: player._id }, { player2: player._id }],
      status: 'completed'
    });

    let matchesPlayed = pMatches.length;
    let wins = 0;
    let draws = 0;
    let losses = 0;
    let totalMaterialPoints = 0;

    for (const match of pMatches) {
      const isPlayer1 = match.player1.toString() === player._id.toString();
      if (isPlayer1) {
        totalMaterialPoints += match.player1MaterialScore || 0;
        if (match.winner === 'player1') wins++;
        else if (match.winner === 'draw') draws++;
        else if (match.winner === 'player2') losses++;
      } else {
        totalMaterialPoints += match.player2MaterialScore || 0;
        if (match.winner === 'player2') wins++;
        else if (match.winner === 'draw') draws++;
        else if (match.winner === 'player1') losses++;
      }
    }

    const tWin = settings.tournamentPoints?.win ?? 3;
    const tDraw = settings.tournamentPoints?.draw ?? 1;
    const tournamentPoints = (wins * tWin) + (draws * tDraw);

    player.matchesPlayed = matchesPlayed;
    player.wins = wins;
    player.draws = draws;
    player.losses = losses;
    player.materialPoints = totalMaterialPoints;
    player.tournamentPoints = tournamentPoints;
    await player.save();
  }

  // Rank players by tournamentPoints desc, then materialPoints desc, then wins desc
  const sorted = await ChessPlayer.find({ status: 'approved' }).sort({
    tournamentPoints: -1,
    materialPoints: -1,
    wins: -1,
    fullName: 1
  });

  for (let i = 0; i < sorted.length; i++) {
    sorted[i].rank = i + 1;
    await sorted[i].save();
  }
};

// -------------------------------------------------------------
// PUBLIC & REGISTRATION ENDPOINTS
// -------------------------------------------------------------

exports.getSettings = async (req, res, next) => {
  try {
    const settings = await getOrCreateSettings();
    const registeredCount = await ChessPlayer.countDocuments({ status: 'approved' });
    const matchesCount = await ChessMatch.countDocuments();
    
    res.json({
      success: true,
      data: {
        ...settings.toObject(),
        registeredCount,
        matchesCount
      }
    });
  } catch (err) {
    next(err);
  }
};

exports.registerPlayer = async (req, res, next) => {
  try {
    const { fullName, email, department } = req.body;

    if (!fullName || !email || !department) {
      return res.status(400).json({
        success: false,
        message: 'Full Name, Email, and Department are required.'
      });
    }

    const validDepts = ['First Year', 'Second Year', 'IT Team', 'MJ Team', 'HR Team'];
    if (!validDepts.includes(department)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid department selected.'
      });
    }

    const existing = await ChessPlayer.findOne({ email: email.toLowerCase() });
    if (existing) {
      return res.status(400).json({
        success: false,
        message: `Player with email ${email} is already registered.`
      });
    }

    const totalCount = await ChessPlayer.countDocuments();
    const playerId = `CHS-${String(totalCount + 1).padStart(3, '0')}`;

    const player = await ChessPlayer.create({
      playerId,
      fullName,
      email,
      department,
      status: 'pending'
    });

    res.status(201).json({
      success: true,
      message: 'Registration successful! Your application is pending admin approval.',
      data: player
    });
  } catch (err) {
    next(err);
  }
};

exports.getPlayers = async (req, res, next) => {
  try {
    const { department, search, status } = req.query;
    const filter = {};

    if (status) {
      filter.status = status;
    } else {
      filter.status = 'approved';
    }

    if (department && department !== 'all') {
      filter.department = department;
    }

    if (search) {
      filter.$or = [
        { fullName: { $regex: search, $options: 'i' } },
        { playerId: { $regex: search, $options: 'i' } },
        { department: { $regex: search, $options: 'i' } }
      ];
    }

    const players = await ChessPlayer.find(filter).sort({ rank: 1, tournamentPoints: -1, materialPoints: -1 });

    res.json({
      success: true,
      count: players.length,
      data: players
    });
  } catch (err) {
    next(err);
  }
};

exports.getPlayerById = async (req, res, next) => {
  try {
    const player = await ChessPlayer.findById(req.params.id);
    if (!player) {
      return res.status(404).json({ success: false, message: 'Player not found.' });
    }

    const matchHistory = await ChessMatch.find({
      $or: [{ player1: player._id }, { player2: player._id }]
    })
      .populate('player1', 'fullName playerId department')
      .populate('player2', 'fullName playerId department')
      .sort({ round: 1, createdAt: -1 });

    res.json({
      success: true,
      data: {
        player,
        matchHistory
      }
    });
  } catch (err) {
    next(err);
  }
};

// -------------------------------------------------------------
// MATCHES ENDPOINTS
// -------------------------------------------------------------

exports.getMatches = async (req, res, next) => {
  try {
    const { round, status, search } = req.query;
    const filter = {};

    if (round && round !== 'all') {
      filter.round = Number(round);
    }
    if (status && status !== 'all') {
      filter.status = status;
    }

    let matches = await ChessMatch.find(filter)
      .populate('player1', 'fullName playerId department rank')
      .populate('player2', 'fullName playerId department rank')
      .sort({ status: 1, round: 1, createdAt: 1 });

    if (search) {
      const q = search.toLowerCase();
      matches = matches.filter(
        (m) =>
          m.matchId.toLowerCase().includes(q) ||
          m.player1?.fullName.toLowerCase().includes(q) ||
          m.player2?.fullName.toLowerCase().includes(q) ||
          m.player1?.department.toLowerCase().includes(q) ||
          m.player2?.department.toLowerCase().includes(q)
      );
    }

    res.json({
      success: true,
      count: matches.length,
      data: matches
    });
  } catch (err) {
    next(err);
  }
};

exports.getMatchById = async (req, res, next) => {
  try {
    const settings = await getOrCreateSettings();
    const match = await ChessMatch.findById(req.params.id)
      .populate('player1')
      .populate('player2');

    if (!match) {
      return res.status(404).json({ success: false, message: 'Match not found.' });
    }

    res.json({
      success: true,
      data: {
        match,
        settings
      }
    });
  } catch (err) {
    next(err);
  }
};

// -------------------------------------------------------------
// STANDINGS ENDPOINTS
// -------------------------------------------------------------

exports.getStandings = async (req, res, next) => {
  try {
    await recalculateStandings();
    const { department, search } = req.query;
    const filter = { status: 'approved' };

    if (department && department !== 'all') {
      filter.department = department;
    }
    if (search) {
      filter.$or = [
        { fullName: { $regex: search, $options: 'i' } },
        { playerId: { $regex: search, $options: 'i' } }
      ];
    }

    const standings = await ChessPlayer.find(filter).sort({
      rank: 1,
      tournamentPoints: -1,
      materialPoints: -1,
      wins: -1
    });

    res.json({
      success: true,
      data: standings
    });
  } catch (err) {
    next(err);
  }
};

// -------------------------------------------------------------
// ADMIN MANAGEMENT ENDPOINTS
// -------------------------------------------------------------

exports.adminLogin = async (req, res, next) => {
  try {
    const { username, password } = req.body;
    
    // Simple admin validation for tournament management
    if (username === 'admin' && (password === 'admin123' || password === 'admin')) {
      return res.json({
        success: true,
        token: 'chess_admin_token_secret_2026',
        user: { name: 'Tournament Director', role: 'admin' }
      });
    }

    res.status(401).json({
      success: false,
      message: 'Invalid credentials. Use admin / admin123.'
    });
  } catch (err) {
    next(err);
  }
};

exports.getDashboardStats = async (req, res, next) => {
  try {
    const totalPlayers = await ChessPlayer.countDocuments();
    const pendingPlayers = await ChessPlayer.countDocuments({ status: 'pending' });
    const approvedPlayers = await ChessPlayer.countDocuments({ status: 'approved' });
    const totalMatches = await ChessMatch.countDocuments();
    const liveMatches = await ChessMatch.countDocuments({ status: 'live' });
    const completedMatches = await ChessMatch.countDocuments({ status: 'completed' });
    const settings = await getOrCreateSettings();

    res.json({
      success: true,
      data: {
        totalPlayers,
        pendingPlayers,
        approvedPlayers,
        totalMatches,
        liveMatches,
        completedMatches,
        currentRound: settings.currentRound,
        registrationOpen: settings.registrationOpen
      }
    });
  } catch (err) {
    next(err);
  }
};

exports.updateRegistrationStatus = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status, adminNotes } = req.body;

    if (!['approved', 'rejected', 'pending'].includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid status.' });
    }

    const player = await ChessPlayer.findById(id);
    if (!player) {
      return res.status(404).json({ success: false, message: 'Player not found.' });
    }

    player.status = status;
    if (adminNotes !== undefined) player.adminNotes = adminNotes;
    await player.save();

    await recalculateStandings();

    res.json({
      success: true,
      message: `Player ${player.fullName} registration marked as ${status}.`,
      data: player
    });
  } catch (err) {
    next(err);
  }
};

exports.updatePlayer = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { fullName, department } = req.body;

    const player = await ChessPlayer.findById(id);
    if (!player) {
      return res.status(404).json({ success: false, message: 'Player not found.' });
    }

    if (fullName) player.fullName = fullName;
    if (department) player.department = department;
    await player.save();

    res.json({
      success: true,
      message: 'Player updated successfully.',
      data: player
    });
  } catch (err) {
    next(err);
  }
};

exports.deletePlayer = async (req, res, next) => {
  try {
    const { id } = req.params;
    const player = await ChessPlayer.findById(id);
    if (!player) {
      return res.status(404).json({ success: false, message: 'Player not found.' });
    }

    await ChessMatch.deleteMany({
      $or: [{ player1: player._id }, { player2: player._id }]
    });

    await ChessPlayer.findByIdAndDelete(id);
    await recalculateStandings();

    res.json({
      success: true,
      message: 'Player and associated matches deleted successfully.'
    });
  } catch (err) {
    next(err);
  }
};

exports.generateMatches = async (req, res, next) => {
  try {
    const settings = await getOrCreateSettings();
    const approvedPlayers = await ChessPlayer.find({ status: 'approved' });

    if (approvedPlayers.length < 2) {
      return res.status(400).json({
        success: false,
        message: 'At least 2 approved players are required to generate fixtures.'
      });
    }

    const round = settings.currentRound || 1;

    // Check existing matches in current round
    const existingMatchesCount = await ChessMatch.countDocuments({ round });

    let createdMatches = [];
    const totalMatchCount = await ChessMatch.countDocuments();
    let mCounter = totalMatchCount + 1;

    // Round-robin or paired matching logic for approved players
    // Shuffle array for randomness if round 1
    const players = [...approvedPlayers];
    for (let i = 0; i < players.length; i += 2) {
      if (i + 1 < players.length) {
        const p1 = players[i];
        const p2 = players[i + 1];

        // Check if these two already played in current round
        const matchId = `CHS-M${String(mCounter).padStart(3, '0')}`;
        mCounter++;

        const newMatch = await ChessMatch.create({
          matchId,
          round,
          player1: p1._id,
          player2: p2._id,
          status: 'scheduled',
          scheduledTime: new Date(),
          durationMinutes: settings.matchDuration || 10
        });

        createdMatches.push(newMatch);
      }
    }

    res.json({
      success: true,
      message: `Generated ${createdMatches.length} matches for Round ${round}.`,
      data: createdMatches
    });
  } catch (err) {
    next(err);
  }
};

exports.startMatch = async (req, res, next) => {
  try {
    const match = await ChessMatch.findById(req.params.id);
    if (!match) {
      return res.status(404).json({ success: false, message: 'Match not found.' });
    }

    match.status = 'live';
    match.actualStartTime = new Date();
    await match.save();

    res.json({
      success: true,
      message: 'Match started!',
      data: match
    });
  } catch (err) {
    next(err);
  }
};

exports.submitMatchResult = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { player1Captured, player2Captured, winner, resultType, notes } = req.body;

    const settings = await getOrCreateSettings();
    const match = await ChessMatch.findById(id);
    if (!match) {
      return res.status(404).json({ success: false, message: 'Match not found.' });
    }

    if (player1Captured) match.player1Captured = player1Captured;
    if (player2Captured) match.player2Captured = player2Captured;

    match.player1MaterialScore = calculateMaterialScore(match.player1Captured, settings);
    match.player2MaterialScore = calculateMaterialScore(match.player2Captured, settings);

    match.winner = winner || 'none';
    match.resultType = resultType || 'points';
    if (notes !== undefined) match.notes = notes;
    match.status = 'completed';
    match.actualEndTime = new Date();

    await match.save();
    await recalculateStandings();

    res.json({
      success: true,
      message: 'Match result submitted and standings updated!',
      data: match
    });
  } catch (err) {
    next(err);
  }
};

exports.overrideMatchResult = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { winner, notes } = req.body;

    const match = await ChessMatch.findById(id);
    if (!match) {
      return res.status(404).json({ success: false, message: 'Match not found.' });
    }

    match.winner = winner;
    match.resultType = 'override';
    if (notes) match.notes = notes;
    match.status = 'completed';
    await match.save();

    await recalculateStandings();

    res.json({
      success: true,
      message: 'Match result overridden successfully.',
      data: match
    });
  } catch (err) {
    next(err);
  }
};

exports.cancelMatch = async (req, res, next) => {
  try {
    const match = await ChessMatch.findById(req.params.id);
    if (!match) {
      return res.status(404).json({ success: false, message: 'Match not found.' });
    }

    match.status = 'cancelled';
    await match.save();

    res.json({
      success: true,
      message: 'Match cancelled.',
      data: match
    });
  } catch (err) {
    next(err);
  }
};

exports.updateSettings = async (req, res, next) => {
  try {
    const { matchDuration, piecePoints, tournamentPoints, currentRound, registrationOpen } = req.body;

    let settings = await getOrCreateSettings();

    if (matchDuration !== undefined) settings.matchDuration = matchDuration;
    if (piecePoints) settings.piecePoints = { ...settings.piecePoints, ...piecePoints };
    if (tournamentPoints) settings.tournamentPoints = { ...settings.tournamentPoints, ...tournamentPoints };
    if (currentRound !== undefined) settings.currentRound = currentRound;
    if (registrationOpen !== undefined) settings.registrationOpen = registrationOpen;

    await settings.save();
    await recalculateStandings();

    res.json({
      success: true,
      message: 'Tournament settings updated successfully.',
      data: settings
    });
  } catch (err) {
    next(err);
  }
};

exports.refreshStandings = async (req, res, next) => {
  try {
    await recalculateStandings();
    const standings = await ChessPlayer.find({ status: 'approved' }).sort({
      rank: 1,
      tournamentPoints: -1,
      materialPoints: -1
    });

    res.json({
      success: true,
      message: 'Standings refreshed and recalculated.',
      data: standings
    });
  } catch (err) {
    next(err);
  }
};
