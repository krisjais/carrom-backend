const express = require('express');
const router = express.Router();
const {
  getMatches,
  getLiveMatches,
  getMatchById,
  startMatch,
  updateScore,
  confirmMatch,
  correctMatch,
  scheduleMatch
} = require('../controllers/matchController');
const { authRequired, adminOnly } = require('../middleware/auth');

router.get('/', getMatches);
router.get('/live', getLiveMatches);
router.get('/:id', getMatchById);
router.post('/:id/start', authRequired, adminOnly, startMatch);
router.put('/:id/score', authRequired, adminOnly, updateScore);
router.post('/:id/confirm', authRequired, adminOnly, confirmMatch);
router.post('/:id/correct', authRequired, adminOnly, correctMatch);
router.put('/:id/schedule', authRequired, adminOnly, scheduleMatch);

module.exports = router;
