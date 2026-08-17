const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Participant = require('../models/Participant');

const generateToken = (user) => {
  return jwt.sign(
    { id: user._id, role: user.role, email: user.email },
    process.env.JWT_SECRET || 'carrom_championship_super_secure_jwt_secret_key_2026',
    { expiresIn: '7d' }
  );
};

// Login for Admin and Participants
const login = async (req, res, next) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'Please provide both email and password.' });
    }

    const user = await User.findOne({ email: email.toLowerCase().trim() }).populate('participantRef');
    if (!user) {
      return res.status(401).json({ success: false, message: 'Invalid email or password.' });
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: 'Invalid email or password.' });
    }

    const token = generateToken(user);

    res.json({
      success: true,
      token,
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        fullName: user.fullName,
        role: user.role,
        participant: user.participantRef
      }
    });
  } catch (error) {
    next(error);
  }
};

// Participant Registration & User Account Creation
const registerParticipant = async (req, res, next) => {
  try {
    const {
      fullName,
      gender,
      studentId,
      email,
      phone,
      department,
      password,
      doublesPartnerName,
      mixedDoublesPartnerName,
      tournamentId
    } = req.body;

    if (!fullName || !gender || !studentId || !email || !phone || !department || !password) {
      return res.status(400).json({ success: false, message: 'All profile fields and password are required.' });
    }

    // Check existing email / studentId
    const existingUser = await User.findOne({ email: email.toLowerCase().trim() });
    if (existingUser) {
      return res.status(400).json({ success: false, message: 'An account with this email already exists.' });
    }

    const existingParticipant = await Participant.findOne({
      $or: [{ email: email.toLowerCase().trim() }, { studentId: studentId.toUpperCase().trim() }]
    });
    if (existingParticipant) {
      return res.status(400).json({ success: false, message: 'A participant with this email or Student ID already exists.' });
    }

    // 1. Create Participant
    const participant = await Participant.create({
      fullName: fullName.trim(),
      gender,
      studentId: studentId.toUpperCase().trim(),
      email: email.toLowerCase().trim(),
      phone: phone.trim(),
      department: department.trim(),
      isApproved: false
    });

    // 2. Create User
    const username = email.split('@')[0] + '_' + Math.floor(100 + Math.random() * 900);
    const user = await User.create({
      username: username.toLowerCase(),
      email: email.toLowerCase().trim(),
      password,
      role: 'participant',
      fullName: fullName.trim(),
      participantRef: participant._id
    });

    participant.userId = user._id;
    await participant.save();

    // 3. Create Registration Record if tournamentId provided
    const Tournament = require('../models/Tournament');
    const Registration = require('../models/Registration');

    let activeTournamentId = tournamentId;
    if (!activeTournamentId) {
      const activeTourn = await Tournament.findOne({ status: { $ne: 'completed' } }).sort({ createdAt: -1 });
      if (activeTourn) activeTournamentId = activeTourn._id;
    }

    if (activeTournamentId) {
      await Registration.create({
        participantId: participant._id,
        tournamentId: activeTournamentId,
        gender,
        doublesPartnerName: (doublesPartnerName || 'To be announced').trim(),
        mixedDoublesPartnerName: (mixedDoublesPartnerName || 'To be announced').trim(),
        status: 'pending'
      });
    }

    const token = generateToken(user);

    res.status(201).json({
      success: true,
      message: 'Participant registration submitted successfully.',
      token,
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        fullName: user.fullName,
        role: user.role,
        participant
      }
    });
  } catch (error) {
    next(error);
  }
};

// Get current logged-in user profile
const getMe = async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id).populate('participantRef');
    res.json({
      success: true,
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        fullName: user.fullName,
        role: user.role,
        participant: user.participantRef
      }
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  login,
  registerParticipant,
  getMe
};
