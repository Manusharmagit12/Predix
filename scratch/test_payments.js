// scratch/test_payments.js
// Automated verification of /api/deposit and /api/wallet endpoints

async function testPayments() {
  const base = 'http://localhost:3000';

  const uname = 'paytest_' + Date.now();
  console.log(`1. Signing up test user ${uname}...`);
  const signupRes = await fetch(`${base}/api/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: uname,
      email: `${uname}@test.local`,
      password: 'password123'
    })
  });
  if (!signupRes.ok) throw new Error('Signup failed: ' + (await signupRes.text()));
  console.log('   ✓ Signed up successfully. Now logging in...');

  const loginRes = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: uname, password: 'password123' })
  });
  if (!loginRes.ok) throw new Error('Login failed: ' + (await loginRes.text()));

  const cookies = loginRes.headers.get('set-cookie');
  console.log('   ✓ Logged in successfully. Cookie:', cookies ? cookies.split(';')[0] : 'none');

  const authHeader = {
    'Cookie': cookies ? cookies.split(';')[0] : '',
    'Content-Type': 'application/json'
  };

  console.log('\n2. Testing GET /api/wallet...');
  const walletRes1 = await fetch(`${base}/api/wallet`, { headers: authHeader });
  if (!walletRes1.ok) throw new Error('GET /api/wallet failed: ' + (await walletRes1.text()));
  const w1 = await walletRes1.json();
  console.log('   Initial wallet state:', {
    available: w1.wallet.available,
    reserved: w1.wallet.reserved,
    total: w1.wallet.total,
    cumulativeDeposits: w1.cumulativeDeposits,
    ledgerCount: w1.ledger.length,
    withdrawalsCount: w1.withdrawals.length
  });

  console.log('\n3. Testing POST /api/deposit (Card deposit $50.00)...');
  const depRes1 = await fetch(`${base}/api/deposit`, {
    method: 'POST',
    headers: authHeader,
    body: JSON.stringify({
      amountCents: 5000,
      method: 'card',
      memo: 'Automated Test Card Deposit'
    })
  });
  if (!depRes1.ok) throw new Error('POST /api/deposit card failed: ' + (await depRes1.text()));
  const depData1 = await depRes1.json();
  console.log('   ✓ Deposit response:', depData1);
  if (depData1.depositedCents !== 5000) throw new Error('Expected 5000 deposited');

  console.log('\n4. Testing POST /api/deposit (Crypto USDC deposit $100.00)...');
  const depRes2 = await fetch(`${base}/api/deposit`, {
    method: 'POST',
    headers: authHeader,
    body: JSON.stringify({
      amountCents: 10000,
      method: 'crypto',
      memo: 'Automated Test Crypto USDC'
    })
  });
  if (!depRes2.ok) throw new Error('POST /api/deposit crypto failed: ' + (await depRes2.text()));
  const depData2 = await depRes2.json();
  console.log('   ✓ Deposit response:', depData2);

  console.log('\n5. Verifying updated wallet via GET /api/wallet...');
  const walletRes2 = await fetch(`${base}/api/wallet`, { headers: authHeader });
  const w2 = await walletRes2.json();
  console.log('   Updated wallet state:', {
    available: w2.wallet.available,
    total: w2.wallet.total,
    cumulativeDeposits: w2.cumulativeDeposits,
    latestLedger: w2.ledger[0]
  });

  const diffAvail = w2.wallet.available - w1.wallet.available;
  console.log(`   Balance increased by: $${(diffAvail / 100).toFixed(2)}`);
  if (diffAvail !== 15000) {
    throw new Error(`Expected balance diff of 15000 cents ($150), got ${diffAvail}`);
  }

  console.log('\n6. Testing validation limits ($2 under minimum $5)...');
  const invalidRes = await fetch(`${base}/api/deposit`, {
    method: 'POST',
    headers: authHeader,
    body: JSON.stringify({ amountCents: 200, method: 'card' })
  });
  if (invalidRes.status === 400) {
    console.log('   ✓ Correctly rejected sub-$5 deposit with status 400.');
  } else {
    throw new Error('Expected status 400 for sub-$5 deposit');
  }

  console.log('\n>>> ALL PAYMENTS API TESTS PASSED SUCCESSFULLY! <<<\n');
}

testPayments().catch((e) => {
  console.error('Test failed:', e);
  process.exit(1);
});
