const express = require('express');
const router = express.Router();
const {
  getCurrentTournament,
  updateTournamentStatus,
  updateTournamentRules,
  updateTournamentSettings,
  generateTournamentSchedule
} = require('../controllers/tournamentController');
const { authRequired, adminOnly } = require('../middleware/auth');

router.get('/current', getCurrentTournament);
router.put('/current/status', authRequired, adminOnly, updateTournamentStatus);
router.put('/current/rules', authRequired, adminOnly, updateTournamentRules);
router.put('/current/settings', authRequired, adminOnly, updateTournamentSettings);
router.post('/current/schedule/generate', authRequired, adminOnly, generateTournamentSchedule);

module.exports = router;
