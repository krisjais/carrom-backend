const mongoose = require('mongoose');

const announcementSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true
    },
    content: {
      type: String,
      required: true
    },
    priority: {
      type: String,
      enum: ['normal', 'urgent'],
      default: 'normal'
    },
    isPinned: {
      type: Boolean,
      default: false
    },
    authorName: {
      type: String,
      default: 'Tournament Director'
    }
  },
  { timestamps: true }
);

module.exports = mongoose.model('Announcement', announcementSchema);
