const express = require('express');
const router = express.Router();
const {
  getTeams,
  createDoublesPair,
  updateTeam,
  deleteTeam,
  deleteAllTeams,
  autoPopulateTeams
} = require('../controllers/teamController');
const { authRequired, adminOnly } = require('../middleware/auth');

router.get('/', getTeams);
router.post('/create-pair', authRequired, adminOnly, createDoublesPair);
router.post('/auto-populate', authRequired, adminOnly, autoPopulateTeams);
router.put('/:id', authRequired, adminOnly, updateTeam);
router.patch('/:id', authRequired, adminOnly, updateTeam);
router.delete('/bulk-clear', authRequired, adminOnly, deleteAllTeams);
router.delete('/:id', authRequired, adminOnly, deleteTeam);

module.exports = router;
