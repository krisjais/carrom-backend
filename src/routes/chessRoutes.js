const express = require('express');
const router = express.Router();
const publicCtrl = require('../controllers/chessPublicController');
const adminCtrl = require('../controllers/chessAdminController');
const { adminLogin } = require('../controllers/chessController');
const { chessAdminAuth } = require('../middleware/chessAuth');

// -------------------------------------------------------------
// PUBLIC APIS
// -------------------------------------------------------------
router.get('/settings', publicCtrl.getSettings);
router.post('/register', publicCtrl.registerPlayer);
router.get('/players', publicCtrl.getPlayers);
router.get('/players/:id', publicCtrl.getPlayerById);
router.get('/matches', publicCtrl.getMatches);
router.get('/matches/:id', publicCtrl.getMatchById);
router.get('/standings', publicCtrl.getStandings);
router.get('/rounds', publicCtrl.getRounds);

// -------------------------------------------------------------
// ADMIN AUTH & DASHBOARD
// -------------------------------------------------------------
router.post('/admin/login', adminLogin);
router.get('/admin/stats', publicCtrl.getSettings);
router.get('/admin/dashboard', chessAdminAuth, adminCtrl.getDashboardStats);

// -------------------------------------------------------------
// ADMIN PLAYER MANAGEMENT
// -------------------------------------------------------------
router.get('/admin/players', chessAdminAuth, adminCtrl.getAdminPlayers);
router.put('/admin/players/:id/status', chessAdminAuth, adminCtrl.updatePlayer);
router.put('/admin/players/:id', chessAdminAuth, adminCtrl.updatePlayer);
router.patch('/admin/players/:id', chessAdminAuth, adminCtrl.updatePlayer);
router.delete('/admin/players/:id', chessAdminAuth, adminCtrl.deletePlayer);

// -------------------------------------------------------------
// ADMIN ROUND MANAGEMENT
// -------------------------------------------------------------
router.get('/admin/rounds', chessAdminAuth, adminCtrl.getAdminRounds);
router.post('/admin/rounds', chessAdminAuth, adminCtrl.createRound);
router.delete('/admin/rounds/:id', chessAdminAuth, adminCtrl.deleteRound);

// -------------------------------------------------------------
// ADMIN MATCH MANAGEMENT
// -------------------------------------------------------------
router.get('/admin/matches', chessAdminAuth, adminCtrl.getAdminMatches);
router.post('/admin/matches/generate', chessAdminAuth, adminCtrl.generateMatches);
router.post('/admin/matches/:id/start', chessAdminAuth, adminCtrl.updateMatch);
router.put('/admin/matches/:id/result', chessAdminAuth, adminCtrl.submitMatchResult);
router.post('/admin/matches/:id/result', chessAdminAuth, adminCtrl.submitMatchResult);
router.post('/admin/matches/:id/override', chessAdminAuth, adminCtrl.overrideMatchResult);
router.post('/admin/matches/:id/cancel', chessAdminAuth, adminCtrl.updateMatch);
router.patch('/admin/matches/:id', chessAdminAuth, adminCtrl.updateMatch);
router.put('/admin/matches/:id', chessAdminAuth, adminCtrl.updateMatch);

// -------------------------------------------------------------
// ADMIN STANDINGS & TOURNAMENT SETTINGS
// -------------------------------------------------------------
router.get('/admin/standings', chessAdminAuth, adminCtrl.getAdminStandings);
router.post('/admin/standings/refresh', chessAdminAuth, adminCtrl.getAdminStandings);
router.put('/admin/settings', chessAdminAuth, adminCtrl.updateSettings);
router.post('/admin/reset', chessAdminAuth, adminCtrl.resetTournamentData);

module.exports = router;
