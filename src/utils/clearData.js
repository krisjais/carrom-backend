require('dotenv').config();
const mongoose = require('mongoose');
const connectDB = require('../config/db');

const User = require('../models/User');
const Participant = require('../models/Participant');
const Tournament = require('../models/Tournament');
const Registration = require('../models/Registration');
const Team = require('../models/Team');
const Match = require('../models/Match');
const Announcement = require('../models/Announcement');
const AuditLog = require('../models/AuditLog');

const ChessPlayer = require('../models/ChessPlayer');
const ChessMatch = require('../models/ChessMatch');
const ChessRound = require('../models/ChessRound');
const ChessConfiguration = require('../models/ChessConfiguration');
const ChessSettings = require('../models/ChessSettings');
const ChessStandings = require('../models/ChessStandings');
const ChessTournament = require('../models/ChessTournament');

const clearAllDemoData = async () => {
  try {
    console.log('[ClearData] Connecting to database...');
    await connectDB();

    console.log('[ClearData] Clearing all demo/sample collections...');

    const results = await Promise.all([
      Participant.deleteMany({}),
      Tournament.deleteMany({}),
      Registration.deleteMany({}),
      Team.deleteMany({}),
      Match.deleteMany({}),
      Announcement.deleteMany({}),
      AuditLog.deleteMany({}),
      ChessPlayer.deleteMany({}),
      ChessMatch.deleteMany({}),
      ChessRound.deleteMany({}),
      ChessConfiguration.deleteMany({}),
      ChessSettings.deleteMany({}),
      ChessStandings.deleteMany({}),
      ChessTournament.deleteMany({})
    ]);

    // Keep or re-create default Admin user, delete all non-admin users
    const adminEmail = (process.env.ADMIN_EMAIL || 'admin@carrom.edu').toLowerCase().trim();
    const adminPassword = process.env.ADMIN_PASSWORD || 'admincarrom2026';

    await User.deleteMany({ email: { $ne: adminEmail } });

    let admin = await User.findOne({ email: adminEmail });
    if (!admin) {
      admin = await User.create({
        username: 'admin',
        email: adminEmail,
        password: adminPassword,
        role: 'admin',
        fullName: process.env.ADMIN_NAME || 'Tournament Director'
      });
      console.log(`[ClearData] Admin account created: ${admin.email}`);
    } else {
      admin.role = 'admin';
      admin.password = adminPassword;
      await admin.save();
      console.log(`[ClearData] Admin account retained & synchronized: ${admin.email}`);
    }

    console.log('[ClearData] All demo data successfully deleted from database!');
    process.exit(0);
  } catch (error) {
    console.error('[ClearData] Error clearing database:', error);
    process.exit(1);
  }
};

clearAllDemoData();
