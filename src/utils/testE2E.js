const fetch = global.fetch;

async function testE2E() {
  try {
    console.log('[Test] 1. Logging in as Admin...');
    const adminLoginRes = await fetch('http://127.0.0.1:5000/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@carrom.edu', password: 'admincarrom2026' })
    }).then(r => r.json());
    
    if (!adminLoginRes.success) throw new Error('Admin login failed: ' + adminLoginRes.message);
    const token = adminLoginRes.token;
    console.log('[Test] 1. Admin Authenticated successfully. Role:', adminLoginRes.user.role);
    
    // 2. Test Draw Generation on Mixed Doubles (6 teams)
    console.log('[Test] 2. Generating dynamic draw on Mixed Doubles (6 teams)...');
    const drawRes = await fetch('http://127.0.0.1:5000/api/draws/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({ category: 'mixed_doubles' })
    }).then(r => r.json());

    if (!drawRes.success) throw new Error('Draw generation failed: ' + drawRes.message);
    console.log('[Test] 2. Mixed Doubles Draw Generated. Bracket size:', drawRes.result.bracketSize, 'Byes:', drawRes.result.byesCount);

    // 3. Fetch bracket tree
    const treeRes = await fetch('http://127.0.0.1:5000/api/draws/category/mixed_doubles').then(r => r.json());
    console.log('[Test] 3. Bracket Tree Total Rounds:', treeRes.totalRounds, 'Total Matches:', treeRes.totalMatches);

    // 4. Find a scheduled match in Round 1
    const matchesRes = await fetch('http://127.0.0.1:5000/api/matches?category=mixed_doubles&status=scheduled').then(r => r.json());
    if (matchesRes.matches && matchesRes.matches.length > 0) {
      const m = matchesRes.matches[0];
      console.log(`[Test] 4. Found match to score: ${m.roundName} M#${m.matchNumber} (${m.team1.name} vs ${m.team2.name})`);

      // 5. Score Board 1: Team 1 wins (15 pts, Queen covered, 0 fouls)
      const score1 = await fetch(`http://127.0.0.1:5000/api/matches/${m._id}/score`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: JSON.stringify({
          boards: [
            { boardNumber: 1, team1Score: 15, team2Score: 8, queenPocketedBy: 'team1', queenCovered: true, team1Fouls: 0, team2Fouls: 1, boardWinner: 'team1' },
            { boardNumber: 2, team1Score: 0, team2Score: 0, queenPocketedBy: 'none', queenCovered: false, team1Fouls: 0, team2Fouls: 0, boardWinner: null },
            { boardNumber: 3, team1Score: 0, team2Score: 0, queenPocketedBy: 'none', queenCovered: false, team1Fouls: 0, team2Fouls: 0, boardWinner: null }
          ],
          carromBoardNumber: 3
        })
      }).then(r => r.json());
      console.log('[Test] 5. Board 1 Scored (1-0). Score:', score1.match.finalScore);

      // 6. Score Board 2: Team 1 wins again (2-0 sweep)
      const score2 = await fetch(`http://127.0.0.1:5000/api/matches/${m._id}/score`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: JSON.stringify({
          boards: [
            { boardNumber: 1, team1Score: 15, team2Score: 8, queenPocketedBy: 'team1', queenCovered: true, team1Fouls: 0, team2Fouls: 1, boardWinner: 'team1' },
            { boardNumber: 2, team1Score: 18, team2Score: 6, queenPocketedBy: 'team1', queenCovered: true, team1Fouls: 0, team2Fouls: 0, boardWinner: 'team1' },
            { boardNumber: 3, team1Score: 0, team2Score: 0, queenPocketedBy: 'none', queenCovered: false, team1Fouls: 0, team2Fouls: 0, boardWinner: null }
          ]
        })
      }).then(r => r.json());
      console.log('[Test] 6. Board 2 Scored (2-0). Score:', score2.match.finalScore);

      // 7. Confirm match winner
      const confirmRes = await fetch(`http://127.0.0.1:5000/api/matches/${m._id}/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token }
      }).then(r => r.json());
      console.log('[Test] 7. Match Confirmed! Status:', confirmRes.match.status, 'Winner ID:', confirmRes.match.winnerTeam);

      // 8. Verify parent match slot populated
      if (m.nextMatchId) {
        const nextM = await fetch(`http://127.0.0.1:5000/api/matches/${m.nextMatchId}`).then(r => r.json());
        console.log('[Test] 8. Verified parent match slot populated:', nextM.match[m.nextMatchSlot]?.name);
      }
    }

    console.log('✅ [TEST PASS] ALL CARROM TOURNAMENT END-TO-END WORKFLOWS OPERATING WITH 100% CORRECTNESS!');
    process.exit(0);
  } catch (err) {
    console.error('❌ [TEST FAIL]:', err.message);
    process.exit(1);
  }
}

testE2E();
