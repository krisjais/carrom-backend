const express = require('express');
const router = express.Router();
const {
  submitRegistration,
  lookupRegistrationByStudentId,
  getAllRegistrations,
  getMyRegistration,
  updateRegistrationStatus,
  adminEditRegistration,
  deleteRegistration,
  bulkDeleteRegistrations,
  getValidationSummary
} = require('../controllers/registrationController');
const { authRequired, adminOnly } = require('../middleware/auth');

// Public endpoints
router.post('/', submitRegistration);
router.get('/lookup/:query', lookupRegistrationByStudentId);

// Admin & Auth protected endpoints
router.get('/', authRequired, adminOnly, getAllRegistrations);
router.get('/validation-summary', authRequired, adminOnly, getValidationSummary);
router.get('/my', authRequired, getMyRegistration);
router.put('/:id/status', authRequired, adminOnly, updateRegistrationStatus);
router.put('/:id/admin-edit', authRequired, adminOnly, adminEditRegistration);
router.delete('/bulk-clear', authRequired, adminOnly, bulkDeleteRegistrations);
router.post('/bulk-delete', authRequired, adminOnly, bulkDeleteRegistrations);
router.delete('/:id', authRequired, adminOnly, deleteRegistration);

module.exports = router;
