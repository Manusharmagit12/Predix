'use strict';
/**
 * Randomized stress test — many users, thousands of Buy/Sell/Cancel ops
 * (plus credits and settlements), with the full invariant checker running
 * after EVERY operation via engine._audit(). Seeded PRNG → reproducible.
 * Run: node tests/stress.test.js   (no server needed)
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

const { Store } = require('../lib/store');
const { Engine } = require('../lib/engine');
const { checkEngine } = require('../lib/invariants');
const { createTestStore } = require('./pg-helper');

const stubHub = { broadcast() {}, sendUser() {} };

/* seeded PRNG (mulberry32) so failures are reproducible */
let s = 42 >>> 0;
const rnd = () => { s |= 0; s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const ri = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];

let passed = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); passed++; console.log('  ✓ ' + msg); };

/* ============ setup ============ */
(async () => {
const store = await createTestStore('stress');
const engine = new Engine(store, stubHub);
engine.rebuild();

const USERS = 14, OPS = 8000;
const users = [];
for (let i = 0; i < USERS; i++) {
  const u = store.insert('users', { username: 'stress_' + i, email: 'stress' + i + '@x.io', salt: 's', passHash: 'h', role: 'user', createdAt: Date.now() });
  engine.creditWallet(u.id, 50000 + i * 7000, 'promo', 'stress starting funds'); // audited injection
  users.push(u);
}

let marketSeq = 0;
function mkMarket(multi) {
  marketSeq++;
  const row = {
    slug: 'stress-mkt-' + marketSeq, title: 'Stress market ' + marketSeq, emoji: '🎲', category: 'Stress',
    description: '', resolutionSource: 'stress', resolutionRules: 'stress',
    closeTime: Date.now() + 30 * 86400000, createdAt: Date.now(),
    status: 'open', outcome: null, last: null, lastTradeTs: null,
  };
  if (multi) row.outcomes = [{ label: 'Alpha' }, { label: 'Beta' }, { label: 'Gamma' }];
  return store.insert('markets', row);
}
let markets = [mkMarket(false), mkMarket(false), mkMarket(true)];

/* state-aware sizing so orders actually trade instead of bouncing off validation */
const walletOf = (uid) => store.findOne('wallets', (w) => w.userId === uid) || { available: 0 };
const freeShares = (uid, midx, idx, outcome) => {
  const p = store.findOne('positions', (r) => r.userId === uid && r.marketId === midx && (r.outcomeIdx || 0) === idx);
  if (!p) return 0;
  return outcome === 'yes' ? p.yesQty - p.yesReserved : p.noQty - p.noReserved;
};

/* ============ the storm ============ */
const tally = { place: 0, rejected: 0, cancel: 0, cancelRejected: 0, credit: 0, settle: 0, fills: 0, rest: 0 };
let lastCtx = '';
let firstViolation = null;
let opN = 0;

function attempt(fn, kind) {
  lastCtx = kind;
  try {
    const out = fn();
    return out;
  } catch (e) {
    if (e && e.status && e.status < 500) return { rejected: e }; // expected business rejections
    firstViolation = firstViolation || { kind, err: e };
    console.error('FAILED at op ' + opN + ' (' + kind + '): ' + (e && e.message));
    throw e;
  } finally {
    // invariants run after EVERY operation — accepted or rejected alike
    try { engine._audit('stress:' + kind); }
    catch (e) { firstViolation = firstViolation || { kind, err: e }; throw e; }
  }
}

console.log('running ' + OPS + ' randomized operations (seed 42)…');
for (let op = 0; op < OPS; op++) {
  opN = op;
  if (op % 1000 === 999) await store.flush(); // incremental durability checkpoints
  const roll = rnd();
  if (roll < 0.78) {
    // ---- place an order (limit 55% / market 23%) ----
    const u = pick(users);
    const m = pick(markets);
    if (m.status !== 'open') continue;
    const multi = !!(m.outcomes && m.outcomes.length > 2);
    const body = {
      side: rnd() < 0.6 ? 'buy' : 'sell',
      outcome: rnd() < 0.5 ? 'yes' : 'no',
      type: roll < 0.55 ? 'limit' : 'market',
    };
    if (multi) body.outcomeIdx = ri(0, m.outcomes.length - 1);
    const idx = multi ? body.outcomeIdx : 0;
    if (body.type === 'limit') {
      body.price = Math.min(95, Math.max(5, ri(32, 68) + ri(-8, 8)));
      if (rnd() < 0.3) body.tif = pick(['GTC', 'IOC', 'FOK', 'POST_ONLY']);
    }
    if (rnd() < 0.25) body.stp = pick(['skip', 'cancel_taker', 'reject']);
    let idemBody = null;
    if (rnd() < 0.12) { body.idemKey = 'op-' + op; idemBody = { u, m, k: JSON.stringify(body) }; }
    if (body.side === 'sell') {
      const free = freeShares(u.id, m.id, idx, body.outcome);
      if (free < 1 && rnd() < 0.9) continue; // usually only sell when we hold (still sometimes probe rejections)
      body.qty = ri(1, Math.max(1, Math.min(40, free + Math.floor(rnd() * 3))));
    } else {
      const per = body.type === 'limit' ? body.price : 50;
      const afford = Math.floor(walletOf(u.id).available / Math.max(1, per));
      body.qty = ri(1, Math.max(1, Math.min(40, afford + 2)));
    }
    const r = attempt(() => engine.place(u, m, body), 'place');
    // retried request with the same idempotency key must replay the exact same order
    if (idemBody && r && !r.rejected) {
      const r2 = attempt(() => engine.place(idemBody.u, idemBody.m, JSON.parse(idemBody.k)), 'place:idem-retry');
      if (r2 && !r2.rejected && r2.order.id !== r.order.id) throw new Error('IDEMPOTENCY FAILURE at op ' + op + ': retry created a new order');
    }
    if (r && (r.rejected || r.order.status === 'rejected')) tally.rejected++;
    else { tally.place++; tally.rest += r.order ? (r.order.status === 'open' ? 1 : 0) : 0; tally.fills += (r.trades || []).length; }
  } else if (roll < 0.88) {
    // ---- cancel a random open order ----
    const open = [...engine.orderIndex.values()];
    if (!open.length) continue;
    const o = pick(open);
    const u = users.find((x) => x.id === o.userId) || users[0];
    const r = attempt(() => engine.cancel(o.userId, o.id), 'cancel');
    if (r && r.rejected) tally.cancelRejected++; else tally.cancel++;
  } else if (roll < 0.985) {
    // ---- deliberate cash injection (audited, K-aware) ----
    const u = pick(users);
    attempt(() => engine.creditWallet(u.id, ri(1000, 5000), 'promo', 'stress top-up'), 'credit');
    tally.credit++;
  } else {
    // ---- resolve the oldest open market, replace it with a fresh one ----
    const open = markets.filter((m) => m.status === 'open');
    if (open.length <= 1) continue;
    const m = open[0];
    const multi = !!(m.outcomes && m.outcomes.length > 2);
    const outcome = multi ? ri(0, m.outcomes.length - 1) : (rnd() < 0.5 ? 'yes' : 'no');
    attempt(() => engine.resolve(m, outcome, { force: true, evidence: 'stress-run resolution ' + m.slug, notes: 'seeded PRNG', confirm: true }), 'settle');
    markets.splice(markets.indexOf(m), 1);
    markets.push(mkMarket(rnd() < 0.35));
    tally.settle++;
  }
}

ok(!firstViolation, 'invariants held after all ' + OPS + ' operations');

/* ============ final sweep ============ */
// resolve everything that is still open — settlement at scale, audited each time
for (const m of markets.filter((m) => m.status === 'open')) {
  const multi = !!(m.outcomes && m.outcomes.length > 2);
  attempt(() => engine.resolve(m, multi ? ri(0, m.outcomes.length - 1) : (rnd() < 0.5 ? 'yes' : 'no'), { force: true, evidence: 'stress final sweep ' + m.slug, confirm: true }), 'settle');
  const again = attempt(() => engine.settleMarket(m.id), 'settle-again'); // idempotency hammered at the end
  if (again && again.rejected) throw new Error('repeat settlement must be safe: ' + again.rejected.message);
  tally.settle++;
}
ok(true, 'all markets settled with invariants green');

const { violations, k, stats } = checkEngine(engine, { kExpected: engine.kExpected });
ok(violations.length === 0, 'final deep scan clean (' + stats.openOrders + ' open orders, ' + stats.trades + ' trades)');
ok(k === engine.kExpected, 'cash/collateral conserved end-to-end: K=' + k);

// every wallet non-negative, every position flat after full settlement
ok(store.all('wallets').every((w) => w.available >= 0 && w.reserved >= 0), 'all wallets non-negative after settlement');
ok(store.all('positions').every((p) => p.yesQty === 0 && p.noQty === 0 && p.yesReserved === 0 && p.noReserved === 0), 'all positions flat + reserves released after settlement');
const cash = store.all('wallets').reduce((t, w) => t + w.available + w.reserved, 0);
ok(cash === k, 'zero pairs outstanding → system cash K=' + (cash / 100).toFixed(2) + ' fully unwound');

// trade-type distribution (prove all four fill types actually exercised)
const kinds = store.all('trades').reduce((a, t) => { const key = [t.takerKind, t.makerKind].sort().join('×'); a[key] = (a[key] || 0) + 1; return a; }, {});
ok((kinds['BN×BY'] || 0) > 0, 'pair mints exercised: ' + (kinds['BN×BY'] || 0));
ok((kinds['SN×SY'] || 0) > 0, 'pair burns exercised: ' + (kinds['SN×SY'] || 0));
ok((kinds['BY×SY'] || 0) > 0, 'YES transfers exercised: ' + (kinds['BY×SY'] || 0));
ok((kinds['BN×SN'] || 0) > 0, 'NO transfers exercised: ' + (kinds['BN×SN'] || 0));

console.log('\n  ops: ' + tally.place + ' orders placed (' + tally.rejected + ' rejected), ' +
  tally.cancel + ' cancels, ' + tally.credit + ' credits, ' + tally.settle + ' settlements, ' +
  tally.fills + ' fills, ' + Object.values(kinds).reduce((a, b) => a + b, 0) + ' trades total');
await store.flush(); await store.close();
{
  const rec = engine.ledger.reconcile();
  ok(rec.violations.length === 0, 'double-entry ledger fully reconciles after ' + OPS + ' random ops (' + rec.txCount + ' txs, ' + rec.entryCount + ' entries)');
}
console.log('\nSTRESS TEST PASSED ✅ (' + passed + ' assertions)');
process.exit(0);

})().catch(async (e) => { console.error('SUITE CRASH:', e); process.exit(1); });
