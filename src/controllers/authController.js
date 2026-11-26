const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Participant = require('../models/Participant');
const ChessPlayer = require('../models/ChessPlayer');

const generateToken = (user) => {
  return jwt.sign(
    { id: user._id, role: user.role, email: user.email },
    process.env.JWT_SECRET || 'carrom_championship_super_secure_jwt_secret_key_2026',
    { expiresIn: '7d' }
  );
};

// Login for Admin and Participants (supports Email, Username, Full Name, or WhatsApp Phone)
const login = async (req, res, next) => {
  try {
    const rawIdentifier = String(req.body.identifier || req.body.email || '').trim();
    const password = String(req.body.password || '').trim();
    if (!rawIdentifier || !password) {
      return res.status(400).json({
        success: false,
        message: 'Please provide both your login identifier (email, name, or phone) and password.'
      });
    }

    const lowerId = rawIdentifier.toLowerCase();
    const escapedId = rawIdentifier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const digitsOnly = rawIdentifier.replace(/\D/g, '');
    const phoneQueries = [{ phone: rawIdentifier }];
    if (digitsOnly.length >= 10) {
      phoneQueries.push({ phone: { $regex: new RegExp(`${digitsOnly.slice(-10)}$`) } });
    }

    // 1. Direct lookup on User by email or username
    let user = await User.findOne({
      $or: [{ email: lowerId }, { username: lowerId }]
    }).populate('participantRef');

    // 2. Fallback lookup via Participant (case-insensitive email, normalized phone, or fullName)
    if (!user) {
      const participant = await Participant.findOne({
        $or: [
          { email: { $regex: new RegExp(`^${escapedId}$`, 'i') } },
          ...phoneQueries,
          { fullName: { $regex: new RegExp(`^${escapedId}$`, 'i') } }
        ]
      });

      if (participant) {
        if (participant.userId) {
          user = await User.findById(participant.userId).populate('participantRef');
        }
        if (!user) {
          user = await User.findOne({ participantRef: participant._id }).populate('participantRef');
        }

        // Auto-provision User account on first login for participants imported/registered without credentials
        // when password matches their registered phone number (or normalized 10-digit phone)
        const pDigits = String(participant.phone || '').replace(/\D/g, '');
        const matchesPhone =
          (participant.phone && password === participant.phone.trim()) ||
          (digitsOnly.length >= 10 && pDigits.endsWith(digitsOnly.slice(-10))) ||
          (pDigits.length >= 10 && password === pDigits.slice(-10));

        if (!user && matchesPhone) {
          const slugBase = participant.fullName.toLowerCase().replace(/[^a-z0-9]/g, '') || 'player';
          const uniqueSuffix = String(participant._id).slice(-4);
          const generatedEmail = participant.email
            ? participant.email.toLowerCase().trim()
            : `${slugBase}.${uniqueSuffix}@carrom.edu`;

          const existingByEmail = await User.findOne({ email: generatedEmail });
          if (existingByEmail) {
            user = existingByEmail;
            if (!user.participantRef) {
              user.participantRef = participant._id;
              await user.save();
            }
          } else {
            user = await User.create({
              username: `${slugBase}_${uniqueSuffix}`.toLowerCase(),
              email: generatedEmail,
              password: participant.phone ? participant.phone.trim() : password,
              role: 'participant',
              fullName: participant.fullName,
              participantRef: participant._id
            });
          }

          participant.userId = user._id;
          if (!participant.email) participant.email = generatedEmail;
          await participant.save();
          user = await User.findById(user._id).populate('participantRef');
        }
      }
    }

    if (!user) {
      // Detect if the user entered valid Chess Championship credentials on the Carrom login page
      const chessMatch = await ChessPlayer.findOne({
        $or: [
          { email: { $regex: new RegExp(`^${escapedId}$`, 'i') } },
          { playerId: { $regex: new RegExp(`^${escapedId}$`, 'i') } }
        ]
      });
      if (chessMatch) {
        return res.status(401).json({
          success: false,
          message: 'This email/ID belongs to the Chess Championship portal. Please sign in at Chess Player Login (/chess/login).'
        });
      }

      return res.status(401).json({ success: false, message: 'Invalid email/name/phone or password.' });
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: 'Invalid email/name/phone or password.' });
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
      email,
      phone,
      department,
      password,
      doublesPartnerName,
      mixedDoublesPartnerName,
      tournamentId
    } = req.body;

    if (!fullName || !gender || !email || !phone || !department || !password) {
      return res.status(400).json({ success: false, message: 'All profile fields and password are required.' });
    }

    // Check existing email
    const existingUser = await User.findOne({ email: email.toLowerCase().trim() });
    if (existingUser) {
      return res.status(400).json({ success: false, message: 'An account with this email already exists.' });
    }

    const existingParticipant = await Participant.findOne({
      $or: [
        { email: email.toLowerCase().trim() },
        { fullName: { $regex: new RegExp(`^${fullName.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') } }
      ]
    });
    if (existingParticipant) {
      return res.status(400).json({ success: false, message: 'A participant with this email or name already exists.' });
    }

    // 1. Create Participant
    const participant = await Participant.create({
      fullName: fullName.trim(),
      gender,
      studentId: '',
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
