const mongoose = require('mongoose');

const chessBoardSchema = new mongoose.Schema(
  {
    boardNumber: {
      type: Number,
      required: true,
      unique: true
    },
    name: {
      type: String,
      required: true,
      default: function () {
        return `Chess Board ${this.boardNumber}`;
      }
    },
    status: {
      type: String,
      enum: ['available', 'live', 'maintenance'],
      default: 'available'
    },
    currentMatchId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ChessMatch',
      default: null
    },
    adminInCharge: {
      type: String,
      default: ''
    }
  },
  { timestamps: true }
);

chessBoardSchema.index({ boardNumber: 1 }, { unique: true });

module.exports = mongoose.model('ChessBoard', chessBoardSchema);
