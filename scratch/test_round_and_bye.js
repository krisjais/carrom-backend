require('dotenv').config();
const mongoose = require('mongoose');
const memoryStore = require('../src/utils/chessMemoryDb');
const { generateRoundPairings } = require('../src/services/pairingService');
const adminCtrl = require('../src/controllers/chessAdminController');

async function runTest() {
  console.log('=== TEST: ROUND CREATION & ODD-PLAYER TOP-SCORER BYE LOGIC ===\n');

  // Reset in-memory store
  memoryStore.players = [];
  memoryStore.matches = [];
  memoryStore.rounds = [];
  memoryStore.configuration.currentRound = 1;

  // 1. Test Admin Round Creation with Name Only
  console.log('--- Step 1: Admin Creates Round 1 (providing ONLY name) ---');
  let mockRes1 = {
    statusCode: 200,
    status(c) { this.statusCode = c; return this; },
    json(data) { this.data = data; return this; }
  };
  await adminCtrl.createRound({ body: { name: 'Swiss Round 1' } }, mockRes1, (err) => { throw err; });
  console.log('Response Status:', mockRes1.statusCode);
  console.log('Created Round:', mockRes1.data.data);

  if (mockRes1.data.data.roundNumber !== 1 || mockRes1.data.data.name !== 'Swiss Round 1') {
    throw new Error('Failed to create Round 1 with auto-assigned number!');
  }

  console.log('\n--- Step 2: Admin Creates Round 2 (providing ONLY name) ---');
  let mockRes2 = {
    statusCode: 200,
    status(c) { this.statusCode = c; return this; },
    json(data) { this.data = data; return this; }
  };
  await adminCtrl.createRound({ body: { name: 'Championship Round' } }, mockRes2, (err) => { throw err; });
  console.log('Response Status:', mockRes2.statusCode);
  console.log('Created Round:', mockRes2.data.data);

  if (mockRes2.data.data.roundNumber !== 2 || mockRes2.data.data.name !== 'Championship Round') {
    throw new Error('Failed to create Round 2 with auto-assigned number!');
  }

  // 2. Test Pairing with Odd Number of Players
  console.log('\n--- Step 3: Register 5 Players with Different Point Values ---');
  memoryStore.players = [
    { _id: 'p_lowest', playerId: 'CHS-001', fullName: 'Lowest Player', status: 'Approved', tournamentPoints: 0, materialPoints: 0, wins: 0 },
    { _id: 'p_mid1', playerId: 'CHS-002', fullName: 'Mid Player 1', status: 'Approved', tournamentPoints: 3, materialPoints: 5, wins: 1 },
    { _id: 'p_mid2', playerId: 'CHS-003', fullName: 'Mid Player 2', status: 'Approved', tournamentPoints: 3, materialPoints: 8, wins: 1 },
    { _id: 'p_top', playerId: 'CHS-004', fullName: 'Top Grandmaster', status: 'Approved', tournamentPoints: 9, materialPoints: 25, wins: 3 },
    { _id: 'p_second', playerId: 'CHS-005', fullName: 'Second Best', status: 'Approved', tournamentPoints: 6, materialPoints: 15, wins: 2 },
  ];

  console.log('Eligible Players (Count = 5):');
  memoryStore.players.forEach(p => console.log(`  - ${p.fullName}: ${p.tournamentPoints} pts (Material: ${p.materialPoints}, Wins: ${p.wins})`));

  console.log('\n--- Step 4: Generate Pairings for Round 1 ---');
  const generatedMatches = await generateRoundPairings(1);
  console.log(`Generated ${generatedMatches.length} matches for Round 1.`);

  const byeMatch = generatedMatches.find(m => m.isBye);
  const playableMatches = generatedMatches.filter(m => !m.isBye);

  console.log('\nBYE Match Info:');
  console.log('  - Match ID:', byeMatch?.matchId);
  console.log('  - Player with BYE:', byeMatch?.player1?.fullName);
  console.log('  - Player 2:', byeMatch?.player2 ? byeMatch.player2.fullName : 'None (No Opponent)');
  console.log('  - Notes:', byeMatch?.notes);

  console.log(`\nPlayable 1v1 Matches (${playableMatches.length}):`);
  playableMatches.forEach(m => {
    console.log(`  - ${m.matchId}: ${m.player1?.fullName} vs ${m.player2?.fullName}`);
  });

  // VERIFICATIONS:
  // 1. Top player (Top Grandmaster, 9 pts) MUST receive the BYE!
  if (!byeMatch || byeMatch.player1?.fullName !== 'Top Grandmaster') {
    throw new Error(`Expected 'Top Grandmaster' (9 pts) to receive the BYE, but got: ${byeMatch?.player1?.fullName}`);
  }

  // 2. Top Grandmaster MUST NOT participate in any 1v1 playable matches
  const topPlayerInPlayable = playableMatches.some(m =>
    m.player1?.fullName === 'Top Grandmaster' || m.player2?.fullName === 'Top Grandmaster'
  );
  if (topPlayerInPlayable) {
    throw new Error('Top Grandmaster was incorrectly placed in a 1v1 match!');
  }

  // 3. Exactly 2 playable matches should exist for the remaining 4 players
  if (playableMatches.length !== 2) {
    throw new Error(`Expected 2 playable matches, got ${playableMatches.length}`);
  }

  console.log('\n✅ ALL ASSERTIONS PASSED! Odd player with most points correctly advanced to next round via BYE without participating in 1v1 matches, and Admin round creation works with name only.');
  process.exit(0);
}

runTest().catch(err => {
  console.error('\n❌ Test Error:', err);
  process.exit(1);
});
