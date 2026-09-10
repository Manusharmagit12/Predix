'use strict';
/**
 * Order-safety tests — idempotency, IOC, FOK, post-only, self-trade prevention,
 * market-order liquidity validation, and the clear 5-status model.
 * The full invariant checker runs after EVERY operation below.
 * Run: node tests/safety.test.js   (no server needed)
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
let passed = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); passed++; console.log('  ✓ ' + msg); };

(async () => {
const store = await createTestStore('safety');
const engine = new Engine(store, stubHub);
engine.rebuild();

function mkUser(name, cents) {
  const u = store.insert('users', { username: name, email: name + '@x.io', salt: 's', passHash: 'h', role: 'user', createdAt: Date.now() });
  engine.creditWallet(u.id, cents, 'promo', 'safety-test funds');
  return u;
}
const alice = mkUser('alice', 200000);
const bob = mkUser('bob', 200000);
let mseq = 0;
function mkMarket() {
  mseq++;
  return store.insert('markets', {
    slug: 'safety-' + mseq, title: 'Safety ' + mseq, emoji: '🛡️', category: 'Test',
    description: '', resolutionSource: '', resolutionRules: '',
    closeTime: Date.now() + 86400000, createdAt: Date.now(),
    status: 'open', outcome: null, last: null, lastTradeTs: null,
  });
}
const M1 = mkMarket(); // idempotency + IOC + FOK
const M2 = mkMarket(); // post-only + STP + market validation
const M3 = mkMarket(); // status model

/* every operation runs through here: place + FULL invariant check afterwards */
function place(u, mkt, body) {
  const r = engine.place(u, mkt, body);
  const { violations } = checkEngine(engine, { kExpected: engine.kExpected });
  ok(violations.length === 0, 'invariants hold: ' + body.type + (body.tif ? ' ' + body.tif : '') + ' ' + body.side + ' ' + body.outcome +
    (body.stp !== 'skip' ? ' stp=' + body.stp : '') + (body.idemKey ? ' idem=' + body.idemKey : ''));
  return r;
}
const pos = (uid, mid) => store.findOne('positions', (p) => p.userId === uid && p.marketId === mid);
const trades = () => store.all('trades');
const cash = () => store.all('wallets').reduce((t, w) => t + w.available + w.reserved, 0);

/* ============ setup: mint 10 pairs on M1 (alice 10 YES, bob 10 NO) ============ */
place(alice, M1, { side: 'buy', outcome: 'yes', type: 'limit', price: 50, qty: 10 });
place(bob, M1, { side: 'buy', outcome: 'no', type: 'limit', price: 50, qty: 10 });
ok(pos(alice.id, M1.id).yesQty === 10 && pos(bob.id, M1.id).noQty === 10, 'setup: 10 YES / 10 NO minted');

/* ============ 1. idempotency: duplicate request = exact replay ============ */
const r1 = place(alice, M1, { side: 'buy', outcome: 'yes', type: 'limit', price: 40, qty: 7, idemKey: 'ord-1' });
const cashAfter1 = cash(), tradesAfter1 = trades().length;
const r2 = place(alice, M1, { side: 'buy', outcome: 'yes', type: 'limit', price: 40, qty: 7, idemKey: 'ord-1' });
ok(r2.order.id === r1.order.id, 'duplicate idempotency request replays the SAME order id');
ok(cash() === cashAfter1 && trades().length === tradesAfter1, 'replay moved no cash and created no trades');
ok(store.all('orders').filter((o) => o.idemKey === 'ord-1').length === 1, 'exactly one order row for key ord-1');
engine.cancel(alice.id, r1.order.id);
checkEngine(engine, { kExpected: engine.kExpected });

/* ============ 2. retrying the same order request after it FILLED ============ */
place(bob, M1, { side: 'buy', outcome: 'yes', type: 'limit', price: 60, qty: 5 }); // bob resting bid
const f1 = place(alice, M1, { side: 'sell', outcome: 'yes', type: 'limit', price: 55, qty: 5, idemKey: 'ord-2' });
ok(f1.order.status === 'filled', 'retry-setup: marketable order filled');
const cashAfterF = cash(), tradesAfterF = trades().length;
const f2 = place(alice, M1, { side: 'sell', outcome: 'yes', type: 'limit', price: 55, qty: 5, idemKey: 'ord-2' });
ok(f2.order.id === f1.order.id && f2.order.status === 'filled' && f2.order.filled === 5, 'retry after fill replays the original FILLED response');
ok(cash() === cashAfterF && trades().length === tradesAfterF, 'no double execution on retry (alice still owns exactly 5 fewer YES)');
let threw409 = false;
try { engine.place(alice, M1, { side: 'buy', outcome: 'yes', type: 'limit', price: 41, qty: 7, idemKey: 'ord-1' }); }
catch (e) { threw409 = e.status === 409; }
ok(threw409, 'idempotency key reused with a different order → 409');

/* ============ 3. partial IOC fill (alice has 5 YES; book has 4 shares of bids) ============ */
place(bob, M1, { side: 'buy', outcome: 'yes', type: 'limit', price: 45, qty: 4 });
const ioc = place(alice, M1, { side: 'sell', outcome: 'yes', type: 'limit', price: 45, qty: 5, tif: 'IOC' });
ok(ioc.order.status === 'canceled' && ioc.order.filled === 4, 'IOC partially filled 4, remainder killed');
ok(ioc.order.statusText === 'CANCELLED' && /IOC/.test(ioc.order.note), 'IOC terminal status CANCELLED with IOC note');
ok(pos(alice.id, M1.id).yesReserved === 0, 'IOC released the unfilled remainder share reserve');

/* ============ 4. failed FOK (book now has zero bids; alice holds 1 YES) ============ */
const fokFail = place(alice, M1, { side: 'sell', outcome: 'yes', type: 'limit', price: 30, qty: 1, tif: 'FOK' });
ok(fokFail.order.status === 'rejected' && fokFail.order.filled === 0, 'FOK with thin book → REJECTED, zero fills');
ok(fokFail.order.statusText === 'REJECTED' && /FOK/.test(fokFail.order.note), 'FOK failure exposes statusText REJECTED');
ok(pos(alice.id, M1.id).yesReserved === 0, 'failed FOK left no share reserve');
const fokBuyFail = place(bob, M1, { side: 'buy', outcome: 'no', type: 'limit', price: 90, qty: 500, tif: 'FOK' });
ok(fokBuyFail.order.status === 'rejected' && fokBuyFail.order.filled === 0, 'FOK buy without liquidity/funds → REJECTED (no up-front funding trap)');

/* ============ 5. successful FOK (mint 6 more to alice, then FOK-sell 6 vs bob's bid) ============ */
place(alice, M1, { side: 'buy', outcome: 'yes', type: 'limit', price: 55, qty: 6 });
place(bob, M1, { side: 'buy', outcome: 'no', type: 'limit', price: 45, qty: 6 });
place(bob, M1, { side: 'buy', outcome: 'yes', type: 'limit', price: 58, qty: 6 }); // bob bids 6@58
const fok = place(alice, M1, { side: 'sell', outcome: 'yes', type: 'limit', price: 55, qty: 6, tif: 'FOK', idemKey: 'fok-1' });
ok(fok.order.status === 'filled' && fok.order.filled === 6, 'FOK fully fillable → FILLED in one shot');
ok(fok.order.statusText === 'FILLED', 'FOK success exposes statusText FILLED');

/* ============ 6. post-only (M2) ============ */
let threw400 = false;
try { engine.place(bob, M2, { side: 'sell', outcome: 'yes', type: 'limit', price: 70, qty: 1 }); }
catch (e) { threw400 = e.status === 400; }
ok(threw400, 'share validation intact: naked sell still rejected up front');
place(bob, M2, { side: 'buy', outcome: 'yes', type: 'limit', price: 30, qty: 5 });
place(alice, M2, { side: 'buy', outcome: 'no', type: 'limit', price: 70, qty: 5 }); // mint → bob 5 YES
place(bob, M2, { side: 'sell', outcome: 'yes', type: 'limit', price: 70, qty: 2 }); // real ask @70
const poBad = place(alice, M2, { side: 'buy', outcome: 'yes', type: 'limit', price: 75, qty: 2, tif: 'POST_ONLY' });
ok(poBad.order.status === 'rejected' && /Post-only/.test(poBad.order.note), 'post-only that would immediately match → REJECTED');
const poGood = place(alice, M2, { side: 'buy', outcome: 'yes', type: 'limit', price: 60, qty: 2, tif: 'POST_ONLY' });
ok(poGood.order.status === 'open' && poGood.order.statusText === 'OPEN', 'post-only below the spread rests as OPEN (guaranteed maker)');
engine.cancel(alice.id, poGood.order.id);
checkEngine(engine, { kExpected: engine.kExpected });

/* ============ 7. self-trade prevention (M2) ============ */
place(alice, M2, { side: 'buy', outcome: 'yes', type: 'limit', price: 40, qty: 5 }); // alice's own bid @40
// alice buys NO @60 → crosses bids at YES 40 → would hit her own BY bid
const stpR = place(alice, M2, { side: 'buy', outcome: 'no', type: 'limit', price: 60, qty: 3, stp: 'reject' });
ok(stpR.order.status === 'rejected' && /Self-trade/.test(stpR.order.note), 'STP reject: crossing own order → REJECTED up front');
const wA = store.findOne('wallets', (x) => x.userId === alice.id);
ok(wA.reserved === store.all('orders').filter((o) => o.userId === alice.id && o.status === 'open' && (o.kind === 'BY' || o.kind === 'BN')).reduce((s, o) => s + (o.basis || 0) * o.qty, 0), 'STP-reject left no cash reserve');
place(bob, M2, { side: 'buy', outcome: 'yes', type: 'limit', price: 45, qty: 2 }); // bob bid @45 — above alice's own 40
const stpC = place(alice, M2, { side: 'buy', outcome: 'no', type: 'limit', price: 60, qty: 4, stp: 'cancel_taker' });
ok(stpC.order.status === 'canceled' && stpC.order.filled === 2 && /Self-trade/.test(stpC.order.note), 'STP cancel-taker: filled 2 vs bob, remainder killed at own order');
const stpS = place(alice, M2, { side: 'buy', outcome: 'no', type: 'limit', price: 60, qty: 2, stp: 'skip' });
ok(stpS.order.status === 'open' && stpS.order.filled === 0, 'STP skip (default): own order invisible, unfilled remainder rests (legacy behavior)');
ok(!trades().some((t) => t.takerUserId === t.makerUserId), 'no trade ever executed against oneself');
// cleanup resting M2 orders
for (const o of [...engine.orderIndex.values()].filter((o) => o.marketId === M2.id && o.userId === alice.id)) engine.cancel(o.userId, o.id); // only alice's — keep bob's ask for section 8
checkEngine(engine, { kExpected: engine.kExpected });

/* ============ 8. market-order liquidity validation (M2: only bob's SY 2@70 on the ask) ============ */
const mk1 = place(alice, M2, { side: 'buy', outcome: 'yes', type: 'market', qty: 50 });
ok(mk1.order.status === 'canceled' && mk1.order.filled === 2, 'market buy clamped to the 2 shares actually offered');
const mkWallet = store.findOne('wallets', (w) => w.userId === alice.id);
const openBuyReserve = store.all('orders').filter((o) => o.userId === alice.id && o.status === 'open' && (o.kind === 'BY' || o.kind === 'BN')).reduce((t, o) => t + (o.basis || 0) * o.qty, 0);
ok(mkWallet.reserved === openBuyReserve, 'market orders leave zero unintended cash reserves');
const mk2 = place(alice, M2, { side: 'buy', outcome: 'yes', type: 'market', qty: 3 });
ok(mk2.order.status === 'canceled' && mk2.order.filled === 0, 'market order into an empty book → canceled, no fills (liquidity validated)');

/* ============ 9. clear 5-status model (M3) ============ */
place(alice, M3, { side: 'buy', outcome: 'yes', type: 'limit', price: 50, qty: 10 });
place(bob, M3, { side: 'buy', outcome: 'no', type: 'limit', price: 50, qty: 10 }); // mint → alice 10 YES
const openOrd = place(alice, M3, { side: 'buy', outcome: 'yes', type: 'limit', price: 20, qty: 3 });
ok(openOrd.order.statusText === 'OPEN' && openOrd.order.status === 'open', 'resting order → OPEN (status field stays legacy-compatible)');
place(bob, M3, { side: 'buy', outcome: 'yes', type: 'limit', price: 25, qty: 4 }); // 4 shares of bid liquidity
const partial = place(alice, M3, { side: 'sell', outcome: 'yes', type: 'limit', price: 25, qty: 8 });
ok(partial.order.status === 'open' && partial.order.filled === 4, 'partially filled remainder still rests (internal status open)');
ok(partial.order.statusText === 'PARTIALLY_FILLED', '…and exposes statusText PARTIALLY_FILLED');
engine.cancel(alice.id, partial.order.id); // release the resting remainder's share lock
checkEngine(engine, { kExpected: engine.kExpected });
place(bob, M3, { side: 'buy', outcome: 'yes', type: 'limit', price: 25, qty: 4 }); // fresh bid liquidity
const filledOrd = place(alice, M3, { side: 'sell', outcome: 'yes', type: 'limit', price: 25, qty: 4 });
ok(filledOrd.order.statusText === 'FILLED' && filledOrd.order.status === 'filled', 'fully executed order → FILLED');
const cancelled = openOrd; engine.cancel(alice.id, openOrd.order.id);
const cRow = store.all('orders').find((o) => o.id === openOrd.order.id);
ok(cRow.status === 'canceled', 'canceled order → CANCELLED (legacy internal spelling preserved)');
const rejOrd = place(alice, M3, { side: 'sell', outcome: 'yes', type: 'limit', price: 20, qty: 2, tif: 'FOK' });
ok(rejOrd.order.status === 'rejected' && rejOrd.order.statusText === 'REJECTED', 'FOK kill → REJECTED');
place(bob, M3, { side: 'buy', outcome: 'yes', type: 'limit', price: 15, qty: 5 }); // leave one resting order
const statuses = new Set(store.all('orders').map((o) => o.status));
ok(['open', 'filled', 'canceled', 'rejected'].every((s) => statuses.has(s)), 'all status families exercised on disk');

/* ============ final invariant sweep ============ */
const { violations, k } = checkEngine(engine, { kExpected: engine.kExpected });
ok(violations.length === 0, 'final deep scan clean');
ok(k === engine.kExpected, 'cash/collateral conserved across every safety feature (K=' + k + ')');

await store.flush(); await store.close();
console.log('\nORDER-SAFETY TESTS PASSED ✅ (' + passed + ' assertions)');
process.exit(0);

})().catch(async (e) => { console.error('SUITE CRASH:', e); process.exit(1); });
