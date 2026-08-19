const mongoose = require('mongoose');
const ChessPlayer = require('../models/ChessPlayer');
const ChessMatch = require('../models/ChessMatch');
const ChessRound = require('../models/ChessRound');
const memoryStore = require('../utils/chessMemoryDb');
const { getConfiguration } = require('./scoringService');

const generateRoundPairings = async (roundNumber = null) => {
  const config = await getConfiguration();
  const targetRound = roundNumber || config.currentRound || 1;
  const isDbConnected = mongoose.connection.readyState === 1;

  // 1. Get all eligible players (Approved or Active status)
  const eligiblePlayers = isDbConnected
    ? await ChessPlayer.find({
        status: { $in: ['Approved', 'Active', 'approved', 'active'] }
      }).sort({ tournamentPoints: -1, materialPoints: -1, wins: -1, fullName: 1 })
    : memoryStore.players.filter(p => ['Approved', 'Active', 'approved', 'active'].includes(p.status));

  if (eligiblePlayers.length < 2) {
    throw new Error('At least 2 approved players are required to generate pairings.');
  }

  // Check if matches already exist for targetRound
  const existingMatches = isDbConnected
    ? await ChessMatch.find({ round: targetRound })
    : memoryStore.matches.filter(m => m.round === targetRound);

  if (existingMatches.length > 0) {
    throw new Error(`Matches for Round ${targetRound} have already been generated.`);
  }

  // Retrieve all previous matches to avoid duplicate head-to-head pairings
  const pastMatches = isDbConnected ? await ChessMatch.find({}) : memoryStore.matches;
  const playedPairs = new Set();
  pastMatches.forEach(m => {
    if (m.player1 && m.player2) {
      const p1 = (m.player1._id || m.player1).toString();
      const p2 = (m.player2._id || m.player2).toString();
      playedPairs.add(`${p1}_${p2}`);
      playedPairs.add(`${p2}_${p1}`);
    }
  });

  let playerPool = [...eligiblePlayers];
  const createdMatches = [];
  let mCounter = (isDbConnected ? await ChessMatch.countDocuments() : memoryStore.matches.length) + 1;

  // 2. Handle Odd Number of Players (Assign BYE)
  if (playerPool.length % 2 !== 0) {
    let byeIndex = -1;
    for (let i = playerPool.length - 1; i >= 0; i--) {
      const p = playerPool[i];
      const pIdStr = (p._id || p.playerId).toString();
      const hasBye = pastMatches.some(m => m.isBye && (m.byePlayer?._id || m.byePlayer)?.toString() === pIdStr);
      if (!hasBye) {
        byeIndex = i;
        break;
      }
    }

    if (byeIndex === -1) {
      byeIndex = playerPool.length - 1;
    }

    const byePlayer = playerPool.splice(byeIndex, 1)[0];
    const matchId = `CHS-M${String(mCounter++).padStart(3, '0')}`;

    const byeMatchData = {
      _id: `mem_m_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
      matchId,
      round: targetRound,
      player1: byePlayer,
      player2: null,
      isBye: true,
      byePlayer: byePlayer,
      status: 'completed',
      winner: 'player1',
      winnerPlayer: byePlayer,
      resultType: 'bye',
      player1Score: 3,
      durationMinutes: config.matchDuration || 10,
      actualStartTime: new Date(),
      actualEndTime: new Date(),
      notes: `Automatic BYE awarded for Round ${targetRound}.`
    };

    let byeMatch;
    if (isDbConnected) {
      byeMatch = await ChessMatch.create({
        ...byeMatchData,
        player1: byePlayer._id,
        byePlayer: byePlayer._id,
        winnerPlayer: byePlayer._id
      });
    } else {
      byeMatch = byeMatchData;
      memoryStore.matches.push(byeMatch);
    }

    // Update BYE player stats
    byePlayer.byes = (byePlayer.byes || 0) + 1;
    byePlayer.tournamentPoints = (byePlayer.tournamentPoints || 0) + (config.tournamentPoints?.win ?? 3);
    byePlayer.matchesPlayed = (byePlayer.matchesPlayed || 0) + 1;
    byePlayer.wins = (byePlayer.wins || 0) + 1;
    if (isDbConnected && typeof byePlayer.save === 'function') {
      await byePlayer.save();
    }

    createdMatches.push(byeMatch);
  }

  // 3. Pair remaining players
  const unassigned = [...playerPool];
  while (unassigned.length >= 2) {
    const p1 = unassigned.shift();
    let p2Index = -1;

    for (let i = 0; i < unassigned.length; i++) {
      const candidate = unassigned[i];
      const p1Id = (p1._id || p1.playerId).toString();
      const candId = (candidate._id || candidate.playerId).toString();
      const pairKey = `${p1Id}_${candId}`;
      if (!playedPairs.has(pairKey)) {
        p2Index = i;
        break;
      }
    }

    if (p2Index === -1) {
      p2Index = 0;
    }

    const p2 = unassigned.splice(p2Index, 1)[0];
    const matchId = `CHS-M${String(mCounter++).padStart(3, '0')}`;

    const matchData = {
      _id: `mem_m_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
      matchId,
      round: targetRound,
      player1: p1,
      player2: p2,
      isBye: false,
      status: 'scheduled',
      scheduledTime: new Date(),
      durationMinutes: config.matchDuration || 10
    };

    let match;
    if (isDbConnected) {
      match = await ChessMatch.create({
        ...matchData,
        player1: p1._id,
        player2: p2._id
      });
    } else {
      match = matchData;
      memoryStore.matches.push(match);
    }

    createdMatches.push(match);
  }

  return createdMatches;
};

module.exports = {
  generateRoundPairings
};
