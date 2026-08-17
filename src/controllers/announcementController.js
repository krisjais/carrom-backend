const Announcement = require('../models/Announcement');

// Get all announcements
const getAnnouncements = async (req, res, next) => {
  try {
    const announcements = await Announcement.find().sort({ isPinned: -1, createdAt: -1 });
    res.json({ success: true, count: announcements.length, announcements });
  } catch (error) {
    next(error);
  }
};

// Admin: Create announcement
const createAnnouncement = async (req, res, next) => {
  try {
    const { title, content, priority, isPinned } = req.body;
    if (!title || !content) {
      return res.status(400).json({ success: false, message: 'Title and content are required.' });
    }

    const announcement = await Announcement.create({
      title: title.trim(),
      content: content.trim(),
      priority: priority || 'normal',
      isPinned: Boolean(isPinned),
      authorName: req.user.fullName || 'Tournament Director'
    });

    res.status(201).json({ success: true, message: 'Announcement published successfully.', announcement });
  } catch (error) {
    next(error);
  }
};

// Admin: Delete announcement
const deleteAnnouncement = async (req, res, next) => {
  try {
    const { id } = req.params;
    await Announcement.findByIdAndDelete(id);
    res.json({ success: true, message: 'Announcement deleted.' });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getAnnouncements,
  createAnnouncement,
  deleteAnnouncement
};
