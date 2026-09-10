'use strict';
/**
 * Test store factory — isolated, clean-state database per suite/run.
 * Default: PostgreSQL (fresh predix_test_<suite>_<ts> database, migrated).
 * PREDIX_TEST_STORE=json falls back to the legacy JSON store (dual-mode tests).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Pool } = require('pg');
const { Store } = require('../lib/store');
const { PgStore } = require('../lib/store-pg');
const { migrate, createDatabase } = require('../lib/migrate');

async function createTestStore(suite) {
  if (process.env.PREDIX_TEST_STORE === 'json') {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'predix-' + suite + '-'));
    return new Store(dir);
  }
  const dbName = 'predix_test_' + suite + '_' + Date.now().toString(36);
  const admin = new Pool({ database: 'postgres' });
  await createDatabase(admin, dbName);
  await admin.end();
  const pool = new Pool({ database: dbName });
  await migrate(pool);           // clean schema state for every run
  const store = new PgStore({ pool });
  await store.load();
  return store;
}

module.exports = { createTestStore };
