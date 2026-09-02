const mongoose = require('mongoose');

const capturedPiecesSchema = new mongoose.Schema(
  {
    pawns: { type: Number, default: 0, min: 0, max: 8 },
    knights: { type: Number, default: 0, min: 0, max: 2 },
    bishops: { type: Number, default: 0, min: 0, max: 2 },
    rooks: { type: Number, default: 0, min: 0, max: 2 },
    queens: { type: Number, default: 0, min: 0, max: 1 }
  },
  { _id: false }
);

const chessMatchSchema = new mongoose.Schema(
  {
    matchId: {
      type: String,
      required: true,
      unique: true,
      trim: true
    },
    round: {
      type: Number,
      required: true,
      min: 1
    },
    player1: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ChessPlayer',
      default: null
    },
    player2: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ChessPlayer',
      default: null
    },
    isBye: {
      type: Boolean,
      default: false
    },
    byePlayer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ChessPlayer',
      default: null
    },
    status: {
      type: String,
      enum: ['scheduled', 'live', 'completed', 'cancelled', 'awaiting_result'],
      default: 'scheduled'
    },
    scheduledTime: {
      type: Date,
      default: Date.now
    },
    actualStartTime: {
      type: Date,
      default: null
    },
    actualEndTime: {
      type: Date,
      default: null
    },
    durationMinutes: {
      type: Number,
      default: 10
    },
    player1Score: {
      type: Number,
      default: 0
    },
    player2Score: {
      type: Number,
      default: 0
    },
    player1Captured: {
      type: capturedPiecesSchema,
      default: () => ({ pawns: 0, knights: 0, bishops: 0, rooks: 0, queens: 0 })
    },
    player2Captured: {
      type: capturedPiecesSchema,
      default: () => ({ pawns: 0, knights: 0, bishops: 0, rooks: 0, queens: 0 })
    },
    player1MaterialScore: {
      type: Number,
      default: 0
    },
    player2MaterialScore: {
      type: Number,
      default: 0
    },
    winner: {
      type: String,
      enum: ['player1', 'player2', 'draw', 'none'],
      default: 'none'
    },
    winnerPlayer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ChessPlayer',
      default: null
    },
    resultType: {
      type: String,
      enum: ['pending', 'checkmate', 'time_out', 'resignation', 'points', 'draw_agreed', 'admin_override', 'bye'],
      default: 'pending'
    },
    isVerified: {
      type: Boolean,
      default: false
    },
    notes: {
      type: String,
      default: ''
    }
  },
  { timestamps: true }
);

chessMatchSchema.index({ round: 1, status: 1 });

module.exports = mongoose.model('ChessMatch', chessMatchSchema);
