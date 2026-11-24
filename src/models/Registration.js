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
    participateSingles: {
      type: Boolean,
      default: true
    },
    participateDoubles: {
      type: Boolean,
      default: false
    },
    participateMixedDoubles: {
      type: Boolean,
      default: false
    },
    doublesPartnerName: {
      type: String,
      default: '',
      trim: true
    },
    doublesPartnerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Participant',
      default: null
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
    mixedDoublesPartnerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Participant',
      default: null
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
    },
    isAutoCreatedPartner: {
      type: Boolean,
      default: false
    }
  },
  { timestamps: true }
);

registrationSchema.index({ participantId: 1, tournamentId: 1 }, { unique: true });
registrationSchema.index({ tournamentId: 1, status: 1, createdAt: -1 });

module.exports = mongoose.model('Registration', registrationSchema);
