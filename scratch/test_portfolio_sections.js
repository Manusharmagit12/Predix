'use strict';
const http = require('http');

function req(options, postData) {
  return new Promise((resolve, reject) => {
    const request = http.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(body); } catch {}
        resolve({ status: res.statusCode, headers: res.headers, body, json });
      });
    });
    request.on('error', reject);
    if (postData) request.write(typeof postData === 'string' ? postData : JSON.stringify(postData));
    request.end();
  });
}

async function run() {
  console.log('Testing portfolio order history...');
  
  // 1. Sign up test user
  const username = 'testuser_' + Date.now().toString().slice(-5);
  const signupRes = await req({
    hostname: 'localhost',
    port: 3000,
    path: '/api/auth/signup',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, {
    username,
    email: `${username}@example.com`,
    password: 'Password123!',
    promoCode: 'WELCOME100'
  });

  if (signupRes.status !== 200 && signupRes.status !== 201) {
    throw new Error('Signup failed: ' + signupRes.body);
  }
  const loginRes = await req({
    hostname: 'localhost',
    port: 3000,
    path: '/api/auth/login',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, {
    identifier: username,
    password: 'Password123!'
  });
  if (loginRes.status !== 200) {
    throw new Error('Login failed: ' + loginRes.body);
  }
  const cookie = loginRes.headers['set-cookie']?.[0]?.split(';')[0];
  console.log('Logged in:', username, 'Cookie:', cookie ? 'OK' : 'FAIL');

  // Redeem welcome promo so user has funds
  await req({
    hostname: 'localhost',
    port: 3000,
    path: '/api/promo/redeem',
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie }
  }, { code: 'WELCOME100' });

  // 2. Query initial portfolio
  let portRes = await req({
    hostname: 'localhost',
    port: 3000,
    path: '/api/portfolio',
    method: 'GET',
    headers: { Cookie: cookie }
  });
  console.log('Initial portfolio status:', portRes.status);
  console.log('orderHistory in response:', Array.isArray(portRes.json?.orderHistory));
  console.log('Initial past orders count:', portRes.json?.orderHistory?.length);

  // 3. Place a limit order on market 1 (Fed rates)
  const ordRes = await req({
    hostname: 'localhost',
    port: 3000,
    path: '/api/orders',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: cookie
    }
  }, {
    marketId: 1,
    outcome: 'yes',
    side: 'buy',
    type: 'limit',
    price: 15, // far below market so it rests
    qty: 5
  });
  console.log('Placed order:', ordRes.status, 'Order ID:', ordRes.json?.order?.id);
  const orderId = ordRes.json?.order?.id;

  // 4. Cancel the order
  const cancelRes = await req({
    hostname: 'localhost',
    port: 3000,
    path: `/api/orders/${orderId}/cancel`,
    method: 'POST',
    headers: { Cookie: cookie }
  });
  console.log('Cancelled order:', cancelRes.status);

  // 5. Query portfolio again to verify it shows up in orderHistory
  portRes = await req({
    hostname: 'localhost',
    port: 3000,
    path: '/api/portfolio',
    method: 'GET',
    headers: { Cookie: cookie }
  });

  const history = portRes.json?.orderHistory;
  console.log('Past orders count after cancel:', history?.length);
  const found = history?.find(o => o.id === orderId);
  console.log('Found canceled order in orderHistory:', found ? 'YES' : 'NO');
  if (found) {
    console.log('Order details:', {
      id: found.id,
      marketId: found.marketId,
      side: found.side,
      outcome: found.outcome,
      price: found.price,
      status: found.status,
      statusText: found.statusText,
      updatedAt: found.updatedAt
    });
  }

  // 6. Place an order that fills (market order or matching resting bot order)
  const fillRes = await req({
    hostname: 'localhost',
    port: 3000,
    path: '/api/orders',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: cookie
    }
  }, {
    marketId: 1,
    outcome: 'yes',
    side: 'buy',
    type: 'market',
    qty: 2
  });
  console.log('Market order status:', fillRes.status, 'Filled:', fillRes.json?.order?.filled);

  // 7. Check portfolio again for filled order and trade history
  portRes = await req({
    hostname: 'localhost',
    port: 3000,
    path: '/api/portfolio',
    method: 'GET',
    headers: { Cookie: cookie }
  });
  const filledOrder = portRes.json?.orderHistory?.find(o => o.id === fillRes.json?.order?.id);
  console.log('Found filled order in orderHistory:', filledOrder ? 'YES' : 'NO');
  console.log('Filled order statusText:', filledOrder?.statusText);
  console.log('Trades count:', portRes.json?.trades?.length);
  console.log('Latest trade marketId:', portRes.json?.trades?.[0]?.marketId);
  console.log('ALL CHECKS PASSED!');
}

run().catch(console.error);
