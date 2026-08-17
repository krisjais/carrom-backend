const express = require('express');
const router = express.Router();
const {
  generateCategoryDraw,
  getBracketTree,
  publishAndLockDraw
} = require('../controllers/drawController');
const { authRequired, adminOnly } = require('../middleware/auth');

router.post('/generate', authRequired, adminOnly, generateCategoryDraw);
router.get('/category/:category', getBracketTree);
router.post('/publish-lock', authRequired, adminOnly, publishAndLockDraw);

module.exports = router;
