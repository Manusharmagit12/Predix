'use strict';
/**
 * Engine unit tests — money math must be exact.
 * Run: node tests/engine.test.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

const { Store } = require('../lib/store');
const { Engine } = require('../lib/engine');
const { createTestStore } = require('./pg-helper');

const stubHub = { broadcast() {}, sendUser() {} };

let passed = 0;
function ok(cond, msg) { assert.ok(cond, msg); passed++; console.log('  ✓ ' + msg); }

/* ============ setup ============ */
(async () => {
const store = await createTestStore('engine');
const engine = new Engine(store, stubHub);
engine.rebuild();
function mkUser(db, name, cents, role = 'user') {
  const u = db.insert('users', { username: name, email: name + '@x.io', salt: 's', passHash: 'h', role, createdAt: Date.now() });
  engine.creditWallet(u.id, cents, 'promo', 'test opening funds'); // ledger-visible funding
  return u;
}

const A = mkUser(store, 'alice', 100000); // $1000.00 in cents
const B = mkUser(store, 'bob', 100000);
const START_CASH = 200000;

const wallet = (uid) => DB.findOne('wallets', (w) => w.userId === uid);
const pos = (uid) => DB.findOne('positions', (p) => p.userId === uid && p.marketId === market.id);
let DB = store;
const totalCash = () => DB.all('wallets').reduce((s, w) => s + w.available + w.reserved, 0);

const market = store.insert('markets', {
  slug: 'test', title: 'Test market', emoji: '❓', category: 'Politics',
  description: '', resolutionSource: '', resolutionRules: '',
  closeTime: Date.now() + 86400000, createdAt: Date.now(),
  status: 'open', outcome: null, last: null, lastTradeTs: null,
});

console.log('\n— mint (BY × BN): two buyers fund a $1 pair —');
let r = engine.place(A, market, { side: 'buy', outcome: 'yes', type: 'limit', price: 55, qty: 4 });
ok(r.order.status === 'open' && r.order.qty === 4, 'BY 4@55 rests on bid');
ok(wallet(A.id).available === 99780 && wallet(A.id).reserved === 220, 'A: 220¢ moved available→reserved');
r = engine.place(B, market, { side: 'buy', outcome: 'no', type: 'limit', price: 45, qty: 6 });
ok(r.order.filled === 4 && r.order.status === 'open' && r.order.qty === 2, 'BN 6 fills 4 vs A\'s bid, 2 remain resting');
ok(wallet(A.id).available === 99780 && wallet(A.id).reserved === 0, 'A paid 55¢×4 from its reserve');
ok(wallet(B.id).available === 99730 && wallet(B.id).reserved === 90, 'B paid 45¢×4, remainder 2 reserved @45¢');
ok(pos(A.id).yesQty === 4 && pos(A.id).yesAvg === 55, 'A holds 4 YES @55 avg');
ok(pos(B.id).noQty === 4 && pos(B.id).noAvg === 45, 'B holds 4 NO @45 avg');
ok(totalCash() === START_CASH - 400, 'system cash −$4 for 4 minted pairs');

console.log('\n— YES transfer (BY × SY) —');
engine.place(A, market, { side: 'sell', outcome: 'yes', type: 'limit', price: 60, qty: 4 }); // A rests ask
r = engine.place(B, market, { side: 'buy', outcome: 'yes', type: 'limit', price: 60, qty: 4 });
ok(r.order.status === 'filled', 'B\'s BY crossed A\'s resting SY');
ok(pos(B.id).yesQty === 4 && pos(A.id).yesQty === 0, '4 YES transferred A→B');
ok(wallet(B.id).available === 99490 && wallet(A.id).available === 100020, '240¢ moved buyer→seller');
ok(totalCash() === START_CASH - 400, 'transfers conserve cash');

console.log('\n— NO transfer (BN × SN) —');
engine.place(B, market, { side: 'sell', outcome: 'no', type: 'limit', price: 45, qty: 4 }); // B rests bid(yes 55)
r = engine.place(A, market, { side: 'buy', outcome: 'no', type: 'limit', price: 45, qty: 2 }); // A takes 2
ok(r.order.status === 'filled', 'A\'s BN crossed B\'s resting SN');
ok(pos(A.id).noQty === 2 && pos(B.id).noQty === 2, '2 NO transferred B→A');
ok(wallet(A.id).available === 99930 && wallet(B.id).available === 99580, '90¢ moved for the NO transfer');
ok(totalCash() === START_CASH - 400, 'still 4 pairs outstanding');

console.log('\n— burn (SN × SY): pair annihilates, $1 freed —');
engine.place(A, market, { side: 'sell', outcome: 'no', type: 'limit', price: 50, qty: 2 });   // A rests bid(yes 50)
r = engine.place(B, market, { side: 'sell', outcome: 'yes', type: 'limit', price: 50, qty: 2 }); // B takes
ok(r.order.status === 'filled', 'B\'s SY crossed A\'s SN — burn');
ok(pos(B.id).yesQty === 2 && pos(A.id).noQty === 0, 'pair destroyed (B yes 2, A no 0)');
ok(wallet(A.id).available === 99930 + 100 && wallet(B.id).available === 99580 + 100, 'burn paid each seller (100-50)¢×2 / 50¢×2');
ok(totalCash() === START_CASH - 200, 'burn released $2 → 2 pairs outstanding');

console.log('\n— guards —');
let threw = false;
try { engine.place(A, market, { side: 'sell', outcome: 'yes', type: 'limit', price: 50, qty: 1 }); } catch { threw = true; }
ok(threw, 'selling YES with none owned rejected');
threw = false;
try { engine.place(A, market, { side: 'buy', outcome: 'yes', type: 'limit', price: 99, qty: 5000 }); } catch { threw = true; }
ok(threw, 'unaffordable limit buy rejected up front');
threw = false;
try { engine.place(A, market, { side: 'buy', outcome: 'yes', type: 'limit', price: 0, qty: 5 }); } catch { threw = true; }
ok(threw, 'price out of bounds rejected');

console.log('\n— cancel releases reserves —');
const avBefore = wallet(A.id).available;
const o = engine.place(A, market, { side: 'buy', outcome: 'yes', type: 'limit', price: 20, qty: 25 });
ok(wallet(A.id).reserved === 500 && wallet(A.id).available === avBefore - 500, 'reserve taken on rest');
engine.cancel(A.id, o.order.id);
ok(wallet(A.id).reserved === 0 && wallet(A.id).available === avBefore, 'reserve returned on cancel');
threw = false;
try { engine.cancel(A.id, o.order.id); } catch { threw = true; }
ok(threw, 'double cancel rejected');

console.log('\n— market order (partial fill, remainder canceled) —');
// B still has a resting SN (2 NO @ bid yes-55) from the earlier step — A takes it with a market order
r = engine.place(A, market, { side: 'buy', outcome: 'no', type: 'market', qty: 10 });
ok(r.order.filled === 2 && r.order.status === 'canceled', 'market order filled 2, remainder canceled');
ok(pos(A.id).noQty === 2 && pos(B.id).noQty === 0, 'NO shares moved');
ok(wallet(A.id).available === 100030 - 90 && wallet(B.id).available === 99680 + 90, 'market fill paid (100−55)¢×2');

console.log('\n— persistence across restart —');
const snapA = wallet(A.id).available, tradesCount = store.all('trades').length, openCount = engine.orderIndex.size;
ok(openCount === 1, 'one bot order still resting (B\'s BN remainder)');
if (store._compact) store._compact(0);
await store.flush(); // durable before restart
const store2 = await store.reopen();
DB = store2; // from here on, assertions read the reloaded store
const engine2 = new Engine(store2, stubHub);
engine2.rebuild();
const A2 = store2.findOne('users', (u) => u.username === 'alice');
ok(store2.findOne('wallets', (w) => w.userId === A2.id).available === snapA, 'wallet survives restart');
ok(store2.all('trades').length === tradesCount, 'trades survive restart');
ok(engine2.orderIndex.size === openCount, 'open orders rebuilt into books after restart');

console.log('\n— resolution & settlement —');
const cashPre = totalCash();
engine2.resolve(market, 'yes', { force: true, evidence: 'unit-test: outcome source doc', notes: 'engine suite', confirm: true, actor: { id: 1, username: 'tester', role: 'admin' } }); // B holds 2 YES → $2 payout
const pA2 = store2.findOne('positions', (p) => p.userId === A2.id && p.marketId === market.id);
ok(pA2.yesQty === 0 && pA2.noQty === 0, 'positions cleared');
ok(totalCash() === cashPre + 200 && totalCash() === START_CASH, '$1 per outstanding pair paid out; system cash fully unwound');
ok(engine2.orderIndex.size === 0, 'all open orders canceled & reserves released at resolution');
threw = false;
try { engine2.place(A2, market, { side: 'buy', outcome: 'yes', type: 'limit', price: 50, qty: 1 }); } catch { threw = true; }
ok(threw, 'trading blocked after resolution');

const rec = engine2.ledger.reconcile();
ok(rec.violations.length === 0, 'double-entry ledger fully reconciles after restart (' + rec.txCount + ' txs)');
await store.flush(); await store.close(); await store2.close();
console.log(`\nALL ${passed} ENGINE TESTS PASSED ✅\n`);

})().catch(async (e) => { console.error('SUITE CRASH:', e); process.exit(1); });
