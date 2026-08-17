const mongoose = require('mongoose');
const connectDB = require('../config/db');
const Match = require('../models/Match');
const Team = require('../models/Team');

async function showBoysSinglesDraw() {
  await connectDB();
  console.log('\n================================================================');
  console.log('    ACTUAL MONGODB DATABASE STRUCTURE: BOYS SINGLES (10 PLAYERS) ');
  console.log('================================================================\n');

  const matches = await Match.find({ category: 'boys_singles' })
    .populate('team1')
    .populate('team2')
    .populate('winnerTeam')
    .sort({ roundNumber: 1, matchNumber: 1 });

  const rounds = {};
  matches.forEach((m) => {
    if (!rounds[m.roundNumber]) {
      rounds[m.roundNumber] = {
        roundNumber: m.roundNumber,
        roundName: m.roundName,
        playable: [],
        byes: []
      };
    }
    if (m.isBye || m.status === 'bye') {
      rounds[m.roundNumber].byes.push(m);
    } else {
      rounds[m.roundNumber].playable.push(m);
    }
  });

  Object.values(rounds).forEach((r) => {
    console.log(`>>> ${r.roundName.toUpperCase()} (Round ${r.roundNumber})`);
    console.log(`    Total Slots in Round: ${r.playable.length + r.byes.length} | Playable Matches: ${r.playable.length} | Byes: ${r.byes.length}`);
    
    if (r.playable.length > 0) {
      console.log('    Playable Matches:');
      r.playable.forEach((m) => {
        const t1 = m.team1 ? m.team1.name : 'Waiting for winner...';
        const t2 = m.team2 ? m.team2.name : 'Waiting for winner...';
        console.log(`      Match #${m.matchNumber}: ${t1}  VS  ${t2}  [Status: ${m.status.toUpperCase()}]`);
      });
    }

    if (r.byes.length > 0) {
      console.log('    Automatic Advances (Byes in this round):');
      r.byes.forEach((m) => {
        const t1 = m.team1 ? m.team1.name : 'Waiting for candidate...';
        console.log(`      Bye Slot #${m.matchNumber}: ${t1}  [BYE — Valid for Round ${m.roundNumber} ONLY]`);
      });
    }
    console.log('----------------------------------------------------------------');
  });

  process.exit(0);
}

showBoysSinglesDraw();
