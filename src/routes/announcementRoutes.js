const express = require('express');
const router = express.Router();
const {
  getAnnouncements,
  createAnnouncement,
  deleteAnnouncement
} = require('../controllers/announcementController');
const { authRequired, adminOnly } = require('../middleware/auth');

router.get('/', getAnnouncements);
router.post('/', authRequired, adminOnly, createAnnouncement);
router.delete('/:id', authRequired, adminOnly, deleteAnnouncement);

module.exports = router;
