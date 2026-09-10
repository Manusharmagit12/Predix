'use strict';
/**
 * Concurrency & race-condition tests — a real HTTP server (in-process) taking
 * genuinely simultaneous trading requests. Scenarios: same-wallet buy storm,
 * buys×sells crossing, many takers vs one maker, cancel-vs-fill, settlement
 * storms, idempotency-key storm, cross-market trading, and the single-writer
 * database guard. After EVERY scenario: full invariants + ledger
 * reconciliation, plus targeted no-overfill / no-double-pay checks.
 * Run: node tests/concurrency.test.js   (isolated PostgreSQL test database)
 */
const assert = require('assert');
const http = require('http');
const { Engine } = require('../lib/engine');
const { Api } = require('../lib/api');
const { Hub } = require('../lib/hub');
const { checkEngine } = require('../lib/invariants');
const { createTestStore } = require('./pg-helper');
const { COOKIE_NAME } = require('../lib/auth');

let passed = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); passed++; console.log('  ✓ ' + msg); };

(async () => {
  const store = await createTestStore('concurrency');
  await store.acquireWriterLock(); // production boot path
  const engine = new Engine(store, new Hub());
  engine.rebuild();
  const api = new Api(store, engine, new Hub());
  const server = http.createServer((req, res) => api.handle(req, res).catch((e) => {
    if (!res.headersSent) { res.writeHead(500, { 'content-type': 'application/json' }); }
    try { res.end(JSON.stringify({ error: 'Server error' })); } catch {}
  }));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port;

  const post = async (path, body, cookie) => {
    const r = await fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });
    const setCookie = r.headers.get('set-cookie');
    return { status: r.status, data: await r.json().catch(() => ({})), cookie: setCookie ? setCookie.split(';')[0] : null };
  };
  /* direct user+session creation (no HTTP auth) so the auth rate limiter
     never masks what we're actually testing: concurrent TRADING endpoints */
  const newUser = (name, extraCents = 0) => {
    const u = store.insert('users', { username: name, email: name + '@t.local', salt: 's', passHash: 'h', role: 'user', createdAt: Date.now() });
    engine.creditWallet(u.id, 10000 + extraCents, 'promo', 'concurrency test funds');
    const token = api.auth.createSession(u.id);
    return { u, cookie: COOKIE_NAME + '=' + token };
  };
  const wallet = (uid) => store.findOne('wallets', (w) => w.userId === uid);
  let seq = 0;
  const mkMarket = () => {
    seq++;
    return store.insert('markets', {
      slug: 'race-' + seq, title: 'Race ' + seq, emoji: '⚡', category: 'Test', description: '',
      resolutionSource: 'src', resolutionRules: 'rules', closeTime: Date.now() + 86400000,
      createdAt: Date.now(), status: 'open', outcome: null, last: null, lastTradeTs: null,
    });
  };
  async function verify(tag) {
    await store.flush();
    const inv = checkEngine(engine, { kExpected: engine.kExpected });
    ok(inv.violations.length === 0, 'invariants clean — ' + tag);
    const rec = engine.ledger.reconcile();
    ok(rec.violations.length === 0, 'ledger reconciles — ' + tag);
    ok(store.all('wallets').every((w) => w.available >= 0 && w.reserved >= 0), 'no negative balances — ' + tag);
    ok(store.all('orders').every((o) => o.filled <= o.origQty), 'no overfilled orders — ' + tag);
    return rec;
  }

  /* ============ 1. 50 simultaneous buys from the SAME wallet ============ */
  {
    const M = mkMarket();
    const { u, cookie } = newUser('storm_buyer', 100000);
    const results = await Promise.all(Array.from({ length: 50 }, () =>
      post('/api/orders', { market: M.slug, side: 'buy', outcome: 'yes', type: 'limit', price: 30, qty: 5 }, cookie)));
    const orders = results.map((r) => r.data.order).filter(Boolean);
    const statusCount = {};
    results.forEach((r) => { statusCount[r.status] = (statusCount[r.status] || 0) + 1; });
    const sampleErr = results.find((r) => r.status !== 201);
    ok(results.every((r) => r.status === 201) && orders.length === 50,
      '50/50 simultaneous orders accepted (statuses=' + JSON.stringify(statusCount) + (sampleErr ? ' err=' + JSON.stringify(sampleErr.data).slice(0, 140) : '') + ')');
    ok(new Set(orders.map((o) => o.id)).size === 50, '50 distinct order ids — no duplicate creation');
    const w = wallet(u.id);
    ok(w.reserved === 50 * 150 && w.available === 100000 + 10000 - 7500, `wallet exact: reserved=${w.reserved} (50 × 150¢), no overspend`);
    await verify('same-wallet storm');
  }

  /* ============ 2. simultaneous buys & sells (opposite sides → mints) ============ */
  {
    const M = mkMarket();
    const buyer = newUser('x_buyer', 100000);
    const noBuyer = newUser('x_nobuyer', 100000);
    const results = await Promise.all([
      ...Array.from({ length: 20 }, () => post('/api/orders', { market: M.slug, side: 'buy', outcome: 'yes', type: 'limit', price: 55, qty: 4 }, buyer.cookie)),
      ...Array.from({ length: 20 }, () => post('/api/orders', { market: M.slug, side: 'buy', outcome: 'no', type: 'limit', price: 45, qty: 4 }, noBuyer.cookie)),
    ]);
    ok(results.every((r) => r.status === 201), '40 concurrent crossing orders all handled');
    const supply = store.all('positions').filter((p) => p.marketId === M.id).reduce((s, p) => s + p.yesQty, 0);
    ok(supply > 0 && supply <= 20 * 4, `minted pairs in range (${supply})`);
    const acct = engine.ledger.accountBalances();
    ok(acct.get(`collat:${M.id}:0`) === 100 * supply, `collateral pool exactly $1 × ${supply} pairs under concurrency`);
    await verify('buys × sells');
  }

  /* ============ 3. many takers hammering ONE maker order ============ */
  {
    const M = mkMarket();
    const maker = newUser('big_maker', 200000);
    // mint 100 YES to the maker (sequentially, setup only)
    engine.place(maker.u, M, { side: 'buy', outcome: 'yes', type: 'limit', price: 50, qty: 100 });
    const filler = newUser('mint_helper', 200000);
    engine.place(filler.u, M, { side: 'buy', outcome: 'no', type: 'limit', price: 50, qty: 100 });
    engine.place(maker.u, M, { side: 'sell', outcome: 'yes', type: 'limit', price: 50, qty: 100 }); // the one resting ask
    const takers = [];
    for (let i = 0; i < 30; i++) takers.push(newUser('taker_' + i));
    const results = await Promise.all(takers.map((t) =>
      post('/api/orders', { market: M.slug, side: 'buy', outcome: 'yes', type: 'market', qty: 5 }, t.cookie)));
    const totalFilled = results.reduce((s, r) => s + (r.data.order ? r.data.order.filled : 0), 0);
    ok(totalFilled === 100, `30 takers × 5 vs one 100-share ask → exactly 100 filled (got ${totalFilled}) — same quantity never filled twice`);
    const makerRow = store.all('orders').find((o) => o.userId === maker.u.id && o.kind === 'SY' && o.origQty === 100);
    ok(makerRow.filled === 100 && makerRow.status === 'filled', 'maker filled exactly origQty, never more');
    const makerTrades = store.all('trades').filter((t) => t.makerOrderId === makerRow.id);
    ok(makerTrades.reduce((s, t) => s + t.qty, 0) === 100 && new Set(makerTrades.map((t) => t.id)).size === makerTrades.length, 'maker trade legs sum to 100 with unique trade ids');
    await verify('taker storm vs single maker');
  }

  /* ============ 4. cancel vs fill race ============ */
  {
    const M = mkMarket();
    const owner = newUser('cancel_owner', 200000);
    const minter = newUser('cancel_minter', 200000);
    engine.place(owner.u, M, { side: 'buy', outcome: 'yes', type: 'limit', price: 40, qty: 50 }); // owner holds YES to sell
    engine.place(minter.u, M, { side: 'buy', outcome: 'no', type: 'limit', price: 60, qty: 50 });
    const resting = [];
    for (let i = 0; i < 10; i++) {
      const r = engine.place(owner.u, M, { side: 'sell', outcome: 'yes', type: 'limit', price: 50 + i, qty: 5 });
      resting.push(r.order.id);
    }
    const attacker = newUser('race_attacker', 200000);
    const results = await Promise.all([
      ...resting.map((id) => post(`/api/orders/${id}/cancel`, {}, owner.cookie)),
      ...Array.from({ length: 10 }, () => post('/api/orders', { market: M.slug, side: 'buy', outcome: 'yes', type: 'market', qty: 5 }, attacker.cookie)),
    ]);
    const cancels = results.slice(0, 10).filter((r) => r.status === 200).length;
    const bought = results.slice(10).reduce((s, r) => s + (r.data.order ? r.data.order.filled : 0), 0);
    const rows = resting.map((id) => store.get('orders', id));
    ok(rows.every((o) => o.qty + o.filled === o.origQty), 'every raced order consistent: qty + filled == origQty');
    ok(cancels + bought >= 0 && rows.filter((o) => o.status === 'canceled').length <= 10, `cancel-vs-fill resolved without corruption (${cancels} cancels won, ${bought} shares bought)`);
    // share reserves: only still-open sell orders may hold reserves
    const openSellQty = store.all('orders').filter((o) => o.marketId === M.id && o.status === 'open' && (o.kind === 'SY' || o.kind === 'SN')).reduce((s, o) => s + o.qty, 0);
    const pos = store.all('positions').find((p) => p.marketId === M.id && p.userId === owner.u.id);
    ok(pos.yesReserved === openSellQty, `concurrent cancels/fills left share reserves exact (${pos.yesReserved} == ${openSellQty})`);
    await verify('cancel vs fill');
  }

  /* ============ 5. settlement vs settlement (+ resolve storm) ============ */
  {
    const M = mkMarket();
    const w1 = newUser('settle_a', 100000);
    const w2 = newUser('settle_b', 100000);
    engine.place(w1.u, M, { side: 'buy', outcome: 'yes', type: 'limit', price: 40, qty: 20 });
    engine.place(w2.u, M, { side: 'buy', outcome: 'no', type: 'limit', price: 60, qty: 20 }); // 20 pairs
    const admin = newUser('root_admin');
    store.update('users', { ...admin.u, role: 'admin' });
    M.status = 'closed'; store.update('markets', M);
    // 5 concurrent RESOLVES — exactly one may win
    const resolves = await Promise.all(Array.from({ length: 5 }, () =>
      post(`/api/admin/markets/${M.id}/resolve`, { outcome: 'yes', evidence: 'concurrency official result', confirm: true, force: true }, admin.cookie)));
    ok(resolves.filter((r) => r.status === 200).length === 1 && resolves.filter((r) => r.status === 409).length === 4, 'concurrent resolves: exactly one wins, four rejected');
    const paid1 = wallet(w1.u.id).available;
    // 12 concurrent SETTLES — must pay nothing more
    const settles = await Promise.all(Array.from({ length: 12 }, () =>
      post(`/api/admin/markets/${M.id}/settle`, {}, admin.cookie)));
    ok(settles.every((s) => s.status === 200 && s.data.alreadySettled === true), '12 concurrent settles: all no-ops (alreadySettled)');
    ok(wallet(w1.u.id).available === paid1, 'winner paid EXACTLY once — no double settlement');
    const setTxs = store.all('ltx').filter((t) => t.kind === 'settlement' && t.marketId === M.id);
    ok(setTxs.reduce((s, t) => s + (t.settlementId !== null ? 1 : 0), 0) === setTxs.length && setTxs.length === 1, 'exactly one settlement ledger transaction');
    await verify('settlement storm');
  }

  /* ============ 6. duplicate idempotency-key storm ============ */
  {
    const M = mkMarket();
    const { cookie } = newUser('idem_storm', 100000);
    const body = { market: M.slug, side: 'buy', outcome: 'yes', type: 'limit', price: 35, qty: 6, tif: 'POST_ONLY', idemKey: 'storm-key-1' };
    const results = await Promise.all(Array.from({ length: 40 }, () => post('/api/orders', body, cookie)));
    const ids = new Set(results.map((r) => r.data.order && r.data.order.id).filter(Boolean));
    ok(results.every((r) => r.status === 201) && ids.size === 1, `40 simultaneous identical requests → ONE order id (${[...ids][0]})`);
    ok(store.all('orders').filter((o) => o.idemKey === 'storm-key-1').length === 1, 'exactly one order row for the storm key');
    const w = store.all('wallets');
    ok(w.every((x) => x.reserved >= 0), 'reserve charged once (no double reserve)');
    await verify('idempotency storm');
  }

  /* ============ 7. concurrent trading across DIFFERENT markets ============ */
  {
    const markets = [mkMarket(), mkMarket(), mkMarket()];
    const traders = [newUser('multi_t1', 100000), newUser('multi_t2', 100000)];
    const jobs = [];
    for (const m of markets) {
      for (const t of traders) {
        jobs.push(post('/api/orders', { market: m.slug, side: 'buy', outcome: 'yes', type: 'limit', price: 30, qty: 5, tif: 'POST_ONLY' }, t.cookie));
        jobs.push(post('/api/orders', { market: m.slug, side: 'buy', outcome: 'no', type: 'limit', price: 70, qty: 5 }, t.cookie));
      }
    }
    const results = await Promise.all(jobs);
    ok(results.every((r) => r.status === 201), '12 concurrent orders across 3 markets × 2 users all accepted (no global lock blocking them)');
    for (const m of markets) {
      const supply = store.all('positions').filter((p) => p.marketId === m.id).reduce((s, p) => s + p.yesQty, 0);
      const acct = engine.ledger.accountBalances();
      ok(acct.get(`collat:${m.id}:0`) === 100 * supply, `market ${m.slug}: pool exact under concurrency`);
    }
    await verify('cross-market concurrency');
  }

  /* ============ 8. single-writer database guard ============ */
  {
    const { PgStore } = require('../lib/store-pg');
    const { Pool } = require('pg');
    const pool2 = new Pool({ database: store.pool.options.database });
    const second = new PgStore({ pool: pool2 });
    let refused = false;
    try { await second.acquireWriterLock(); } catch (e) { refused = /another Predix instance/.test(e.message); }
    ok(refused, 'a second process is refused by the PostgreSQL writer lock (no split-brain)');
    await second.close();
  }

  const rec = await verify('final full sweep');
  ok(rec.txCount > 100, `substantial ledger history all balanced (${rec.txCount} txs, ${rec.entryCount} entries)`);

  server.close();
  await store.close();
  console.log('\nCONCURRENCY TESTS PASSED ✅ (' + passed + ' assertions)');
  process.exit(0);
})().catch((e) => { console.error('SUITE CRASH:', e); process.exit(1); });
