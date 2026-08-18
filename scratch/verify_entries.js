require('dotenv').config();
const mongoose = require('mongoose');
const connectDB = require('../src/config/db');
const Tournament = require('../src/models/Tournament');
const Participant = require('../src/models/Participant');
const Team = require('../src/models/Team');
const Registration = require('../src/models/Registration');
const { getTournamentEntryValidationReport } = require('../src/services/partnerValidationEngine');

const verify = async () => {
  await connectDB();
  const tournament = await Tournament.findOne().sort({ createdAt: -1 });
  console.log('--- TOURNAMENT VERIFICATION REPORT ---');
  const report = await getTournamentEntryValidationReport(tournament._id);
  console.log(JSON.stringify(report, null, 2));

  console.log('\n--- PARTICIPANT BREAKDOWN ---');
  const participants = await Participant.find().sort({ gender: 1, fullName: 1 });
  participants.forEach((p, idx) => {
    console.log(`${idx + 1}. [${p.gender.toUpperCase()}] ${p.fullName} (${p.studentId}) - Approved: ${p.isApproved}`);
  });

  console.log('\n--- CATEGORY BREAKDOWN ---');
  const categories = ['boys_singles', 'girls_singles', 'boys_doubles', 'girls_doubles', 'mixed_doubles'];
  for (const cat of categories) {
    const teams = await Team.find({ tournamentId: tournament._id, category: cat, isApproved: true })
      .populate('player1')
      .populate('player2');
    console.log(`\n${cat.toUpperCase()} (${teams.length} teams):`);
    teams.forEach((t, i) => {
      console.log(`  ${i + 1}. ${t.name} (P1: ${t.player1?.fullName}, P2: ${t.player2?.fullName || 'N/A'})`);
    });
  }

  process.exit(0);
};

verify();
