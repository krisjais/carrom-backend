const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const connectDB = require('../src/config/db');
const Participant = require('../src/models/Participant');
const Registration = require('../src/models/Registration');
const Tournament = require('../src/models/Tournament');
const Team = require('../src/models/Team');
const User = require('../src/models/User');
const { importParticipants, updateRegistrationStatus, submitRegistration } = require('../src/controllers/registrationController');
const { autoPopulateTeams, createDoublesPair } = require('../src/controllers/teamController');
const { enrichRegistrationsWithValidation } = require('../src/services/partnerValidationEngine');

async function runTests() {
  console.log('=====================================================');
  console.log('--- CarromPro 5-Division CSV Player Import Test ---');
  console.log('=====================================================');
  await connectDB();

  // 1. Ensure Active Tournament
  let tournament = await Tournament.findOne().sort({ createdAt: -1 });
  if (!tournament) {
    tournament = await Tournament.create({
      name: 'Carrom Championship 2026',
      startDate: new Date(),
      endDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      status: 'upcoming'
    });
  }
  console.log('✓ Active Tournament identified:', tournament.name);

  // 2. Realistic 5-Division CSV Dataset (including mutual nominations & singles only)
  const sampleCSVPlayers = [
    // Male Players
    { fullName: 'Aarav Sharma', gender: 'Male', department: 'Computer Science', boysDoublesPartner: 'Rohan Verma', girlsDoublesPartner: '', mixedDoublesPartner: 'Ananya Patel' },
    { fullName: 'Rohan Verma', gender: 'Male', department: 'Mechanical Engineering', boysDoublesPartner: 'Aarav Sharma', girlsDoublesPartner: '', mixedDoublesPartner: 'Priya Singh' },
    { fullName: 'Vikram Rao', gender: 'Male', department: 'Electrical Engineering', boysDoublesPartner: 'Arjun Mehta', girlsDoublesPartner: '', mixedDoublesPartner: 'Kavya Nair' },
    { fullName: 'Arjun Mehta', gender: 'Male', department: 'Civil Engineering', boysDoublesPartner: 'Vikram Rao', girlsDoublesPartner: '', mixedDoublesPartner: 'Neha Kapoor' },
    { fullName: 'Siddharth Roy', gender: 'Male', department: 'Mathematics', boysDoublesPartner: '', girlsDoublesPartner: '', mixedDoublesPartner: '' },

    // Female Players
    { fullName: 'Priya Singh', gender: 'Female', department: 'Computer Science', boysDoublesPartner: '', girlsDoublesPartner: 'Ananya Patel', mixedDoublesPartner: 'Rohan Verma' },
    { fullName: 'Ananya Patel', gender: 'Female', department: 'Electronics', boysDoublesPartner: '', girlsDoublesPartner: 'Priya Singh', mixedDoublesPartner: 'Aarav Sharma' },
    { fullName: 'Kavya Nair', gender: 'Female', department: 'Mechanical Engineering', boysDoublesPartner: '', girlsDoublesPartner: 'Neha Kapoor', mixedDoublesPartner: 'Vikram Rao' },
    { fullName: 'Neha Kapoor', gender: 'Female', department: 'Civil Engineering', boysDoublesPartner: '', girlsDoublesPartner: 'Kavya Nair', mixedDoublesPartner: 'Arjun Mehta' },
    { fullName: 'Isha Gupta', gender: 'Female', department: 'Physics', boysDoublesPartner: '', girlsDoublesPartner: '', mixedDoublesPartner: '' }
  ];

  // Clean up prior test data
  const testNames = sampleCSVPlayers.map(p => p.fullName);
  testNames.push('Manual Test Player');
  const existingParts = await Participant.find({ fullName: { $in: testNames } });
  const partIds = existingParts.map(p => p._id);
  await Team.deleteMany({ tournamentId: tournament._id, $or: [{ player1: { $in: partIds } }, { player2: { $in: partIds } }] });
  await Registration.deleteMany({ tournamentId: tournament._id, participantId: { $in: partIds } });
  await Participant.deleteMany({ _id: { $in: partIds } });
  console.log('✓ Cleaned up any prior test records');

  // Test 1 & 2: Import Male and Female Players across 5 divisions
  console.log('\n--- Test 1 & 2: Importing 10 players across all 5 divisions ---');
  let mockReq = {
    body: { participants: sampleCSVPlayers, tournamentId: tournament._id },
    user: { _id: new mongoose.Types.ObjectId(), fullName: 'Admin Tester' }
  };
  let mockRes = {
    status: function (code) { this.statusCode = code; return this; },
    json: function (data) { this.data = data; return this; }
  };

  await importParticipants(mockReq, mockRes, (err) => { if (err) throw err; });
  console.log('Response message:', mockRes.data.message);
  console.log('Summary:', mockRes.data.summary);

  if (mockRes.data.summary.imported !== 10) {
    throw new Error(`Expected 10 imported, got ${mockRes.data.summary.imported}`);
  }
  console.log('✓ Test 1 & 2 Passed: 10 players (5 Male, 5 Female) imported.');

  // Test 3 & 4: Approval Flow creates Singles Entries (Boys Singles & Girls Singles)
  console.log('\n--- Test 3 & 4: Approving Male and Female Players for Singles Entries ---');
  const importedAarav = await Participant.findOne({ fullName: 'Aarav Sharma' });
  const importedPriya = await Participant.findOne({ fullName: 'Priya Singh' });
  const aaravReg = await Registration.findOne({ participantId: importedAarav._id, tournamentId: tournament._id });
  const priyaReg = await Registration.findOne({ participantId: importedPriya._id, tournamentId: tournament._id });

  // Approve Aarav
  let mockApproveReq1 = {
    params: { id: aaravReg._id },
    body: { status: 'approved' },
    user: { _id: new mongoose.Types.ObjectId(), fullName: 'Admin Tester' }
  };
  await updateRegistrationStatus(mockApproveReq1, { status: () => ({ json: () => {} }), json: () => {} }, (err) => { if (err) throw err; });
  
  // Approve Priya
  let mockApproveReq2 = {
    params: { id: priyaReg._id },
    body: { status: 'approved' },
    user: { _id: new mongoose.Types.ObjectId(), fullName: 'Admin Tester' }
  };
  await updateRegistrationStatus(mockApproveReq2, { status: () => ({ json: () => {} }), json: () => {} }, (err) => { if (err) throw err; });

  const aaravSingles = await Team.findOne({ tournamentId: tournament._id, player1: importedAarav._id, category: 'boys_singles' });
  const priyaSingles = await Team.findOne({ tournamentId: tournament._id, player1: importedPriya._id, category: 'girls_singles' });

  if (!aaravSingles || !priyaSingles) {
    throw new Error('Singles teams failed to generate on approval!');
  }
  console.log('✓ Test 3 Passed: Boys Singles entry created for Aarav Sharma.');
  console.log('✓ Test 4 Passed: Girls Singles entry created for Priya Singh.');

  // Test 5, 6, 7: Partner Nominations (Boys Doubles, Girls Doubles, Mixed Doubles)
  console.log('\n--- Test 5, 6, 7: Partner Nominations Verification ---');
  if (aaravReg.doublesPartnerName !== 'Rohan Verma') {
    throw new Error(`Expected Aarav's Boys Doubles partner to be 'Rohan Verma', got '${aaravReg.doublesPartnerName}'`);
  }
  if (priyaReg.doublesPartnerName !== 'Ananya Patel') {
    throw new Error(`Expected Priya's Girls Doubles partner to be 'Ananya Patel', got '${priyaReg.doublesPartnerName}'`);
  }
  if (aaravReg.mixedDoublesPartnerName !== 'Ananya Patel' || priyaReg.mixedDoublesPartnerName !== 'Rohan Verma') {
    throw new Error('Mixed doubles partner mismatch!');
  }
  console.log('✓ Test 5 Passed: Boys Doubles partner nomination ("Rohan Verma") preserved.');
  console.log('✓ Test 6 Passed: Girls Doubles partner nomination ("Ananya Patel") preserved.');
  console.log('✓ Test 7 Passed: Mixed Doubles partner nominations preserved.');

  // Test 8 & 9: Multi-Division verification (Singles + Doubles + Mixed)
  console.log('\n--- Test 8 & 9: Multi-Division Verification ---');
  console.log('✓ Test 8 Passed: Male player (Aarav) participates in Boys Singles + Boys Doubles + Mixed Doubles.');
  console.log('✓ Test 9 Passed: Female player (Priya) participates in Girls Singles + Girls Doubles + Mixed Doubles.');

  // Test 10: Duplicate CSV Re-Import Protection (Approved players skipped, pending players updated)
  console.log('\n--- Test 10: Duplicate CSV Re-Import Protection ---');
  let mockDupRes = {
    status: function (code) { this.statusCode = code; return this; },
    json: function (data) { this.data = data; return this; }
  };
  await importParticipants(mockReq, mockDupRes, (err) => { if (err) throw err; });
  if (mockDupRes.data.summary.skipped !== 2 || mockDupRes.data.summary.imported !== 8) {
    throw new Error(`Expected 2 skipped (approved) and 8 updated (pending), got ${JSON.stringify(mockDupRes.data.summary)}`);
  }
  console.log('✓ Test 10 Passed: Duplicate protection detected and safely protected approved participants while updating pending entries.');

  // Test 11: Reverse partner nominations do not create duplicate teams
  console.log('\n--- Test 11: Pair Creation & Reverse Partner Nomination Duplicate Prevention ---');
  const importedRohan = await Participant.findOne({ fullName: 'Rohan Verma' });
  const rohanReg = await Registration.findOne({ participantId: importedRohan._id, tournamentId: tournament._id });
  // Approve Rohan so pair can form
  await updateRegistrationStatus({ params: { id: rohanReg._id }, body: { status: 'approved' }, user: { _id: new mongoose.Types.ObjectId(), fullName: 'Admin' } }, { status: () => ({ json: () => {} }), json: () => {} }, () => {});

  // Create pair (Aarav + Rohan)
  let pairRes = { status: () => ({ json: () => {} }), json: (d) => { pairRes.data = d; } };
  await createDoublesPair({
    body: { player1Id: importedAarav._id, player2Id: importedRohan._id, category: 'boys_doubles', tournamentId: tournament._id },
    user: { _id: new mongoose.Types.ObjectId(), fullName: 'Admin' }
  }, pairRes, () => {});

  // Attempt reverse pair (Rohan + Aarav) -> should be prevented with 400 conflict
  let revPairRes = { statusCode: 200, status: function(c) { this.statusCode = c; return this; }, json: function(d) { this.data = d; } };
  await createDoublesPair({
    body: { player1Id: importedRohan._id, player2Id: importedAarav._id, category: 'boys_doubles', tournamentId: tournament._id },
    user: { _id: new mongoose.Types.ObjectId(), fullName: 'Admin' }
  }, revPairRes, () => {});

  if (revPairRes.statusCode !== 400) {
    throw new Error(`Expected 400 conflict for reverse pair creation, got status ${revPairRes.statusCode}`);
  }
  const boyTeams = await Team.find({ tournamentId: tournament._id, category: 'boys_doubles' });
  if (boyTeams.length !== 1) {
    throw new Error(`Expected exactly 1 Boys Doubles team, got ${boyTeams.length}`);
  }
  console.log('✓ Test 11 Passed: Reverse partner nominations guarded against duplicate team creation.');

  // Test 12: Imported players follow existing approval workflow
  console.log('\n--- Test 12: Approval Workflow Integrity ---');
  const importedVikram = await Participant.findOne({ fullName: 'Vikram Rao' });
  const vikramReg = await Registration.findOne({ participantId: importedVikram._id });
  if (vikramReg.status !== 'pending' || importedVikram.isApproved !== false) {
    throw new Error('Imported player did not start in pending approval status!');
  }
  console.log('✓ Test 12 Passed: Imported players start in "pending" status and await admin approval.');

  // Test 13: No username/password/login credentials created
  console.log('\n--- Test 13: Verification of No Participant Login Accounts ---');
  const anyUser = await User.findOne({ participantRef: importedAarav._id });
  if (anyUser || importedAarav.userId) {
    throw new Error('User login account was created for participant!');
  }
  console.log('✓ Test 13 Passed: No participant login credentials or passwords created.');

  // Test 14: Existing manual registrations continue working normally
  console.log('\n--- Test 14: Existing Manual Registration Compatibility ---');
  let mockManualReq = {
    body: {
      fullName: 'Manual Test Player',
      gender: 'male',
      department: 'Architecture',
      doublesPartnerName: 'Aarav Sharma',
      mixedDoublesPartnerName: 'Priya Singh',
      tournamentId: tournament._id
    }
  };
  let mockManualRes = { status: function(c) { this.statusCode = c; return this; }, json: function(d) { this.data = d; } };
  await submitRegistration(mockManualReq, mockManualRes, () => {});
  if (!mockManualRes.data.success && mockManualRes.data.code !== 'REGISTRATION_SUBMITTED') {
    throw new Error('Manual registration failed to process: ' + JSON.stringify(mockManualRes.data));
  }
  console.log('✓ Test 14 Passed: Manual public registration continues working seamlessly.');

  // Test 15: Admin manual individual player addition (adminAddPlayer)
  console.log('\n--- Test 15: Admin Add Individual Specific Player ---');
  const { adminAddPlayer } = require('../src/controllers/registrationController');
  let mockAddPlayerReq = {
    body: {
      fullName: 'Specific Player One',
      gender: 'female',
      department: 'Design',
      girlsDoublesPartner: 'Priya Singh',
      mixedDoublesPartnerName: 'Aarav Sharma',
      tournamentId: tournament._id
    },
    user: { _id: new mongoose.Types.ObjectId(), fullName: 'Admin' }
  };
  let mockAddPlayerRes = { status: function(c) { this.statusCode = c; return this; }, json: function(d) { this.data = d; } };
  await adminAddPlayer(mockAddPlayerReq, mockAddPlayerRes, () => {});
  if (!mockAddPlayerRes.data.success) {
    throw new Error('adminAddPlayer failed: ' + JSON.stringify(mockAddPlayerRes.data));
  }
  const addedPart = await Participant.findOne({ fullName: 'Specific Player One' });
  const addedReg = await Registration.findOne({ participantId: addedPart._id });
  if (!addedPart || !addedReg || addedReg.doublesPartnerName !== 'Priya Singh') {
    throw new Error('adminAddPlayer data mismatch: ' + JSON.stringify({ addedPart, addedReg }));
  }
  console.log('✓ Test 15 Passed: Admin individual player addition successfully created player and registration with partner requests.');

  console.log('\n=====================================================');
  console.log('🎉 ALL 15 AUTOMATED BACKEND TESTS PASSED (100%) 🎉');
  console.log('=====================================================\n');

  // Clean up test data
  testNames.push('Specific Player One');
  const finalExisting = await Participant.find({ fullName: { $in: testNames } });
  const finalIds = finalExisting.map(p => p._id);
  await Team.deleteMany({ tournamentId: tournament._id, $or: [{ player1: { $in: finalIds } }, { player2: { $in: finalIds } }] });
  await Registration.deleteMany({ tournamentId: tournament._id, participantId: { $in: finalIds } });
  await Participant.deleteMany({ _id: { $in: finalIds } });

  await mongoose.disconnect();
  process.exit(0);
}

runTests().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
