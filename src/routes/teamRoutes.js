const express = require('express');
const router = express.Router();
const { getTeams, createDoublesPair, deleteTeam, deleteAllTeams } = require('../controllers/teamController');
const { authRequired, adminOnly } = require('../middleware/auth');

router.get('/', getTeams);
router.post('/create-pair', authRequired, adminOnly, createDoublesPair);
router.delete('/bulk-clear', authRequired, adminOnly, deleteAllTeams);
router.delete('/:id', authRequired, adminOnly, deleteTeam);

module.exports = router;
