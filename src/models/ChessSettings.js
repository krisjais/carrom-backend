const mongoose = require('mongoose');

const chessSettingsSchema = new mongoose.Schema(
  {
    tournamentName: {
      type: String,
      default: 'Chess Championship 2026'
    },
    tournamentTagline: {
      type: String,
      default: 'Think ahead. Play smart. Finish strong.'
    },
    matchDuration: {
      type: Number,
      default: 10
    },
    piecePoints: {
      pawn: { type: Number, default: 1 },
      knight: { type: Number, default: 3 },
      bishop: { type: Number, default: 3 },
      rook: { type: Number, default: 5 },
      queen: { type: Number, default: 9 },
      king: { type: Number, default: 0 }
    },
    tournamentPoints: {
      win: { type: Number, default: 3 },
      draw: { type: Number, default: 1 },
      loss: { type: Number, default: 0 }
    },
    currentRound: {
      type: Number,
      default: 1
    },
    registrationOpen: {
      type: Boolean,
      default: true
    }
  },
  { timestamps: true }
);

module.exports = mongoose.model('ChessSettings', chessSettingsSchema);
