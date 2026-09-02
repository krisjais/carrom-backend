const mongoose = require('mongoose');

const chessTournamentSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      default: 'Chess Championship 2026'
    },
    status: {
      type: String,
      enum: ['upcoming', 'active', 'completed'],
      default: 'active'
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

module.exports = mongoose.model('ChessTournament', chessTournamentSchema);
