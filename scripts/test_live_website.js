'use strict';
const http = require('http');

const BASE = 'http://localhost:3000';
let passed = 0;
let failed = 0;

function assert(condition, message, detail = '') {
  if (condition) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    console.error(`  ✗ FAIL: ${message} ${detail ? '(' + detail + ')' : ''}`);
  }
}

const cookieJar = new Map();

function request(method, path, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE);
    const postData = body ? (typeof body === 'string' ? body : JSON.stringify(body)) : null;

    const reqHeaders = {
      ...headers,
      ...(postData ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) } : {}),
      ...(cookieJar.size > 0 ? { 'Cookie': [...cookieJar.entries()].map(([k, v]) => `${k}=${v}`).join('; ') } : {}),
    };

    const req = http.request(url, { method, headers: reqHeaders }, (res) => {
      if (res.headers['set-cookie']) {
        res.headers['set-cookie'].forEach((c) => {
          const [pair] = c.split(';');
          const idx = pair.indexOf('=');
          if (idx !== -1) {
            cookieJar.set(pair.slice(0, idx).trim(), pair.slice(idx + 1).trim());
          }
        });
      }

      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        let json = null;
        try {
          json = JSON.parse(data);
        } catch (_) {}
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: data,
          json,
        });
      });
    });

    req.on('error', reject);
    if (postData) req.write(postData);
    req.end();
  });
}

async function run() {
  console.log('=== PREDIX LIVE WEBSITE END-TO-END TESTS ===\n');

  // 1. Static frontend assets
  console.log('--- 1. Static Assets & Frontend Shell ---');
  const index = await request('GET', '/');
  assert(index.statusCode === 200, 'GET / returns 200 OK');
  assert(index.body.includes('<title>Predix'), 'Index contains Predix title');
  assert(index.body.includes('styles.css'), 'Index loads styles.css');
  assert(index.body.includes('app.js'), 'Index loads app.js');

  const css = await request('GET', '/styles.css');
  assert(css.statusCode === 200, 'GET /styles.css returns 200 OK');
  assert(css.headers['content-type']?.includes('text/css'), 'styles.css has text/css content type');

  const js = await request('GET', '/app.js');
  assert(js.statusCode === 200, 'GET /app.js returns 200 OK');
  assert(js.headers['content-type']?.includes('javascript'), 'app.js has javascript content type');

  // 2. Public API Endpoints
  console.log('\n--- 2. Public Market & Stats API ---');
  const stats = await request('GET', '/api/stats');
  assert(stats.statusCode === 200, 'GET /api/stats returns 200');
  assert(typeof stats.json?.markets === 'number', `Stats returns total markets count: ${stats.json?.markets}`);
  assert(typeof stats.json?.openMarkets === 'number', `Stats returns open markets: ${stats.json?.openMarkets}`);
  assert(typeof stats.json?.traders === 'number', `Stats returns total traders: ${stats.json?.traders}`);

  const marketsRes = await request('GET', '/api/markets');
  assert(marketsRes.statusCode === 200, 'GET /api/markets returns 200');
  const markets = marketsRes.json?.markets || [];
  assert(Array.isArray(markets) && markets.length > 0, `Markets list populated: ${markets.length} markets found`);

  const openMarket = markets.find((m) => m.status === 'open' && !m.multi);
  assert(!!openMarket, `Found open binary market: ${openMarket?.slug || 'none'}`);

  const multiMarket = markets.find((m) => m.multi);
  assert(!!multiMarket, `Found multi-outcome market: ${multiMarket?.slug || 'none'}`);

  if (openMarket) {
    const detail = await request('GET', `/api/markets/${openMarket.slug}`);
    assert(detail.statusCode === 200, `GET /api/markets/${openMarket.slug} returns 200`);
    assert(detail.json?.id === openMarket.id, `Market detail ID matches (${detail.json?.id})`);
    assert(Array.isArray(detail.json?.book?.bids), `Order book has bids array (${detail.json?.book?.bids?.length} bids)`);
    assert(Array.isArray(detail.json?.book?.asks), `Order book has asks array (${detail.json?.book?.asks?.length} asks)`);
    assert(Array.isArray(detail.json?.trades), `Market history has trades array (${detail.json?.trades?.length} trades)`);
  }

  const leaderboard = await request('GET', '/api/leaderboard');
  assert(leaderboard.statusCode === 200, 'GET /api/leaderboard returns 200');
  assert(Array.isArray(leaderboard.json?.leaderboard), `Leaderboard returns array (${leaderboard.json?.leaderboard?.length} traders)`);

  // 3. Authentication & Promo Credit
  console.log('\n--- 3. User Authentication & Promo Code ---');
  const testUser = `trader_${Date.now().toString().slice(-6)}`;
  const signupRes = await request('POST', '/api/auth/signup', {
    username: testUser,
    email: `${testUser}@example.com`,
    password: 'password12345',
    promo: 'WELCOME100',
  });
  assert(signupRes.statusCode === 201, `Signup ${testUser} returns 201 Created`);
  assert(signupRes.json?.user?.username === testUser, 'User created with expected username');
  assert(signupRes.json?.snapshot?.wallet?.available === 10000, `Signup promo code granted 10000 cents ($100.00 play money), actual: ${signupRes.json?.snapshot?.wallet?.available}`);

  // Log in as the newly created user
  const loginRes = await request('POST', '/api/auth/login', {
    identifier: testUser,
    password: 'password12345',
  });
  assert(loginRes.statusCode === 200, `Login as ${testUser} returns 200 OK`);
  assert(cookieJar.has('predix_session'), 'Session cookie predix_session received');

  // Verify authenticated session via /api/me
  const meRes = await request('GET', '/api/me');
  assert(meRes.statusCode === 200, 'GET /api/me returns 200 with session');
  assert(meRes.json?.user?.username === testUser, `Session correctly identifies user: ${meRes.json?.user?.username}`);
  assert(meRes.json?.snapshot?.wallet?.available === 10000, `User wallet balance confirmed: $${(meRes.json?.snapshot?.wallet?.available / 100).toFixed(2)}`);

  // 4. Order Execution & Matching Engine
  console.log('\n--- 4. Order Book & Live Trading ---');
  if (openMarket) {
    const marketDetail = await request('GET', `/api/markets/${openMarket.slug}`);
    const bestAsk = marketDetail.json?.book?.asks?.[0];

    if (bestAsk) {
      console.log(`  Top ask for ${openMarket.slug}: ${bestAsk.qty} contracts @ ${bestAsk.price}¢`);
      // Place a buy order to match against best ask
      const orderRes = await request('POST', '/api/orders', {
        marketId: openMarket.id,
        side: 'buy',
        outcome: 'yes',
        type: 'limit',
        price: bestAsk.price,
        qty: 2,
      });

      assert(orderRes.statusCode === 201, `Place buy order against ask returns 201 Created: status=${orderRes.json?.order?.status}`);
      assert(orderRes.json?.order?.filled > 0 || orderRes.json?.order?.status === 'filled', `Order filled: ${orderRes.json?.order?.filled} contracts filled`);

      // Check updated balance & position
      const meAfterTrade = await request('GET', '/api/me');
      assert(meAfterTrade.json?.snapshot?.wallet?.available < 10000, `Cash debited for trade: now ${meAfterTrade.json?.snapshot?.wallet?.available}¢ (was 10000¢)`);
      const position = meAfterTrade.json?.snapshot?.positions?.find((p) => p.marketId === openMarket.id);
      assert(!!position && position.yesQty >= 2, `Position updated: user holds ${position?.yesQty} YES contracts`);
    } else {
      console.log('  No asks currently available; placing resting limit order...');
      const limitOrderRes = await request('POST', '/api/orders', {
        marketId: openMarket.id,
        side: 'buy',
        outcome: 'yes',
        type: 'limit',
        price: 25,
        qty: 3,
      });
      assert(limitOrderRes.statusCode === 201, `Limit order placed successfully: id=${limitOrderRes.json?.order?.id}`);
    }

    // Test Portfolio view API
    const portfolioRes = await request('GET', '/api/portfolio');
    assert(portfolioRes.statusCode === 200, 'GET /api/portfolio returns 200 OK');
    assert(Array.isArray(portfolioRes.json?.trades), `Portfolio includes trades history (${portfolioRes.json?.trades?.length} trades)`);
    assert(Array.isArray(portfolioRes.json?.ledger), `Portfolio includes immutable ledger entries (${portfolioRes.json?.ledger?.length} entries)`);
  }

  // 5. Admin Authentication & Controls
  console.log('\n--- 5. Admin Account Access ---');
  cookieJar.clear(); // clear user session
  const adminLogin = await request('POST', '/api/auth/login', {
    identifier: 'admin',
    password: process.env.ADMIN_PASSWORD || 'admin1234',
  });
  assert(adminLogin.statusCode === 200, `Admin login succeeded: ${adminLogin.statusCode}`, adminLogin.body);
  assert(adminLogin.json?.user?.role === 'admin', `Admin role confirmed: ${adminLogin.json?.user?.role}`);

  const adminStats = await request('GET', '/api/admin/stats');
  assert(adminStats.statusCode === 200, 'GET /api/admin/stats returns 200 for admin');
  assert(typeof adminStats.json?.cashInSystem === 'number', `Admin stats reports system cash: $${(adminStats.json?.cashInSystem / 100).toFixed(2)}`);

  // 6. Real-time SSE Stream Connectivity
  console.log('\n--- 6. SSE Live Events Stream Connectivity ---');
  const sseConnected = await new Promise((resolve) => {
    const url = new URL('/api/events', BASE);
    const req = http.request(url, {
      method: 'GET',
      headers: { 'Accept': 'text/event-stream' },
    }, (res) => {
      if (res.statusCode === 200 && res.headers['content-type']?.includes('text/event-stream')) {
        let received = '';
        res.on('data', (chunk) => {
          received += chunk.toString();
          if (received.includes('event: init') || received.includes('data:') || received.includes('retry:')) {
            req.destroy();
            resolve(true);
          }
        });
        setTimeout(() => {
          req.destroy();
          resolve(received.length > 0);
        }, 1500);
      } else {
        resolve(false);
      }
    });
    req.on('error', () => resolve(false));
    req.end();
  });
  assert(sseConnected, 'SSE /api/events endpoint connected and streaming live events');

  // Summary
  console.log(`\n========================================`);
  console.log(`TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log(`========================================\n`);

  process.exit(failed > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error('Fatal error running tests:', err);
  process.exit(1);
});
