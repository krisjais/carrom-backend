const mongoose = require('mongoose');

const carromBoardSchema = new mongoose.Schema(
  {
    tournamentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Tournament',
      required: true
    },
    boardNumber: {
      type: Number,
      required: true
    },
    name: {
      type: String,
      required: true,
      default: function () {
        return `Carrom Board ${this.boardNumber}`;
      }
    },
    status: {
      type: String,
      enum: ['available', 'live', 'maintenance'],
      default: 'available'
    },
    currentMatchId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Match',
      default: null
    },
    assignedCategory: {
      type: String,
      enum: ['all', 'boys_singles', 'girls_singles', 'boys_doubles', 'girls_doubles', 'mixed_doubles'],
      default: 'all'
    },
    adminInCharge: {
      type: String,
      default: ''
    }
  },
  { timestamps: true }
);

carromBoardSchema.index({ tournamentId: 1, boardNumber: 1 }, { unique: true });

module.exports = mongoose.model('CarromBoard', carromBoardSchema);
