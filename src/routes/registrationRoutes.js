const express = require('express');
const router = express.Router();
const {
  submitRegistration,
  getAllRegistrations,
  getMyRegistration,
  updateRegistrationStatus
} = require('../controllers/registrationController');
const { authRequired, adminOnly } = require('../middleware/auth');

router.post('/', submitRegistration);
router.get('/', authRequired, adminOnly, getAllRegistrations);
router.get('/my', authRequired, getMyRegistration);
router.put('/:id/status', authRequired, adminOnly, updateRegistrationStatus);

module.exports = router;
