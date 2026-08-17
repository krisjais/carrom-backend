const mongoose = require('mongoose');

const teamSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true
    },
    tournamentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Tournament',
      required: true
    },
    category: {
      type: String,
      enum: ['boys_singles', 'girls_singles', 'boys_doubles', 'girls_doubles', 'mixed_doubles'],
      required: true
    },
    player1: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Participant',
      required: true
    },
    player2: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Participant',
      default: null
    },
    rawPartnerName: {
      type: String,
      default: ''
    },
    isApproved: {
      type: Boolean,
      default: true
    },
    seed: {
      type: Number,
      default: null
    }
  },
  { timestamps: true }
);

teamSchema.index({ tournamentId: 1, category: 1 });

module.exports = mongoose.model('Team', teamSchema);
