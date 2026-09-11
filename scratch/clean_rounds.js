require('dotenv').config();
const mongoose = require('mongoose');
const connectDB = require('../src/config/db');

const ChessPlayer = require('../src/models/ChessPlayer');
const ChessMatch = require('../src/models/ChessMatch');
const ChessRound = require('../src/models/ChessRound');
const { recalculateAllStandings } = require('../src/services/standingsService');

async function cleanRounds() {
  await connectDB();
  const mRes = await ChessMatch.deleteMany({});
  const rRes = await ChessRound.deleteMany({});
  console.log('Deleted matches:', mRes.deletedCount);
  console.log('Deleted rounds:', rRes.deletedCount);

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

  await recalculateAllStandings();
  console.log('All rounds deleted, players stats reset to 0, standings recalculated.');
  process.exit(0);
}

cleanRounds().catch(err => {
  console.error(err);
  process.exit(1);
});
