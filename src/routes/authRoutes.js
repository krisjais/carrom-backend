const express = require('express');
const router = express.Router();
const { login, registerParticipant, getMe } = require('../controllers/authController');
const { authRequired } = require('../middleware/auth');

router.post('/login', login);
router.post('/register-participant', registerParticipant);
router.get('/me', authRequired, getMe);

module.exports = router;
