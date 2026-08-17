const mongoose = require('mongoose');

const boardDetailSchema = new mongoose.Schema(
  {
    boardNumber: {
      type: Number,
      required: true,
      min: 1,
      max: 3
    },
    team1Score: {
      type: Number,
      default: 0,
      min: 0,
      max: 25
    },
    team2Score: {
      type: Number,
      default: 0,
      min: 0,
      max: 25
    },
    queenPocketedBy: {
      type: String,
      enum: ['team1', 'team2', 'none'],
      default: 'none'
    },
    queenCovered: {
      type: Boolean,
      default: false
    },
    team1Fouls: {
      type: Number,
      default: 0,
      min: 0
    },
    team2Fouls: {
      type: Number,
      default: 0,
      min: 0
    },
    boardWinner: {
      type: String,
      enum: ['team1', 'team2', null],
      default: null
    },
    notes: {
      type: String,
      default: ''
    }
  },
  { _id: false }
);

const matchSchema = new mongoose.Schema(
  {
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
    roundNumber: {
      type: Number,
      required: true
    },
    roundName: {
      type: String,
      required: true
    },
    matchNumber: {
      type: Number,
      required: true
    },
    matchIndexInRound: {
      type: Number,
      required: true
    },
    team1: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Team',
      default: null
    },
    team2: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Team',
      default: null
    },
    isBye: {
      type: Boolean,
      default: false
    },
    winnerTeam: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Team',
      default: null
    },
    nextMatchId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Match',
      default: null
    },
    nextMatchSlot: {
      type: String,
      enum: ['team1', 'team2', null],
      default: null
    },
    status: {
      type: String,
      enum: ['pending', 'scheduled', 'live', 'completed', 'bye'],
      default: 'pending'
    },
    carromBoardNumber: {
      type: Number,
      default: 1
    },
    boardName: {
      type: String,
      default: 'Main Carrom Board'
    },
    queuePosition: {
      type: Number,
      default: null
    },
    scheduledTime: {
      type: Date,
      default: null
    },
    actualStartTime: {
      type: Date,
      default: null
    },
    actualEndTime: {
      type: Date,
      default: null
    },
    boards: {
      type: [boardDetailSchema],
      default: () => [
        { boardNumber: 1, team1Score: 0, team2Score: 0, queenPocketedBy: 'none', queenCovered: false, team1Fouls: 0, team2Fouls: 0, boardWinner: null },
        { boardNumber: 2, team1Score: 0, team2Score: 0, queenPocketedBy: 'none', queenCovered: false, team1Fouls: 0, team2Fouls: 0, boardWinner: null },
        { boardNumber: 3, team1Score: 0, team2Score: 0, queenPocketedBy: 'none', queenCovered: false, team1Fouls: 0, team2Fouls: 0, boardWinner: null }
      ]
    },
    finalScore: {
      team1BoardsWon: { type: Number, default: 0 },
      team2BoardsWon: { type: Number, default: 0 }
    },
    isResultConfirmed: {
      type: Boolean,
      default: false
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null
    }
  },
  { timestamps: true }
);

matchSchema.index({ tournamentId: 1, category: 1, roundNumber: 1 });
matchSchema.index({ tournamentId: 1, status: 1, queuePosition: 1 });

module.exports = mongoose.model('Match', matchSchema);
