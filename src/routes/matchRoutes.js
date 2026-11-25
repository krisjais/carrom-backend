const express = require('express');
const router = express.Router();
const {
  getMatches,
  createAdditionalMatch,
  getLiveMatches,
  getMatchById,
  startMatch,
  stopLiveMatch,
  updateMatchTimer,
  updateScore,
  confirmMatch,
  correctMatch,
  scheduleMatch,
  substituteMatchPartner
} = require('../controllers/matchController');
const { authRequired, adminOnly } = require('../middleware/auth');

router.get('/', getMatches);
router.post('/manual', authRequired, adminOnly, createAdditionalMatch);
router.get('/live', getLiveMatches);
router.get('/:id', getMatchById);
router.post('/:id/start', authRequired, adminOnly, startMatch);
router.post('/:id/stop-live', authRequired, adminOnly, stopLiveMatch);
router.post('/:id/timer', authRequired, adminOnly, updateMatchTimer);
router.put('/:id/score', authRequired, adminOnly, updateScore);
router.post('/:id/confirm', authRequired, adminOnly, confirmMatch);
router.post('/:id/correct', authRequired, adminOnly, correctMatch);
router.put('/:id/schedule', authRequired, adminOnly, scheduleMatch);
router.put('/:id/substitute', authRequired, adminOnly, substituteMatchPartner);
router.post('/:id/substitute', authRequired, adminOnly, substituteMatchPartner);

module.exports = router;

