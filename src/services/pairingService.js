const mongoose = require('mongoose');
const ChessPlayer = require('../models/ChessPlayer');
const ChessMatch = require('../models/ChessMatch');
const ChessRound = require('../models/ChessRound');
const memoryStore = require('../utils/chessMemoryDb');
const { getConfiguration } = require('./scoringService');

const generateRoundPairings = async (roundNumber = null, roundName = null) => {
  const config = await getConfiguration();
  const isDbConnected = mongoose.connection.readyState === 1;

  // Resolve customRoundName and targetRound flexibly from text
  let customRoundName = (roundName || (typeof roundNumber === 'string' && isNaN(Number(roundNumber)) ? roundNumber : '') || '').trim();
  let targetRound = Number(roundNumber);

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
      const existingMatches = isDbConnected ? await ChessMatch.find({}, 'round') : memoryStore.matches;
      const maxExisting = existingMatches.reduce((max, m) => Math.max(max, m.round || 0), 0);
      targetRound = maxExisting + 1;
    }
  }

  if (!customRoundName) {
    customRoundName = `Round ${targetRound}`;
  }

  // 1. Get all eligible players (Approved or Active status)
  const rawEligiblePlayers = isDbConnected
    ? await ChessPlayer.find({
        status: { $in: ['Approved', 'Active', 'approved', 'active'] }
      }).sort({ tournamentPoints: -1, materialPoints: -1, wins: -1, fullName: 1 })
    : memoryStore.players
        .filter(p => ['Approved', 'Active', 'approved', 'active'].includes(p.status))
        .sort((a, b) => (b.tournamentPoints || 0) - (a.tournamentPoints || 0) || (b.materialPoints || 0) - (a.materialPoints || 0));

  // Deduplicate eligible players by unique ID and normalized full name
  const seenPlayerIds = new Set();
  const seenPlayerNames = new Set();
  const eligiblePlayers = [];

  for (const player of rawEligiblePlayers) {
    const idStr = (player._id || player.playerId || '').toString();
    const normName = (player.fullName || '').trim().toLowerCase();
    if (idStr && seenPlayerIds.has(idStr)) continue;
    if (normName && seenPlayerNames.has(normName)) continue;
    if (idStr) seenPlayerIds.add(idStr);
    if (normName) seenPlayerNames.add(normName);
    eligiblePlayers.push(player);
  }

  if (eligiblePlayers.length < 2) {
    throw new Error('At least 2 approved players are required to generate pairings.');
  }

  // Check if matches already exist for targetRound or exact same round name
  let existingMatches = isDbConnected
    ? await ChessMatch.find({ round: targetRound }).populate('player1 player2 byePlayer')
    : memoryStore.matches.filter(m => m.round === targetRound);

  const exactSameRound = existingMatches.find(m => (m.roundName || '').toLowerCase() === customRoundName.toLowerCase());
  if (exactSameRound) {
    throw new Error(`Matches for "${customRoundName}" have already been generated.`);
  }

  // If numeric round was taken by another named round, auto-increment round number
  while (existingMatches.length > 0) {
    targetRound++;
    existingMatches = isDbConnected
      ? await ChessMatch.find({ round: targetRound }).populate('player1 player2 byePlayer')
      : memoryStore.matches.filter(m => m.round === targetRound);
  }

  // Check any players already assigned in this target round (if matches were partially created)
  const alreadyAssignedInRound = new Set();
  const alreadyAssignedNamesInRound = new Set();
  existingMatches.forEach(m => {
    [m.player1, m.player2, m.byePlayer].filter(Boolean).forEach(p => {
      const pId = (p._id || p.playerId || p).toString();
      alreadyAssignedInRound.add(pId);
      if (p.fullName) {
        alreadyAssignedNamesInRound.add(p.fullName.trim().toLowerCase());
      }
    });
  });

  // Retrieve all previous matches
  const pastMatches = isDbConnected ? await ChessMatch.find({}).populate('player1 player2 byePlayer') : memoryStore.matches;
  const playedPairs = new Set();
  pastMatches.forEach(m => {
    if (m.player1 && m.player2) {
      const p1 = (m.player1._id || m.player1).toString();
      const p2 = (m.player2._id || m.player2).toString();
      playedPairs.add(`${p1}_${p2}`);
      playedPairs.add(`${p2}_${p1}`);
    }
  });

  let playerPool = eligiblePlayers.filter(p => {
    const idStr = (p._id || p.playerId || '').toString();
    const normName = (p.fullName || '').trim().toLowerCase();
    return !alreadyAssignedInRound.has(idStr) && !alreadyAssignedNamesInRound.has(normName);
  });

  // 2. Knockout rule: If previous round matches exist, require them to be completed and advance winners & BYEs
  if (pastMatches.length > 0) {
    const previousRounds = pastMatches.map(m => m.round).filter(r => r < targetRound);
    const lastRoundNumber = previousRounds.length > 0 ? Math.max(...previousRounds) : (targetRound > 1 ? targetRound - 1 : null);
    
    if (lastRoundNumber) {
      const prevRoundMatches = pastMatches.filter(m => m.round === lastRoundNumber);
      if (prevRoundMatches.length > 0) {
        const uncompleted = prevRoundMatches.filter(m => m.status !== 'completed');
        if (uncompleted.length > 0) {
          throw new Error(`Previous round (Round ${lastRoundNumber}) has ${uncompleted.length} uncompleted match(es). Please complete all matches in the previous round before generating ${customRoundName}.`);
        }

      const advancingPlayerIds = new Set();
      const advancingPlayerNames = new Set();
      prevRoundMatches.forEach(m => {
        const p1 = m.player1 || m.byePlayer;
        const p2 = m.player2;
        const p1Id = (p1?._id || p1?.playerId || p1)?.toString();
        const p2Id = (p2?._id || p2?.playerId || p2)?.toString();
        const p1Name = (p1?.fullName || '').trim().toLowerCase();
        const p2Name = (p2?.fullName || '').trim().toLowerCase();

        if (m.isBye) {
          if (p1Id) advancingPlayerIds.add(p1Id);
          if (p1Name) advancingPlayerNames.add(p1Name);
        } else if (m.winner === 'player1') {
          if (p1Id) advancingPlayerIds.add(p1Id);
          if (p1Name) advancingPlayerNames.add(p1Name);
        } else if (m.winner === 'player2') {
          if (p2Id) advancingPlayerIds.add(p2Id);
          if (p2Name) advancingPlayerNames.add(p2Name);
        } else if (m.winner === 'draw') {
          // In case of a draw, advance player with higher material score
          if ((m.player1MaterialScore || 0) >= (m.player2MaterialScore || 0)) {
            if (p1Id) advancingPlayerIds.add(p1Id);
            if (p1Name) advancingPlayerNames.add(p1Name);
          } else {
            if (p2Id) advancingPlayerIds.add(p2Id);
            if (p2Name) advancingPlayerNames.add(p2Name);
          }
        } else if (m.winnerPlayer) {
          advancingPlayerIds.add(m.winnerPlayer.toString());
        }
      });

      // Keep ONLY winning/advancing players in the pool (and not already assigned in target round)
      playerPool = playerPool.filter(p => {
        const idStr = (p._id || p.playerId).toString();
        const normName = (p.fullName || '').trim().toLowerCase();
        const isAdvancing = advancingPlayerIds.has(idStr) || (normName && advancingPlayerNames.has(normName));
        return isAdvancing && !alreadyAssignedInRound.has(idStr) && !alreadyAssignedNamesInRound.has(normName);
      });

      if (playerPool.length < 2) {
        if (alreadyAssignedInRound.size > 0) {
          throw new Error(`All advancing players are already scheduled in ${customRoundName}.`);
        }
        throw new Error(`Only ${playerPool.length} advancing player remaining. The tournament has concluded with a champion!`);
      }
    }
  }
}

  if (playerPool.length < 2) {
    if (alreadyAssignedInRound.size > 0) {
      throw new Error(`All eligible players are already scheduled in ${customRoundName}.`);
    }
    throw new Error(`At least 2 available players are required to generate pairings for ${customRoundName}.`);
  }

  // Sort remaining pool
  playerPool.sort((a, b) => {
    return (b.materialPoints || 0) - (a.materialPoints || 0) ||
           (b.tournamentPoints || 0) - (a.tournamentPoints || 0) ||
           (b.wins || 0) - (a.wins || 0);
  });

  const createdMatches = [];
  let mCounter = (isDbConnected ? await ChessMatch.countDocuments() : memoryStore.matches.length) + 1;

  // 3. Odd Number of Players: Award an Automatic BYE to advance to next round
  if (playerPool.length % 2 !== 0) {
    // Sort candidates primarily by Tournament Points, Wins, then Seed/Rank
    const candidates = [...playerPool].sort((a, b) => {
      const ptDiff = (b.tournamentPoints || 0) - (a.tournamentPoints || 0);
      if (ptDiff !== 0) return ptDiff;
      const winDiff = (b.wins || 0) - (a.wins || 0);
      if (winDiff !== 0) return winDiff;
      return (a.rank || 9999) - (b.rank || 9999);
    });

    // Find the player who has not yet received a BYE in previous rounds
    let selectedCandidate = null;
    for (let i = 0; i < candidates.length; i++) {
      const p = candidates[i];
      const pIdStr = (p._id || p.playerId).toString();
      const hasBye = pastMatches.some(m => m.isBye && (m.byePlayer?._id || m.byePlayer)?.toString() === pIdStr);
      if (!hasBye) {
        selectedCandidate = p;
        break;
      }
    }

    // If all remaining candidates already had a bye, pick top seed
    if (!selectedCandidate) {
      selectedCandidate = candidates[0];
    }

    // Remove the selected bye player from playerPool so remaining players can be paired together
    const byeIndex = playerPool.findIndex(p => (p._id || p.playerId).toString() === (selectedCandidate._id || selectedCandidate.playerId).toString());
    const byePlayer = playerPool.splice(byeIndex, 1)[0];
    const matchId = `CHS-M${String(mCounter++).padStart(3, '0')}`;

    const byeMatchData = {
      matchId,
      round: targetRound,
      roundName: customRoundName,
      isBye: true,
      status: 'completed',
      winner: 'player1',
      resultType: 'bye',
      player1Score: 3,
      durationMinutes: config.matchDuration || 10,
      actualStartTime: new Date(),
      actualEndTime: new Date(),
      notes: `Automatic BYE awarded for ${customRoundName} (odd player count) - player automatically advances to the next round with +3 points.`
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
      roundName: customRoundName,
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
