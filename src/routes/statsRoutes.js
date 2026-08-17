const express = require('express');
const router = express.Router();
const { getOverviewStats, getAuditLogs } = require('../controllers/statsController');
const { authRequired, adminOnly } = require('../middleware/auth');

router.get('/overview', getOverviewStats);
router.get('/audit-logs', authRequired, adminOnly, getAuditLogs);

module.exports = router;
