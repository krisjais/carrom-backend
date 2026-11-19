const express = require('express');
const router = express.Router();
const {
  getBoards,
  createBoard,
  updateBoard,
  deleteBoard
} = require('../controllers/carromBoardController');
const { authRequired, adminOnly } = require('../middleware/auth');

// Public read: Spectators and admins can fetch live boards
router.get('/', getBoards);

// Admin-only management
router.post('/', authRequired, adminOnly, createBoard);
router.put('/:id', authRequired, adminOnly, updateBoard);
router.delete('/:id', authRequired, adminOnly, deleteBoard);

module.exports = router;
