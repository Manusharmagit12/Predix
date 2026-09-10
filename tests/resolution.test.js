'use strict';
/**
 * Resolution & settlement transparency tests — two-step admin confirmation,
 * immutable hash-chained audit records, evidence hashing, settlement guards
 * and idempotency, multi-outcome resolution. Invariants checked after every op.
 * Run: node tests/resolution.test.js   (no server needed)
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const assert = require('assert');

const { Store } = require('../lib/store');
const { Engine } = require('../lib/engine');
const { checkEngine } = require('../lib/invariants');
const { createTestStore } = require('./pg-helper');

const stubHub = { broadcast() {}, sendUser() {} };
let passed = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); passed++; console.log('  ✓ ' + msg); };

(async () => {
const store = await createTestStore('resolution');
const engine = new Engine(store, stubHub);
engine.rebuild();

const ACTOR = { id: 1, username: 'admin_test', role: 'admin' };
function mkUser(name, cents) {
  const u = store.insert('users', { username: name, email: name + '@x.io', salt: 's', passHash: 'h', role: 'user', createdAt: Date.now() });
  engine.creditWallet(u.id, cents, 'promo', 'resolution-test funds');
  return u;
}
const alice = mkUser('alice', 100000);
const bob = mkUser('bob', 100000);
let seq = 0;
function mkMarket(opts = {}) {
  seq++;
  return store.insert('markets', {
    slug: 'res-' + seq, title: 'Res ' + seq, emoji: '⚖️', category: 'Test',
    description: '', resolutionSource: 'official-results.example.org', resolutionRules: 'Resolves per official results.',
    expectedResolutionTime: Date.now() + 7 * 86400000, resolver: 'admin',
    closeTime: Date.now() + 86400000, createdAt: Date.now(),
    status: opts.status || 'open', outcome: null, last: null, lastTradeTs: null,
    outcomes: opts.outcomes || null,
  });
}
function audit(marketId) { return engine.resolutionAudit(marketId); }
function inv(tag) {
  const { violations } = checkEngine(engine, { kExpected: engine.kExpected });
  ok(violations.length === 0, 'invariants hold: ' + tag);
}
const throwsWith = (fn, re, msg) => {
  try { fn(); } catch (e) { ok(re.test(e.message), msg + ' → ' + e.message.slice(0, 60)); return; }
  ok(false, msg + ' → DID NOT THROW');
};

/* ============ 1. invalid early resolution ============ */
const M1 = mkMarket();
engine.place(alice, M1, { side: 'buy', outcome: 'yes', type: 'limit', price: 50, qty: 4 });
inv('seed order on open market');
throwsWith(() => engine.resolve(M1, 'yes', { evidence: 'premature', confirm: true, actor: ACTOR }), /must close|still trading/i, 'early resolution of an OPEN market rejected');
ok(audit(M1.id).length === 0 && M1.status === 'open', 'no audit record written, market untouched');
inv('after rejected early resolution');

/* ============ 2. evidence required ============ */
const M2 = mkMarket({ status: 'closed' });
throwsWith(() => engine.resolve(M2, 'yes', { confirm: true, actor: ACTOR }), /evidence/i, 'resolution without evidence rejected');
ok(audit(M2.id).length === 0, 'no record without evidence');

/* ============ 3. admin confirmation step ============ */
const prop = engine.resolve(M2, 'yes', { evidence: 'results.gov/final-42', notes: 'final canvass', actor: ACTOR });
ok(prop.confirmationRequired === true && prop.proposal.outcome === 'YES', 'step 1 returns a confirmation proposal with preview');
ok(prop.proposal.preview.payout === 0 && prop.proposal.preview.winningQty === 0, 'preview reports expected payouts (nobody holds)');
ok(M2.status === 'closed' && audit(M2.id).length === 0, 'proposal wrote NO resolution record — market not yet resolved');
throwsWith(() => engine.settleMarket(M2.id), /resolved|resolution record/i, 'settlement refused while only a proposal exists');

/* ============ 4. confirmed resolution: record + settlement ============ */
const cashBefore = store.all('wallets').reduce((t, w) => t + w.available, 0);
const done = engine.resolve(M2, 'yes', { evidence: 'results.gov/final-42', notes: 'final canvass', confirm: true, actor: ACTOR });
ok(done.ok === true && M2.status === 'resolved', 'confirmed resolution resolves the market');
ok(done.settle.alreadySettled === false, 'settlement ran exactly once inside the confirmed resolution');
const rec = audit(M2.id)[0];
ok(!!rec, 'immutable resolution record stored');
ok(rec.outcome === 'YES' && rec.winnerIdx === 0, 'winning outcome stored');
ok(rec.resolvedBy.username === 'admin_test' && rec.resolvedBy.role === 'admin', 'resolver identity stored');
ok(rec.resolvedAt > 0 && rec.source === 'official-results.example.org', 'timestamp + resolution source stored');
ok(rec.evidence === 'results.gov/final-42' && rec.notes === 'final canvass', 'evidence + notes stored');
ok(/^([0-9a-f]{64})$/.test(rec.hash), 'SHA-256 evidence hash stored');
ok(M2.resolutionHash === rec.hash && M2.settledAt > 0, 'market row links to record and marks settlement');
inv('after confirmed resolution');

/* ============ 5. duplicate resolution ============ */
throwsWith(() => engine.resolve(M2, 'no', { evidence: 'again', confirm: true, actor: ACTOR }), /already resolved/i, 'duplicate resolution rejected');
ok(audit(M2.id).length === 1, 'audit history still has exactly one record');

/* ============ 6. settlement without resolution ============ */
const M3 = mkMarket(); // open, never resolved
throwsWith(() => engine.settleMarket(M3.id), /closed and resolved/i, 'settlement of an open market rejected');
M3.status = 'closed'; store.update('markets', M3);
throwsWith(() => engine.settleMarket(M3.id), /resolved|resolution record/i, 'settlement of a closed but unresolved market rejected');

/* ============ 7. repeated settlement is idempotent ============ */
const again1 = engine.settleMarket(M2.id);
const again2 = engine.settleMarket(M2.id);
ok(again1.alreadySettled === true && again2.alreadySettled === true, 're-running settlement returns alreadySettled');
const cashAfter = store.all('wallets').reduce((t, w) => t + w.available, 0);
ok(cashAfter === cashBefore, 'repeated settlement paid nothing extra');
ok(store.all('positions').every((p) => p.marketId !== M2.id || (p.yesQty === 0 && p.noQty === 0)), 'positions stay flat after repeat settlement');
inv('after repeated settlements');

/* ============ 8. audit immutability ============ */
throwsWith(() => store.update('resolutions', { ...rec, evidence: 'tampered' }), /append-only|immutable/i, 'UPDATE of a resolution record refused by the store');
throwsWith(() => store.remove('resolutions', rec.id), /append-only|immutable/i, 'DELETE of a resolution record refused by the store');
ok(audit(M2.id).length === 1 && audit(M2.id)[0].evidence === 'results.gov/final-42', 'record untouched after tamper attempts');

/* ============ 9. evidence hashing (independent recompute + chain) ============ */
const canonical = JSON.stringify({
  v: 1, marketId: rec.marketId, slug: rec.slug, multi: !!rec.multi,
  outcome: rec.outcome, winnerIdx: rec.winnerIdx,
  resolvedBy: rec.resolvedBy, resolvedAt: rec.resolvedAt,
  source: rec.source, evidence: rec.evidence, notes: rec.notes || '',
  prevHash: rec.prevHash,
});
ok(crypto.createHash('sha256').update(canonical).digest('hex') === rec.hash, 'independent SHA-256 recompute matches the stored hash');
ok(rec.prevHash === 'GENESIS', 'first record chains from GENESIS');
ok(engine.verifyResolution({ ...rec, evidence: 'tampered' }) === false, 'a tampered payload fails hash verification');
// second resolution → chain extends
const M4 = mkMarket({ status: 'closed' });
engine.resolve(M4, 'no', { evidence: 'results.gov/final-43', confirm: true, actor: ACTOR });
const rec2 = audit(M4.id)[0];
ok(rec2.prevHash === rec.hash, 'second record hash-chains onto the first (tamper-evident history)');
ok(engine.verifyResolution(rec) && engine.verifyResolution(rec2), 'engine verifies both records');

/* ============ 10. tampered record blocks settlement (crash-recovery safety) ============ */
const M5 = mkMarket();
engine.place(alice, M5, { side: 'buy', outcome: 'yes', type: 'limit', price: 30, qty: 5 });
engine.place(bob, M5, { side: 'buy', outcome: 'no', type: 'limit', price: 70, qty: 5 }); // mint 5 pairs
M5.status = 'closed'; store.update('markets', M5);
engine.resolve(M5, 'yes', { evidence: 'results.gov/final-44', confirm: true, actor: ACTOR }); // settles + pays
const walletAlice = store.findOne('wallets', (w) => w.userId === alice.id).available;
const rec5 = audit(M5.id)[0];
// simulate a crash BETWEEN record-write and settlement, then tamper with the record
const m5row = store.get('markets', M5.id);
const savedEv = rec5.evidence;
m5row.settledAt = null; m5row.settledPayout = 0; store.update('markets', m5row); // un-settle the row only
rec5.evidence = 'TAMPERED';
throwsWith(() => engine.settleMarket(M5.id), /hash verification/i, 'settlement refused when the record hash does not verify');
rec5.evidence = savedEv; // restore
const repaired = engine.settleMarket(M5.id);
ok(repaired.alreadySettled === false, 'verified record settles after crash-recovery');
ok(store.findOne('wallets', (w) => w.userId === alice.id).available === walletAlice, 'no double payout across crash-recovery + earlier settle cycle');
inv('after tamper-block + crash-recovery settlement');

/* ============ 11. multi-outcome resolution ============ */
const M6 = mkMarket({ outcomes: [{ label: 'Alpha' }, { label: 'Beta' }, { label: 'Gamma' }] });
engine.place(alice, M6, { side: 'buy', outcome: 'yes', type: 'limit', price: 40, qty: 6, outcomeIdx: 2 }); // alice 6 YES on Gamma
engine.place(bob, M6, { side: 'buy', outcome: 'no', type: 'limit', price: 60, qty: 6, outcomeIdx: 2 }); // bob 6 NO on Gamma
engine.place(bob, M6, { side: 'buy', outcome: 'yes', type: 'limit', price: 30, qty: 3, outcomeIdx: 0 }); // bob 3 YES on Alpha
engine.place(alice, M6, { side: 'buy', outcome: 'no', type: 'limit', price: 70, qty: 3, outcomeIdx: 0 }); // alice 3 NO on Alpha
inv('multi positions built');
const preA = store.findOne('wallets', (w) => w.userId === alice.id).available;
const preB = store.findOne('wallets', (w) => w.userId === bob.id).available;
const md = engine.resolve(M6, 2, { evidence: 'official-final.html', notes: 'Gamma wins', confirm: true, force: true, actor: ACTOR });
const rec6 = audit(M6.id)[0];
ok(rec6.outcome === 'Gamma' && rec6.winnerIdx === 2 && rec6.multi === true, 'multi record stores winning option label + index');
ok(engine.verifyResolution(rec6), 'multi record hash verifies');
ok(store.findOne('wallets', (w) => w.userId === alice.id).available === preA + 900, 'Gamma YES (6 × $1) + Alpha NO of a losing option (3 × $1) both paid');
ok(store.findOne('wallets', (w) => w.userId === bob.id).available === preB, 'losing-side holder (Gamma NO, Alpha YES) paid nothing');
inv('after multi resolution + settlement');

/* ============ 12. marketPublic transparency fields ============ */
const pub = engine.marketPublic(M6);
ok(pub.resolution && pub.resolution.outcome === 'Gamma' && pub.resolution.evidence === 'official-final.html', 'marketPublic exposes the resolution record');
ok(pub.resolution.verified === true && pub.auditCount === 1, 'verification flag + audit count exposed');
ok(pub.expectedResolutionTime > 0 && pub.resolver === 'admin' && typeof pub.resolutionRule === 'string', 'expectedResolutionTime / resolver / resolutionRule exposed');
const legacy = mkMarket({ status: 'resolved' });
store.update('markets', { ...legacy, outcome: 'yes', resolvedAt: Date.now() });
const pubLegacy = engine.marketPublic(legacy);
ok(pubLegacy.resolution && pubLegacy.resolution.legacy === true, 'legacy pre-audit resolutions flagged gracefully');

/* ============ final invariant sweep ============ */
const { violations, k } = checkEngine(engine, { kExpected: engine.kExpected });
ok(violations.length === 0 && k === engine.kExpected, 'cash/collateral conserved across the entire resolution suite (K=' + k + ')');

await store.flush(); await store.close();
console.log('\nRESOLUTION TESTS PASSED ✅ (' + passed + ' assertions)');
process.exit(0);

})().catch(async (e) => { console.error('SUITE CRASH:', e); process.exit(1); });
