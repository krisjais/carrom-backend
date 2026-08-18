const express = require('express');
const router = express.Router();
const {
  generateCategoryDraw,
  getBracketTree,
  publishAndLockDraw,
  advanceRound
} = require('../controllers/drawController');
const { authRequired, adminOnly } = require('../middleware/auth');

router.post('/generate', authRequired, adminOnly, generateCategoryDraw);
router.get('/category/:category', getBracketTree);
router.post('/publish-lock', authRequired, adminOnly, publishAndLockDraw);
router.post('/advance-round', authRequired, adminOnly, advanceRound);

module.exports = router;
