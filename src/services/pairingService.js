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
    : memoryStore.players
        .filter(p => ['Approved', 'Active', 'approved', 'active'].includes(p.status))
        .sort((a, b) => {
          if ((b.tournamentPoints || 0) !== (a.tournamentPoints || 0)) {
            return (b.tournamentPoints || 0) - (a.tournamentPoints || 0);
          }
          if ((b.materialPoints || 0) !== (a.materialPoints || 0)) {
            return (b.materialPoints || 0) - (a.materialPoints || 0);
          }
          if ((b.wins || 0) !== (a.wins || 0)) {
            return (b.wins || 0) - (a.wins || 0);
          }
          return (a.fullName || '').localeCompare(b.fullName || '');
        });

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

  // 2. Handle Odd Number of Players:
  // The player with the MOST points automatically advances to next round via BYE
  // and will NOT participate in a match pairing for this round.
  if (playerPool.length % 2 !== 0) {
    // Search from index 0 (highest points) for top-ranked player who hasn't received a BYE
    let byeIndex = -1;
    for (let i = 0; i < playerPool.length; i++) {
      const p = playerPool[i];
      const pIdStr = (p._id || p.playerId).toString();
      const hasBye = pastMatches.some(m => m.isBye && (m.byePlayer?._id || m.byePlayer)?.toString() === pIdStr);
      if (!hasBye) {
        byeIndex = i;
        break;
      }
    }

    // If all top players already had a bye, pick the top player with most points (index 0)
    if (byeIndex === -1) {
      byeIndex = 0;
    }

    // Remove top player from playerPool so they do not participate in matches this round
    const byePlayer = playerPool.splice(byeIndex, 1)[0];
    const matchId = `CHS-M${String(mCounter++).padStart(3, '0')}`;
    const winPoints = config.tournamentPoints?.win ?? 3;

    const byeMatchData = {
      matchId,
      round: targetRound,
      isBye: true,
      status: 'completed',
      winner: 'player1',
      resultType: 'bye',
      player1Score: winPoints,
      durationMinutes: config.matchDuration || 10,
      actualStartTime: new Date(),
      actualEndTime: new Date(),
      notes: `Automatic BYE awarded for Round ${targetRound}. Top-ranked player (${byePlayer.fullName || byePlayer.playerId}) advances directly to next round.`
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
      byeMatch = {
        _id: `mem_m_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
        ...byeMatchData,
        player1: byePlayer,
        player2: null,
        byePlayer: byePlayer,
        winnerPlayer: byePlayer
      };
      memoryStore.matches.push(byeMatch);
    }

    // Update BYE player stats
    byePlayer.byes = (byePlayer.byes || 0) + 1;
    byePlayer.tournamentPoints = (byePlayer.tournamentPoints || 0) + winPoints;
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
      matchId,
      round: targetRound,
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
      match = {
        _id: `mem_m_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
        ...matchData,
        player1: p1,
        player2: p2
      };
      memoryStore.matches.push(match);
    }

    createdMatches.push(match);
  }

  // Update or create ChessRound record
  if (isDbConnected) {
    let roundDoc = await ChessRound.findOne({ roundNumber: targetRound });
    if (!roundDoc) {
      await ChessRound.create({
        roundNumber: targetRound,
        name: `Round ${targetRound}`,
        status: 'active',
        matchesCount: createdMatches.length,
        startTime: new Date()
      });
    } else {
      roundDoc.matchesCount = createdMatches.length;
      roundDoc.status = 'active';
      if (!roundDoc.startTime) roundDoc.startTime = new Date();
      await roundDoc.save();
    }
  } else {
    let roundItem = memoryStore.rounds.find(r => r.roundNumber === targetRound);
    if (!roundItem) {
      memoryStore.rounds.push({
        _id: `mem_r_${Date.now()}`,
        roundNumber: targetRound,
        name: `Round ${targetRound}`,
        status: 'active',
        matchesCount: createdMatches.length,
        startTime: new Date()
      });
    } else {
      roundItem.matchesCount = createdMatches.length;
      roundItem.status = 'active';
      if (!roundItem.startTime) roundItem.startTime = new Date();
    }
  }

  // Recalculate standings so BYE points and matches played are updated
  try {
    const { recalculateAllStandings } = require('./standingsService');
    await recalculateAllStandings();
  } catch (err) {
    console.error('Error recalculating standings post pairing:', err);
  }

  return createdMatches;
};

module.exports = {
  generateRoundPairings
};
