const Registration = require('../models/Registration');
const Participant = require('../models/Participant');
const Tournament = require('../models/Tournament');
const Team = require('../models/Team');
const Match = require('../models/Match');
const AuditLog = require('../models/AuditLog');
const User = require('../models/User');

// Public / Participant submission
const submitRegistration = async (req, res, next) => {
  try {
    const {
      fullName,
      gender,
      studentId,
      email,
      phone,
      department,
      doublesPartnerName,
      mixedDoublesPartnerName,
      tournamentId
    } = req.body;

    if (!fullName || !gender || !studentId || !email || !phone || !department) {
      return res.status(400).json({ success: false, message: 'All personal fields are required.' });
    }

    if (!doublesPartnerName || !mixedDoublesPartnerName) {
      return res.status(400).json({
        success: false,
        message: 'Please provide partner names for Doubles and Mixed Doubles categories.'
      });
    }

    let tournId = tournamentId;
    if (!tournId) {
      const activeTourn = await Tournament.findOne().sort({ createdAt: -1 });
      if (!activeTourn) return res.status(400).json({ success: false, message: 'No active tournament found.' });
      tournId = activeTourn._id;
    }

    // Check if tournament registration is open
    const tourn = await Tournament.findById(tournId);
    if (tourn.status === 'registration_closed' || tourn.status === 'completed') {
      return res.status(400).json({ success: false, message: 'Registration for this tournament is currently closed.' });
    }

    // Upsert or find participant
    let participant = await Participant.findOne({
      $or: [{ email: email.toLowerCase().trim() }, { studentId: studentId.toUpperCase().trim() }]
    });

    if (!participant) {
      participant = await Participant.create({
        fullName: fullName.trim(),
        gender,
        studentId: studentId.toUpperCase().trim(),
        email: email.toLowerCase().trim(),
        phone: phone.trim(),
        department: department.trim()
      });
    } else {
      participant.fullName = fullName.trim();
      participant.gender = gender;
      participant.phone = phone.trim();
      participant.department = department.trim();
      await participant.save();
    }

    // Check if registration already exists
    let existingReg = await Registration.findOne({ participantId: participant._id, tournamentId: tournId });
    if (existingReg) {
      existingReg.gender = gender;
      existingReg.doublesPartnerName = doublesPartnerName.trim();
      existingReg.mixedDoublesPartnerName = mixedDoublesPartnerName.trim();
      await existingReg.save();
      return res.json({ success: true, message: 'Registration details updated.', registration: existingReg });
    }

    const registration = await Registration.create({
      participantId: participant._id,
      tournamentId: tournId,
      gender,
      doublesPartnerName: doublesPartnerName.trim(),
      mixedDoublesPartnerName: mixedDoublesPartnerName.trim(),
      status: 'pending'
    });

    res.status(201).json({
      success: true,
      message: 'Tournament registration submitted successfully. Admin will verify your entry.',
      registration
    });
  } catch (error) {
    next(error);
  }
};

const {
  enrichRegistrationsWithValidation,
  getTournamentEntryValidationReport
} = require('../services/partnerValidationEngine');

// Admin: Get all registrations with filtering and partner validation enrichment
const getAllRegistrations = async (req, res, next) => {
  try {
    const { status, gender, search, tournamentId } = req.query;

    let query = {};
    if (status) query.status = status;
    if (gender) query.gender = gender;

    let tournId = tournamentId;
    if (!tournId) {
      const activeTourn = await Tournament.findOne().sort({ createdAt: -1 });
      if (activeTourn) tournId = activeTourn._id;
    }
    if (tournId) query.tournamentId = tournId;

    let registrations = await Registration.find(query)
      .populate('participantId')
      .sort({ createdAt: -1 });

    if (search) {
      const s = search.toLowerCase();
      registrations = registrations.filter((r) => {
        const p = r.participantId;
        if (!p) return false;
        return (
          p.fullName.toLowerCase().includes(s) ||
          p.studentId.toLowerCase().includes(s) ||
          p.email.toLowerCase().includes(s) ||
          p.department.toLowerCase().includes(s)
        );
      });
    }

    const enrichedRegistrations = await enrichRegistrationsWithValidation(registrations, tournId);

    res.json({ success: true, count: enrichedRegistrations.length, registrations: enrichedRegistrations });
  } catch (error) {
    next(error);
  }
};

// Admin: Get tournament partner validation summary report
const getValidationSummary = async (req, res, next) => {
  try {
    let tournId = req.query.tournamentId;
    if (!tournId) {
      const activeTourn = await Tournament.findOne().sort({ createdAt: -1 });
      if (activeTourn) tournId = activeTourn._id;
    }

    const report = await getTournamentEntryValidationReport(tournId);
    res.json({ success: true, report });
  } catch (error) {
    next(error);
  }
};

// Participant: View own registration, approved teams & match schedule
const getMyRegistration = async (req, res, next) => {
  try {
    if (!req.user || req.user.role !== 'participant') {
      return res.status(403).json({ success: false, message: 'Participant portal access only.' });
    }

    const participant = await Participant.findOne({
      $or: [{ userId: req.user._id }, { email: req.user.email }]
    });

    if (!participant) {
      return res.status(404).json({ success: false, message: 'No participant record associated with your account.' });
    }

    const registration = await Registration.findOne({ participantId: participant._id })
      .populate('tournamentId')
      .sort({ createdAt: -1 });

    // Find all teams this participant is part of
    const teams = await Team.find({
      $or: [{ player1: participant._id }, { player2: participant._id }]
    }).populate('player1').populate('player2');

    const teamIds = teams.map((t) => t._id);

    // Find all matches for these teams
    const matches = await Match.find({
      $or: [{ team1: { $in: teamIds } }, { team2: { $in: teamIds } }]
    })
      .populate('team1')
      .populate('team2')
      .populate('winnerTeam')
      .sort({ roundNumber: 1, matchNumber: 1 });

    res.json({
      success: true,
      participant,
      registration,
      teams,
      matches
    });
  } catch (error) {
    next(error);
  }
};

// Admin: Update registration status (Approve / Reject)
const updateRegistrationStatus = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status, adminNotes } = req.body;

    if (!['pending', 'approved', 'rejected'].includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid status.' });
    }

    const registration = await Registration.findById(id).populate('participantId');
    if (!registration) {
      return res.status(404).json({ success: false, message: 'Registration record not found.' });
    }

    registration.status = status;
    if (adminNotes !== undefined) registration.adminNotes = adminNotes;
    await registration.save();

    // If approved, update participant approved status
    if (registration.participantId) {
      await Participant.findByIdAndUpdate(registration.participantId._id, {
        isApproved: status === 'approved'
      });

      // Auto-create Singles Team record if approved
      if (status === 'approved') {
        const p = registration.participantId;
        const singlesCategory = p.gender === 'male' ? 'boys_singles' : 'girls_singles';

        const existingSinglesTeam = await Team.findOne({
          tournamentId: registration.tournamentId,
          category: singlesCategory,
          player1: p._id
        });

        if (!existingSinglesTeam) {
          await Team.create({
            name: p.fullName,
            tournamentId: registration.tournamentId,
            category: singlesCategory,
            player1: p._id,
            player2: null,
            isApproved: true
          });
        }
      }
    }

    await AuditLog.create({
      action: 'UPDATE_REGISTRATION_STATUS',
      performedBy: req.user._id,
      performedByName: req.user.fullName,
      entityType: 'Registration',
      entityId: registration._id.toString(),
      details: {
        participant: registration.participantId ? registration.participantId.fullName : 'Unknown',
        newStatus: status
      },
      reason: `Admin updated registration status to ${status}.`
    });

    res.json({ success: true, message: `Registration ${status} successfully.`, registration });
  } catch (error) {
    next(error);
  }
};

// Admin: Delete registration and participant
const deleteRegistration = async (req, res, next) => {
  try {
    const { id } = req.params;
    const registration = await Registration.findById(id).populate('participantId');
    if (!registration) {
      return res.status(404).json({ success: false, message: 'Registration not found.' });
    }

    const participant = registration.participantId;
    const participantName = participant ? participant.fullName : 'Unknown';

    // Remove teams associated with this participant
    if (participant) {
      await Team.deleteMany({
        $or: [{ player1: participant._id }, { player2: participant._id }]
      });

      // Remove login user account if exists
      if (participant.userId) {
        await User.findByIdAndDelete(participant.userId);
      }
      if (participant.email) {
        await User.deleteMany({ email: participant.email.toLowerCase() });
      }

      // Delete participant record
      await Participant.findByIdAndDelete(participant._id);
    }

    // Delete registration record
    await Registration.findByIdAndDelete(id);

    await AuditLog.create({
      action: 'DELETE_REGISTRATION',
      performedBy: req.user._id,
      performedByName: req.user.fullName,
      entityType: 'Registration',
      entityId: id,
      details: {
        participant: participantName,
        email: participant?.email,
        studentId: participant?.studentId
      },
      reason: `Admin deleted user/registration for ${participantName}.`
    });

    res.json({
      success: true,
      message: `User and registration for ${participantName} deleted successfully.`
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  submitRegistration,
  getAllRegistrations,
  getMyRegistration,
  updateRegistrationStatus,
  deleteRegistration,
  getValidationSummary
};
