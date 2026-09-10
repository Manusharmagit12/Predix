'use strict';
/**
 * Simulated withdrawal tests (PLAY MONEY ONLY) — request validation, escrow
 * accounting, insufficient funds, cancel, reject, approve+complete, duplicate
 * idempotency key, concurrent requests, W5 escrow invariant and full ledger
 * reconciliation after every path.
 * Run: node tests/withdrawal.test.js   (isolated PostgreSQL test database)
 */
const assert = require('assert');
const { Engine } = require('../lib/engine');
const { checkEngine } = require('../lib/invariants');
const { createTestStore } = require('./pg-helper');

let passed = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); passed++; console.log('  ✓ ' + msg); };
const throwsWith = (fn, re, msg) => {
  try { fn(); } catch (e) { ok(re.test(e.message), msg + ' → ' + e.message.slice(0, 80)); return; }
  ok(false, msg + ' → DID NOT THROW');
};

(async () => {
  const store = await createTestStore('withdrawal');
  const engine = new Engine(store, { broadcast() {}, sendUser() {} });
  engine.rebuild();

  const mkUser = (name, cents) => {
    const u = store.insert('users', { username: name, email: name + '@x.io', salt: 's', passHash: 'h', role: 'user', createdAt: Date.now() });
    engine.creditWallet(u.id, cents, 'promo', 'withdrawal test funds');
    return u;
  };
  const admin = store.insert('users', { username: 'admin', email: 'a@x.io', salt: 's', passHash: 'h', role: 'admin', createdAt: Date.now() });
  const walletOf = (uid) => engine._wallet(uid);
  const wdRows = () => store.all('withdrawals');
  const bal = (a) => (engine.ledger.accountBalances().get(a) || 0);
  // clean() only runs after every withdrawal was properly closed through the
  // lifecycle (so ledger + wallets already agree); it just resets rows for the
  // next section so W5 never sees stale pending/approved state.
  const clean = () => { for (const r of wdRows()) store.remove('withdrawals', r.id); for (const w of store.all('wallets')) { w.withdrawReserved = 0; store.update('wallets', w); } };

  console.log('\n— request & escrow —');
  const u1 = mkUser('wduser1', 100000); // $1000.00
  {
    throwsWith(() => engine.requestWithdrawal(u1.id, 0), /positive whole number/i, 'rejects zero amount');
    throwsWith(() => engine.requestWithdrawal(u1.id, -500), /positive whole number/i, 'rejects negative amount');
    throwsWith(() => engine.requestWithdrawal(u1.id, 10.5), /positive whole number/i, 'rejects fractional cents');
    throwsWith(() => engine.requestWithdrawal(u1.id, 100001), /insufficient/i, 'rejects more than available balance');

    const { withdrawal: wd, replayed } = engine.requestWithdrawal(u1.id, 25000, { idemKey: 'idem-a' });
    ok(replayed === undefined || replayed === false, 'first request is not a replay');
    ok(wd.status === 'pending' && wd.amount === 25000, 'withdrawal created PENDING for $250.00');
    const w = walletOf(u1.id);
    ok(w.available === 75000, 'available dropped 100000 → 75000 (locked in escrow)');
    ok(w.withdrawReserved === 25000, 'withdrawReserved escrow holds 25000');
    ok(w.reserved === 0, 'trading reserved untouched by withdrawal escrow');
    ok(bal('wdraw:' + u1.id) === 25000, 'ledger escrow account wdraw:<uid> = 25000');
    ok(bal('avail:' + u1.id) === 75000, 'ledger avail account = 75000');

    throwsWith(() => engine.requestWithdrawal(u1.id, 5000), /already have a withdrawal in review/i, 'second concurrent request blocked while one is pending');
  }

  console.log('\n— idempotency —');
  {
    const r = engine.requestWithdrawal(u1.id, 25000, { idemKey: 'idem-a' });
    ok(r.replayed === true && r.withdrawal.amount === 25000, 'same idem key replays original withdrawal, no double debit');
    ok(wdRows().filter((x) => x.userId === u1.id).length === 1, 'still exactly one withdrawal row');
    ok(walletOf(u1.id).available === 75000, 'balance unchanged after replayed request');
    const dup = engine.requestWithdrawal(u1.id, 99999, { idemKey: 'idem-a' });
    ok(dup.replayed === true && dup.withdrawal.amount === 25000, 'idem replay wins even if new amount would fail validation');
    const inv = checkEngine(engine).violations;
    ok(inv.length === 0, 'invariants clean after request + replays' + (inv.length ? ' → ' + inv[0] : ''));
  }

  console.log('\n— cancel (user, pending only) —');
  {
    const wd = wdRows().find((x) => x.userId === u1.id);
    engine.cancelWithdrawal(u1.id, wd.id);
    const w = walletOf(u1.id);
    ok(w.available === 100000 && w.withdrawReserved === 0, 'cancel refunds escrow → available back to 100000');
    ok(wdRows().find((x) => x.id === wd.id).status === 'cancelled', 'row status CANCELLED');
    ok(bal('wdraw:' + u1.id) === 0, 'ledger escrow account drained to 0');
    throwsWith(() => engine.cancelWithdrawal(u1.id, wd.id), /only pending/i, 'cannot cancel a non-pending withdrawal');
    const u2 = mkUser('wduser2', 50000);
    const w2 = engine.requestWithdrawal(u2.id, 10000).withdrawal;
    throwsWith(() => engine.cancelWithdrawal(u1.id, w2.id), /not your withdrawal/i, 'cannot cancel another user’s withdrawal');
    engine.cancelWithdrawal(u2.id, w2.id);
    clean();
  }

  console.log('\n— reject (admin) refunds —');
  {
    const u3 = mkUser('wduser3', 80000);
    const wd = engine.requestWithdrawal(u3.id, 30000).withdrawal;
    engine.adminWithdrawal(admin, wd.id, 'approve');
    ok(wdRows().find((x) => x.id === wd.id).status === 'approved', 'pending → approved');
    ok(walletOf(u3.id).withdrawReserved === 30000, 'funds stay escrowed after approval');
    engine.adminWithdrawal(admin, wd.id, 'reject', 'suspicious');
    const w = walletOf(u3.id);
    ok(w.available === 80000 && w.withdrawReserved === 0, 'reject refunds escrow to available');
    const row = wdRows().find((x) => x.id === wd.id);
    ok(row.status === 'rejected' && row.note === 'suspicious' && row.processedBy === 'admin', 'row records rejected + note + processor');
    ok(bal('wdraw:' + u3.id) === 0, 'escrow account zero after reject');
    throwsWith(() => engine.adminWithdrawal(admin, wd.id, 'complete'), /already REJECTED/i, 'no actions on a final-state withdrawal');
    clean();
  }

  console.log('\n— approve → complete pays out via ledger —');
  {
    const u4 = mkUser('wduser4', 60000);
    const before = bal('equity:withdraw');
    const wd = engine.requestWithdrawal(u4.id, 45000).withdrawal;
    throwsWith(() => engine.adminWithdrawal(admin, wd.id, 'complete'), /approve the withdrawal before marking it paid/i, 'cannot complete a PENDING request directly (approve first)');
    engine.adminWithdrawal(admin, wd.id, 'approve');
    engine.adminWithdrawal(admin, wd.id, 'complete');
    const w = walletOf(u4.id);
    ok(w.available === 15000 && w.withdrawReserved === 0 && w.reserved === 0, 'completed: cash left the wallet for good');
    ok(bal('equity:withdraw') === before + 45000, 'payout sink equity:withdraw grew by exactly 45000');
    ok(bal('wdraw:' + u4.id) === 0, 'escrow account zero after completion');
    throwsWith(() => engine.requestWithdrawal(u4.id, 20000), /insufficient/i, 'cannot withdraw refunded/settled funds that were never his');
    const snap = engine.userSnapshot(u4.id);
    ok(snap.wallet.total === 15000, 'userSnapshot total reflects post-withdrawal wealth');
    clean();
  }

  console.log('\n— escrow never touches trading reserves (W3/W5 coexistence) —');
  {
    const u5 = mkUser('wduser5', 100000);
    const m = store.insert('markets', {
      slug: 'wd-m1', title: 'Withdrawal market', emoji: '🎯', category: 'Test', description: '',
      resolutionSource: 'src', resolutionRules: 'rules', closeTime: Date.now() + 86400000,
      createdAt: Date.now(), status: 'open', outcome: null, last: null, lastTradeTs: null, outcomes: null,
    });
    engine.place(u5, m, { side: 'buy', outcome: 'yes', type: 'limit', price: 55, qty: 100 }); // reserves 5500
    const afterOrder = walletOf(u5.id);
    ok(afterOrder.reserved === 5500, 'resting order reserves 5500');
    const wd = engine.requestWithdrawal(u5.id, 90000).withdrawal; // exactly the remaining available
    const w = walletOf(u5.id);
    ok(w.available === 4500 && w.withdrawReserved === 90000 && w.reserved === 5500, 'escrow and order reserves coexist, no overlap');
    throwsWith(() => engine.requestWithdrawal(u5.id, 1), /already have a withdrawal in review/i, 'one active withdrawal at a time (review rule fires before balance)');
    engine.cancelWithdrawal(u5.id, wd.id);
    throwsWith(() => engine.requestWithdrawal(u5.id, 94501), /insufficient/i, 'after cancel, ceiling is 94500 — order reserves 5500 are untouchable');
    const inv = checkEngine(engine).violations;
    ok(inv.length === 0, 'W1–W5 all clean with order + escrow' + (inv.length ? ' → ' + inv[0] : ''));
    clean();
  }

  console.log('\n— concurrency: N parallel requests, one wins —');
  {
    const u6 = mkUser('wduser6', 70000);
    const results = await Promise.allSettled(
      Array.from({ length: 8 }, (_, i) =>
        new Promise((resolve) => {
          setImmediate(() => {
            try { resolve({ v: engine.requestWithdrawal(u6.id, 70000 - i, { idemKey: 'race-' + i }) }); }
            catch (e) { resolve({ e }); }
          });
        })
      )
    );
    const wins = results.filter((r) => r.value && r.value.v).length;
    const errs = results.filter((r) => r.value && r.value.e).length;
    ok(wins === 1, `exactly one of 8 racing requests wins (got ${wins} wins, ${errs} blocked)`);
    const w = walletOf(u6.id);
    ok(w.available + w.withdrawReserved === 70000, 'no money created or destroyed by the race');
    const raceWd = wdRows().find((x) => x.userId === u6.id);
    engine.adminWithdrawal(admin, raceWd.id, 'approve');
    engine.adminWithdrawal(admin, raceWd.id, 'complete');
    ok(walletOf(u6.id).available === 0 && walletOf(u6.id).withdrawReserved === 0, 'drained after completion');
    clean();
  }

  console.log('\n— full lifecycle storm + reconciliation —');
  {
    const users = [mkUser('storm1', 50000), mkUser('storm2', 30000), mkUser('storm3', 20000)];
    const sinkBefore = bal('equity:withdraw');
    let completed = 0, refunded = 0;
    for (const u of users) {
      for (let i = 0; i < 3; i++) {
        const wd = engine.requestWithdrawal(u.id, 5000, { idemKey: 'storm-' + u.id + '-' + i }).withdrawal;
        if (i % 3 === 0) { engine.adminWithdrawal(admin, wd.id, 'approve'); engine.adminWithdrawal(admin, wd.id, 'complete'); completed++; }
        else if (i % 3 === 1) { engine.cancelWithdrawal(u.id, wd.id); refunded++; }
        else { engine.adminWithdrawal(admin, wd.id, 'reject'); refunded++; }
      }
    }
    ok(completed === 3 && refunded === 6, `storm processed 3 payouts + 6 refunds (${completed}/${refunded})`);
    for (const u of users) ok(walletOf(u.id).withdrawReserved === 0, `user ${u.username} escrow fully drained after storm`);
    const inv = checkEngine(engine).violations;
    ok(inv.length === 0, 'W1–W5 invariants clean after storm' + (inv.length ? ' → ' + inv[0] : ''));
    const recon = engine.ledger.reconcile();
    ok(recon.violations.length === 0, 'ledger reconciles clean after every withdrawal path' + (recon.violations.length ? ' → ' + recon.violations[0] : ''));
    ok(bal('equity:withdraw') === sinkBefore + 15000, 'payout sink grew by exactly the 3 completed withdrawals (5000 each)');
  }

  console.log(`\n✓ withdrawal: ${passed} assertions passed\n`);
  process.exit(0);
})().catch((e) => { console.error('\n✗ WITHDRAWAL TEST FAILED:', e); process.exit(1); });
