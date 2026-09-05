const Tournament = require('../models/Tournament');
const Team = require('../models/Team');
const Match = require('../models/Match');
const Registration = require('../models/Registration');
const AuditLog = require('../models/AuditLog');

// Get active tournament
const getCurrentTournament = async (req, res, next) => {
  try {
    let tournament = await Tournament.findOne().sort({ createdAt: -1 });

    if (!tournament) {
      // Auto-create default tournament if none exists
      tournament = await Tournament.create({
        title: 'Annual Intra-College Carrom Championship',
        edition: '2026',
        status: 'registration_open',
        boardCount: 6
      });
    }

    // Category summary statistics
    const categories = ['boys_singles', 'girls_singles', 'boys_doubles', 'girls_doubles', 'mixed_doubles'];
    const categoryStats = {};

    for (const cat of categories) {
      const teamsCount = await Team.countDocuments({ tournamentId: tournament._id, category: cat, isApproved: true });
      const matchesCount = await Match.countDocuments({ tournamentId: tournament._id, category: cat });
      const completedMatches = await Match.countDocuments({ tournamentId: tournament._id, category: cat, status: 'completed' });
      const liveMatches = await Match.countDocuments({ tournamentId: tournament._id, category: cat, status: 'live' });

      categoryStats[cat] = {
        teamsCount,
        matchesCount,
        completedMatches,
        liveMatches,
        isDrawPublished: tournament.drawsPublished ? Boolean(tournament.drawsPublished[cat]) : false,
        isDrawLocked: tournament.drawsLocked ? Boolean(tournament.drawsLocked[cat]) : false
      };
    }

    const totalRegistrations = await Registration.countDocuments({ tournamentId: tournament._id });
    const pendingRegistrations = await Registration.countDocuments({ tournamentId: tournament._id, status: 'pending' });

    res.json({
      success: true,
      tournament,
      stats: {
        totalRegistrations,
        pendingRegistrations,
        categories: categoryStats
      }
    });
  } catch (error) {
    next(error);
  }
};

// Update tournament status
const updateTournamentStatus = async (req, res, next) => {
  try {
    const { status } = req.body;
    if (!['registration_open', 'registration_closed', 'ongoing', 'completed'].includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid tournament status.' });
    }

    const tournament = await Tournament.findOne().sort({ createdAt: -1 });
    if (!tournament) {
      return res.status(404).json({ success: false, message: 'Tournament not found.' });
    }

    tournament.status = status;
    await tournament.save();

    await AuditLog.create({
      action: 'UPDATE_TOURNAMENT_STATUS',
      performedBy: req.user._id,
      performedByName: req.user.fullName,
      entityType: 'Tournament',
      entityId: tournament._id.toString(),
      details: { newStatus: status },
      reason: `Tournament status changed to ${status}`
    });

    res.json({ success: true, message: `Tournament status updated to ${status}`, tournament });
  } catch (error) {
    next(error);
  }
};

// Update tournament rules
const updateTournamentRules = async (req, res, next) => {
  try {
    const { rulesContent } = req.body;
    if (!rulesContent) {
      return res.status(400).json({ success: false, message: 'Rules content is required.' });
    }

    const tournament = await Tournament.findOne().sort({ createdAt: -1 });
    if (!tournament) {
      return res.status(404).json({ success: false, message: 'Tournament not found.' });
    }

    tournament.rulesContent = rulesContent;
    await tournament.save();

    res.json({ success: true, message: 'Tournament rules updated successfully.', rulesContent: tournament.rulesContent });
  } catch (error) {
    next(error);
  }
};

const { generateSequentialSchedule, recalculateEstimatedTimes } = require('../services/scheduleEngine');

// Update settings (title, edition, scheduleSettings)
const updateTournamentSettings = async (req, res, next) => {
  try {
    const { title, edition, scheduleSettings } = req.body;
    const tournament = await Tournament.findOne().sort({ createdAt: -1 });
    if (!tournament) {
      return res.status(404).json({ success: false, message: 'Tournament not found.' });
    }

    if (title) tournament.title = title.trim();
    if (edition) tournament.edition = edition.trim();

    if (scheduleSettings) {
      if (scheduleSettings.startTime) tournament.scheduleSettings.startTime = new Date(scheduleSettings.startTime);
      if (scheduleSettings.matchDurationMinutes !== undefined) tournament.scheduleSettings.matchDurationMinutes = Number(scheduleSettings.matchDurationMinutes);
      if (scheduleSettings.breakTimeMinutes !== undefined) tournament.scheduleSettings.breakTimeMinutes = Number(scheduleSettings.breakTimeMinutes);
      if (scheduleSettings.minRestTimeMinutes !== undefined) tournament.scheduleSettings.minRestTimeMinutes = Number(scheduleSettings.minRestTimeMinutes);
      tournament.markModified('scheduleSettings');
    }

    await tournament.save();

    // Recalculate queue estimated times with new settings
    await recalculateEstimatedTimes(tournament._id);

    res.json({ success: true, message: 'Tournament settings updated successfully.', tournament });
  } catch (error) {
    next(error);
  }
};

// Generate full sequential schedule on Main Carrom Board
const generateTournamentSchedule = async (req, res, next) => {
  try {
    const tournament = await Tournament.findOne().sort({ createdAt: -1 });
    if (!tournament) {
      return res.status(404).json({ success: false, message: 'Tournament not found.' });
    }

    const result = await generateSequentialSchedule(tournament._id, req.body, req.user._id);

    await AuditLog.create({
      action: 'GENERATE_SEQUENTIAL_SCHEDULE',
      performedBy: req.user._id,
      performedByName: req.user.fullName || 'Admin',
      entityType: 'Tournament',
      entityId: tournament._id.toString(),
      details: { settings: req.body, result },
      reason: `Generated sequential match schedule for Main Carrom Board.`
    });

    res.json({
      success: true,
      message: 'Sequential schedule generated successfully for Main Carrom Board.',
      result
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getCurrentTournament,
  updateTournamentStatus,
  updateTournamentRules,
  updateTournamentSettings,
  generateTournamentSchedule
};
