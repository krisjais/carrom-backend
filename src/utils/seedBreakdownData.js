require('dotenv').config();
const connectDB = require('../config/db');
const { seedBreakdownData } = require('../services/breakdownSeedService');

const run = async () => {
  try {
    await connectDB();
    console.log('[Seed:Breakdown] Connected to MongoDB. Seeding breakdown dataset...');
    const start = Date.now();
    const summary = await seedBreakdownData();
    const elapsedMs = Date.now() - start;

    console.log(`\n[Seed:Breakdown] Completed in ${elapsedMs}ms:`);
    console.log(`  Unique Participants : Male=${summary.uniqueParticipants.male}, Female=${summary.uniqueParticipants.female}, Total=${summary.uniqueParticipants.total}`);
    console.log(`  Singles             : Male=${summary.formats.singles.male}, Female=${summary.formats.singles.female}, Total=${summary.formats.singles.total}`);
    console.log(`  Doubles             : Male=${summary.formats.doubles.male}, Female=${summary.formats.doubles.female}, Total=${summary.formats.doubles.total}`);
    console.log(`  Mixed Doubles       : Male=${summary.formats.mixedDoubles.male}, Female=${summary.formats.mixedDoubles.female}, Total=${summary.formats.mixedDoubles.total}`);
    console.log(`  Approved Teams      : ${JSON.stringify(summary.teams)}`);
    process.exit(0);
  } catch (error) {
    console.error('[Seed:Breakdown] Error seeding data:', error);
    process.exit(1);
  }
};

run();
