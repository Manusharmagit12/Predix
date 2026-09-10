'use strict';
require('../lib/load-env');
const { Pool } = require('pg');
const { migrate } = require('../lib/migrate');
const path = require('path');
const { Store, TABLES } = require('../lib/store');
const { PgStore } = require('../lib/store-pg');

const ORDER = ['users', 'sessions', 'wallets', 'markets', 'promos', 'orders', 'trades', 'positions',
  'ledger', 'redemptions', 'watchlist', 'notifications', 'comments', 'alerts', 'achievements', 'settled', 'idem', 'resolutions'];

async function main() {
  const dbName = process.env.PGDATABASE || 'predix';
  console.log(`[reset] Connecting to postgres admin to recreate "${dbName}"...`);
  const admin = new Pool({ database: 'postgres' });

  await admin.query(`
    SELECT pg_terminate_backend(pid) 
    FROM pg_stat_activity 
    WHERE datname = $1 AND pid <> pg_backend_pid()
  `, [dbName]);

  await admin.query(`DROP DATABASE IF EXISTS ${dbName}`);
  await admin.query(`CREATE DATABASE ${dbName}`);
  await admin.end();
  console.log(`[reset] Database "${dbName}" freshly recreated.`);

  const config = { database: dbName };
  const pool = new Pool(config);
  console.log('[reset] Applying migrations...');
  await migrate(pool);

  console.log('[reset] Importing clean seed data from ./data...');
  const srcDir = path.join(__dirname, '..', 'data');
  const legacy = new Store(srcDir);
  const pg = new PgStore({ pool });
  await pg.load();

  for (const t of ORDER) {
    const rows = legacy.all(t);
    if (!rows.length) continue;
    if (t === 'wallets') for (const r of rows) if (r.withdrawReserved == null) r.withdrawReserved = 0;
    pg.tx(() => { for (const r of rows) pg._up({ o: 'u', t, r: JSON.parse(JSON.stringify(r)) }); });
  }
  for (const [key, arr] of Object.entries(legacy.hist || {})) {
    pg.tx(() => { for (const p of arr) pg._up({ o: 'h', s: key, p }); });
  }
  await pg.flush();
  await pg.close();
  await pool.end();

  console.log('[reset] Clean seed data imported successfully!');
}

main().catch((e) => {
  console.error('[reset] Error:', e);
  process.exit(1);
});
