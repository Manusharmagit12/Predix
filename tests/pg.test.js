'use strict';
/**
 * PostgreSQL persistence tests — schema constraints, immutability trigger,
 * idempotency-key uniqueness, integer money, migration idempotency,
 * JSON→PG import round-trip and restart persistence.
 * Run: node tests/pg.test.js   (needs a local PostgreSQL; PREDIX_TEST_STORE=json skips)
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Pool } = require('pg');
const { execFileSync } = require('child_process');
const { PgStore } = require('../lib/store-pg');
const { Store } = require('../lib/store');
const { Engine } = require('../lib/engine');
const { migrate, createDatabase } = require('../lib/migrate');
const { createTestStore } = require('./pg-helper');

let passed = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); passed++; console.log('  ✓ ' + msg); };
const throwsWith = (fn, re, msg) => {
  try { fn(); } catch (e) { ok(re.test(e.message), msg + ' → ' + e.message.slice(0, 70)); return; }
  ok(false, msg + ' → DID NOT THROW');
};

(async () => {
  if (process.env.PREDIX_TEST_STORE === 'json') {
    console.log('PERSISTENCE TESTS SKIPPED (json mode)');
    process.exit(0);
  }

  /* ============ 1. migrations are idempotent ============ */
  const store = await createTestStore('pg');
  const n1 = await migrate(store.pool);
  ok(n1 === 0, 'running migrate again applies nothing (schema already current)');

  /* ============ 2. engine writes flow into PostgreSQL ============ */
  const engine = new Engine(store, { broadcast() {}, sendUser() {} });
  engine.rebuild();
  const u = store.insert('users', { username: 'pguser', email: 'pg@x.io', salt: 's', passHash: 'h', role: 'user', createdAt: Date.now() });
  engine.creditWallet(u.id, 50000, 'promo', 'pg test funds');
  const m = store.insert('markets', {
    slug: 'pg-market', title: 'PG', emoji: 'x', category: 'Test', description: '',
    resolutionSource: 'src', resolutionRules: 'rules', closeTime: Date.now() + 86400000,
    createdAt: Date.now(), status: 'open', outcome: null, last: null, lastTradeTs: null,
  });
  const r = engine.place(u, m, { side: 'buy', outcome: 'yes', type: 'limit', price: 55, qty: 8, tif: 'POST_ONLY' });
  await store.flush();
  const raw = await store.pool.query("SELECT data->>'kind' AS kind, qty, price, status FROM orders WHERE id = $1", [r.order.id]);
  ok(raw.rows.length === 1 && raw.rows[0].kind === 'BY' && raw.rows[0].qty === 8 && raw.rows[0].price === 55, 'order row landed in PostgreSQL with typed columns');
  const wrow = await store.pool.query('SELECT available, reserved FROM wallets WHERE user_id = $1', [u.id]);
  ok(Number(wrow.rows[0].reserved) === 8 * 55 && Number(wrow.rows[0].available) === 50000 - 8 * 55, 'wallet cash reserve visible in SQL (integer cents)');

  /* ============ 3. database constraints ============ */
  const q = (sql, params) => store.pool.query(sql, params);
  const rejects = async (sql, params, msg, re) => {
    try { await q(sql, params); } catch (e) { ok(re.test(e.message), msg + ' → ' + e.message.split('\n')[0].slice(0, 60)); return; }
    ok(false, msg + ' → DID NOT THROW');
  };
  await rejects('UPDATE wallets SET available = -1 WHERE user_id = $1', [u.id], 'non-negative balance CHECK blocks negative available', /check/i);
  await rejects('UPDATE wallets SET reserved = -5 WHERE user_id = $1', [u.id], 'non-negative balance CHECK blocks negative reserved', /check/i);
  await rejects("INSERT INTO orders (id, user_id, market_id, kind, type, qty, orig_qty, filled, status, data) VALUES (99991, $1, $2, 'BY', 'limit', -4, 4, 0, 'open', '{}')", [u.id, m.id], 'order quantity CHECK blocks negative qty', /check/i);
  await rejects("INSERT INTO orders (id, user_id, market_id, kind, type, qty, orig_qty, filled, status, data) VALUES (99992, $1, $2, 'BY', 'limit', 4, 4, 9, 'open', '{}')", [u.id, m.id], 'order CHECK blocks filled > origQty', /check/i);
  await rejects("INSERT INTO orders (id, user_id, market_id, kind, type, qty, orig_qty, filled, price, status, data) VALUES (99993, $1, $2, 'BY', 'limit', 4, 4, 0, 0, 'open', '{}')", [u.id, m.id], 'order CHECK blocks price 0 (valid range 1–99)', /check/i);
  await rejects("INSERT INTO orders (id, user_id, market_id, kind, type, qty, orig_qty, filled, status, data) VALUES (99994, $1, 999999, 'BY', 'limit', 4, 4, 0, 'open', '{}')", [u.id], 'foreign key blocks order on a nonexistent market', /foreign key/i);
  await q("INSERT INTO idem (id, user_id, key, data) VALUES (99995, $1, 'dup', '{}')", [u.id]);
  ok(true, 'idempotency-key insert (setup)');
  await rejects("INSERT INTO idem (id, user_id, key, data) VALUES (99996, $1, 'dup', '{}')", [u.id], 'UNIQUE(user_id, key) blocks duplicate idempotency keys', /duplicate key/i);
  await rejects("INSERT INTO positions (id, user_id, market_id, yes_qty, no_qty, yes_reserved, no_reserved, data) VALUES (99997, $1, $2, 3, 0, 5, 0, '{}')", [u.id, m.id], 'position CHECK blocks reserved > owned shares', /check/i);

  /* ============ 4. resolution audit immutability (DB level) ============ */
  const closed = { ...m, status: 'closed' };
  store.update('markets', closed);
  engine.resolve(closed, 'yes', { force: true, evidence: 'pg-test evidence', confirm: true, actor: { id: u.id, username: 'pguser', role: 'admin' } });
  await store.flush();
  const recs = await q('SELECT id, hash FROM resolutions WHERE market_id = $1', [m.id]);
  ok(recs.rows.length === 1, 'resolution record persisted');
  await rejects("UPDATE resolutions SET hash = 'tampered' WHERE market_id = $1", [m.id], 'DB trigger blocks UPDATE of resolution audit rows', /append-only/i);
  await rejects('DELETE FROM resolutions WHERE market_id = $1', [m.id], 'DB trigger blocks DELETE of resolution audit rows', /append-only/i);
  throwsWith(() => store.update('resolutions', { ...store.all('resolutions')[0], evidence: 'tampered' }), /append-only/i, 'PgStore refuses resolution UPDATE synchronously');
  throwsWith(() => store.remove('resolutions', recs.rows[0].id), /append-only/i, 'PgStore refuses resolution DELETE synchronously');

  /* ============ 5. integer-only money enforcement ============ */
  throwsWith(() => {
    const bad = { userId: u.id, available: 12.5, reserved: 0 };
    store.tx(() => store._up({ o: 'u', t: 'wallets', r: bad }));
  }, /integer/i, 'adapter rejects non-integer money (float available) synchronously');
  store.failure = null; store._queue.length = 0; // drop the poisoned op

  /* ============ 6. SQL transactions: financial mutations are atomic ============ */
  const before = await q('SELECT COUNT(*)::int AS n FROM trades');
  const atomicStore = new PgStore({ pool: store.pool });
  await atomicStore.load();
  try {
    atomicStore.tx(() => {
      atomicStore._up({ o: 'u', t: 'trades', r: { id: 888001, marketId: m.id, outcomeIdx: 0, price: 50, qty: 1, ts: Date.now(), takerUserId: u.id, makerUserId: u.id, takerKind: 'BY', makerKind: 'SY' } });
      atomicStore._up({ o: 'u', t: 'trades', r: { id: 888002, marketId: 999999, outcomeIdx: 0, price: 50, qty: 1, ts: Date.now() } }); // FK violation
    });
    await atomicStore.flush();
    ok(false, 'batch with a bad op must fail');
  } catch (e) {
    ok(/foreign key/i.test(e.message), 'SQL transaction rolls back the WHOLE batch on failure');
  }
  const after = await q('SELECT COUNT(*)::int AS n FROM trades');
  ok(after.rows[0].n === before.rows[0].n, 'neither trade row was committed (atomicity verified)');

  /* ============ 7. restart persistence ============ */
  const reopened = await store.reopen();
  ok(reopened.all('orders').length === store.all('orders').length, 'all orders survive a reload from PostgreSQL');
  ok(reopened.get('users', u.id).username === 'pguser', 'user rows identical after reload');
  const w1 = store.findOne('wallets', (x) => x.userId === u.id);
  const w2 = reopened.findOne('wallets', (x) => x.userId === u.id);
  ok(w1.available === w2.available && w1.reserved === w2.reserved, 'wallet balances identical after reload');
  await reopened.close();

  /* ============ 8. JSON → PostgreSQL import round-trip ============ */
  const srcDir = fs.mkdtempSync(path.join(os.tmpdir(), 'predix-import-'));
  const legacy = new Store(srcDir);
  const lu = legacy.insert('users', { username: 'import_u', email: 'i@x.io', salt: 's', passHash: 'h', role: 'user', createdAt: Date.now() });
  legacy.insert('wallets', { id: lu.id, userId: lu.id, available: 12345, reserved: 0 });
  const lm = legacy.insert('markets', {
    slug: 'import-market', title: 'Import', emoji: 'x', category: 'Test', description: '',
    resolutionSource: 's', resolutionRules: 'r', closeTime: Date.now() + 86400000, createdAt: Date.now(),
    status: 'open', outcome: null, last: 44, lastTradeTs: Date.now(),
  });
  legacy.insert('orders', { userId: lu.id, marketId: lm.id, outcomeIdx: 0, kind: 'BY', type: 'limit', price: 40, userPrice: 40, basis: 40, qty: 3, origQty: 3, filled: 0, notional: 0, status: 'open', createdAt: Date.now(), updatedAt: Date.now() });
  legacy.pushHist(String(lm.id), Date.now(), 44);
  legacy._compact(0);

  const importDb = 'predix_test_import_' + Date.now().toString(36);
  const admin = new Pool({ database: 'postgres' });
  await createDatabase(admin, importDb);
  await admin.end();
  const target = new Pool({ database: importDb });
  await migrate(target);
  await target.end();
  execFileSync('node', ['scripts/import-json.js', srcDir], {
    env: { ...process.env, PGDATABASE: importDb, DATABASE_URL: '' },
    stdio: 'pipe',
  });
  const check = new Pool({ database: importDb });
  const cnt = await check.query('SELECT (SELECT COUNT(*) FROM users)::int AS u, (SELECT COUNT(*) FROM wallets)::int AS w, (SELECT COUNT(*) FROM orders)::int AS o, (SELECT COUNT(*) FROM market_hist)::int AS h');
  ok(cnt.rows[0].u === 1 && cnt.rows[0].w === 1 && cnt.rows[0].o === 1 && cnt.rows[0].h === 1, 'importer moved users, wallets, orders and price history');
  const bal = await check.query('SELECT available FROM wallets');
  ok(Number(bal.rows[0].available) === 12345, 'imported balance exact (integer cents preserved)');
  await check.end();
  fs.rmSync(srcDir, { recursive: true, force: true });

  await store.flush();
  await store.close();
  console.log('\nPERSISTENCE (POSTGRESQL) TESTS PASSED ✅ (' + passed + ' assertions)');
  process.exit(0);
})().catch((e) => { console.error('SUITE CRASH:', e); process.exit(1); });
