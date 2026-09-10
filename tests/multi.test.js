'use strict';
const fs = require('fs'), os = require('os'), path = require('path'), assert = require('assert');
const { Store } = require('../lib/store');
const { Engine } = require('../lib/engine');
const { createTestStore } = require('./pg-helper');
const stubHub = { broadcast() {}, sendUser() {} };
(async () => {
const store = await createTestStore('multi');
const engine = new Engine(store, stubHub);
engine.rebuild();
function mkUser(name, cents){ const u = store.insert('users',{username:name,email:name+'@x',salt:'s',passHash:'h',role:'user',createdAt:Date.now()}); engine.creditWallet(u.id, cents, 'promo', 'test opening funds'); return u; }
const A = mkUser('a', 100000), B = mkUser('b', 100000);
const market = store.insert('markets', {
  slug: 'multi', title: 'Who wins?', emoji: '🏆', category: 'Sports', description: '', resolutionSource: '', resolutionRules: '',
  closeTime: Date.now() + 864e5, createdAt: Date.now(), status: 'open', outcome: null, last: null, lastTradeTs: null,
  outcomes: [{label:'X',base:40},{label:'Y',base:35},{label:'Z',base:20}],
});
let passed = 0;
const ok = (c, m) => { assert.ok(c, m); passed++; console.log('  ✓', m); };
const W = (uid) => store.findOne('wallets', (w) => w.userId === uid);
const total = () => store.all('wallets').reduce((s, w) => s + w.available + w.reserved, 0);

// A buys YES on option 0, B buys NO on option 0 (mint)
let r = engine.place(A, market, { side: 'buy', outcome: 'yes', type: 'limit', price: 40, qty: 10, outcomeIdx: 0 });
ok(r.order.status === 'open', 'BY opt0 rests');
r = engine.place(B, market, { side: 'buy', outcome: 'no', type: 'limit', price: 60, qty: 10, outcomeIdx: 0 });
ok(r.order.status === 'filled', 'BN opt0 crosses → mint');
ok(total() === 200000 - 1000, 'cash −$10 for 10 minted pairs on book 0');

// A buys YES on option 1 via market order against nothing (no liquidity) → canceled
r = engine.place(A, market, { side: 'buy', outcome: 'yes', type: 'market', qty: 5, outcomeIdx: 1 });
ok(r.order.status === 'canceled' && r.order.filled === 0, 'opt1 empty book market order cancels');

// B sells YES option 0 back to A's resting? A has resting? place A sell YES opt0 5
r = engine.place(A, market, { side: 'sell', outcome: 'yes', type: 'limit', price: 55, qty: 5, outcomeIdx: 0 });
ok(r.order.status === 'open', 'SY opt0 rests');
r = engine.place(B, market, { side: 'buy', outcome: 'yes', type: 'limit', price: 55, qty: 5, outcomeIdx: 0 });
ok(r.order.status === 'filled', 'BY opt0 takes SY → transfer');
const posB0 = store.findOne('positions', (p) => p.userId === B.id && p.marketId === market.id && (p.outcomeIdx||0) === 0);
ok(posB0 && posB0.yesQty === 5, 'B holds 5 YES opt0');

// resolve option 1 (Z? no — winner idx 1 = 'Y'): A holds 10 YES opt0 (worth 0), B holds 5 YES opt0 + 10 NO opt0 → NO pays!
engine.resolve(market, 1, { force: true, evidence: 'multi-test: official result', confirm: true, actor: { id: 1, username: 'tester', role: 'admin' } });
const settledA = store.find('settled', (s) => s.userId === A.id);
const settledB = store.find('settled', (s) => s.userId === B.id);
ok(settledA.length === 1 && settledA[0].win === false, 'A archived as loser (YES opt0, winner=opt1)');
ok(settledB.length === 1 && settledB[0].win === true, 'B archived as winner (NO opt0 pays when opt0 loses)');
ok(W(B.id).available === 100000 - 600 - 275 + 1000, 'B: paid 600 (NO×10) + 275 (YES×5), NO settles $10');
ok(total() === 200000, 'all collateral returned after settlement');
{
  const rec = engine.ledger.reconcile();
  ok(rec.violations.length === 0, 'double-entry ledger fully reconciles (' + rec.txCount + ' txs)');
}
await store.flush(); await store.close();
console.log(`\nMULTI-OUTCOME TESTS PASSED (${passed}) ✅ (final cash check informational)`);

})().catch(async (e) => { console.error('SUITE CRASH:', e); process.exit(1); });
