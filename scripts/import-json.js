#!/usr/bin/env node
'use strict';
require('../lib/load-env');
/**
 * Import existing JSON-store data (data/snapshot.json + journal) into PostgreSQL.
 *   node scripts/import-json.js [sourceDir]        (default ./data)
 * Target database: $PGDATABASE (default predix) — must already be migrated (npm run db:init).
 * Writes every table in FK-safe order plus price history, then verifies row counts.
 */
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const { Store, TABLES } = require('../lib/store');
const { PgStore } = require('../lib/store-pg');

/* FK-safe insertion order */
const ORDER = ['users', 'sessions', 'wallets', 'markets', 'promos', 'orders', 'trades', 'positions',
  'ledger', 'redemptions', 'watchlist', 'notifications', 'comments', 'alerts', 'achievements', 'settled', 'idem', 'resolutions'];

async function main() {
  const srcDir = path.resolve(process.argv[2] || path.join(__dirname, '..', 'data'));
  if (!fs.existsSync(path.join(srcDir, 'snapshot.json')) && !fs.existsSync(path.join(srcDir, 'journal.jsonl'))) {
    console.error(`[import] no JSON store found in ${srcDir} — nothing to import`);
    process.exit(1);
  }
  const dbName = process.env.PGDATABASE || (process.env.DATABASE_URL ? null : 'predix');
  const config = process.env.DATABASE_URL
    ? { connectionString: process.env.DATABASE_URL }
    : { database: dbName };
  const pool = new Pool(config);

  const legacy = new Store(srcDir);
  const counts = {};
  for (const t of TABLES) counts[t] = legacy.all(t).length;
  const histPoints = Object.values(legacy.hist || {}).reduce((s, a) => s + a.length, 0);
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  console.log(`[import] source: ${srcDir} — ${total} rows, ${histPoints} price points`);

  const pg = new PgStore({ pool });
  await pg.load();
  const existing = ORDER.some((t) => pg.all(t).length > 0);
  if (existing) {
    console.error('[import] target database is not empty — refusing to import over it');
    await pg.close();
    process.exit(1);
  }

  for (const t of ORDER) {
    const rows = legacy.all(t);
    if (!rows.length) continue;
    if (t === 'wallets') for (const r of rows) if (r.withdrawReserved == null) r.withdrawReserved = 0; // v3 withdrawal escrow col
    pg.tx(() => { for (const r of rows) pg._up({ o: 'u', t, r: JSON.parse(JSON.stringify(r)) }); });
  }
  for (const [key, arr] of Object.entries(legacy.hist || {})) {
    pg.tx(() => { for (const p of arr) pg._up({ o: 'h', s: key, p }); });
  }
  await pg.flush();

  /* verify (separate connection pool) */
  const pool2 = new Pool(config);
  const pg2 = new PgStore({ pool: pool2 });
  await pg2.load();
  let bad = 0;
  for (const t of ORDER) {
    const n = pg2.all(t).length;
    if (n !== counts[t]) { console.error(`[import] MISMATCH ${t}: json=${counts[t]} pg=${n}`); bad++; }
  }
  const w1 = legacy.all('wallets').reduce((s, w) => s + w.available + w.reserved, 0);
  const w2 = pg2.all('wallets').reduce((s, w) => s + w.available + w.reserved, 0);
  if (w1 !== w2) { console.error(`[import] cash mismatch: json=${w1} pg=${w2}`); bad++; }
  await pg2.close();
  await pg.close();
  if (bad) { console.error(`[import] FAILED with ${bad} mismatches`); process.exit(1); }
  console.log('[import] verified — all rows and total cash match. Done.');
  process.exit(0);
}

main().catch((e) => { console.error('[import] error:', e); process.exit(1); });
