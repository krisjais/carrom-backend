const mongoose = require('mongoose');
const ChessMatch = require('../models/ChessMatch');
const memoryStore = require('../utils/chessMemoryDb');
const { getConfiguration, calculateMaterialScore } = require('./scoringService');
const { recalculateAllStandings } = require('./standingsService');

const isDbConnected = () => mongoose.connection.readyState === 1;

const CHESS_PIECE_LIMITS = {
  pawns: 8,
  knights: 2,
  bishops: 2,
  rooks: 2,
  queens: 1,
  kings: 1
};

const sanitizeCapturedPieces = (captured = {}) => {
  if (!captured || typeof captured !== 'object') {
    return { pawns: 0, knights: 0, bishops: 0, rooks: 0, queens: 0, kings: 0 };
  }
  const sanitized = {};
  for (const [piece, maxLimit] of Object.entries(CHESS_PIECE_LIMITS)) {
    const val = Number(captured[piece]) || 0;
    sanitized[piece] = Math.max(0, Math.min(maxLimit, Math.floor(val)));
  }
  return sanitized;
};


const startMatch = async (matchId) => {
  if (isDbConnected()) {
    let match = await ChessMatch.findById(matchId);
    if (!match) {
      match = await ChessMatch.findOne({ matchId });
    }
    if (!match) throw new Error('Match not found.');
    if (match.status === 'completed') throw new Error('Cannot start a match that is already completed.');

    match.status = 'live';
    match.actualStartTime = new Date();
    match.durationMinutes = 10;
    await match.save();

    return await ChessMatch.findById(match._id)
      .populate('player1', 'fullName playerId department rank')
      .populate('player2', 'fullName playerId department rank');
  }

  const match = memoryStore.matches.find(m => m._id === matchId || m.matchId === matchId);
  if (!match) throw new Error('Match not found.');
  match.status = 'live';
  match.actualStartTime = new Date();
  match.durationMinutes = 10;
  return match;
};

const createManualMatch = async (matchData) => {
  const { player1Id, player2Id, round, roundName, scheduledTime, durationMinutes } = matchData;
  let customRoundName = (roundName || (typeof round === 'string' && isNaN(Number(round)) ? round : '') || '').trim();
  let targetRound = Number(round);

  if (isNaN(targetRound) || targetRound < 1) {
    const lower = customRoundName.toLowerCase();
    const matchNum = customRoundName.match(/\d+/);
    if (matchNum) {
      targetRound = parseInt(matchNum[0], 10);
    } else if (lower.includes('grand final')) {
      targetRound = 7;
    } else if (lower.includes('final')) {
      targetRound = 6;
    } else if (lower.includes('semi')) {
      targetRound = 5;
    } else if (lower.includes('quarter')) {
      targetRound = 4;
    } else {
      targetRound = 1;
    }
  }
  if (!customRoundName) {
    customRoundName = `Round ${targetRound}`;
  }

  const duration = Number(durationMinutes) || 10;

  let mCounter = (isDbConnected() ? await ChessMatch.countDocuments() : memoryStore.matches.length) + 1;
  const matchId = `CHS-M${String(mCounter).padStart(3, '0')}`;

  if (isDbConnected()) {
    const match = await ChessMatch.create({
      matchId,
      round: targetRound,
      roundName: customRoundName,
      player1: player1Id || null,
      player2: player2Id || null,
      status: 'scheduled',
      scheduledTime: scheduledTime ? new Date(scheduledTime) : new Date(),
      durationMinutes: duration
    });
    return await ChessMatch.findById(match._id)
      .populate('player1', 'fullName playerId department rank')
      .populate('player2', 'fullName playerId department rank');
  }

  const p1 = memoryStore.players.find(p => (p._id || p.playerId) === player1Id);
  const p2 = memoryStore.players.find(p => (p._id || p.playerId) === player2Id);

  const match = {
    _id: `mem_m_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
    matchId,
    round: targetRound,
    roundName: customRoundName,
    player1: p1 || null,
    player2: p2 || null,
    status: 'scheduled',
    scheduledTime: scheduledTime ? new Date(scheduledTime) : new Date(),
    durationMinutes: duration,
    player1Captured: { pawns: 0, knights: 0, bishops: 0, rooks: 0, queens: 0 },
    player2Captured: { pawns: 0, knights: 0, bishops: 0, rooks: 0, queens: 0 },
    player1MaterialScore: 0,
    player2MaterialScore: 0,
    winner: 'none'
  };

  memoryStore.matches.push(match);
  return match;
};

const submitResult = async (matchId, resultData) => {
  const config = await getConfiguration();
  const { player1Captured, player2Captured, winner, resultType, notes } = resultData;

  if (isDbConnected()) {
    const match = await ChessMatch.findById(matchId);
    if (!match) throw new Error('Match not found.');

    if (player1Captured) match.player1Captured = sanitizeCapturedPieces(player1Captured);
    if (player2Captured) match.player2Captured = sanitizeCapturedPieces(player2Captured);

    const p1MatScore = calculateMaterialScore(match.player1Captured, config);
    const p2MatScore = calculateMaterialScore(match.player2Captured, config);

    match.player1MaterialScore = p1MatScore;
    match.player2MaterialScore = p2MatScore;

    let finalWinner = winner;
    if (!finalWinner || finalWinner === 'none') {
      if (p1MatScore > p2MatScore) finalWinner = 'player1';
      else if (p2MatScore > p1MatScore) finalWinner = 'player2';
      else finalWinner = 'draw';
    }

    match.winner = finalWinner;
    match.winnerPlayer = finalWinner === 'player1' ? match.player1 : finalWinner === 'player2' ? match.player2 : null;
    match.resultType = resultType || 'points';
    if (notes !== undefined) match.notes = notes;
    match.status = 'completed';
    match.actualEndTime = new Date();

    await match.save();
    await recalculateAllStandings();
    return match;
  }

  const match = memoryStore.matches.find(m => m._id === matchId || m.matchId === matchId);
  if (!match) throw new Error('Match not found.');

  if (player1Captured) match.player1Captured = sanitizeCapturedPieces(player1Captured);
  if (player2Captured) match.player2Captured = sanitizeCapturedPieces(player2Captured);

  const p1MatScore = calculateMaterialScore(match.player1Captured, config);
  const p2MatScore = calculateMaterialScore(match.player2Captured, config);

  match.player1MaterialScore = p1MatScore;
  match.player2MaterialScore = p2MatScore;

  let finalWinner = winner;
  if (!finalWinner || finalWinner === 'none') {
    if (p1MatScore > p2MatScore) finalWinner = 'player1';
    else if (p2MatScore > p1MatScore) finalWinner = 'player2';
    else finalWinner = 'draw';
  }

  match.winner = finalWinner;
  match.resultType = resultType || 'points';
  if (notes !== undefined) match.notes = notes;
  match.status = 'completed';
  match.actualEndTime = new Date();

  await recalculateAllStandings();
  return match;
};

const overrideResult = async (matchId, overrideData) => {
  const { winner, notes, resultType } = overrideData;

  if (isDbConnected()) {
    const match = await ChessMatch.findById(matchId);
    if (!match) throw new Error('Match not found.');

    match.winner = winner || 'none';
    match.winnerPlayer = winner === 'player1' ? match.player1 : winner === 'player2' ? match.player2 : null;
    match.resultType = resultType || 'admin_override';
    if (notes) match.notes = notes;
    match.status = 'completed';
    match.actualEndTime = new Date();
    match.isVerified = true;

    await match.save();
    await recalculateAllStandings();
    return match;
  }

  const match = memoryStore.matches.find(m => m._id === matchId || m.matchId === matchId);
  if (!match) throw new Error('Match not found.');

  match.winner = winner || 'none';
  match.resultType = resultType || 'admin_override';
  if (notes) match.notes = notes;
  match.status = 'completed';
  match.actualEndTime = new Date();
  match.isVerified = true;

  await recalculateAllStandings();
  return match;
};

const cancelMatch = async (matchId) => {
  if (isDbConnected()) {
    const match = await ChessMatch.findById(matchId);
    if (!match) throw new Error('Match not found.');
    match.status = 'cancelled';
    await match.save();
    return match;
  }

  const match = memoryStore.matches.find(m => m._id === matchId || m.matchId === matchId);
  if (!match) throw new Error('Match not found.');
  match.status = 'cancelled';
  return match;
};

const updateLiveCaptures = async (matchId, captureData) => {
  const config = await getConfiguration();
  const { player1Captured, player2Captured } = captureData;

  if (isDbConnected()) {
    let match = await ChessMatch.findById(matchId);
    if (!match) match = await ChessMatch.findOne({ matchId });
    if (!match) throw new Error('Match not found.');

    if (player1Captured) match.player1Captured = sanitizeCapturedPieces(player1Captured);
    if (player2Captured) match.player2Captured = sanitizeCapturedPieces(player2Captured);

    match.player1MaterialScore = calculateMaterialScore(match.player1Captured, config);
    match.player2MaterialScore = calculateMaterialScore(match.player2Captured, config);

    // If match was scheduled, transition to live with 10-min clock
    if (match.status === 'scheduled') {
      match.status = 'live';
      if (!match.actualStartTime) match.actualStartTime = new Date();
      match.durationMinutes = 10;
    }

    await match.save();

    return await ChessMatch.findById(match._id)
      .populate('player1', 'fullName playerId department rank')
      .populate('player2', 'fullName playerId department rank');
  }

  const match = memoryStore.matches.find(m => m._id === matchId || m.matchId === matchId);
  if (!match) throw new Error('Match not found.');

  if (player1Captured) match.player1Captured = sanitizeCapturedPieces(player1Captured);
  if (player2Captured) match.player2Captured = sanitizeCapturedPieces(player2Captured);

  match.player1MaterialScore = calculateMaterialScore(match.player1Captured, config);
  match.player2MaterialScore = calculateMaterialScore(match.player2Captured, config);

  if (match.status === 'scheduled') {
    match.status = 'live';
    if (!match.actualStartTime) match.actualStartTime = new Date();
    match.durationMinutes = 10;
  }

  return match;
};

module.exports = {
  startMatch,
  createManualMatch,
  updateLiveCaptures,
  submitResult,
  overrideResult,
  cancelMatch,
  CHESS_PIECE_LIMITS,
  sanitizeCapturedPieces
};
