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
router.post('/players', chessAdminAuth, adminCtrl.createPlayer);
router.post('/chess/players', chessAdminAuth, adminCtrl.createPlayer);
router.post('/players/import', chessAdminAuth, adminCtrl.importPlayers);
router.post('/chess/players/import', chessAdminAuth, adminCtrl.importPlayers);
router.patch('/players/:id', chessAdminAuth, adminCtrl.updatePlayer);
router.put('/players/:id', chessAdminAuth, adminCtrl.updatePlayer);
router.patch('/chess/players/:id', chessAdminAuth, adminCtrl.updatePlayer);
router.put('/chess/players/:id', chessAdminAuth, adminCtrl.updatePlayer);
router.put('/players/:id/password', chessAdminAuth, adminCtrl.updatePlayer);
router.patch('/players/:id/password', chessAdminAuth, adminCtrl.updatePlayer);
router.put('/chess/players/:id/password', chessAdminAuth, adminCtrl.updatePlayer);
router.patch('/chess/players/:id/password', chessAdminAuth, adminCtrl.updatePlayer);
router.delete('/players/:id', chessAdminAuth, adminCtrl.deletePlayer);
router.delete('/chess/players/:id', chessAdminAuth, adminCtrl.deletePlayer);

// Matches & Rounds
router.get('/matches', chessAdminAuth, adminCtrl.getAdminMatches);
router.get('/chess/matches', chessAdminAuth, adminCtrl.getAdminMatches);
router.post('/matches', chessAdminAuth, adminCtrl.createMatch);
router.post('/chess/matches', chessAdminAuth, adminCtrl.createMatch);
router.delete('/rounds/all', chessAdminAuth, adminCtrl.deleteAllRounds);
router.delete('/chess/rounds/all', chessAdminAuth, adminCtrl.deleteAllRounds);
router.delete('/rounds', chessAdminAuth, adminCtrl.deleteAllRounds);
router.delete('/chess/rounds', chessAdminAuth, adminCtrl.deleteAllRounds);
router.delete('/rounds/:round', chessAdminAuth, adminCtrl.deleteRound);
router.delete('/chess/rounds/:round', chessAdminAuth, adminCtrl.deleteRound);
router.post('/matches/generate', chessAdminAuth, adminCtrl.generateMatches);
router.post('/chess/matches/generate', chessAdminAuth, adminCtrl.generateMatches);
router.post('/matches/:id/start', chessAdminAuth, adminCtrl.startMatch);
router.post('/chess/matches/:id/start', chessAdminAuth, adminCtrl.startMatch);
router.put('/matches/:id/start', chessAdminAuth, adminCtrl.startMatch);
router.put('/chess/matches/:id/start', chessAdminAuth, adminCtrl.startMatch);
router.post('/matches/:id/restart', chessAdminAuth, adminCtrl.updateMatch);
router.post('/chess/matches/:id/restart', chessAdminAuth, adminCtrl.updateMatch);
router.put('/matches/:id/restart', chessAdminAuth, adminCtrl.updateMatch);
router.put('/chess/matches/:id/restart', chessAdminAuth, adminCtrl.updateMatch);
router.patch('/matches/:id', chessAdminAuth, adminCtrl.updateMatch);
router.put('/matches/:id', chessAdminAuth, adminCtrl.updateMatch);
router.patch('/chess/matches/:id', chessAdminAuth, adminCtrl.updateMatch);
router.put('/chess/matches/:id', chessAdminAuth, adminCtrl.updateMatch);
router.delete('/matches/:id', chessAdminAuth, adminCtrl.deleteMatch);
router.delete('/chess/matches/:id', chessAdminAuth, adminCtrl.deleteMatch);
router.post('/matches/bulk-delete', chessAdminAuth, adminCtrl.bulkDeleteMatches);
router.post('/chess/matches/bulk-delete', chessAdminAuth, adminCtrl.bulkDeleteMatches);
router.put('/matches/:id/live-score', chessAdminAuth, adminCtrl.updateLiveCaptures);
router.put('/chess/matches/:id/live-score', chessAdminAuth, adminCtrl.updateLiveCaptures);
router.patch('/matches/:id/live-score', chessAdminAuth, adminCtrl.updateLiveCaptures);
router.patch('/chess/matches/:id/live-score', chessAdminAuth, adminCtrl.updateLiveCaptures);
router.post('/matches/:id/result', chessAdminAuth, adminCtrl.submitMatchResult);
router.post('/chess/matches/:id/result', chessAdminAuth, adminCtrl.submitMatchResult);

// Standings
router.get('/standings', chessAdminAuth, adminCtrl.getAdminStandings);
router.get('/chess/standings', chessAdminAuth, adminCtrl.getAdminStandings);

module.exports = router;
