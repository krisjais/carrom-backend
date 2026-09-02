const mongoose = require('mongoose');

const chessPlayerSchema = new mongoose.Schema(
  {
    playerId: {
      type: String,
      required: true,
      unique: true,
      trim: true
    },
    fullName: {
      type: String,
      required: true,
      trim: true
    },
    email: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true
    },
    phone: {
      type: String,
      trim: true,
      default: ''
    },
    department: {
      type: String,
      required: true,
      enum: ['First Year', 'Second Year', 'IT Team', 'MJ Team', 'HR Team'],
      trim: true
    },
    status: {
      type: String,
      enum: ['Registered', 'Approved', 'Rejected', 'Active', 'Eliminated', 'Completed'],
      default: 'Registered'
    },
    matchesPlayed: {
      type: Number,
      default: 0
    },
    wins: {
      type: Number,
      default: 0
    },
    draws: {
      type: Number,
      default: 0
    },
    losses: {
      type: Number,
      default: 0
    },
    byes: {
      type: Number,
      default: 0
    },
    materialPoints: {
      type: Number,
      default: 0
    },
    tournamentPoints: {
      type: Number,
      default: 0
    },
    tieBreakScore: {
      type: Number,
      default: 0
    },
    rank: {
      type: Number,
      default: 0
    },
    adminNotes: {
      type: String,
      default: ''
    }
  },
  { timestamps: true }
);

chessPlayerSchema.index({ status: 1 });
chessPlayerSchema.index({ tournamentPoints: -1, materialPoints: -1, wins: -1 });

module.exports = mongoose.model('ChessPlayer', chessPlayerSchema);
