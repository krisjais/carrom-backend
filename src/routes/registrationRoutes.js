const express = require('express');
const router = express.Router();
const {
  submitRegistration,
  getAllRegistrations,
  getMyRegistration,
  updateRegistrationStatus,
  deleteRegistration,
  getValidationSummary
} = require('../controllers/registrationController');
const { authRequired, adminOnly } = require('../middleware/auth');

router.post('/', submitRegistration);
router.get('/', authRequired, adminOnly, getAllRegistrations);
router.get('/validation-summary', authRequired, adminOnly, getValidationSummary);
router.get('/my', authRequired, getMyRegistration);
router.put('/:id/status', authRequired, adminOnly, updateRegistrationStatus);
router.delete('/:id', authRequired, adminOnly, deleteRegistration);

module.exports = router;
