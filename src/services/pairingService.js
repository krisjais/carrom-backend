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
        .sort((a, b) => (b.tournamentPoints || 0) - (a.tournamentPoints || 0) || (b.materialPoints || 0) - (a.materialPoints || 0));

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

  // Retrieve all previous matches
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

  // 2. Knockout rule: After Round 1, players who lost will NOT go to next round
  if (targetRound > 1) {
    const prevRoundMatches = pastMatches.filter(m => m.round === targetRound - 1);
    if (prevRoundMatches.length === 0) {
      throw new Error(`Cannot generate Round ${targetRound} pairings before Round ${targetRound - 1} matches are scheduled.`);
    }

    const uncompleted = prevRoundMatches.filter(m => m.status !== 'completed');
    if (uncompleted.length > 0) {
      throw new Error(`Round ${targetRound - 1} has ${uncompleted.length} uncompleted match(es). Please complete all matches in the previous round before generating Round ${targetRound}.`);
    }

    const advancingPlayerIds = new Set();
    prevRoundMatches.forEach(m => {
      const p1Id = (m.player1?._id || m.player1 || m.byePlayer?._id || m.byePlayer)?.toString();
      const p2Id = (m.player2?._id || m.player2)?.toString();

      if (m.isBye) {
        if (p1Id) advancingPlayerIds.add(p1Id);
      } else if (m.winner === 'player1') {
        if (p1Id) advancingPlayerIds.add(p1Id);
      } else if (m.winner === 'player2') {
        if (p2Id) advancingPlayerIds.add(p2Id);
      } else if (m.winner === 'draw') {
        // In case of a draw, advance player with higher material score
        if ((m.player1MaterialScore || 0) >= (m.player2MaterialScore || 0)) {
          if (p1Id) advancingPlayerIds.add(p1Id);
        } else {
          if (p2Id) advancingPlayerIds.add(p2Id);
        }
      } else if (m.winnerPlayer) {
        advancingPlayerIds.add(m.winnerPlayer.toString());
      }
    });

    // Keep ONLY winning/advancing players in the pool
    playerPool = playerPool.filter(p => {
      const idStr = (p._id || p.playerId).toString();
      return advancingPlayerIds.has(idStr);
    });

    if (playerPool.length < 2) {
      throw new Error(`Only ${playerPool.length} advancing player remaining. The tournament has concluded with a champion!`);
    }
  }

  // Sort remaining pool by points table: tournamentPoints desc, materialPoints desc, wins desc
  playerPool.sort((a, b) => {
    return (b.tournamentPoints || 0) - (a.tournamentPoints || 0) ||
           (b.materialPoints || 0) - (a.materialPoints || 0) ||
           (b.wins || 0) - (a.wins || 0);
  });

  const createdMatches = [];
  let mCounter = (isDbConnected ? await ChessMatch.countDocuments() : memoryStore.matches.length) + 1;

  // 3. Odd Number of Players: Player with HIGHEST points goes to the next round by default (BYE)
  if (playerPool.length % 2 !== 0) {
    // Find the highest-point player from the top who hasn't had a bye yet
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

    // If all remaining players already had a bye, pick the top player on points table
    if (byeIndex === -1) {
      byeIndex = 0;
    }

    const byePlayer = playerPool.splice(byeIndex, 1)[0];
    const matchId = `CHS-M${String(mCounter++).padStart(3, '0')}`;

    const byeMatchData = {
      matchId,
      round: targetRound,
      isBye: true,
      status: 'completed',
      winner: 'player1',
      resultType: 'bye',
      player1Score: 3,
      durationMinutes: config.matchDuration || 10,
      actualStartTime: new Date(),
      actualEndTime: new Date(),
      notes: `Automatic BYE awarded for Round ${targetRound} to leaderboard leader.`
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

    // Update BYE player stats (+3 pts)
    byePlayer.byes = (byePlayer.byes || 0) + 1;
    byePlayer.tournamentPoints = (byePlayer.tournamentPoints || 0) + (config.tournamentPoints?.win ?? 3);
    byePlayer.matchesPlayed = (byePlayer.matchesPlayed || 0) + 1;
    byePlayer.wins = (byePlayer.wins || 0) + 1;
    if (isDbConnected && typeof byePlayer.save === 'function') {
      await byePlayer.save();
    }

    createdMatches.push(byeMatch);
  }

  // 4. Pair remaining players
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

  return createdMatches;
};

module.exports = {
  generateRoundPairings
};
