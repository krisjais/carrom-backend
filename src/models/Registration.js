const mongoose = require('mongoose');

const registrationSchema = new mongoose.Schema(
  {
    participantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Participant',
      required: true
    },
    tournamentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Tournament',
      required: true
    },
    gender: {
      type: String,
      enum: ['male', 'female'],
      required: true
    },
    doublesPartnerName: {
      type: String,
      default: '',
      trim: true
    },
    doublesPartnerStudentId: {
      type: String,
      default: '',
      trim: true,
      uppercase: true
    },
    mixedDoublesPartnerName: {
      type: String,
      default: '',
      trim: true
    },
    mixedDoublesPartnerStudentId: {
      type: String,
      default: '',
      trim: true,
      uppercase: true
    },
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected'],
      default: 'pending'
    },
    adminNotes: {
      type: String,
      default: ''
    }
  },
  { timestamps: true }
);

registrationSchema.index({ participantId: 1, tournamentId: 1 }, { unique: true });

module.exports = mongoose.model('Registration', registrationSchema);
