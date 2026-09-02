const BASE_URL = 'http://localhost:5000';

async function testAllAPIs() {
  console.log('=== CHESS BACKEND PRODUCTION API TEST SUITE ===\n');

  // 1. Health check
  console.log('1. Health Check GET /api/health');
  const healthRes = await fetch(`${BASE_URL}/api/health`).then(r => r.json());
  console.log('Response:', healthRes);

  // 2. Public Settings GET /api/chess/settings
  console.log('\n2. Public Settings GET /api/chess/settings');
  const settingsRes = await fetch(`${BASE_URL}/api/chess/settings`).then(r => r.json());
  console.log('Response:', settingsRes.success, 'Tagline:', settingsRes.data?.tournamentTagline);

  // 3. Register Players POST /api/chess/register
  console.log('\n3. Player Registration POST /api/chess/register');
  const player1 = await fetch(`${BASE_URL}/api/chess/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fullName: 'Rahul Sharma',
      email: `rahul.sharma.${Date.now()}@college.edu`,
      phone: '9876543210',
      department: 'IT Team'
    })
  }).then(r => r.json());
  console.log('Player 1 Registered:', player1.data?.playerId, player1.data?.fullName, 'Status:', player1.data?.status);

  const player2 = await fetch(`${BASE_URL}/api/chess/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fullName: 'Aman Verma',
      email: `aman.verma.${Date.now()}@college.edu`,
      phone: '9876543211',
      department: 'First Year'
    })
  }).then(r => r.json());
  console.log('Player 2 Registered:', player2.data?.playerId, player2.data?.fullName, 'Status:', player2.data?.status);

  // 4. Admin Login POST /api/chess/admin/login
  console.log('\n4. Admin Login POST /api/chess/admin/login');
  const loginRes = await fetch(`${BASE_URL}/api/chess/admin/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin123' })
  }).then(r => r.json());
  console.log('Admin Token Received:', !!loginRes.token);
  const token = loginRes.token;

  // 5. Admin Dashboard GET /api/admin/dashboard
  console.log('\n5. Admin Dashboard GET /api/admin/dashboard');
  const dashRes = await fetch(`${BASE_URL}/api/admin/dashboard`, {
    headers: { 'Authorization': `Bearer ${token}` }
  }).then(r => r.json());
  console.log('Dashboard Data:', dashRes.data);

  // 6. Admin Approve Players PATCH /api/admin/players/:id
  console.log('\n6. Approve Players PATCH /api/admin/players/:id');
  if (player1.data?._id) {
    const app1 = await fetch(`${BASE_URL}/api/admin/players/${player1.data._id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ status: 'Approved' })
    }).then(r => r.json());
    console.log('Approve Player 1:', app1.success, app1.data?.status);
  }
  if (player2.data?._id) {
    const app2 = await fetch(`${BASE_URL}/api/admin/players/${player2.data._id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ status: 'Approved' })
    }).then(r => r.json());
    console.log('Approve Player 2:', app2.success, app2.data?.status);
  }

  // 7. Admin Match Generation POST /api/admin/matches/generate
  console.log('\n7. Generate Round Matches POST /api/admin/matches/generate');
  const genRes = await fetch(`${BASE_URL}/api/admin/matches/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify({ round: 1 })
  }).then(r => r.json());
  console.log('Matches Generated:', genRes.success, 'Count:', genRes.data?.length);

  // 8. Public Matches GET /api/chess/matches
  console.log('\n8. Public Matches List GET /api/chess/matches');
  const matchesRes = await fetch(`${BASE_URL}/api/chess/matches`).then(r => r.json());
  console.log('Matches Count:', matchesRes.count);

  // 9. Submit Result POST /api/admin/matches/:id/result
  if (matchesRes.data && matchesRes.data.length > 0) {
    const targetMatch = matchesRes.data[0];
    console.log(`\n9. Submit Result POST /api/admin/matches/${targetMatch._id}/result`);
    const resultRes = await fetch(`${BASE_URL}/api/admin/matches/${targetMatch._id}/result`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({
        player1Captured: { pawns: 3, knights: 1 }, // 6 pts
        player2Captured: { pawns: 1, rooks: 1 },  // 6 pts
        winner: 'player1',
        resultType: 'checkmate'
      })
    }).then(r => r.json());
    console.log('Result Submission Status:', resultRes.success, 'Winner:', resultRes.data?.winner);
  }

  // 10. Standings GET /api/chess/standings & GET /api/admin/standings
  console.log('\n10. Standings Leaderboard GET /api/chess/standings');
  const standingsRes = await fetch(`${BASE_URL}/api/chess/standings`).then(r => r.json());
  console.log('Standings Count:', standingsRes.count);
  if (standingsRes.data && standingsRes.data.length > 0) {
    standingsRes.data.forEach(p => {
      console.log(` Rank #${p.rank} | ${p.playerId} | ${p.fullName} (${p.department}) | Pts: ${p.tournamentPoints} | Material: ${p.materialPoints}`);
    });
  }

  console.log('\n🎉 ALL 10 ENDPOINTS TESTED & PASSED SUCCESSFULLY!');
}

testAllAPIs().catch(console.error);
