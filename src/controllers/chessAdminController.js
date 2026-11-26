const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const ChessPlayer = require('../models/ChessPlayer');
const ChessMatch = require('../models/ChessMatch');
const ChessRound = require('../models/ChessRound');
const ChessConfiguration = require('../models/ChessConfiguration');
const ChessStandings = require('../models/ChessStandings');
const memoryStore = require('../utils/chessMemoryDb');
const { getConfiguration } = require('../services/scoringService');
const { generateRoundPairings } = require('../services/pairingService');
const { submitResult, overrideResult, startMatch, cancelMatch, createManualMatch, updateLiveCaptures } = require('../services/matchService');
const { recalculateAllStandings } = require('../services/standingsService');
const { emitMatchUpdate, emitChessLive } = require('../socket');

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
      const enriched = players.map((p) => {
        const obj = p.toObject ? p.toObject() : { ...p };
        if (!obj.plainPassword) {
          obj.plainPassword = obj.playerId ? `${obj.playerId.toLowerCase()}` : 'chess123';
        }
        return obj;
      });
      return res.json({ success: true, count: enriched.length, data: enriched });
    }

    let players = [...memoryStore.players];
    if (status && status !== 'all') players = players.filter(p => p.status === status);
    if (department && department !== 'all') players = players.filter(p => p.department === department);
    if (search) {
      const q = search.toLowerCase();
      players = players.filter(p => p.fullName.toLowerCase().includes(q) || p.playerId.toLowerCase().includes(q));
    }

    const enrichedMem = players.map((p) => {
      const obj = { ...p };
      if (!obj.plainPassword) {
        obj.plainPassword = obj.playerId ? `${obj.playerId.toLowerCase()}` : 'chess123';
      }
      return obj;
    });

    res.json({ success: true, count: enrichedMem.length, data: enrichedMem });
  } catch (err) {
    next(err);
  }
};

// Admin Update Player (PATCH/PUT)
exports.updatePlayer = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { fullName, email, department, status, phone, adminNotes, password, newPassword, plainPassword } = req.body;
    const rawPassword = (newPassword || password || plainPassword || '').trim();
    const cleanEmail = email !== undefined ? String(email).toLowerCase().trim() : undefined;

    if (isDbConnected()) {
      const player = mongoose.Types.ObjectId.isValid(id)
        ? await ChessPlayer.findById(id)
        : await ChessPlayer.findOne({ playerId: id });
      if (!player) {
        return res.status(404).json({ success: false, message: 'Player not found.' });
      }

      if (cleanEmail !== undefined && cleanEmail.length > 0 && cleanEmail !== player.email) {
        const duplicateEmail = await ChessPlayer.findOne({
          email: cleanEmail,
          _id: { $ne: player._id }
        });
        if (duplicateEmail) {
          return res.status(400).json({
            success: false,
            message: `Another player (${duplicateEmail.fullName}) already uses ${cleanEmail}.`
          });
        }
        player.email = cleanEmail;
      }

      if (fullName && fullName.trim()) player.fullName = fullName.replace(/\s+/g, ' ').trim();
      if (department && department.trim()) player.department = department.trim();
      if (phone !== undefined) player.phone = String(phone).trim();
      if (adminNotes !== undefined) player.adminNotes = adminNotes;
      if (rawPassword) {
        player.password = rawPassword;
        player.plainPassword = rawPassword;
      }

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
        message: rawPassword && !fullName && cleanEmail === undefined && !department
          ? `Password for ${player.fullName} updated successfully to '${rawPassword}'.`
          : `Player ${player.fullName} updated successfully.`,
        data: player
      });
    }

    const player = memoryStore.players.find(p => p._id === id || p.playerId === id);
    if (!player) {
      return res.status(404).json({ success: false, message: 'Player not found.' });
    }

    if (cleanEmail !== undefined && cleanEmail.length > 0 && cleanEmail !== player.email) {
      const duplicateEmail = memoryStore.players.find(
        p => p.email === cleanEmail && p._id !== player._id
      );
      if (duplicateEmail) {
        return res.status(400).json({
          success: false,
          message: `Another player (${duplicateEmail.fullName}) already uses ${cleanEmail}.`
        });
      }
      player.email = cleanEmail;
    }

    if (fullName && fullName.trim()) player.fullName = fullName.replace(/\s+/g, ' ').trim();
    if (department && department.trim()) player.department = department.trim();
    if (phone !== undefined) player.phone = String(phone).trim();
    if (adminNotes !== undefined) player.adminNotes = adminNotes;
    if (rawPassword) {
      const salt = bcrypt.genSaltSync(10);
      player.password = bcrypt.hashSync(rawPassword, salt);
      player.plainPassword = rawPassword;
    }
    if (status) {
      if (status === 'approved') player.status = 'Approved';
      else if (status === 'rejected') player.status = 'Rejected';
      else if (status === 'pending') player.status = 'Registered';
      else player.status = status;
    }

    await recalculateAllStandings();

    res.json({
      success: true,
      message: rawPassword && !fullName && cleanEmail === undefined && !department
        ? `Password for ${player.fullName} updated successfully to '${rawPassword}'.`
        : `Player ${player.fullName} updated successfully.`,
      data: player
    });
  } catch (err) {
    if (err.name === 'ValidationError' || err.code === 11000) {
      return res.status(400).json({ success: false, message: err.message });
    }
    next(err);
  }
};

// Admin Create / Add Player Directly
exports.createPlayer = async (req, res, next) => {
  try {
    const { fullName, email, phone, department, status, password, plainPassword } = req.body;

    if (!fullName || !department) {
      return res.status(400).json({
        success: false,
        message: 'Full Name and Department are required.'
      });
    }

    const cleanName = fullName.replace(/\s+/g, ' ').trim();
    const cleanDept = department.trim();
    const cleanPhone = phone ? phone.trim() : '';
    let targetStatus = status || 'Approved';
    const initPassword = (password || plainPassword || 'chess123').trim();

    if (isDbConnected()) {
      const totalCount = await ChessPlayer.countDocuments();
      let playerId = `CHS-${String(totalCount + 1).padStart(3, '0')}`;
      let candidateEmail = email ? email.toLowerCase().trim() : `${cleanName.toLowerCase().replace(/[^a-z0-9]/g, '')}_${Date.now().toString().slice(-4)}@tournament.local`;

      if (email) {
        const existing = await ChessPlayer.findOne({ email: candidateEmail });
        if (existing) {
          return res.status(400).json({
            success: false,
            message: `A player with email ${email} already exists.`
          });
        }
      }

      let existsId = await ChessPlayer.findOne({ playerId });
      let counter = totalCount + 1;
      while (existsId) {
        counter++;
        playerId = `CHS-${String(counter).padStart(3, '0')}`;
        existsId = await ChessPlayer.findOne({ playerId });
      }

      const player = await ChessPlayer.create({
        playerId,
        fullName: cleanName,
        email: candidateEmail,
        password: initPassword,
        plainPassword: initPassword,
        phone: cleanPhone,
        department: cleanDept,
        status: targetStatus
      });

      await recalculateAllStandings();

      return res.status(201).json({
        success: true,
        message: `Player ${player.fullName} added successfully with ID ${player.playerId}.`,
        data: player
      });
    }

    // In-Memory Fallback
    const totalCount = memoryStore.players.length;
    let playerId = `CHS-${String(totalCount + 1).padStart(3, '0')}`;
    let candidateEmail = email ? email.toLowerCase().trim() : `${cleanName.toLowerCase().replace(/[^a-z0-9]/g, '')}_${Date.now().toString().slice(-4)}@tournament.local`;
    const salt = bcrypt.genSaltSync(10);

    const newPlayer = {
      _id: `player_mem_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
      playerId,
      fullName: cleanName,
      email: candidateEmail,
      password: bcrypt.hashSync(initPassword, salt),
      plainPassword: initPassword,
      phone: cleanPhone,
      department: cleanDept,
      status: targetStatus,
      tournamentPoints: 0,
      materialPoints: 0,
      matchesPlayed: 0,
      wins: 0,
      draws: 0,
      losses: 0,
      createdAt: new Date()
    };

    memoryStore.players.push(newPlayer);
    await recalculateAllStandings();

    res.status(201).json({
      success: true,
      message: `Player ${newPlayer.fullName} added successfully with ID ${newPlayer.playerId}.`,
      data: newPlayer
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

// Admin Delete Round (Deletes all fixtures in specified round by number or name)
exports.deleteRound = async (req, res, next) => {
  try {
    const roundParam = req.params.round;
    const roundNum = parseInt(roundParam, 10);
    const roundName = req.query.roundName || req.body?.roundName;

    // Build query matching round number, roundName, or stageName
    const orConditions = [];

    if (!isNaN(roundNum) && roundNum > 0) {
      orConditions.push({ round: roundNum });
    }
    if (roundName && typeof roundName === 'string' && roundName.trim()) {
      const escaped = roundName.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      orConditions.push({ roundName: new RegExp(`^${escaped}$`, 'i') });
      orConditions.push({ stageName: new RegExp(`^${escaped}$`, 'i') });
    }
    if (isNaN(roundNum) && roundParam && roundParam !== 'undefined') {
      const escaped = roundParam.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      orConditions.push({ roundName: new RegExp(`^${escaped}$`, 'i') });
      orConditions.push({ stageName: new RegExp(`^${escaped}$`, 'i') });
    }

    if (orConditions.length === 0) {
      return res.status(400).json({ success: false, message: 'Invalid round specified for deletion.' });
    }

    const query = orConditions.length === 1 ? orConditions[0] : { $or: orConditions };

    let deletedCount = 0;
    if (isDbConnected()) {
      const deleteRes = await ChessMatch.deleteMany(query);
      deletedCount = deleteRes.deletedCount || 0;
      if (!isNaN(roundNum) && roundNum > 0) {
        await ChessRound.deleteOne({ roundNumber: roundNum });
      }
      await recalculateAllStandings();
      emitChessLive('chess:matches_generated', null);

      const targetLabel = roundName || (!isNaN(roundNum) ? `Round ${roundNum}` : roundParam);
      return res.json({
        success: true,
        message: `${targetLabel} and its ${deletedCount} match(es) were deleted successfully.`,
        data: { round: roundNum || roundParam, deletedCount }
      });
    }

    // Memory store fallback
    const initialLen = memoryStore.matches.length;
    memoryStore.matches = memoryStore.matches.filter(m => {
      const matchNum = !isNaN(roundNum) && m.round === roundNum;
      const matchName = roundName && (m.roundName || '').toLowerCase() === roundName.trim().toLowerCase();
      const matchParam = isNaN(roundNum) && (m.roundName || '').toLowerCase() === roundParam.trim().toLowerCase();
      return !(matchNum || matchName || matchParam);
    });
    deletedCount = initialLen - memoryStore.matches.length;
    if (!isNaN(roundNum)) {
      memoryStore.rounds = memoryStore.rounds.filter(r => r.roundNumber !== roundNum);
    }
    await recalculateAllStandings();
    emitChessLive('chess:matches_generated', null);

    const targetLabel = roundName || (!isNaN(roundNum) ? `Round ${roundNum}` : roundParam);
    res.json({
      success: true,
      message: `${targetLabel} and its ${deletedCount} match(es) were deleted successfully.`,
      data: { round: roundNum || roundParam, deletedCount }
    });
  } catch (err) {
    next(err);
  }
};

// Admin Reschedule Round (Resets clocks and status to scheduled for all matches in a round)
exports.rescheduleRound = async (req, res, next) => {
  try {
    const roundParam = req.params.round;
    const { scheduledTime, durationMinutes } = req.body || {};
    const roundNum = parseInt(roundParam, 10);

    let updatedMatches = [];
    if (isDbConnected()) {
      const query = !isNaN(roundNum) ? { round: roundNum } : { stageName: roundParam };
      const matches = await ChessMatch.find(query).populate('player1').populate('player2');

      for (const match of matches) {
        if (match.isBye) continue;
        const initialSec = (durationMinutes || match.durationMinutes || 10) * 60;
        match.status = 'scheduled';
        match.winner = null;
        match.winnerPlayer = null;
        match.resultType = null;
        match.activeTurn = 'white';
        match.isClockRunning = false;
        match.whiteTimeRemaining = initialSec;
        match.blackTimeRemaining = initialSec;
        match.movesCount = 0;
        match.lastClockUpdate = new Date();
        match.player1Score = 0;
        match.player2Score = 0;
        match.capturedPieces = { white: [], black: [] };
        if (scheduledTime) match.scheduledTime = new Date(scheduledTime);
        if (durationMinutes) match.durationMinutes = durationMinutes;
        await match.save();
        updatedMatches.push(match);

        emitMatchUpdate(match._id, 'chess:match_restarted', match);
        emitMatchUpdate(match._id, 'chess:clock_updated', match);
      }
    } else {
      const matches = memoryStore.matches.filter(m => (!isNaN(roundNum) ? m.round === roundNum : m.stageName === roundParam));
      for (const match of matches) {
        if (match.isBye) continue;
        const initialSec = (durationMinutes || match.durationMinutes || 10) * 60;
        match.status = 'scheduled';
        match.winner = null;
        match.winnerPlayer = null;
        match.resultType = null;
        match.activeTurn = 'white';
        match.isClockRunning = false;
        match.whiteTimeRemaining = initialSec;
        match.blackTimeRemaining = initialSec;
        match.movesCount = 0;
        match.lastClockUpdate = new Date();
        match.player1Score = 0;
        match.player2Score = 0;
        match.capturedPieces = { white: [], black: [] };
        if (scheduledTime) match.scheduledTime = new Date(scheduledTime);
        if (durationMinutes) match.durationMinutes = durationMinutes;
        updatedMatches.push(match);

        emitMatchUpdate(match._id, 'chess:match_restarted', match);
        emitMatchUpdate(match._id, 'chess:clock_updated', match);
      }
    }

    emitChessLive('chess:matches_updated', updatedMatches);

    return res.json({
      success: true,
      message: `Round ${roundParam} matches rescheduled successfully (${updatedMatches.length} match${updatedMatches.length !== 1 ? 'es' : ''} reset).`,
      count: updatedMatches.length,
      data: updatedMatches
    });
  } catch (err) {
    next(err);
  }
};

// Admin Delete All Rounds (Wipes all matches and rounds, resets scores, keeps players)
exports.deleteAllRounds = async (req, res, next) => {
  try {
    let deletedMatches = 0;
    let deletedRounds = 0;

    if (isDbConnected()) {
      const matchRes = await ChessMatch.deleteMany({});
      deletedMatches = matchRes.deletedCount || 0;
      const roundRes = await ChessRound.deleteMany({});
      deletedRounds = roundRes.deletedCount || 0;

      // Reset all players stats
      await ChessPlayer.updateMany({}, {
        $set: {
          matchesPlayed: 0,
          wins: 0,
          draws: 0,
          losses: 0,
          byes: 0,
          materialPoints: 0,
          tournamentPoints: 0,
          tieBreakScore: 0,
          rank: 0
        }
      });

      let config = await ChessConfiguration.findOne();
      if (config) {
        config.currentRound = 1;
        await config.save();
      }

      await recalculateAllStandings();

      return res.json({
        success: true,
        message: `All ${deletedMatches} match(es) and ${deletedRounds} round(s) deleted successfully. Tournament reset to Round 1.`,
        data: { deletedMatches, deletedRounds }
      });
    }

    deletedMatches = memoryStore.matches.length;
    deletedRounds = memoryStore.rounds.length;
    memoryStore.matches = [];
    memoryStore.rounds = [];
    memoryStore.players.forEach(p => {
      p.matchesPlayed = 0;
      p.wins = 0;
      p.draws = 0;
      p.losses = 0;
      p.byes = 0;
      p.materialPoints = 0;
      p.tournamentPoints = 0;
      p.tieBreakScore = 0;
      p.rank = 0;
    });
    memoryStore.configuration.currentRound = 1;
    await recalculateAllStandings();

    res.json({
      success: true,
      message: `All ${deletedMatches} match(es) and ${deletedRounds} round(s) deleted successfully. Tournament reset to Round 1.`,
      data: { deletedMatches, deletedRounds }
    });
  } catch (err) {
    next(err);
  }
};

// Admin Bulk Update Player Status
exports.bulkUpdatePlayerStatus = async (req, res, next) => {
  try {
    const { ids, status } = req.body;
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ success: false, message: 'Player IDs array is required.' });
    }

    let targetStatus = 'Approved';
    if (status === 'approved' || status === 'Approved') targetStatus = 'Approved';
    else if (status === 'rejected' || status === 'Rejected') targetStatus = 'Rejected';
    else if (status === 'pending' || status === 'Registered') targetStatus = 'Registered';
    else if (status) targetStatus = status;

    if (isDbConnected()) {
      await ChessPlayer.updateMany(
        { _id: { $in: ids } },
        { $set: { status: targetStatus } }
      );
      await recalculateAllStandings();

      return res.json({
        success: true,
        message: `Updated status to ${targetStatus} for ${ids.length} player(s).`
      });
    }

    ids.forEach(id => {
      const player = memoryStore.players.find(p => p._id === id || p.playerId === id);
      if (player) player.status = targetStatus;
    });
    await recalculateAllStandings();

    res.json({
      success: true,
      message: `Updated status to ${targetStatus} for ${ids.length} player(s).`
    });
  } catch (err) {
    next(err);
  }
};

// Admin Bulk Delete Players
exports.bulkDeletePlayers = async (req, res, next) => {
  try {
    const { ids } = req.body;
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ success: false, message: 'Player IDs array is required.' });
    }

    if (isDbConnected()) {
      await ChessMatch.deleteMany({
        $or: [{ player1: { $in: ids } }, { player2: { $in: ids } }]
      });
      await ChessPlayer.deleteMany({ _id: { $in: ids } });
      await recalculateAllStandings();

      return res.json({
        success: true,
        message: `Successfully deleted ${ids.length} player(s).`
      });
    }

    memoryStore.players = memoryStore.players.filter(p => !ids.includes(p._id) && !ids.includes(p.playerId));
    await recalculateAllStandings();

    res.json({
      success: true,
      message: `Successfully deleted ${ids.length} player(s).`
    });
  } catch (err) {
    next(err);
  }
};

// Helper for department normalization
const normalizeDepartment = (dept) => {
  if (!dept) return 'IT Team';
  const clean = dept.toString().trim().toLowerCase();
  if (clean.includes('staff') || clean.includes('faculty') || clean.includes('teacher') || clean.includes('prof')) return 'Staff';
  if (clean.includes('first') || clean.includes('fe') || clean.includes('1st') || clean.includes('fy')) return 'First Year';
  if (clean.includes('second') || clean.includes('se') || clean.includes('2nd') || clean.includes('sy')) return 'Second Year';
  if (clean.includes('it') || clean.includes('tech') || clean.includes('comp') || clean.includes('cs') || clean.includes('inf')) return 'IT Team';
  if (clean.includes('mj') || clean.includes('media') || clean.includes('manage')) return 'MJ Team';
  if (clean.includes('hr') || clean.includes('human') || clean.includes('resource')) return 'HR Team';
  return 'IT Team';
};

// Admin Bulk Import Players from CSV
exports.importChessPlayers = async (req, res, next) => {
  try {
    const { players: rawPlayers, defaultStatus } = req.body;
    if (!rawPlayers || !Array.isArray(rawPlayers) || rawPlayers.length === 0) {
      return res.status(400).json({ success: false, message: 'No player data provided for import.' });
    }

    const imported = [];
    const skipped = [];
    const errors = [];

    const targetDefaultStatus = (defaultStatus === 'Approved' || defaultStatus === 'approved') ? 'Approved' : 'Registered';

    if (isDbConnected()) {
      const existingPlayers = await ChessPlayer.find().select('email playerId');
      const existingEmails = new Set(existingPlayers.map(p => p.email.toLowerCase()));
      let currentMaxCount = existingPlayers.length;

      for (let i = 0; i < rawPlayers.length; i++) {
        const item = rawPlayers[i];
        const rowNum = i + 1;
        const fullName = (item.fullName || item.name || item.player || item.playerName || '').trim();
        const email = (item.email || item.emailAddress || '').trim().toLowerCase();
        const rawDept = item.department || item.dept || item.branch || item.team || '';
        const phone = (item.phone || item.mobile || item.contact || '').trim();
        const status = targetDefaultStatus;

        if (!fullName) {
          errors.push({ row: rowNum, reason: 'Full Name is required.' });
          continue;
        }

        // Generate synthetic email if empty
        const finalEmail = email || `${fullName.toLowerCase().replace(/[^a-z0-9]/g, '')}_${Date.now()}_${i}@chess.edu`;

        if (existingEmails.has(finalEmail)) {
          skipped.push({ row: rowNum, name: fullName, email: finalEmail, reason: 'Duplicate email already exists.' });
          continue;
        }

        currentMaxCount++;
        const playerId = `CHS-${String(currentMaxCount).padStart(3, '0')}`;
        const department = normalizeDepartment(rawDept);
        const playerPassword = (item.password || item.plainPassword || 'chess123').trim();

        try {
          const newDoc = await ChessPlayer.create({
            playerId,
            fullName,
            email: finalEmail,
            password: playerPassword,
            plainPassword: playerPassword,
            phone,
            department,
            status: targetDefaultStatus,
            matchesPlayed: 0,
            wins: 0,
            draws: 0,
            losses: 0,
            byes: 0,
            materialPoints: 0,
            tournamentPoints: 0,
            tieBreakScore: 0,
            rank: currentMaxCount
          });

          existingEmails.add(finalEmail);
          imported.push(newDoc);
        } catch (saveErr) {
          errors.push({ row: rowNum, name: fullName, reason: saveErr.message });
        }
      }

      await recalculateAllStandings();

      return res.json({
        success: true,
        message: `Imported ${imported.length} player(s) as ${targetDefaultStatus}. ${skipped.length} skipped, ${errors.length} failed.`,
        data: {
          importedCount: imported.length,
          skippedCount: skipped.length,
          errorCount: errors.length,
          imported,
          skipped,
          errors
        }
      });
    }

    // In-memory fallback
    const existingEmails = new Set(memoryStore.players.map(p => p.email.toLowerCase()));
    let currentMaxCount = memoryStore.players.length;

    for (let i = 0; i < rawPlayers.length; i++) {
      const item = rawPlayers[i];
      const rowNum = i + 1;
      const fullName = (item.fullName || item.name || item.player || item.playerName || '').trim();
      const email = (item.email || item.emailAddress || '').trim().toLowerCase();
      const rawDept = item.department || item.dept || item.branch || item.team || '';
      const phone = (item.phone || item.mobile || item.contact || '').trim();
      const status = targetDefaultStatus;

      if (!fullName) {
        errors.push({ row: rowNum, reason: 'Full Name is required.' });
        continue;
      }

      const finalEmail = email || `${fullName.toLowerCase().replace(/[^a-z0-9]/g, '')}_${Date.now()}_${i}@chess.edu`;

      if (existingEmails.has(finalEmail)) {
        skipped.push({ row: rowNum, name: fullName, email: finalEmail, reason: 'Duplicate email already exists.' });
        continue;
      }

      currentMaxCount++;
      const playerId = `CHS-${String(currentMaxCount).padStart(3, '0')}`;
      const department = normalizeDepartment(rawDept);
      const playerPassword = (item.password || item.plainPassword || 'chess123').trim();
      const salt = bcrypt.genSaltSync(10);

      const newPlayer = {
        _id: `mem_p_${Date.now()}_${i}`,
        playerId,
        fullName,
        email: finalEmail,
        password: bcrypt.hashSync(playerPassword, salt),
        plainPassword: playerPassword,
        phone,
        department,
        status: targetDefaultStatus,
        matchesPlayed: 0,
        wins: 0,
        draws: 0,
        losses: 0,
        byes: 0,
        materialPoints: 0,
        tournamentPoints: 0,
        tieBreakScore: 0,
        rank: currentMaxCount
      };

      memoryStore.players.push(newPlayer);
      existingEmails.add(finalEmail);
      imported.push(newPlayer);
    }

    await recalculateAllStandings();

    res.json({
      success: true,
      message: `Imported ${imported.length} player(s). ${skipped.length} skipped, ${errors.length} failed.`,
      data: {
        importedCount: imported.length,
        skippedCount: skipped.length,
        errorCount: errors.length,
        imported,
        skipped,
        errors
      }
    });
  } catch (err) {
    next(err);
  }
};

exports.importPlayers = exports.importChessPlayers;

// Admin Generate Matches
exports.generateMatches = async (req, res, next) => {
  try {
    const { round, roundName } = req.body || {};
    const matches = await generateRoundPairings(round, roundName);

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
        .sort({ round: 1, createdAt: 1 })
        .lean();

      // Compute dynamic up-to-the-second clock for running live matches
      const dynamicMatches = matches.map((m) => {
        if (m.status === 'live' && m.isClockRunning !== false && m.lastClockUpdate) {
          const elapsed = Math.max(0, Math.floor((Date.now() - new Date(m.lastClockUpdate).getTime()) / 1000));
          const turn = m.activeTurn && m.activeTurn !== 'none' ? m.activeTurn : 'white';
          if (turn === 'white' && typeof m.whiteTimeRemaining === 'number') {
            m.whiteTimeRemaining = Math.max(0, m.whiteTimeRemaining - elapsed);
          } else if (turn === 'black' && typeof m.blackTimeRemaining === 'number') {
            m.blackTimeRemaining = Math.max(0, m.blackTimeRemaining - elapsed);
          }
        }
        return m;
      });

      return res.json({ success: true, count: dynamicMatches.length, data: dynamicMatches });
    }

    let matches = [...memoryStore.matches];
    if (round && round !== 'all') matches = matches.filter(m => m.round === Number(round));
    if (status && status !== 'all') matches = matches.filter(m => m.status === status);

    const dynamicMemoryMatches = matches.map((m) => {
      const doc = { ...m };
      if (typeof doc.player1 === 'string' && Array.isArray(memoryStore.players)) {
        doc.player1 = memoryStore.players.find((p) => p._id === doc.player1 || p.playerId === doc.player1) || { fullName: doc.player1 };
      }
      if (typeof doc.player2 === 'string' && Array.isArray(memoryStore.players)) {
        doc.player2 = memoryStore.players.find((p) => p._id === doc.player2 || p.playerId === doc.player2) || { fullName: doc.player2 };
      }
      if (doc.status === 'live' && doc.isClockRunning !== false && doc.lastClockUpdate) {
        const elapsed = Math.max(0, Math.floor((Date.now() - new Date(doc.lastClockUpdate).getTime()) / 1000));
        const turn = doc.activeTurn && doc.activeTurn !== 'none' ? doc.activeTurn : 'white';
        if (turn === 'white' && typeof doc.whiteTimeRemaining === 'number') {
          doc.whiteTimeRemaining = Math.max(0, doc.whiteTimeRemaining - elapsed);
        } else if (turn === 'black' && typeof doc.blackTimeRemaining === 'number') {
          doc.blackTimeRemaining = Math.max(0, doc.blackTimeRemaining - elapsed);
        }
      }
      return doc;
    });

    res.json({ success: true, count: dynamicMemoryMatches.length, data: dynamicMemoryMatches });
  } catch (err) {
    next(err);
  }
};

// Admin Explicit Start Match (POST /admin/matches/:id/start)
exports.startMatch = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { boardNumber, boardName } = req.body || {};
    const match = await startMatch(id, boardNumber, boardName);

    emitMatchUpdate(id, 'chess:match_started', match);
    emitChessLive('chess:match_started', match);

    return res.json({
      success: true,
      message: `Match started successfully on ${match.boardName || `Board #${match.boardNumber || 1}`}.`,
      data: match
    });
  } catch (err) {
    next(err);
  }
};

// Admin Create Manual Match Pairing (POST /admin/matches)
exports.createMatch = async (req, res, next) => {
  try {
    const match = await createManualMatch(req.body);
    emitChessLive('chess:matches_generated', match);

    return res.status(201).json({
      success: true,
      message: 'Manual match pairing created successfully.',
      data: match
    });
  } catch (err) {
    next(err);
  }
};

// Admin Update Match Status / Start Match / Restart Match / Reschedule Match (PATCH/PUT/POST)
exports.updateMatch = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status, action, scheduledTime, boardNumber, venue, durationMinutes, notes } = req.body || {};

    const isRestart = action === 'restart' || action === 'reset' || (req.path && req.path.endsWith('/restart')) || (req.originalUrl && req.originalUrl.includes('/restart'));
    const isReschedule = action === 'reschedule' || (req.path && req.path.endsWith('/reschedule')) || (req.originalUrl && req.originalUrl.includes('/reschedule'));

    if (isRestart || isReschedule) {
      let match;
      if (isDbConnected()) {
        match = await ChessMatch.findById(id).populate('player1').populate('player2');
        if (!match) return res.status(404).json({ success: false, message: 'Match not found.' });

        const initialSec = (durationMinutes || match.durationMinutes || 10) * 60;
        match.status = 'scheduled';
        match.winner = null;
        match.winnerPlayer = null;
        match.resultType = null;
        match.activeTurn = 'white';
        match.isClockRunning = false;
        match.whiteTimeRemaining = initialSec;
        match.blackTimeRemaining = initialSec;
        match.movesCount = 0;
        match.lastClockUpdate = new Date();
        match.player1Score = 0;
        match.player2Score = 0;
        match.capturedPieces = { white: [], black: [] };
        if (scheduledTime) match.scheduledTime = new Date(scheduledTime);
        if (boardNumber !== undefined && boardNumber !== '') match.boardNumber = boardNumber;
        if (venue !== undefined) match.venue = venue;
        if (durationMinutes) match.durationMinutes = durationMinutes;
        if (notes !== undefined) match.notes = notes;
        await match.save();
      } else {
        match = memoryStore.matches.find(m => m._id === id || m.matchId === id);
        if (!match) return res.status(404).json({ success: false, message: 'Match not found.' });

        const initialSec = (durationMinutes || match.durationMinutes || 10) * 60;
        match.status = 'scheduled';
        match.winner = null;
        match.winnerPlayer = null;
        match.resultType = null;
        match.activeTurn = 'white';
        match.isClockRunning = false;
        match.whiteTimeRemaining = initialSec;
        match.blackTimeRemaining = initialSec;
        match.movesCount = 0;
        match.lastClockUpdate = new Date();
        match.player1Score = 0;
        match.player2Score = 0;
        match.capturedPieces = { white: [], black: [] };
        if (scheduledTime) match.scheduledTime = new Date(scheduledTime);
        if (boardNumber !== undefined && boardNumber !== '') match.boardNumber = boardNumber;
        if (venue !== undefined) match.venue = venue;
        if (durationMinutes) match.durationMinutes = durationMinutes;
        if (notes !== undefined) match.notes = notes;
      }

      emitMatchUpdate(id, 'chess:match_restarted', match);
      emitMatchUpdate(id, 'chess:match_rescheduled', match);
      emitMatchUpdate(id, 'chess:clock_updated', match);
      emitChessLive('chess:match_updated', match);

      const actionMsg = isReschedule ? 'rescheduled' : 'restarted';
      return res.json({
        success: true,
        message: `Match #${match.matchNumber || match.matchId} ${actionMsg} successfully. Clocks reset to initial duration.`,
        data: match
      });
    }

    const isStart = action === 'start' || status === 'live' || (req.path && req.path.endsWith('/start')) || (req.originalUrl && req.originalUrl.includes('/start'));
    if (isStart) {
      const match = await startMatch(id, boardNumber, req.body?.boardName);
      emitMatchUpdate(id, 'chess:match_started', match);
      emitChessLive('chess:match_started', match);

      return res.json({
        success: true,
        message: 'Match started.',
        data: match
      });
    }

    if (action === 'cancel' || status === 'cancelled') {
      const match = await cancelMatch(id);
      emitMatchUpdate(id, 'chess:match_cancelled', match);
      emitChessLive('chess:match_cancelled', match);

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

      emitMatchUpdate(id, 'chess:match_updated', match);
      emitChessLive('chess:match_updated', match);

      return res.json({ success: true, message: 'Match updated.', data: match });
    }

    const match = memoryStore.matches.find(m => m._id === id || m.matchId === id);
    if (!match) {
      return res.status(404).json({ success: false, message: 'Match not found.' });
    }
    if (status) match.status = status;

    emitMatchUpdate(id, 'chess:match_updated', match);
    emitChessLive('chess:match_updated', match);

    res.json({ success: true, message: 'Match updated.', data: match });
  } catch (err) {
    next(err);
  }
};

// Admin Live In-Game Piece Captures Update (PUT /admin/matches/:id/live-score)
exports.updateLiveCaptures = async (req, res, next) => {
  try {
    const { id } = req.params;
    const match = await updateLiveCaptures(id, req.body);

    emitMatchUpdate(id, 'chess:score_updated', match);
    emitChessLive('chess:match_updated', match);

    return res.json({
      success: true,
      message: 'Live material score updated.',
      data: match
    });
  } catch (err) {
    next(err);
  }
};

// Admin Submit / Enter Match Result (POST/PUT)
exports.submitMatchResult = async (req, res, next) => {
  try {
    const { id } = req.params;
    const match = await submitResult(id, req.body);

    emitMatchUpdate(id, 'chess:match_completed', match);
    emitChessLive('chess:match_completed', match);

    res.json({
      success: true,
      message: 'Match result submitted and standings updated.',
      data: match
    });
  } catch (err) {
    next(err);
  }
};

// Admin Delete Match (DELETE /admin/matches/:id)
exports.deleteMatch = async (req, res, next) => {
  try {
    const { id } = req.params;
    if (isDbConnected()) {
      const match = await ChessMatch.findByIdAndDelete(id);
      if (!match) {
        return res.status(404).json({ success: false, message: 'Match not found.' });
      }
      return res.json({ success: true, message: 'Match pairing deleted.' });
    }
    const idx = memoryStore.matches.findIndex(m => m._id === id || m.matchId === id);
    if (idx === -1) {
      return res.status(404).json({ success: false, message: 'Match not found.' });
    }
    memoryStore.matches.splice(idx, 1);
    return res.json({ success: true, message: 'Match pairing deleted.' });
  } catch (err) {
    next(err);
  }
};

// Admin Bulk Delete Matches (POST /admin/matches/bulk-delete)
exports.bulkDeleteMatches = async (req, res, next) => {
  try {
    const { ids } = req.body || {};
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ success: false, message: 'No match IDs provided for bulk deletion.' });
    }

    if (isDbConnected()) {
      const result = await ChessMatch.deleteMany({ _id: { $in: ids } });
      return res.json({
        success: true,
        message: `Successfully deleted ${result.deletedCount} match(es).`,
        count: result.deletedCount
      });
    }

    const initialLen = memoryStore.matches.length;
    memoryStore.matches = memoryStore.matches.filter(m => !ids.includes(m._id) && !ids.includes(m.matchId));
    const deletedCount = initialLen - memoryStore.matches.length;

    return res.json({
      success: true,
      message: `Successfully deleted ${deletedCount} match(es).`,
      count: deletedCount
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
      await ChessStandings.deleteMany({});
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
