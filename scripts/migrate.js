#!/usr/bin/env node
'use strict';
require('../lib/load-env');
/**
 * Predix database CLI
 *   node scripts/migrate.js            apply pending migrations to $PGDATABASE (default predix)
 *   node scripts/migrate.js --init     create the database if needed, then migrate
 * Connection: standard libpq env (PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE) or DATABASE_URL.
 */
const { Pool } = require('pg');
const { migrate, createDatabase } = require('../lib/migrate');

async function main() {
  const init = process.argv.includes('--init');
  const dbName = process.env.PGDATABASE || (process.env.DATABASE_URL ? null : 'predix');

  if (init && dbName && !process.env.DATABASE_URL) {
    const admin = new Pool({ database: 'postgres' });
    const created = await createDatabase(admin, dbName);
    console.log(`[db:init] database ${dbName} ${created ? 'created' : 'already exists'}`);
    await admin.end();
  }

  const config = process.env.DATABASE_URL
    ? { connectionString: process.env.DATABASE_URL }
    : { database: dbName };
  const pool = new Pool(config);
  await migrate(pool);
  await pool.end();
  console.log('[db] ready');
}

main().catch((e) => { console.error('[db] error:', e.message); process.exit(1); });
