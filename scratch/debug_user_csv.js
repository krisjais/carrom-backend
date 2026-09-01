const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const connectDB = require('../src/config/db');
const Participant = require('../src/models/Participant');
const Registration = require('../src/models/Registration');
const Tournament = require('../src/models/Tournament');
const { importParticipants, getAllRegistrations } = require('../src/controllers/registrationController');
const { enrichRegistrationsWithValidation } = require('../src/services/partnerValidationEngine');

const rawCSV = `Full Name,Gender,Department,Boys Doubles Partner,Girls Doubles Partner,Mixed Doubles Partner
Aarav Sharma,Male,Computer Science,Rohan Verma,,Ananya Patel
Rohan Verma,Male,Mechanical Engineering,Aarav Sharma,,Priya Singh
Vikram Rao,Male,Electrical Engineering,Arjun Mehta,,Kavya Nair
Arjun Mehta,Male,Civil Engineering,Vikram Rao,,Neha Kapoor
Priya Singh,Female,Computer Science,,Ananya Patel,Rohan Verma
Ananya Patel,Female,Electronics,,Priya Singh,Aarav Sharma
Kavya Nair,Female,Mechanical Engineering,,Neha Kapoor,Vikram Rao
Neha Kapoor,Female,Civil Engineering,,Kavya Nair,Arjun Mehta
Siddharth Roy,Male,Mathematics,,,
Isha Gupta,Female,Physics,,,
Kabir Mehta,Male,Information Technology,Dev Malhotra,,Riya Kapoor
Dev Malhotra,Male,Business Administration,Kabir Mehta,,Meera Shah
Riya Kapoor,Female,Computer Science,,Meera Shah,Kabir Mehta
Meera Shah,Female,Biotechnology,,Riya Kapoor,Dev Malhotra
Aditya Joshi,Male,Architecture,,,
Nisha Verma,Female,Commerce,,,`;

function parseCSV(text) {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const rawHeaders = lines[0].split(',').map(h => h.toLowerCase().replace(/[^a-z0-9]/g, ' '));

  const getColIndex = (aliases) => {
    const exactIdx = rawHeaders.findIndex((h) =>
      aliases.some((alias) => {
        const cleanAlias = alias.toLowerCase().replace(/[^a-z0-9]/g, ' ').trim();
        return h.trim() === cleanAlias;
      })
    );
    if (exactIdx >= 0) return exactIdx;

    return rawHeaders.findIndex((h) =>
      aliases.some((alias) => {
        const cleanAlias = alias.toLowerCase().replace(/[^a-z0-9]/g, ' ').trim();
        return h.trim().includes(cleanAlias);
      })
    );
  };

  const nameIdx = getColIndex(['full name', 'student name', 'athlete name', 'player name', 'athlete', 'player', 'name']);
  const genderIdx = getColIndex(['gender', 'sex']);
  const deptIdx = getColIndex(['department', 'dept', 'major', 'branch', 'course', 'program']);
  const boysDoublesIdx = getColIndex(['boys doubles partner', 'boys partner', 'boys doubles']);
  const girlsDoublesIdx = getColIndex(['girls doubles partner', 'girls partner', 'girls doubles']);
  const mixedIdx = getColIndex(['mixed doubles partner', 'mixed partner', 'mixed doubles']);

  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',').map(c => c.trim());
    rows.push({
      fullName: cols[nameIdx] || '',
      gender: cols[genderIdx] || '',
      department: cols[deptIdx] || '',
      boysDoublesPartner: cols[boysDoublesIdx] || '',
      girlsDoublesPartner: cols[girlsDoublesIdx] || '',
      mixedDoublesPartner: cols[mixedIdx] || ''
    });
  }
  return rows;
}

async function verify() {
  await connectDB();
  const tournament = await Tournament.findOne().sort({ createdAt: -1 });

  // Test re-importing the 16 players directly
  const rows = parseCSV(rawCSV);
  console.log(`Parsed ${rows.length} rows from CSV`);

  let req = {
    body: { participants: rows, tournamentId: tournament._id },
    user: { _id: new mongoose.Types.ObjectId(), fullName: 'Admin' }
  };
  let res = { status: () => res, json: (d) => { res.data = d; } };

  await importParticipants(req, res, (err) => { if (err) throw err; });
  console.log('Import Result:', res.data.message);
  console.log('Summary:', res.data.summary);

  const allRegs = await Registration.find({ tournamentId: tournament._id }).populate('participantId');
  const enriched = await enrichRegistrationsWithValidation(allRegs, tournamentId = tournament._id);

  console.log('\n--- Enriched Registrations Verification ---');
  enriched.forEach((r, idx) => {
    const p = r.participantId;
    console.log(
      `${idx + 1}. ${p.fullName} (${p.gender}) [${p.department}]:\n` +
      `   - Doubles Partner: "${r.doublesPartnerName || 'Singles Only'}" -> Validation Status: ${r.doublesValidation?.status} (${r.doublesValidation?.message})\n` +
      `   - Mixed Partner:   "${r.mixedDoublesPartnerName || 'Singles Only'}" -> Validation Status: ${r.mixedDoublesValidation?.status} (${r.mixedDoublesValidation?.message})`
    );
  });

  await mongoose.disconnect();
}

verify().catch(err => { console.error(err); process.exit(1); });
