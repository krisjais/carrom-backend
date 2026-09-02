const mongoose = require('mongoose');
const ChessMatch = require('../models/ChessMatch');
const memoryStore = require('../utils/chessMemoryDb');
const { getConfiguration, calculateMaterialScore } = require('./scoringService');
const { recalculateAllStandings } = require('./standingsService');

const isDbConnected = () => mongoose.connection.readyState === 1;

const startMatch = async (matchId) => {
  if (isDbConnected()) {
    const match = await ChessMatch.findById(matchId);
    if (!match) throw new Error('Match not found.');
    if (match.status === 'completed') throw new Error('Cannot start a match that is already completed.');

    match.status = 'live';
    match.actualStartTime = new Date();
    await match.save();
    return match;
  }

  const match = memoryStore.matches.find(m => m._id === matchId || m.matchId === matchId);
  if (!match) throw new Error('Match not found.');
  match.status = 'live';
  match.actualStartTime = new Date();
  return match;
};

const submitResult = async (matchId, resultData) => {
  const config = await getConfiguration();
  const { player1Captured, player2Captured, winner, resultType, notes } = resultData;

  if (isDbConnected()) {
    const match = await ChessMatch.findById(matchId);
    if (!match) throw new Error('Match not found.');

    if (player1Captured) match.player1Captured = player1Captured;
    if (player2Captured) match.player2Captured = player2Captured;

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

  if (player1Captured) match.player1Captured = player1Captured;
  if (player2Captured) match.player2Captured = player2Captured;

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

module.exports = {
  startMatch,
  submitResult,
  overrideResult,
  cancelMatch
};
