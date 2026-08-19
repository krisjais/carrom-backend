const mongoose = require('mongoose');
const ChessPlayer = require('../models/ChessPlayer');
const ChessMatch = require('../models/ChessMatch');
const ChessStandings = require('../models/ChessStandings');
const memoryStore = require('../utils/chessMemoryDb');
const { getConfiguration } = require('./scoringService');

const recalculateAllStandings = async () => {
  const config = await getConfiguration();
  const isDbConnected = mongoose.connection.readyState === 1;

  const eligiblePlayers = isDbConnected
    ? await ChessPlayer.find({ status: { $in: ['Approved', 'Active', 'Registered', 'Completed'] } })
    : memoryStore.players.filter(p => ['Approved', 'Active', 'Registered', 'Completed'].includes(p.status));

  for (const player of eligiblePlayers) {
    const playerMatches = isDbConnected
      ? await ChessMatch.find({
          $or: [{ player1: player._id }, { player2: player._id }],
          status: 'completed'
        })
      : memoryStore.matches.filter(m => (m.player1 === player._id || m.player2 === player._id) && m.status === 'completed');

    let matchesPlayed = 0;
    let wins = 0;
    let draws = 0;
    let losses = 0;
    let byes = 0;
    let totalMaterialPoints = 0;

    for (const match of playerMatches) {
      if (match.isBye) {
        if (match.byePlayer?.toString() === player._id.toString()) {
          byes++;
          wins++;
          matchesPlayed++;
        }
        continue;
      }

      matchesPlayed++;
      const isPlayer1 = (match.player1?._id || match.player1)?.toString() === player._id.toString();

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

    const tWin = config.tournamentPoints?.win ?? 3;
    const tDraw = config.tournamentPoints?.draw ?? 1;
    const tournamentPoints = (wins * tWin) + (draws * tDraw);
    const tieBreakScore = totalMaterialPoints;

    player.matchesPlayed = matchesPlayed;
    player.wins = wins;
    player.draws = draws;
    player.losses = losses;
    player.byes = byes;
    player.materialPoints = totalMaterialPoints;
    player.tournamentPoints = tournamentPoints;
    player.tieBreakScore = tieBreakScore;

    if (isDbConnected && typeof player.save === 'function') {
      await player.save();
    }
  }

  // Sort players by tournamentPoints desc, materialPoints desc, wins desc
  const sorted = isDbConnected
    ? await ChessPlayer.find({ status: { $in: ['Approved', 'Active', 'Registered', 'Completed'] } }).sort({
        tournamentPoints: -1,
        materialPoints: -1,
        wins: -1,
        fullName: 1
      })
    : [...memoryStore.players].sort((a, b) => {
        if (b.tournamentPoints !== a.tournamentPoints) return b.tournamentPoints - a.tournamentPoints;
        if (b.materialPoints !== a.materialPoints) return b.materialPoints - a.materialPoints;
        if (b.wins !== a.wins) return b.wins - a.wins;
        return a.fullName.localeCompare(b.fullName);
      });

  if (isDbConnected) {
    await ChessStandings.deleteMany({});
    for (let i = 0; i < sorted.length; i++) {
      sorted[i].rank = i + 1;
      await sorted[i].save();
      await ChessStandings.create({
        player: sorted[i]._id,
        rank: i + 1,
        matchesPlayed: sorted[i].matchesPlayed,
        wins: sorted[i].wins,
        draws: sorted[i].draws,
        losses: sorted[i].losses,
        materialPoints: sorted[i].materialPoints,
        tournamentPoints: sorted[i].tournamentPoints,
        tieBreakScore: sorted[i].tieBreakScore
      });
    }
  } else {
    sorted.forEach((p, i) => {
      p.rank = i + 1;
    });
  }

  return sorted;
};

module.exports = {
  recalculateAllStandings
};
