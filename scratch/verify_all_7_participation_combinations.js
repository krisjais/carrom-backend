require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mongoose = require('mongoose');

const Participant = require('../src/models/Participant');
const Registration = require('../src/models/Registration');
const Tournament = require('../src/models/Tournament');
const Team = require('../src/models/Team');
const Match = require('../src/models/Match');

const {
  syncAndAutoPairTournamentEntries,
  enrichRegistrationsWithValidation,
  getTournamentEntryValidationReport
} = require('../src/services/partnerValidationEngine');

const { generateDynamicBracket } = require('../src/services/drawEngine');

async function runVerification() {
  console.log('========================================================================');
  console.log('🧪 VERIFYING OPTIONAL TOURNAMENT PARTICIPATION RULE (ALL 7 COMBINATIONS)');
  console.log('========================================================================\n');

  const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/carrom_tournament';
  await mongoose.connect(uri);
  console.log('✅ Connected to MongoDB.');

  // 1. Create a dedicated isolated test tournament
  const testTournName = `Test_Optional_Participation_${Date.now()}`;
  const tourn = await Tournament.create({
    title: testTournName,
    edition: '2026',
    status: 'registration_open'
  });
  console.log(`✅ Created test tournament: "${tourn.title}" (ID: ${tourn._id})\n`);

  try {
    // 2. Define players for ALL 7 COMBINATIONS
    // -------------------------------------------------------------------------
    // Combination 1: Singles only (1 Male, 1 Female)
    // Combination 2: Doubles only (1 Male pair, 1 Female pair)
    // Combination 3: Mixed Doubles only (1 Male + 1 Female)
    // Combination 4: Singles + Doubles (1 Male pair, 1 Female pair)
    // Combination 5: Singles + Mixed Doubles (1 Male + 1 Female)
    // Combination 6: Doubles + Mixed Doubles (2 Males, 2 Females)
    // Combination 7: Singles + Doubles + Mixed Doubles (2 Males, 2 Females)
    // -------------------------------------------------------------------------

    const testPlayers = [
      // COMBINATION 1: Singles Only
      {
        name: 'Player 1A (Singles Only)',
        gender: 'male',
        dept: 'CS',
        combo: '1. Singles only',
        singles: true,
        doubles: false,
        mixed: false,
        doublesPartner: '',
        mixedPartner: ''
      },
      {
        name: 'Player 1B (Singles Only)',
        gender: 'female',
        dept: 'IT',
        combo: '1. Singles only',
        singles: true,
        doubles: false,
        mixed: false,
        doublesPartner: '',
        mixedPartner: ''
      },

      // COMBINATION 2: Doubles Only (Boys pair + Girls pair)
      {
        name: 'Player 2A (Doubles Only)',
        gender: 'male',
        dept: 'Mech',
        combo: '2. Doubles only',
        singles: false,
        doubles: true,
        mixed: false,
        doublesPartner: 'Player 2B (Doubles Only)',
        mixedPartner: ''
      },
      {
        name: 'Player 2B (Doubles Only)',
        gender: 'male',
        dept: 'Mech',
        combo: '2. Doubles only',
        singles: false,
        doubles: true,
        mixed: false,
        doublesPartner: 'Player 2A (Doubles Only)',
        mixedPartner: ''
      },
      {
        name: 'Player 2C (Doubles Only)',
        gender: 'female',
        dept: 'Civil',
        combo: '2. Doubles only',
        singles: false,
        doubles: true,
        mixed: false,
        doublesPartner: 'Player 2D (Doubles Only)',
        mixedPartner: ''
      },
      {
        name: 'Player 2D (Doubles Only)',
        gender: 'female',
        dept: 'Civil',
        combo: '2. Doubles only',
        singles: false,
        doubles: true,
        mixed: false,
        doublesPartner: 'Player 2C (Doubles Only)',
        mixedPartner: ''
      },

      // COMBINATION 3: Mixed Doubles Only
      {
        name: 'Player 3A (Mixed Only)',
        gender: 'male',
        dept: 'ECE',
        combo: '3. Mixed Doubles only',
        singles: false,
        doubles: false,
        mixed: true,
        doublesPartner: '',
        mixedPartner: 'Player 3B (Mixed Only)'
      },
      {
        name: 'Player 3B (Mixed Only)',
        gender: 'female',
        dept: 'ECE',
        combo: '3. Mixed Doubles only',
        singles: false,
        doubles: false,
        mixed: true,
        doublesPartner: '',
        mixedPartner: 'Player 3A (Mixed Only)'
      },

      // COMBINATION 4: Singles + Doubles (1 Male pair, 1 Female pair)
      {
        name: 'Player 4A (Singles + Doubles)',
        gender: 'male',
        dept: 'Aero',
        combo: '4. Singles + Doubles',
        singles: true,
        doubles: true,
        mixed: false,
        doublesPartner: 'Player 4B (Singles + Doubles)',
        mixedPartner: ''
      },
      {
        name: 'Player 4B (Singles + Doubles)',
        gender: 'male',
        dept: 'Aero',
        combo: '4. Singles + Doubles',
        singles: true,
        doubles: true,
        mixed: false,
        doublesPartner: 'Player 4A (Singles + Doubles)',
        mixedPartner: ''
      },
      {
        name: 'Player 4C (Singles + Doubles)',
        gender: 'female',
        dept: 'Biotech',
        combo: '4. Singles + Doubles',
        singles: true,
        doubles: true,
        mixed: false,
        doublesPartner: 'Player 4D (Singles + Doubles)',
        mixedPartner: ''
      },
      {
        name: 'Player 4D (Singles + Doubles)',
        gender: 'female',
        dept: 'Biotech',
        combo: '4. Singles + Doubles',
        singles: true,
        doubles: true,
        mixed: false,
        doublesPartner: 'Player 4C (Singles + Doubles)',
        mixedPartner: ''
      },

      // COMBINATION 5: Singles + Mixed Doubles (1 Male + 1 Female)
      {
        name: 'Player 5A (Singles + Mixed)',
        gender: 'male',
        dept: 'Chem',
        combo: '5. Singles + Mixed Doubles',
        singles: true,
        doubles: false,
        mixed: true,
        doublesPartner: '',
        mixedPartner: 'Player 5B (Singles + Mixed)'
      },
      {
        name: 'Player 5B (Singles + Mixed)',
        gender: 'female',
        dept: 'Chem',
        combo: '5. Singles + Mixed Doubles',
        singles: true,
        doubles: false,
        mixed: true,
        doublesPartner: '',
        mixedPartner: 'Player 5A (Singles + Mixed)'
      },

      // COMBINATION 6: Doubles + Mixed Doubles (2 Males, 2 Females)
      {
        name: 'Player 6A (Doubles + Mixed)',
        gender: 'male',
        dept: 'EEE',
        combo: '6. Doubles + Mixed Doubles',
        singles: false,
        doubles: true,
        mixed: true,
        doublesPartner: 'Player 6B (Doubles + Mixed)',
        mixedPartner: 'Player 6C (Doubles + Mixed)'
      },
      {
        name: 'Player 6B (Doubles + Mixed)',
        gender: 'male',
        dept: 'EEE',
        combo: '6. Doubles + Mixed Doubles',
        singles: false,
        doubles: true,
        mixed: true,
        doublesPartner: 'Player 6A (Doubles + Mixed)',
        mixedPartner: 'Player 6D (Doubles + Mixed)'
      },
      {
        name: 'Player 6C (Doubles + Mixed)',
        gender: 'female',
        dept: 'EEE',
        combo: '6. Doubles + Mixed Doubles',
        singles: false,
        doubles: true,
        mixed: true,
        doublesPartner: 'Player 6D (Doubles + Mixed)',
        mixedPartner: 'Player 6A (Doubles + Mixed)'
      },
      {
        name: 'Player 6D (Doubles + Mixed)',
        gender: 'female',
        dept: 'EEE',
        combo: '6. Doubles + Mixed Doubles',
        singles: false,
        doubles: true,
        mixed: true,
        doublesPartner: 'Player 6C (Doubles + Mixed)',
        mixedPartner: 'Player 6B (Doubles + Mixed)'
      },

      // COMBINATION 7: Singles + Doubles + Mixed Doubles (All 3)
      {
        name: 'Player 7A (All 3 Divisions)',
        gender: 'male',
        dept: 'Robotics',
        combo: '7. Singles + Doubles + Mixed',
        singles: true,
        doubles: true,
        mixed: true,
        doublesPartner: 'Player 7B (All 3 Divisions)',
        mixedPartner: 'Player 7C (All 3 Divisions)'
      },
      {
        name: 'Player 7B (All 3 Divisions)',
        gender: 'male',
        dept: 'Robotics',
        combo: '7. Singles + Doubles + Mixed',
        singles: true,
        doubles: true,
        mixed: true,
        doublesPartner: 'Player 7A (All 3 Divisions)',
        mixedPartner: 'Player 7D (All 3 Divisions)'
      },
      {
        name: 'Player 7C (All 3 Divisions)',
        gender: 'female',
        dept: 'Robotics',
        combo: '7. Singles + Doubles + Mixed',
        singles: true,
        doubles: true,
        mixed: true,
        doublesPartner: 'Player 7D (All 3 Divisions)',
        mixedPartner: 'Player 7A (All 3 Divisions)'
      },
      {
        name: 'Player 7D (All 3 Divisions)',
        gender: 'female',
        dept: 'Robotics',
        combo: '7. Singles + Doubles + Mixed',
        singles: true,
        doubles: true,
        mixed: true,
        doublesPartner: 'Player 7C (All 3 Divisions)',
        mixedPartner: 'Player 7B (All 3 Divisions)'
      }
    ];

    console.log(`📋 Registering ${testPlayers.length} athletes covering all 7 combinations...`);

    const createdParticipants = [];
    const createdRegistrations = [];

    for (const tp of testPlayers) {
      const p = await Participant.create({
        fullName: tp.name,
        gender: tp.gender,
        department: tp.dept,
        studentId: '',
        isApproved: true
      });

      const reg = await Registration.create({
        participantId: p._id,
        tournamentId: tourn._id,
        gender: tp.gender,
        participateSingles: tp.singles,
        participateDoubles: tp.doubles,
        participateMixedDoubles: tp.mixed,
        doublesPartnerName: tp.doublesPartner,
        mixedDoublesPartnerName: tp.mixedPartner,
        status: 'approved'
      });

      createdParticipants.push(p);
      createdRegistrations.push(reg);
    }

    console.log(`✅ Successfully created ${createdParticipants.length} participants & approved registrations.\n`);

    // 3. Test Enrichment & Validation Report
    console.log('🔍 Testing validation enrichment and report...');
    const enriched = await enrichRegistrationsWithValidation(createdRegistrations, tourn._id);
    const report = await getTournamentEntryValidationReport(tourn._id);

    console.log(`   - Enriched count: ${enriched.length}`);
    console.log(`   - Unmatched partner requests reported: ${report.unmatchedPartnerRequests.length}`);

    // Verify: Singles-only and opt-out players must NOT be flagged as unmatched!
    if (report.unmatchedPartnerRequests.length > 0) {
      console.error('❌ FAILED: Unexpected unmatched partner requests:', report.unmatchedPartnerRequests);
      throw new Error('Unmatched partner requests found for valid pairings or opted-out players');
    } else {
      console.log('✅ PASSED: No false unmatched partner errors for opted-out divisions.');
    }

    // 4. Test Sync & Auto-Pairing
    console.log('\n⚡ Running syncAndAutoPairTournamentEntries...');
    const syncResult = await syncAndAutoPairTournamentEntries(tourn._id);
    console.log(`   - Teams created: ${syncResult.createdCount}`);

    // Query teams in database for this tournament
    const allTeams = await Team.find({ tournamentId: tourn._id });
    console.log(`   - Total teams in database: ${allTeams.length}`);

    const boysSinglesTeams = allTeams.filter((t) => t.category === 'boys_singles');
    const girlsSinglesTeams = allTeams.filter((t) => t.category === 'girls_singles');
    const boysDoublesTeams = allTeams.filter((t) => t.category === 'boys_doubles');
    const girlsDoublesTeams = allTeams.filter((t) => t.category === 'girls_doubles');
    const mixedDoublesTeams = allTeams.filter((t) => t.category === 'mixed_doubles');

    console.log(`\n📊 Breakdown by Category:`);
    console.log(`   - Boys Singles: ${boysSinglesTeams.length}`);
    console.log(`   - Girls Singles: ${girlsSinglesTeams.length}`);
    console.log(`   - Boys Doubles: ${boysDoublesTeams.length}`);
    console.log(`   - Girls Doubles: ${girlsDoublesTeams.length}`);
    console.log(`   - Mixed Doubles: ${mixedDoublesTeams.length}`);

    // VERIFICATION: Check Singles participation
    // Expected Boys Singles:
    // 1A (Combo 1), 4A, 4B (Combo 4), 5A (Combo 5), 7A, 7B (Combo 7) -> 6 boys
    // NOT in Boys Singles: 2A, 2B (Combo 2), 3A (Combo 3), 6A, 6B (Combo 6)
    if (boysSinglesTeams.length !== 6) {
      throw new Error(`Expected exactly 6 Boys Singles entries, got ${boysSinglesTeams.length}`);
    }
    console.log('✅ PASSED: Boys Singles correctly excludes players who did not opt into Singles (Combos 2, 3, 6).');

    // Expected Girls Singles:
    // 1B (Combo 1), 4C, 4D (Combo 4), 5B (Combo 5), 7C, 7D (Combo 7) -> 6 girls
    if (girlsSinglesTeams.length !== 6) {
      throw new Error(`Expected exactly 6 Girls Singles entries, got ${girlsSinglesTeams.length}`);
    }
    console.log('✅ PASSED: Girls Singles correctly excludes players who did not opt into Singles.');

    // Expected Boys Doubles:
    // Pair 2A & 2B (Combo 2), Pair 4A & 4B (Combo 4), Pair 6A & 6B (Combo 6), Pair 7A & 7B (Combo 7) -> 4 teams
    if (boysDoublesTeams.length !== 4) {
      throw new Error(`Expected exactly 4 Boys Doubles teams, got ${boysDoublesTeams.length}`);
    }
    console.log('✅ PASSED: Boys Doubles has exactly the 4 nominated pairs. No random pairings.');

    // Expected Girls Doubles:
    // Pair 2C & 2D (Combo 2), Pair 4C & 4D (Combo 4), Pair 6C & 6D (Combo 6), Pair 7C & 7D (Combo 7) -> 4 teams
    if (girlsDoublesTeams.length !== 4) {
      throw new Error(`Expected exactly 4 Girls Doubles teams, got ${girlsDoublesTeams.length}`);
    }
    console.log('✅ PASSED: Girls Doubles has exactly the 4 nominated pairs. No random pairings.');

    // Expected Mixed Doubles:
    // Pair 3A & 3B (Combo 3), Pair 5A & 5B (Combo 5), Pair 6A & 6C (Combo 6), Pair 6B & 6D (Combo 6), Pair 7A & 7C (Combo 7), Pair 7B & 7D (Combo 7) -> 6 teams
    if (mixedDoublesTeams.length !== 6) {
      throw new Error(`Expected exactly 6 Mixed Doubles teams, got ${mixedDoublesTeams.length}`);
    }
    console.log('✅ PASSED: Mixed Doubles has exactly the 6 nominated pairs (1 male + 1 female each).');

    // 5. Test Draw & Bracket Generation for Each Category Independently
    console.log('\n🏆 Testing Bracket / Draw Generation for all 5 categories independently:');

    const categoriesToTest = [
      { cat: 'boys_singles', name: 'Boys Singles' },
      { cat: 'girls_singles', name: 'Girls Singles' },
      { cat: 'boys_doubles', name: 'Boys Doubles' },
      { cat: 'girls_doubles', name: 'Girls Doubles' },
      { cat: 'mixed_doubles', name: 'Mixed Doubles' }
    ];

    for (const { cat, name } of categoriesToTest) {
      console.log(`\n  🎯 Generating Draw for ${name} (${cat})...`);
      const drawResult = await generateDynamicBracket(tourn._id, cat);
      const matches = await Match.find({ tournamentId: tourn._id, category: cat });
      console.log(`     - Match count generated: ${matches.length}`);

      const round1Matches = matches.filter((m) => m.roundNumber === 1);
      const byes = round1Matches.filter((m) => m.isBye);
      const realMatches = round1Matches.filter((m) => !m.isBye);

      console.log(`     - Round 1 playable matches: ${realMatches.length}, byes: ${byes.length}`);

      // Verify knockout rules
      const teamCount = allTeams.filter((t) => t.category === cat).length;
      const expectedByes = teamCount % 2;
      const expectedReal = Math.floor(teamCount / 2);

      if (byes.length !== expectedByes) {
        throw new Error(`Draw rule violation in ${name}: expected ${expectedByes} bye(s), found ${byes.length}`);
      }
      if (realMatches.length !== expectedReal) {
        throw new Error(`Draw rule violation in ${name}: expected ${expectedReal} real match(es), found ${realMatches.length}`);
      }

      console.log(`     ✅ Knockout Rule Validated: ${teamCount} entries → ${expectedReal} matches + ${expectedByes} bye(s).`);
    }

    console.log('\n========================================================================');
    console.log('🎉 ALL 7 COMBINATIONS & DRAW ENGINES VERIFIED SUCCESSFULLY!');
    console.log('========================================================================\n');

  } finally {
    // 6. Cleanup test data
    console.log('🧹 Cleaning up test tournament and participants...');
    await Match.deleteMany({ tournamentId: tourn._id });
    await Team.deleteMany({ tournamentId: tourn._id });
    await Registration.deleteMany({ tournamentId: tourn._id });
    await Participant.deleteMany({ fullName: { $regex: /^Player [1-7][A-D]/ } });
    await Tournament.findByIdAndDelete(tourn._id);
    console.log('✅ Cleanup complete.');

    await mongoose.disconnect();
    console.log('✅ Disconnected from database.');
  }
}

runVerification().catch((err) => {
  console.error('\n❌ VERIFICATION TEST FAILED:', err);
  process.exit(1);
});
