const fetch = global.fetch;

async function testReliability() {
  try {
    console.log('=== STARTING PRODUCTION RELIABILITY VERIFICATION ===\n');

    // 1. Health Check Endpoint
    console.log('[Test 1] Testing GET /api/health ...');
    const healthRes = await fetch('http://127.0.0.1:5000/api/health');
    const healthStatus = healthRes.status;
    const healthData = await healthRes.json();
    console.log(`[Test 1] Status Code: ${healthStatus}`);
    console.log(`[Test 1] Response Body:`, JSON.stringify(healthData));

    if (healthStatus !== 200 || healthData.status !== 'ok' || healthData.database !== 'connected') {
      throw new Error(`Health check failed. Expected 200 ok/connected, got ${healthStatus} ${JSON.stringify(healthData)}`);
    }
    console.log('✅ [Test 1 Passed] Health check reports 200 OK and database connected.\n');

    // 2. Admin Login with Valid Credentials
    console.log('[Test 2] Testing POST /api/auth/login with valid credentials ...');
    const loginRes = await fetch('http://127.0.0.1:5000/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@carrom.edu', password: 'admincarrom2026' })
    });
    const loginData = await loginRes.json();
    console.log(`[Test 2] Status Code: ${loginRes.status}`);
    console.log(`[Test 2] Success: ${loginData.success}, Role: ${loginData.user?.role}, Token received: ${!!loginData.token}`);

    if (loginRes.status !== 200 || !loginData.success || !loginData.token) {
      throw new Error(`Admin login failed: ${JSON.stringify(loginData)}`);
    }
    console.log('✅ [Test 2 Passed] Admin login succeeded with 200 OK and valid JWT token.\n');

    // 3. Admin Login with Invalid Credentials (Immediate 401, no retry loop)
    console.log('[Test 3] Testing POST /api/auth/login with invalid password ...');
    const invalidLoginRes = await fetch('http://127.0.0.1:5000/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@carrom.edu', password: 'wrongpassword' })
    });
    const invalidLoginData = await invalidLoginRes.json();
    console.log(`[Test 3] Status Code: ${invalidLoginRes.status}`);
    console.log(`[Test 3] Response Message: ${invalidLoginData.message}`);

    if (invalidLoginRes.status !== 401 || invalidLoginData.success !== false) {
      throw new Error(`Expected 401 for invalid password, got ${invalidLoginRes.status}`);
    }
    console.log('✅ [Test 3 Passed] Invalid login immediately returned 401 as expected.\n');

    // 4. Tournament Current Status Endpoint
    console.log('[Test 4] Testing GET /api/tournaments/current ...');
    const tournRes = await fetch('http://127.0.0.1:5000/api/tournaments/current');
    const tournData = await tournRes.json();
    console.log(`[Test 4] Status Code: ${tournRes.status}`);
    console.log(`[Test 4] Tournament: ${tournData.tournament?.title}, Status: ${tournData.tournament?.status}`);

    if (tournRes.status !== 200 || !tournData.success) {
      throw new Error(`Failed to fetch current tournament: ${JSON.stringify(tournData)}`);
    }
    console.log('✅ [Test 4 Passed] Tournament current endpoint active and operational.\n');

    // 5. Matches Live Endpoint
    console.log('[Test 5] Testing GET /api/matches/live ...');
    const liveMatchesRes = await fetch('http://127.0.0.1:5000/api/matches/live');
    const liveMatchesData = await liveMatchesRes.json();
    console.log(`[Test 5] Status Code: ${liveMatchesRes.status}`);
    console.log(`[Test 5] Success: ${liveMatchesData.success}`);

    if (liveMatchesRes.status !== 200 || !liveMatchesData.success) {
      throw new Error(`Failed to fetch live matches: ${JSON.stringify(liveMatchesData)}`);
    }
    console.log('✅ [Test 5 Passed] Live matches endpoint active and operational.\n');

    console.log('====================================================');
    console.log('🎉 ALL PRODUCTION RELIABILITY CHECKS PASSED (5/5)!');
    console.log('====================================================');
    process.exit(0);
  } catch (err) {
    console.error('❌ [Reliability Test Failed]:', err.message);
    process.exit(1);
  }
}

testReliability();
