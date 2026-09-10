'use strict';
/**
 * Double-entry ledger tests — balanced trades, reserve/release, mint/burn,
 * settlement, credits, failed transactions, tamper attempts (DB triggers),
 * and full reconciliation after a randomized storm.
 * Run: node tests/ledger.test.js   (isolated PostgreSQL test database)
 */
const assert = require('assert');
const { Engine } = require('../lib/engine');
const { checkEngine } = require('../lib/invariants');
const { createTestStore } = require('./pg-helper');

let passed = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); passed++; console.log('  ✓ ' + msg); };
const throwsWith = (fn, re, msg) => {
  try { fn(); } catch (e) { ok(re.test(e.message), msg + ' → ' + e.message.slice(0, 70)); return; }
  ok(false, msg + ' → DID NOT THROW');
};

(async () => {
  const store = await createTestStore('ledger');
  const engine = new Engine(store, { broadcast() {}, sendUser() {} });
  engine.rebuild();
  const led = engine.ledger;

  const mkUser = (name, cents) => {
    const u = store.insert('users', { username: name, email: name + '@x.io', salt: 's', passHash: 'h', role: 'user', createdAt: Date.now() });
    engine.creditWallet(u.id, cents, 'promo', 'ledger test funds');
    return u;
  };
  let seq = 0;
  const mkMarket = (outcomes) => {
    seq++;
    return store.insert('markets', {
      slug: 'led-' + seq, title: 'Ledger ' + seq, emoji: '💰', category: 'Test', description: '',
      resolutionSource: 'src', resolutionRules: 'rules', closeTime: Date.now() + 86400000,
      createdAt: Date.now(), status: 'open', outcome: null, last: null, lastTradeTs: null,
      outcomes: outcomes || null,
    });
  };
  const wallet = (uid) => store.findOne('wallets', (w) => w.userId === uid);
  const acct = () => led.accountBalances();
  const A = (a) => acct().get(a) || 0;

  /* ============ 1. credits are balanced issuance ============ */
  const alice = mkUser('alice', 100000);
  const bob = mkUser('bob', 100000);
  ok(A(`avail:${alice.id}`) === 100000 && wallet(alice.id).available === 100000, 'credit: ledger avail == wallet.available');
  ok(A('equity:promo') === -200000, 'credit: equity:promo carries the offsetting debit (zero-sum)');

  /* ============ 2. reserve / release ============ */
  const M = mkMarket();
  const rOrder = engine.place(alice, M, { side: 'buy', outcome: 'yes', type: 'limit', price: 40, qty: 7, tif: 'POST_ONLY' });
  ok(A(`rsvd:${alice.id}`) === 280 && wallet(alice.id).reserved === 280, 'reserve: rsvd account == wallet.reserved (7 × 40¢)');
  ok(A(`avail:${alice.id}`) === 99720 && wallet(alice.id).available === 99720, 'reserve: avail debited in lockstep');
  const resTx = store.all('ltx').find((t) => t.kind === 'reserve');
  ok(resTx && resTx.orderId === rOrder.order.id && resTx.marketId === M.id, 'reserve tx references orderId + marketId');
  engine.cancel(alice.id, rOrder.order.id);
  ok(A(`rsvd:${alice.id}`) === 0 && wallet(alice.id).reserved === 0, 'release: reserve returned to avail on cancel');

  /* ============ 3. mint: pair funded $1, pool = 100 × supply ============ */
  engine.place(alice, M, { side: 'buy', outcome: 'yes', type: 'limit', price: 45, qty: 10 }); // rests
  engine.place(bob, M, { side: 'buy', outcome: 'no', type: 'limit', price: 55, qty: 10 });   // crosses → mint
  const supply0 = store.all('positions').filter((p) => p.marketId === M.id).reduce((s, p) => s + p.yesQty, 0);
  ok(supply0 === 10, 'setup: 10 pairs outstanding');
  ok(A(`collat:${M.id}:0`) === 1000, 'mint: collateral pool holds exactly $1 × 10 pairs');
  const mintTx = store.all('ltx').find((t) => t.kind === 'mint');
  ok(!!mintTx && mintTx.tradeId !== null && mintTx.orderId !== null, 'mint tx references tradeId + orderId');

  /* ============ 4. trade transfer: buyer debit == seller credit ============ */
  const avA = wallet(alice.id).available, avB = wallet(bob.id).available;
  engine.place(bob, M, { side: 'buy', outcome: 'yes', type: 'limit', price: 50, qty: 4 }); // bob bids
  engine.place(alice, M, { side: 'sell', outcome: 'yes', type: 'limit', price: 48, qty: 4 }); // alice sells → transfer
  ok(wallet(bob.id).available === avB - 200 && wallet(alice.id).available === avA + 200, 'transfer: cash moved 4 × 50¢ buyer→seller');
  ok(A(`collat:${M.id}:0`) === 1000, 'transfer: collateral pool untouched by share transfer');

  /* ============ 5. burn: $1 released from the pool ============ */
  engine.place(bob, M, { side: 'sell', outcome: 'no', type: 'limit', price: 55, qty: 3 });    // bob SN 3@55 → rests as BID at YES 45
  engine.place(alice, M, { side: 'sell', outcome: 'yes', type: 'limit', price: 45, qty: 3 });  // alice SY 3@45 → ASK crosses bob's bid → BURN 3 pairs
  ok(A(`collat:${M.id}:0`) === 700, 'burn: pool shrank by $1 × 3 burned pairs');

  /* ============ 6. settlement drains the pool to winners ============ */
  M.status = 'closed'; store.update('markets', M);
  const preAlice = wallet(alice.id).available;
  engine.resolve(M, 'yes', { evidence: 'ledger-test official result', confirm: true, force: true, actor: { id: 1, username: 'tester', role: 'admin' } });
  ok(A(`collat:${M.id}:0`) === 0, 'settlement: collateral pool fully drained');
  ok(wallet(alice.id).available === preAlice + A(`avail:${alice.id}`) - preAlice, 'settlement: wallet == ledger after payout');
  const setTx = store.all('ltx').find((t) => t.kind === 'settlement');
  ok(setTx && setTx.settlementId !== null && setTx.marketId === M.id, 'settlement tx references settlementId + marketId');

  /* ============ 7. failed transactions: unbalanced = refused, nothing written ============ */
  const txBefore = store.all('ltx').length, entBefore = store.all('lent').length;
  throwsWith(() => led.post('credit', [{ a: 'equity:promo', d: 500 }, { a: `avail:${alice.id}`, c: 400 }]), /does not balance/, 'unbalanced transaction refused by post()');
  throwsWith(() => led.post('trade', [{ a: `avail:${alice.id}`, d: 100 }]), /does not balance/, 'single-sided transaction refused');
  throwsWith(() => led.post('mint', [{ a: 'x', d: 10.5 }, { a: 'y', c: 10.5 }]), /positive integer/, 'non-integer cents refused');
  ok(store.all('ltx').length === txBefore && store.all('lent').length === entBefore, 'refused transactions wrote zero rows');
  await store.flush(); // everything so far commits (balanced) — DB balance trigger satisfied

  /* ============ 8. tamper attempts ============ */
  // JS-level: append-only guard
  throwsWith(() => store.update('ltx', { ...store.all('ltx')[0], memo: 'tampered' }), /append-only/, 'PgStore refuses ltx UPDATE synchronously');
  throwsWith(() => store.remove('lent', store.all('lent')[0].id), /append-only/, 'PgStore refuses lent DELETE synchronously');
  // DB-level: triggers + deferred balance constraint
  await store.flush();
  const q = (sql, p) => store.pool.query(sql, p);
  const rejects = async (sql, p, msg, re) => {
    try { await q(sql, p); } catch (e) { ok(re.test(e.message), msg + ' → ' + e.message.split('\n')[0].slice(0, 60)); return; }
    ok(false, msg + ' → DID NOT THROW');
  };
  await rejects("UPDATE ltx SET kind = 'tampered' WHERE id = $1", [setTx.id], 'DB trigger blocks ltx UPDATE', /append-only/i);
  await rejects('DELETE FROM lent WHERE tx_id = $1', [setTx.id], 'DB trigger blocks lent DELETE', /append-only/i);
  // unbalanced rows straight via SQL → COMMIT refused by the deferred constraint trigger
  try {
    const c = await store.pool.connect();
    try {
      await c.query('BEGIN');
      await c.query("INSERT INTO ltx (id, kind, ts, data) VALUES (990001, 'trade', 1, '{}')");
      await c.query("INSERT INTO lent (id, tx_id, account, direction, amount, ts, data) VALUES (990001, 990001, 'avail:1', 'D', 100, 1, '{}')");
      await c.query("INSERT INTO lent (id, tx_id, account, direction, amount, ts, data) VALUES (990002, 990001, 'avail:2', 'C', 99, 1, '{}')");
      await c.query('COMMIT');
      ok(false, 'unbalanced SQL ledger transaction must not commit');
    } finally { c.release(); }
  } catch (e) {
    ok(/does not balance/i.test(e.message), 'unbalanced SQL ledger transaction refused at COMMIT (deferred trigger)');
  }

  /* ============ 9. reconciliation detects wallet tampering ============ */
  const w = wallet(alice.id);
  const saved = w.available;
  w.available += 500; store.update('wallets', w); // simulate corrupted wallet
  ok(led.reconcile().violations.length > 0, 'reconcile() flags a wallet that diverges from the ledger');
  w.available = saved; store.update('wallets', w);
  ok(led.reconcile().violations.length === 0, 'reconcile() clean again after restoring');

  /* ============ 10. randomized storm + full reconciliation ============ */
  const users = [alice, bob];
  for (let i = 0; i < 6; i++) users.push(mkUser('storm_' + i, 60000));
  let mseq2 = 100;
  const markets = [mkMarket(), mkMarket([{ label: 'A' }, { label: 'B' }, { label: 'C' }])];
  let s = 4242 >>> 0;
  const rnd = () => { s |= 0; s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const ri = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const freeShares = (uid, midx, idx, oc) => {
    const p = store.findOne('positions', (r) => r.userId === uid && r.marketId === midx && (r.outcomeIdx || 0) === idx);
    return p ? (oc === 'yes' ? p.yesQty - p.yesReserved : p.noQty - p.noReserved) : 0;
  };
  let ops = 0;
  for (let op = 0; op < 3000; op++) {
    const roll = rnd();
    try {
      if (roll < 0.8) {
        const u = pick(users), m = pick(markets);
        if (m.status !== 'open') continue;
        const multi = !!(m.outcomes && m.outcomes.length > 2);
        const body = { side: rnd() < 0.6 ? 'buy' : 'sell', outcome: rnd() < 0.5 ? 'yes' : 'no', type: roll < 0.55 ? 'limit' : 'market' };
        if (multi) body.outcomeIdx = ri(0, m.outcomes.length - 1);
        const idx = multi ? body.outcomeIdx : 0;
        if (body.type === 'limit') body.price = Math.min(95, Math.max(5, ri(30, 70) + ri(-10, 10)));
        if (body.side === 'sell') {
          const free = freeShares(u.id, m.id, idx, body.outcome);
          if (free < 1) continue;
          body.qty = ri(1, Math.min(30, free));
        } else body.qty = ri(1, 30);
        if (body.type === 'limit' && rnd() < 0.25) body.tif = pick(['IOC', 'FOK', 'POST_ONLY']);
        if (rnd() < 0.2) body.stp = pick(['skip', 'cancel_taker', 'reject']);
        engine.place(u, m, body); ops++;
      } else if (roll < 0.93) {
        const open = [...engine.orderIndex.values()];
        if (!open.length) continue;
        const o = pick(open);
        engine.cancel(o.userId, o.id); ops++;
      } else {
        const openM = markets.filter((m) => m.status === 'open');
        if (openM.length <= 1) { mseq2++; markets.push(mkMarket()); continue; }
        const m = openM[0];
        engine.resolve(m, m.outcomes ? ri(0, m.outcomes.length - 1) : (rnd() < 0.5 ? 'yes' : 'no'), { force: true, evidence: 'storm ' + m.slug, confirm: true }); ops++;
        mseq2++; markets.push(mkMarket(rnd() < 0.4 ? [{ label: 'A' }, { label: 'B' }, { label: 'C' }] : null));
      }
    } catch (e) { if (!(e && e.status && e.status < 500)) throw e; }
    if (op % 500 === 499) {
      const inv = checkEngine(engine, { kExpected: engine.kExpected });
      ok(inv.violations.length === 0, 'invariants hold at storm checkpoint ' + op);
    }
  }
  for (const m of markets.filter((m) => m.status === 'open')) {
    engine.resolve(m, m.outcomes ? ri(0, m.outcomes.length - 1) : 'yes', { force: true, evidence: 'final ' + m.slug, confirm: true });
  }
  const rec = led.reconcile();
  ok(rec.violations.length === 0, `FULL RECONCILIATION after ${ops} storm ops: every tx balanced, wallets+pools == ledger (${rec.txCount} txs, ${rec.entryCount} entries)`);
  ok([...rec.accounts.values()].reduce((a, b) => a + b, 0) === 0, 'ledger zero-sum across all accounts (equity offsets everything)');

  /* per-kind coverage proof */
  const kinds = new Set(store.all('ltx').map((t) => t.kind));
  for (const k of ['credit', 'reserve', 'release', 'trade', 'mint', 'burn', 'settlement']) {
    ok(kinds.has(k), `ledger covers '${k}' transactions`);
  }

  await store.flush();
  await store.close();
  console.log('\nDOUBLE-ENTRY LEDGER TESTS PASSED ✅ (' + passed + ' assertions)');
  process.exit(0);
})().catch((e) => { console.error('SUITE CRASH:', e); process.exit(1); });
