const mongoose = require('mongoose');

const chessStandingsSchema = new mongoose.Schema(
  {
    player: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ChessPlayer',
      required: true
    },
    rank: { type: Number, required: true },
    matchesPlayed: { type: Number, default: 0 },
    wins: { type: Number, default: 0 },
    draws: { type: Number, default: 0 },
    losses: { type: Number, default: 0 },
    materialPoints: { type: Number, default: 0 },
    tournamentPoints: { type: Number, default: 0 },
    tieBreakScore: { type: Number, default: 0 }
  },
  { timestamps: true }
);

module.exports = mongoose.model('ChessStandings', chessStandingsSchema);
