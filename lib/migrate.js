'use strict';
/**
 * Migration runner — applies ./migrations/*.sql in order, exactly once each,
 * tracked in the schema_migrations table. Used by the CLI (scripts/migrate.js),
 * by server boot (auto-apply) and by the test helper.
 */
const fs = require('fs');
const path = require('path');

const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations');

async function migrate(pool) {
  await pool.query('CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, applied_at BIGINT NOT NULL)');
  const { rows } = await pool.query('SELECT id FROM schema_migrations');
  const done = new Set(rows.map((r) => r.id));
  const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
  let applied = 0;
  for (const f of files) {
    if (done.has(f)) continue;
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8');
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      await c.query(sql);
      await c.query('INSERT INTO schema_migrations (id, applied_at) VALUES ($1, $2)', [f, Date.now()]);
      await c.query('COMMIT');
      applied++;
      console.log(`[migrate] applied ${f}`);
    } catch (e) {
      await c.query('ROLLBACK').catch(() => {});
      c.release();
      throw new Error(`migration ${f} failed: ${e.message}`);
    }
    c.release();
  }
  if (!applied) console.log('[migrate] schema up to date');
  return applied;
}

/* create a database if it does not exist (best effort, for db:init) */
async function createDatabase(adminPool, name) {
  const { rows } = await adminPool.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);
  if (rows.length) return false;
  if (!/^[a-z0-9_]+$/.test(name)) throw new Error('unsafe database name');
  await adminPool.query(`CREATE DATABASE ${name}`);
  return true;
}

module.exports = { migrate, createDatabase, MIGRATIONS_DIR };
