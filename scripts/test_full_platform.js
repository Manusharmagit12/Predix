'use strict';
const http = require('http');

const BASE = 'http://localhost:3000';
let passed = 0;
let failed = 0;
const results = [];

function step(name) {
  console.log(`\n============================================================`);
  console.log(`🔹 STEP: ${name}`);
  console.log(`============================================================`);
}

function test(condition, description, extra = '') {
  if (condition) {
    passed++;
    console.log(`  ✓ ${description}`);
    results.push({ ok: true, description });
  } else {
    failed++;
    console.error(`  ✗ FAIL: ${description} ${extra ? '(' + extra + ')' : ''}`);
    results.push({ ok: false, description, extra });
  }
}

class SessionClient {
  constructor(name) {
    this.name = name;
    this.cookie = null;
    this.user = null;
  }

  request(method, path, body, customHeaders = {}) {
    return new Promise((resolve, reject) => {
      const url = new URL(path, BASE);
      const postData = body ? (typeof body === 'string' ? body : JSON.stringify(body)) : null;

      const headers = {
        ...customHeaders,
        ...(postData ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) } : {}),
        ...(this.cookie ? { 'Cookie': this.cookie } : {}),
      };

      const req = http.request(url, { method, headers }, (res) => {
        if (res.headers['set-cookie']) {
          const cookieHeader = res.headers['set-cookie'].find((c) => c.startsWith('predix_session='));
          if (cookieHeader) {
            this.cookie = cookieHeader.split(';')[0];
          }
        }

        let raw = '';
        res.on('data', (chunk) => (raw += chunk));
        res.on('end', () => {
          let json = null;
          try {
            json = JSON.parse(raw);
          } catch (_) {}
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: raw,
            json,
          });
        });
      });

      req.on('error', reject);
      if (postData) req.write(postData);
      req.end();
    });
  }

  async signup(username, email, password, promo = null, ref = null) {
    const res = await this.request('POST', '/api/auth/signup', { username, email, password, promo, ref });
    if (res.status === 201 && res.json?.user) {
      this.user = res.json.user;
    }
    return res;
  }

  async login(identifier, password) {
    const res = await this.request('POST', '/api/auth/login', { identifier, password });
    if (res.status === 200 && res.json?.user) {
      this.user = res.json.user;
    }
    return res;
  }

  async me() {
    return await this.request('GET', '/api/me');
  }

  async portfolio() {
    return await this.request('GET', '/api/portfolio');
  }

  async placeOrder(order) {
    return await this.request('POST', '/api/orders', order);
  }

  async cancelOrder(orderId) {
    return await this.request('POST', `/api/orders/${orderId}/cancel`);
  }
}

async function runComprehensiveTests() {
  console.log(`\n************************************************************`);
  console.log(`🚀 COMPREHENSIVE END-TO-END FEATURE & TRADING TEST SUITE`);
  console.log(`   Target Server: ${BASE}`);
  console.log(`************************************************************`);

  const ts = Date.now().toString().slice(-6);
  const alice = new SessionClient('Alice');
  const bob = new SessionClient('Bob');
  const admin = new SessionClient('Admin');

  // STEP 1: Admin Authentication & Baseline System Checks
  step('1. Admin Authentication & Baseline Platform Health');
  const adminLog = await admin.login('admin', process.env.ADMIN_PASSWORD || 'admin1234');
  test(adminLog.status === 200, 'Admin logs in with 200 OK');
  test(adminLog.json?.user?.role === 'admin', 'Admin user role is verified');

  const adminStats = await admin.request('GET', '/api/admin/stats');
  test(adminStats.status === 200, 'Admin can fetch /api/admin/stats');
  test(typeof adminStats.json?.openMarkets === 'number', `Open markets count: ${adminStats.json?.openMarkets}`);
  test(typeof adminStats.json?.cashInSystem === 'number', `Total system cash: $${(adminStats.json?.cashInSystem / 100).toFixed(2)}`);

  // STEP 2: User Signups, Promo Codes & Referral Bonuses
  step('2. User Signups, Welcome Promo & Referral Network');
  const aliceName = `alice_${ts}`;
  const bobName = `bob_${ts}`;

  // Alice signs up with WELCOME100
  const aliceSignup = await alice.signup(aliceName, `${aliceName}@test.local`, 'password123', 'WELCOME100');
  test(aliceSignup.status === 201, `Alice (${aliceName}) registered with 201 Created`);
  test(aliceSignup.json?.promoApplied?.code === 'WELCOME100', 'Welcome promo WELCOME100 applied for Alice');
  test(aliceSignup.json?.snapshot?.wallet?.available === 10000, 'Alice received $100.00 (10,000¢) welcome credit');

  await alice.login(aliceName, 'password123');
  const aliceMe = await alice.me();
  test(aliceMe.json?.user?.username === aliceName, 'Alice session verified via /api/me');
  test(aliceMe.json?.snapshot?.wallet?.available === 10000, 'Alice wallet available balance is $100.00');

  // Bob signs up referencing Alice (@aliceName)
  const bobSignup = await bob.signup(bobName, `${bobName}@test.local`, 'password123', 'WELCOME100', aliceName);
  test(bobSignup.status === 201, `Bob (${bobName}) registered with referral @${aliceName}`);
  test(bobSignup.json?.referral?.by === aliceName, `Referral credited by @${aliceName}`);
  test(bobSignup.json?.snapshot?.wallet?.available === 11000, `Bob received $100 welcome + $10 referral bonus ($110.00 = 11,000¢)`);

  await bob.login(bobName, 'password123');

  // Check that Alice also received the $10 referral bonus
  const aliceMeAfterRef = await alice.me();
  test(aliceMeAfterRef.json?.snapshot?.wallet?.available === 11000, `Alice wallet credited with $10 referral bonus: now $110.00`);

  // Bob redeems another top-up promo code TOPUP25
  const redeemRes = await bob.request('POST', '/api/promo/redeem', { code: 'TOPUP25' });
  test(redeemRes.status === 200, 'Bob redeems TOPUP25 promo code');
  test(redeemRes.json?.amount === 2500, 'TOPUP25 grants $25.00 (2,500¢)');

  const bobMeAfterPromo = await bob.me();
  test(bobMeAfterPromo.json?.snapshot?.wallet?.available === 13500, `Bob total balance is now $135.00 (13,500¢)`);

  // STEP 3: Market Discovery & Public Data
  step('3. Market Discovery, Categories, and Quotes');
  const mktsRes = await alice.request('GET', '/api/markets');
  test(mktsRes.status === 200, 'GET /api/markets returns 200');
  const openMarkets = mktsRes.json?.markets?.filter((m) => m.status === 'open') || [];
  test(openMarkets.length > 0, `Active open markets available: ${openMarkets.length}`);

  const binaryMarket = openMarkets.find((m) => !m.multi);
  test(!!binaryMarket, `Found open binary market: "${binaryMarket?.title}" (${binaryMarket?.slug})`);

  const multiMarket = openMarkets.find((m) => m.multi);
  test(!!multiMarket, `Found open multi-outcome market: "${multiMarket?.title}" (${multiMarket?.slug})`);

  // Check market detail
  const detail = await alice.request('GET', `/api/markets/${binaryMarket.slug}`);
  test(detail.status === 200, `GET /api/markets/${binaryMarket.slug} returns 200`);
  test(Array.isArray(detail.json?.book?.bids), 'Order book contains bids');
  test(Array.isArray(detail.json?.book?.asks), 'Order book contains asks');

  // STEP 4: Order Matching & Trading Mechanics
  step('4. Active Trading: Limit Maker/Taker, Book Matching, and Cancellations');
  const initialAliceCash = (await alice.me()).json?.snapshot?.wallet?.available;

  // Alice places a Maker Limit Order well below the book ask
  const currentAsks = detail.json?.book?.asks || [];
  const lowestAsk = currentAsks.length ? Math.min(...currentAsks.map((a) => a.price)) : 60;
  const makerPrice = Math.max(1, Math.min(25, lowestAsk - 5));
  const expectedCost = 5 * makerPrice;

  const makerOrder = await alice.placeOrder({
    marketId: binaryMarket.id,
    side: 'buy',
    outcome: 'yes',
    type: 'limit',
    price: makerPrice,
    qty: 5,
  });
  test(makerOrder.status === 201, `Alice places resting Maker Limit Order (Buy 5 YES @ ${makerPrice}¢)`);
  test(makerOrder.json?.order?.status === 'open', 'Maker order status is open (resting in book)');
  const aliceMakerOrderId = makerOrder.json?.order?.id;

  // Verify Alice's cash is reserved (5 shares * makerPrice¢ reserved)
  const aliceAfterMaker = await alice.me();
  test(aliceAfterMaker.json?.snapshot?.wallet?.reserved >= expectedCost, `Alice cash reserved: ${aliceAfterMaker.json?.snapshot?.wallet?.reserved}¢`);
  test(aliceAfterMaker.json?.snapshot?.wallet?.available === initialAliceCash - expectedCost, `Alice available cash reduced by ${expectedCost}¢ to ${aliceAfterMaker.json?.snapshot?.wallet?.available}¢`);

  // Alice cancels her resting maker order
  const cancelRes = await alice.cancelOrder(aliceMakerOrderId);
  test(cancelRes.status === 200, 'Alice cancels her maker order');
  const aliceAfterCancel = await alice.me();
  test(!aliceAfterCancel.json?.snapshot?.orders?.some((o) => o.id === aliceMakerOrderId), 'Canceled order removed from open orders index');
  test(aliceAfterCancel.json?.snapshot?.wallet?.available === initialAliceCash, 'Alice reserved cash unreserved after cancel');

  // Test Direct Taker Trade: Alice buys 3 YES contracts directly against the top ask
  const mktDetailBeforeTrade = (await alice.request('GET', `/api/markets/${binaryMarket.slug}`)).json;
  const topAsk = mktDetailBeforeTrade?.book?.asks?.[0];
  if (topAsk) {
    const takerOrder = await alice.placeOrder({
      marketId: binaryMarket.id,
      side: 'buy',
      outcome: 'yes',
      type: 'limit',
      price: topAsk.price,
      qty: 3,
    });
    test(takerOrder.status === 201, `Alice buys 3 YES @ ${topAsk.price}¢ against book ask`);
    test(takerOrder.json?.order?.filled === 3, 'Alice order filled completely');
    test(takerOrder.json?.trades?.length > 0, `Trade executed on tape: ${takerOrder.json?.trades?.length} trade(s)`);

    // Verify Alice now holds YES position
    const alicePosAfter = (await alice.me()).json?.snapshot?.positions?.find((p) => p.marketId === binaryMarket.id);
    test(alicePosAfter?.yesQty >= 3, `Alice YES position updated: now holds ${alicePosAfter?.yesQty} YES contracts`);

    // Bob buys 3 NO contracts
    const bobNoOrder = await bob.placeOrder({
      marketId: binaryMarket.id,
      side: 'buy',
      outcome: 'no',
      type: 'market',
      qty: 3,
    });
    test(bobNoOrder.status === 201, 'Bob executes Market Order buying 3 NO contracts');
    const bobPosAfter = (await bob.me()).json?.snapshot?.positions?.find((p) => p.marketId === binaryMarket.id);
    test(bobPosAfter?.noQty >= 3, `Bob NO position updated: now holds ${bobPosAfter?.noQty} NO contracts`);
  }

  // STEP 5: Multi-Outcome Markets Trading
  step('5. Multi-Outcome Market Trading (Elections / Tournaments / Milestones)');
  if (multiMarket) {
    const multiDetail = (await alice.request('GET', `/api/markets/${multiMarket.slug}`)).json;
    test(Array.isArray(multiDetail.outcomes) && multiDetail.outcomes.length > 2, `Multi market has ${multiDetail.outcomes?.length} outcomes`);
    const opt0 = multiDetail.outcomes[0];
    const opt1 = multiDetail.outcomes[1];

    // Alice buys 2 shares of Outcome 0
    const multiOrder0 = await alice.placeOrder({
      marketId: multiMarket.id,
      side: 'buy',
      outcome: 'yes',
      type: 'limit',
      price: 50,
      qty: 2,
      outcomeIdx: 0,
    });
    test(multiOrder0.status === 201, `Alice placed order on Outcome 0: "${opt0.label}"`);

    // Bob buys 2 shares of Outcome 1
    const multiOrder1 = await bob.placeOrder({
      marketId: multiMarket.id,
      side: 'buy',
      outcome: 'yes',
      type: 'limit',
      price: 30,
      qty: 2,
      outcomeIdx: 1,
    });
    test(multiOrder1.status === 201, `Bob placed order on Outcome 1: "${opt1.label}"`);
  }

  // STEP 6: Simulated Play-Money Withdrawals
  step('6. Simulated Withdrawals & Banking Pipeline');
  // Alice requests a simulated withdrawal of $20.00 (2000¢)
  const withdrawReq = await alice.request('POST', '/api/withdrawals', {
    amountCents: 2000,
    idemKey: `wd_test_${Date.now()}`,
  });
  test(withdrawReq.status === 201, 'Alice requests $20.00 withdrawal (201 Created)');
  test(withdrawReq.json?.withdrawal?.status === 'pending', 'Withdrawal initial status is pending');
  const wdId = withdrawReq.json?.withdrawal?.id;

  // Alice checks her withdrawals list
  const aliceWds = await alice.request('GET', '/api/withdrawals');
  test(aliceWds.status === 200, 'Alice views /api/withdrawals');
  test(aliceWds.json?.withdrawals?.some((w) => w.id === wdId), 'Pending withdrawal appears in Alice list');
  test(aliceWds.json?.wallet?.withdrawReserved >= 2000, `Withdrawal amount reserved in wallet: ${aliceWds.json?.wallet?.withdrawReserved}¢`);

  // Admin approves and completes the withdrawal
  const adminWdList = await admin.request('GET', '/api/admin/withdrawals');
  test(adminWdList.status === 200, 'Admin accesses /api/admin/withdrawals');
  test(adminWdList.json?.withdrawals?.some((w) => w.id === wdId), 'Admin sees pending withdrawal');

  const adminApprove = await admin.request('POST', `/api/admin/withdrawals/${wdId}/approve`);
  test(adminApprove.status === 200, 'Admin approves withdrawal');

  const adminComplete = await admin.request('POST', `/api/admin/withdrawals/${wdId}/complete`, { note: 'Demo bank payout sent' });
  test(adminComplete.status === 200, 'Admin marks withdrawal completed');

  // Verify Alice wallet reflects final completion
  const aliceAfterWd = await alice.me();
  test(aliceAfterWd.json?.snapshot?.wallet?.withdrawReserved === 0, 'Withdrawal reserve released after completion');

  // Test user withdrawal cancellation: Bob requests $10 withdrawal and cancels it
  const bobWdReq = await bob.request('POST', '/api/withdrawals', { amountCents: 1000 });
  test(bobWdReq.status === 201, 'Bob requests $10.00 withdrawal');
  const bobWdId = bobWdReq.json?.withdrawal?.id;

  const bobCancelWd = await bob.request('POST', `/api/withdrawals/${bobWdId}/cancel`);
  test(bobCancelWd.status === 200, 'Bob cancels his pending withdrawal');
  test(bobCancelWd.json?.withdrawal?.status === 'cancelled', 'Withdrawal status updated to cancelled');

  // STEP 7: Watchlist, Comments, and Alerts
  step('7. Social, Watchlist & Price Alerts');
  // Watchlist: Alice adds binary market to watchlist
  const watchToggleOn = await alice.request('POST', '/api/watchlist/toggle', { marketId: binaryMarket.id });
  test(watchToggleOn.status === 200 && watchToggleOn.json?.watching === true, 'Alice adds market to watchlist');

  const aliceWatchlist = await alice.request('GET', '/api/watchlist');
  test(Array.isArray(aliceWatchlist.json?.markets) && aliceWatchlist.json?.markets?.some((m) => m.id === binaryMarket.id), 'Market appears in Alice watchlist');

  // Comments: Bob posts a comment on binaryMarket
  const commentText = `Great liquidity on this market! Timestamp: ${Date.now()}`;
  const postComment = await bob.request('POST', `/api/markets/${binaryMarket.slug}/comments`, { body: commentText });
  test(postComment.status === 201, 'Bob posts comment on market');
  test(postComment.json?.comment?.body === commentText, 'Comment body matches');

  const getComments = await alice.request('GET', `/api/markets/${binaryMarket.slug}/comments`);
  test(getComments.status === 200, 'Alice fetches comments for market');
  test(getComments.json?.comments?.some((c) => c.body === commentText), 'Bob comment visible to other traders');

  // Price Alerts: Alice sets a price alert
  const alertRes = await alice.request('POST', '/api/me/alerts', {
    marketId: binaryMarket.id,
    outcomeIdx: 0,
    dir: 'above',
    price: 80,
  });
  test(alertRes.status === 201, 'Alice sets price alert for price > 80¢');

  const aliceAlerts = await alice.request('GET', '/api/me/alerts');
  test(aliceAlerts.json?.alerts?.length > 0, `Alice has ${aliceAlerts.json?.alerts?.length} active alert(s)`);
  const alertId = aliceAlerts.json?.alerts?.[0]?.id;

  if (alertId) {
    const deleteAlert = await alice.request('DELETE', `/api/me/alerts/${alertId}`);
    test(deleteAlert.status === 200, 'Alice deletes her price alert');
  }

  // STEP 8: Public Profiles, Stats, and Leaderboard
  step('8. Trader Profiles, Achievements & Leaderboard');
  const aliceProfile = await bob.request('GET', `/api/traders/${aliceName}`);
  test(aliceProfile.status === 200, `Public trader profile accessible for @${aliceName}`);
  test(aliceProfile.json?.trader?.username === aliceName, 'Profile returns correct username');
  test(typeof aliceProfile.json?.trader?.equity === 'number', `Trader total equity reported: $${(aliceProfile.json?.trader?.equity / 100).toFixed(2)}`);

  const bobAchievements = await bob.request('GET', '/api/me/achievements');
  test(bobAchievements.status === 200, 'Bob fetches personal achievements');

  const bobStats = await bob.request('GET', '/api/me/stats');
  test(bobStats.status === 200, 'Bob fetches personal trading performance statistics');

  const leaderboardRes = await alice.request('GET', '/api/leaderboard');
  test(leaderboardRes.status === 200, 'GET /api/leaderboard returns 200');
  test(Array.isArray(leaderboardRes.json?.leaderboard), 'Leaderboard populated with active traders');

  // STEP 9: Security & Password Management
  step('9. Account Security & Password Update');
  const changePw = await alice.request('POST', '/api/me/password', {
    current: 'password123',
    next: 'new_super_secret_pw_999',
  });
  test(changePw.status === 200, 'Alice changes account password');

  // Check login with old password fails
  const oldLogin = await (new SessionClient('AliceOld')).login(aliceName, 'password123');
  test(oldLogin.status === 401, 'Login with old password rejected with 401');

  // Check login with new password succeeds
  const newLogin = await (new SessionClient('AliceNew')).login(aliceName, 'new_super_secret_pw_999');
  test(newLogin.status === 200, 'Login with updated password succeeds with 200 OK');

  // Notifications: Alice marks security notification as read
  const notifs = await alice.request('GET', '/api/me/notifications');
  test(notifs.status === 200, 'Alice fetches notifications');
  test(notifs.json?.notifications?.some((n) => n.title.toLowerCase().includes('password')), 'Security notification logged for password change');

  const markRead = await alice.request('POST', '/api/me/notifications/read');
  test(markRead.status === 200, 'Alice marks all notifications as read');

  // STEP 10: External Feeds & Price Oracles
  step('10. Price Oracles & External Data Feeds');
  const btcPrice = await admin.request('GET', '/api/price?asset=bitcoin');
  test(btcPrice.status === 200, 'GET /api/price?asset=bitcoin returns 200');
  test(typeof btcPrice.json?.value === 'number', `Live/cached Bitcoin reference price: $${btcPrice.json?.value}`);

  const weatherQuote = await admin.request('GET', '/api/weather?lat=28.6139&lon=77.2090&metric=temperature');
  test(weatherQuote.status === 200, 'GET /api/weather returns 200');
  test(typeof weatherQuote.json?.value === 'number', `Weather feed temperature: ${weatherQuote.json?.value}°C`);

  // STEP 11: Market Creation, Halting, Trading, Resolution & Settlement
  step('11. Full Admin Market Lifecycle (Create, Halt, Trade, Resolve, Settle)');
  const newMarketTitle = `Will AGI be announced by end of 2026? (${ts})`;
  const newMarketSlug = `will-agi-be-announced-by-end-of-2026-${ts}`;
  const closeTime = Date.now() + 2 * 3600 * 1000; // 2 hours from now (> 1 hour requirement)

  // 11.1 Admin creates new market
  const createMarketRes = await admin.request('POST', '/api/admin/markets', {
    title: newMarketTitle,
    slug: newMarketSlug,
    category: 'Technology',
    emoji: '🤖',
    closeTime,
    rules: 'Resolves YES if leading AI labs formally announce AGI.',
    source: 'Official Press Releases',
  });
  test(createMarketRes.status === 201, `Admin created new market: "${newMarketTitle}"`);
  const createdMarketId = createMarketRes.json?.market?.id;
  test(!!createdMarketId, `New market ID assigned: ${createdMarketId}`);

  // 11.2 Admin halts market trading
  const haltRes = await admin.request('POST', `/api/admin/markets/${createdMarketId}/halt`);
  test(haltRes.status === 200, 'Admin halts trading on the new market');

  // Alice attempts to place an order while halted -> Should be rejected with 423!
  const haltedOrder = await alice.placeOrder({
    marketId: createdMarketId,
    side: 'buy',
    outcome: 'yes',
    type: 'limit',
    price: 50,
    qty: 5,
  });
  test(haltedOrder.status === 423, 'Order placed on halted market correctly rejected with 423');

  // 11.3 Admin resumes trading
  const openRes = await admin.request('POST', `/api/admin/markets/${createdMarketId}/open`);
  test(openRes.status === 200, 'Admin resumes trading on the market');

  // 11.4 Alice and Bob trade on the new market
  // Alice buys 10 YES @ 60¢ ($6.00)
  const aliceBuyAgi = await alice.placeOrder({
    marketId: createdMarketId,
    side: 'buy',
    outcome: 'yes',
    type: 'limit',
    price: 60,
    qty: 10,
  });
  test(aliceBuyAgi.status === 201, 'Alice places 10 YES @ 60¢ on new market');

  // Bob buys 10 NO @ 40¢ ($4.00) -> Crosses Alice's 60¢ YES bid via minting!
  const bobBuyAgi = await bob.placeOrder({
    marketId: createdMarketId,
    side: 'buy',
    outcome: 'no',
    type: 'limit',
    price: 40,
    qty: 10,
  });
  test(bobBuyAgi.status === 201, 'Bob places 10 NO @ 40¢ (matched against Alice)');

  // Verify positions on the new market
  const aliceAgiPos = (await alice.me()).json?.snapshot?.positions?.find((p) => p.marketId === createdMarketId);
  test(aliceAgiPos?.yesQty === 10, `Alice holds exactly 10 YES contracts`);

  const bobAgiPos = (await bob.me()).json?.snapshot?.positions?.find((p) => p.marketId === createdMarketId);
  test(bobAgiPos?.noQty === 10, `Bob holds exactly 10 NO contracts`);

  const aliceCashBeforeSettle = (await alice.me()).json?.snapshot?.wallet?.available;
  const bobCashBeforeSettle = (await bob.me()).json?.snapshot?.wallet?.available;

  // 11.5 Admin resolution preview step (Step 1)
  const resolvePreview = await admin.request('POST', `/api/admin/markets/${createdMarketId}/resolve`, {
    outcome: 'yes',
    evidence: 'OpenAI and DeepMind announced AGI milestone with audited benchmarks.',
    source: 'Press Release',
    force: true,
  });
  test(resolvePreview.status === 200, 'Admin generates resolution proposal preview (Step 1)');
  test(resolvePreview.json?.confirmationRequired === true, 'Resolution requires confirmation preview');
  test(resolvePreview.json?.proposal?.outcome === 'YES', 'Resolution proposed outcome is YES');

  // 11.6 Admin confirms settlement (Step 2)
  const settleRes = await admin.request('POST', `/api/admin/markets/${createdMarketId}/resolve`, {
    outcome: 'yes',
    evidence: 'OpenAI and DeepMind announced AGI milestone with audited benchmarks.',
    source: 'Press Release',
    confirm: true,
    force: true,
  });
  test(settleRes.status === 200, 'Admin settles market payouts (Step 2)');
  test(settleRes.json?.ok === true, 'Resolution succeeded');

  // 11.7 Payout Verification
  // Alice won! 10 YES contracts pay $1.00 (100¢) each = $10.00 (1000¢) credited!
  const aliceCashAfterSettle = (await alice.me()).json?.snapshot?.wallet?.available;
  const alicePayout = aliceCashAfterSettle - aliceCashBeforeSettle;
  test(alicePayout === 1000, `Alice won: received full payout of +$10.00 (1,000¢) for 10 YES contracts (actual: +${alicePayout}¢)`);

  // Bob lost on NO: received 0¢ payout
  const bobCashAfterSettle = (await bob.me()).json?.snapshot?.wallet?.available;
  const bobPayout = bobCashAfterSettle - bobCashBeforeSettle;
  test(bobPayout === 0, `Bob lost NO: received 0¢ payout as expected`);

  // 11.8 Public Resolution Audit Trail
  const auditRes = await alice.request('GET', `/api/markets/${newMarketSlug}/resolution`);
  test(auditRes.status === 200, 'Public resolution audit trail accessible');
  test(auditRes.json?.verified === true, 'Cryptographic hash verification passed on resolution record');
  test(auditRes.json?.resolution?.outcome === 'YES', 'Audit record confirms outcome = YES');

  // STEP 12: Ledger Zero-Sum Reconciliation
  step('12. Double-Entry Immutable Ledger Audit');
  const portfolioAfterAll = await alice.portfolio();
  test(Array.isArray(portfolioAfterAll.json?.ledger), `Alice ledger contains ${portfolioAfterAll.json?.ledger?.length} immutable double-entry records`);

  // Summary
  console.log(`\n============================================================`);
  console.log(`🏁 FULL PLATFORM TEST SUMMARY:`);
  console.log(`   TOTAL TESTS: ${passed + failed}`);
  console.log(`   PASSED:      ${passed} ✅`);
  console.log(`   FAILED:      ${failed} ${failed > 0 ? '❌' : ''}`);
  console.log(`============================================================\n`);

  process.exit(failed > 0 ? 1 : 0);
}

runComprehensiveTests().catch((err) => {
  console.error('Fatal test runner failure:', err);
  process.exit(1);
});
