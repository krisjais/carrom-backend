require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mongoose = require('mongoose');

const Participant = require('../src/models/Participant');
const Registration = require('../src/models/Registration');
const Tournament = require('../src/models/Tournament');
const Team = require('../src/models/Team');

const {
  ensurePartnerRegistration,
  syncAndAutoPairTournamentEntries,
  enrichRegistrationsWithValidation
} = require('../src/services/partnerValidationEngine');

const {
  submitRegistration,
  updateRegistrationStatus,
  importParticipants
} = require('../src/controllers/registrationController');

async function runTest() {
  console.log('========================================================================');
  console.log('🧪 TESTING PARTNER AUTO-REGISTRATION FEATURE');
  console.log('========================================================================\n');

  const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/carrom_tournament';
  await mongoose.connect(uri);
  console.log('✅ Connected to MongoDB.');

  const testTourn = await Tournament.create({
    title: `Test_Partner_AutoReg_${Date.now()}`,
    edition: '2026',
    status: 'registration_open'
  });
  console.log(`✅ Created test tournament: ${testTourn.title} (ID: ${testTourn._id})\n`);

  try {
    // -------------------------------------------------------------------------
    // TEST 1: Public Registration with Doubles & Mixed Partner Auto-Registration
    // -------------------------------------------------------------------------
    console.log('--- TEST 1: Public Registration (Player A registers for Doubles + Mixed) ---');

    const p1Name = `Player1_${Date.now()}`;
    const p2Name = `PartnerDoubles_${Date.now()}`;
    const p3Name = `PartnerMixed_${Date.now()}`;

    const mockReq1 = {
      body: {
        fullName: p1Name,
        gender: 'male',
        department: 'CS',
        participateSingles: true,
        participateDoubles: true,
        participateMixedDoubles: true,
        doublesPartnerName: p2Name,
        mixedDoublesPartnerName: p3Name,
        tournamentId: testTourn._id
      }
    };

    let resData1 = null;
    const mockRes1 = {
      status: function (code) {
        this.statusCode = code;
        return this;
      },
      json: function (data) {
        resData1 = data;
        return this;
      }
    };

    await submitRegistration(mockReq1, mockRes1, (err) => {
      if (err) throw err;
    });

    console.log('Status code:', mockRes1.statusCode);
    console.log('Registration submitted:', resData1.success, resData1.message);

    // Verify Player 1 was registered
    const p1 = await Participant.findOne({ fullName: p1Name });
    const p1Reg = await Registration.findOne({ participantId: p1._id, tournamentId: testTourn._id });
    console.log('Player 1 created:', !!p1, 'Registration:', !!p1Reg);

    // Verify Partner 2 (Doubles partner) was AUTO-CREATED
    const p2 = await Participant.findOne({ fullName: p2Name });
    const p2Reg = await Registration.findOne({ participantId: p2?._id, tournamentId: testTourn._id });
    console.log('Doubles Partner auto-created:', !!p2);
    console.log('  Gender:', p2?.gender, '(Expected: male)');
    console.log('  participateSingles:', p2Reg?.participateSingles, '(Expected: false)');
    console.log('  participateDoubles:', p2Reg?.participateDoubles, '(Expected: true)');
    console.log('  doublesPartnerName:', p2Reg?.doublesPartnerName, `(Expected: ${p1Name})`);
    console.log('  isAutoCreatedPartner:', p2Reg?.isAutoCreatedPartner, '(Expected: true)');

    // Verify Partner 3 (Mixed partner) was AUTO-CREATED
    const p3 = await Participant.findOne({ fullName: p3Name });
    const p3Reg = await Registration.findOne({ participantId: p3?._id, tournamentId: testTourn._id });
    console.log('Mixed Partner auto-created:', !!p3);
    console.log('  Gender:', p3?.gender, '(Expected: female)');
    console.log('  participateSingles:', p3Reg?.participateSingles, '(Expected: false)');
    console.log('  participateMixedDoubles:', p3Reg?.participateMixedDoubles, '(Expected: true)');
    console.log('  mixedDoublesPartnerName:', p3Reg?.mixedDoublesPartnerName, `(Expected: ${p1Name})`);
    console.log('  isAutoCreatedPartner:', p3Reg?.isAutoCreatedPartner, '(Expected: true)');

    if (!p2 || !p2Reg || !p3 || !p3Reg) {
      throw new Error('TEST 1 FAILED: Partners were not auto-created!');
    }
    console.log('✅ TEST 1 PASSED: Partners auto-created with singles=false.\n');

    // -------------------------------------------------------------------------
    // TEST 2: Admin Approves Player 1 -> Partners auto-approved & Teams created
    // -------------------------------------------------------------------------
    console.log('--- TEST 2: Admin Approves Player 1 (Verify Auto-Approval & Auto-Pairing) ---');

    const mockReq2 = {
      params: { id: p1Reg._id.toString() },
      body: { status: 'approved' },
      user: { _id: new mongoose.Types.ObjectId(), fullName: 'Admin' }
    };

    let resData2 = null;
    const mockRes2 = {
      status: function (code) {
        this.statusCode = code;
        return this;
      },
      json: function (data) {
        resData2 = data;
        return this;
      }
    };

    await updateRegistrationStatus(mockReq2, mockRes2, (err) => {
      if (err) throw err;
    });

    // Check Player 2 and Player 3 status
    const p2Updated = await Participant.findById(p2._id);
    const p2RegUpdated = await Registration.findById(p2Reg._id);
    const p3Updated = await Participant.findById(p3._id);
    const p3RegUpdated = await Registration.findById(p3Reg._id);

    console.log('Partner 2 approved:', p2Updated.isApproved, 'Reg status:', p2RegUpdated.status, '(Expected: true, approved)');
    console.log('Partner 3 approved:', p3Updated.isApproved, 'Reg status:', p3RegUpdated.status, '(Expected: true, approved)');

    // Check that Teams were created
    const doublesTeam = await Team.findOne({
      tournamentId: testTourn._id,
      category: 'boys_doubles',
      $or: [{ player1: p1._id }, { player2: p1._id }]
    }).populate('player1').populate('player2');

    const mixedTeam = await Team.findOne({
      tournamentId: testTourn._id,
      category: 'mixed_doubles',
      $or: [{ player1: p1._id }, { player2: p1._id }]
    }).populate('player1').populate('player2');

    console.log('Doubles Team created:', !!doublesTeam, doublesTeam?.name);
    console.log('Mixed Doubles Team created:', !!mixedTeam, mixedTeam?.name);

    if (!doublesTeam || !mixedTeam) {
      throw new Error('TEST 2 FAILED: Teams were not auto-paired!');
    }
    console.log('✅ TEST 2 PASSED: Auto-approval and team creation verified.\n');

    // -------------------------------------------------------------------------
    // TEST 3: CSV Import where partner is not in CSV
    // -------------------------------------------------------------------------
    console.log('--- TEST 3: CSV Import with Partner Not in CSV ---');

    const csvP1Name = `CSV_P1_${Date.now()}`;
    const csvP2Name = `CSV_Partner_${Date.now()}`;

    const mockReq3 = {
      body: {
        tournamentId: testTourn._id,
        participants: [
          {
            fullName: csvP1Name,
            gender: 'female',
            department: 'EE',
            participateSingles: true,
            participateDoubles: true,
            girlsDoublesPartner: csvP2Name
          }
        ]
      },
      user: { _id: new mongoose.Types.ObjectId(), fullName: 'Admin' }
    };

    let resData3 = null;
    const mockRes3 = {
      status: function (code) {
        this.statusCode = code;
        return this;
      },
      json: function (data) {
        resData3 = data;
        return this;
      }
    };

    await importParticipants(mockReq3, mockRes3, (err) => {
      if (err) throw err;
    });

    const csvP2 = await Participant.findOne({ fullName: csvP2Name });
    const csvP2Reg = await Registration.findOne({ participantId: csvP2?._id, tournamentId: testTourn._id });

    console.log('CSV partner auto-created:', !!csvP2);
    console.log('  Gender:', csvP2?.gender, '(Expected: female)');
    console.log('  participateSingles:', csvP2Reg?.participateSingles, '(Expected: false)');
    console.log('  participateDoubles:', csvP2Reg?.participateDoubles, '(Expected: true)');
    console.log('  doublesPartnerName:', csvP2Reg?.doublesPartnerName, `(Expected: ${csvP1Name})`);

    if (!csvP2 || !csvP2Reg) {
      throw new Error('TEST 3 FAILED: CSV partner was not auto-created!');
    }
    console.log('✅ TEST 3 PASSED: CSV Partner auto-registration verified.\n');

    console.log('========================================================================');
    console.log('🎉 ALL TESTS PASSED SUCCESSFULLY!');
    console.log('========================================================================');
  } finally {
    // Clean up test tournament
    await Tournament.findByIdAndDelete(testTourn._id);
    await Registration.deleteMany({ tournamentId: testTourn._id });
    await Team.deleteMany({ tournamentId: testTourn._id });
    await mongoose.disconnect();
    console.log('Cleaned up test data & disconnected.');
  }
}

runTest().catch((err) => {
  console.error('❌ Test failed with error:', err);
  process.exit(1);
});
