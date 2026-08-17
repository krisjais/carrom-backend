const mongoose = require('mongoose');

const auditLogSchema = new mongoose.Schema(
  {
    action: {
      type: String,
      required: true
    },
    performedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null
    },
    performedByName: {
      type: String,
      default: 'Admin'
    },
    entityType: {
      type: String,
      required: true
    },
    entityId: {
      type: String,
      default: null
    },
    details: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    },
    reason: {
      type: String,
      default: ''
    }
  },
  { timestamps: true }
);

module.exports = mongoose.model('AuditLog', auditLogSchema);
