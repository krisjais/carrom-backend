const express = require('express');
const router = express.Router();
const adminCtrl = require('../controllers/chessAdminController');
const { chessAdminAuth } = require('../middleware/chessAuth');

// Dashboard
router.get('/dashboard', chessAdminAuth, adminCtrl.getDashboardStats);
router.get('/chess/dashboard', chessAdminAuth, adminCtrl.getDashboardStats);

// Players
router.get('/players', chessAdminAuth, adminCtrl.getAdminPlayers);
router.get('/chess/players', chessAdminAuth, adminCtrl.getAdminPlayers);
router.patch('/players/:id', chessAdminAuth, adminCtrl.updatePlayer);
router.put('/players/:id', chessAdminAuth, adminCtrl.updatePlayer);
router.delete('/players/:id', chessAdminAuth, adminCtrl.deletePlayer);

// Rounds
router.get('/rounds', chessAdminAuth, adminCtrl.getAdminRounds);
router.get('/chess/rounds', chessAdminAuth, adminCtrl.getAdminRounds);
router.post('/rounds', chessAdminAuth, adminCtrl.createRound);
router.post('/chess/rounds', chessAdminAuth, adminCtrl.createRound);
router.delete('/rounds/:id', chessAdminAuth, adminCtrl.deleteRound);
router.delete('/chess/rounds/:id', chessAdminAuth, adminCtrl.deleteRound);

// Matches
router.get('/matches', chessAdminAuth, adminCtrl.getAdminMatches);
router.get('/chess/matches', chessAdminAuth, adminCtrl.getAdminMatches);
router.post('/matches/generate', chessAdminAuth, adminCtrl.generateMatches);
router.patch('/matches/:id', chessAdminAuth, adminCtrl.updateMatch);
router.put('/matches/:id', chessAdminAuth, adminCtrl.updateMatch);
router.post('/matches/:id/result', chessAdminAuth, adminCtrl.submitMatchResult);

// Standings
router.get('/standings', chessAdminAuth, adminCtrl.getAdminStandings);
router.get('/chess/standings', chessAdminAuth, adminCtrl.getAdminStandings);

module.exports = router;
