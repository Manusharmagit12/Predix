'use strict';
/**
 * PgStore — PostgreSQL persistence with the exact same synchronous interface
 * as the legacy JSON Store, so the engine keeps working unchanged.
 *
 * How it works
 *   • Rows live in memory (arrays of plain objects, identical shapes) and are
 *     mutated synchronously — the engine's matching code stays 100% in-process.
 *   • Every engine transaction (db.tx) is recorded as an ordered op queue and
 *     flushed to PostgreSQL inside ONE SQL transaction (BEGIN … COMMIT). If
 *     any statement fails (constraint violation = bug), the SQL transaction
 *     rolls back, the failure is recorded and rethrown loudly.
 *   • `await store.flush()` gives explicit durability (API handlers call it
 *     before responding; tests call it at checkpoints). A background
 *     setImmediate flush also drains the queue automatically.
 *   • Boot = `await store.load()`: every table is read back (ORDER BY id =
 *     insertion order) and id sequences are recomputed. The engine's
 *     rebuild() then reconstructs books from the open orders.
 *
 * Money is stored as BIGINT cents; integer-only values are enforced by the
 * adapter and by the SQL column types. No floating-point money, ever.
 */
const dns = require('dns');
if (dns && typeof dns.setDefaultResultOrder === 'function') {
  dns.setDefaultResultOrder('ipv4first');
}
const { Pool } = require('pg');
const { TABLES } = require('./store');

const IMMUTABLE = new Set(['resolutions', 'ltx', 'lent']); // append-only, also enforced by DB triggers
const HIST_CAP = 4000;

/* typed, constrained columns per table: [sqlColumn, rowKey] — everything else
   lives in the `data` JSONB blob (the canonical row). `int`/`bigint` values
   are strictly validated as integers before they reach the database. */
const COLS = {
  users: [['username', 'username', 't'], ['email', 'email', 't'], ['role', 'role', 't'], ['created_at', 'createdAt', 'i']],
  sessions: [['token', 'token', 't'], ['user_id', 'userId', 'i'], ['created_at', 'createdAt', 'i'], ['expires_at', 'expiresAt', 'i']],
  wallets: [['user_id', 'userId', 'i'], ['available', 'available', 'i'], ['reserved', 'reserved', 'i'], ['withdraw_reserved', 'withdrawReserved', 'i']],
  markets: [['slug', 'slug', 't'], ['status', 'status', 't'], ['close_time', 'closeTime', 'i'], ['created_at', 'createdAt', 'i'], ['resolved_at', 'resolvedAt', 'i'], ['settled_at', 'settledAt', 'i'], ['resolution_hash', 'resolutionHash', 't'], ['provider', 'provider', 't'], ['asset_id', 'assetId', 't'], ['currency', 'currency', 't'], ['operator', 'operator', 't'], ['target_value', 'targetValue', 'f'], ['feed_resolution_time', 'feedResolutionTime', 'i'], ['latitude', 'latitude', 'f'], ['longitude', 'longitude', 'f'], ['metric', 'metric', 't'], ['unit', 'unit', 't']],
  orders: [['user_id', 'userId', 'i'], ['market_id', 'marketId', 'i'], ['outcome_idx', 'outcomeIdx', 'i'], ['kind', 'kind', 't'], ['type', 'type', 't'], ['price', 'price', 'i'], ['qty', 'qty', 'i'], ['orig_qty', 'origQty', 'i'], ['filled', 'filled', 'i'], ['basis', 'basis', 'i'], ['status', 'status', 't'], ['tif', 'tif', 't'], ['stp', 'stp', 't'], ['idem_key', 'idemKey', 't'], ['created_at', 'createdAt', 'i']],
  trades: [['market_id', 'marketId', 'i'], ['outcome_idx', 'outcomeIdx', 'i'], ['price', 'price', 'i'], ['qty', 'qty', 'i'], ['ts', 'ts', 'i'], ['taker_user_id', 'takerUserId', 'i'], ['maker_user_id', 'makerUserId', 'i']],
  positions: [['user_id', 'userId', 'i'], ['market_id', 'marketId', 'i'], ['outcome_idx', 'outcomeIdx', 'i'], ['yes_qty', 'yesQty', 'i'], ['no_qty', 'noQty', 'i'], ['yes_reserved', 'yesReserved', 'i'], ['no_reserved', 'noReserved', 'i']],
  ledger: [['user_id', 'userId', 'i'], ['type', 'type', 't'], ['amount', 'amount', 'i'], ['balance_after', 'balanceAfter', 'i'], ['ts', 'ts', 'i']],
  promos: [['code', 'code', 't'], ['amount', 'amount', 'i']],
  redemptions: [['user_id', 'userId', 'i'], ['code', 'code', 't'], ['amount', 'amount', 'i'], ['ts', 'ts', 'i']],
  watchlist: [['user_id', 'userId', 'i'], ['market_id', 'marketId', 'i'], ['ts', 'ts', 'i']],
  notifications: [['user_id', 'userId', 'i'], ['type', 'type', 't'], ['ts', 'ts', 'i'], ['read', 'read', 'b']],
  comments: [['user_id', 'userId', 'i'], ['market_id', 'marketId', 'i'], ['ts', 'ts', 'i']],
  alerts: [['user_id', 'userId', 'i'], ['market_id', 'marketId', 'i'], ['status', 'status', 't'], ['ts', 'ts', 'i']],
  achievements: [['user_id', 'userId', 'i'], ['code', 'code', 't'], ['ts', 'ts', 'i']],
  settled: [['user_id', 'userId', 'i'], ['market_id', 'marketId', 'i'], ['outcome_idx', 'outcomeIdx', 'i'], ['payout', 'payout', 'i'], ['ts', 'ts', 'i']],
  idem: [['user_id', 'userId', 'i'], ['key', 'key', 't'], ['ts', 'ts', 'i']],
  resolutions: [['market_id', 'marketId', 'i'], ['hash', 'hash', 't'], ['prev_hash', 'prevHash', 't'], ['resolved_at', 'resolvedAt', 'i'], ['resolved_by', 'resolvedBy', 'j']],
  ltx: [['kind', 'kind', 't'], ['ts', 'ts', 'i'], ['market_id', 'marketId', 'i'], ['order_id', 'orderId', 'i'], ['trade_id', 'tradeId', 'i'], ['user_id', 'userId', 'i'], ['settlement_id', 'settlementId', 'i']],
  lent: [['tx_id', 'txId', 'i'], ['account', 'account', 't'], ['direction', 'direction', 't'], ['amount', 'amount', 'i'], ['ts', 'ts', 'i']],
  withdrawals: [['user_id', 'userId', 'i'], ['amount', 'amount', 'i'], ['status', 'status', 't'], ['requested_at', 'requestedAt', 'i'], ['updated_at', 'updatedAt', 'i'], ['processed_at', 'processedAt', 'i'], ['processed_by', 'processedBy', 't'], ['note', 'note', 't'], ['idem_key', 'idemKey', 't']],
};

/* value coercion for typed columns: strict integers, jsonb for objects, null for absent */
function colVal(row, key, kind) {
  const v = row[key];
  if (v === undefined || v === null) return null;
  if (kind === 'i') {
    if (typeof v !== 'number' || !Number.isInteger(v)) {
      throw new Error(`store-pg: field '${key}' must be an integer (got ${JSON.stringify(v)}) — money/qty/price are integer-only`);
    }
    return v;
  }
  if (kind === 'j') return JSON.stringify(v);
  if (kind === 'f') {
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      throw new Error(`store-pg: field '${key}' must be a finite number (got ${JSON.stringify(v)})`);
    }
    return v; // external asset price data (never ledger money — that stays integer cents)
  }
  return v; // 't' text / 'b' boolean
}

function applyOp(data, hist, op) {
  if (op.o === 'u') {
    const arr = data[op.t];
    if (!arr) return;
    const i = arr.findIndex((r) => r.id === op.r.id);
    if (i >= 0) arr[i] = op.r; else arr.push(op.r);
  } else if (op.o === 'd') {
    const arr = data[op.t];
    if (!arr) return;
    const i = arr.findIndex((r) => r.id === op.id);
    if (i >= 0) arr.splice(i, 1);
  } else if (op.o === 'h') {
    if (!hist[op.s]) hist[op.s] = [];
    hist[op.s].push(op.p);
    if (hist[op.s].length > HIST_CAP) hist[op.s].splice(0, hist[op.s].length - HIST_CAP);
  }
}

class PgStore {
  constructor(opts = {}) {
    let cfg = opts.config;
    if (!opts.pool && !cfg) {
      const connStr = opts.url || process.env.DATABASE_URL;
      if (connStr) {
        cfg = { connectionString: connStr };
        if (!/localhost|127\.0\.0\.1/.test(connStr) && !process.env.PGSSLMODE) {
          cfg.ssl = { rejectUnauthorized: false };
        }
      } else {
        cfg = {};
      }
    }
    this._cfg = opts.pool ? { pool: opts.pool } : { config: cfg };
    this.pool = opts.pool || new Pool(this._cfg.config);
    this._ownsPool = !opts.pool; // a borrowed pool is not closed by this store
    this.data = {};
    this.hist = {};
    this.seq = {};
    for (const t of TABLES) this.data[t] = [];
    this._pending = null;
    this._queue = [];
    this._chain = null;
    this.failure = null;
  }

  /* ---------- single-writer guard: one Predix process per database ----------
     A session-level advisory lock on a dedicated connection. If a second
     process boots against the same database it fails fast instead of racing
     this one (double fills / double settlement across processes). */
  async acquireWriterLock() {
    if (this._lockClient) return true;
    const c = await this.pool.connect();
    const r = await c.query("SELECT pg_try_advisory_lock(hashtext('predix-writer:' || current_database())) AS ok");
    if (!r.rows[0].ok) {
      c.release();
      throw new Error('This PostgreSQL database is already owned by another Predix instance (writer lock held) — refusing to start.');
    }
    this._lockClient = c; // the session lock lives as long as this connection stays open
    return true;
  }

  /* ---------- boot: load everything back into memory ---------- */
  async load() {
    const c = await this.pool.connect();
    try {
      for (const t of TABLES) {
        const r = await c.query(`SELECT data FROM ${t} ORDER BY id`);
        this.data[t] = r.rows.map((x) => x.data);
        let m = 0;
        for (const row of this.data[t]) if (typeof row.id === 'number' && row.id > m) m = row.id;
        this.seq[t] = m;
      }
      const h = await c.query('SELECT book_key, ts, price FROM market_hist ORDER BY ts');
      this.hist = {};
      for (const r of h.rows) {
        (this.hist[r.book_key] = this.hist[r.book_key] || []).push([Number(r.ts), r.price]);
      }
      for (const k of Object.keys(this.hist)) {
        if (this.hist[k].length > HIST_CAP) this.hist[k].splice(0, this.hist[k].length - HIST_CAP);
      }
    } finally { c.release(); }
  }

  /* ---------- transactions (sync interface, queued SQL flush) ---------- */
  tx(fn) {
    if (this._pending) return fn(); // nested — join outer tx
    this._pending = [];
    let out;
    try { out = fn(); } catch (e) { this._pending = null; throw e; }
    const ops = this._pending;
    this._pending = null;
    if (ops.length) {
      this._queue.push(...ops);
      setImmediate(() => { this.flush().catch(() => {}); }); // background durability
    }
    return out;
  }

  _up(op) {
    if (!this._pending) throw new Error('mutation outside tx');
    if (op.o === 'u') {
      for (const [, key, kind] of (COLS[op.t] || [])) colVal(op.r, key, kind); // fail fast: strict integer money/qty/price
    }
    applyOp(this.data, this.hist, op); // memory first (synchronous, like the JSON store)
    this._pending.push(op);
  }

  /* ---------- CRUD (identical semantics to the JSON store) ---------- */
  all(t) { return this.data[t]; }
  get(t, id) { return this.data[t].find((r) => r.id === id) || null; }
  find(t, pred) { return this.data[t].filter(pred); }
  findOne(t, pred) { return this.data[t].find(pred) || null; }

  insert(t, row) {
    return this.tx(() => {
      if (row.id === undefined) row.id = ++this.seq[t];
      this._up({ o: 'u', t, r: row });
      return row;
    });
  }

  update(t, row) {
    if (IMMUTABLE.has(t)) throw new Error(`table '${t}' is append-only (immutable audit history)`);
    return this.tx(() => this._up({ o: 'u', t, r: row }));
  }

  remove(t, id) {
    if (IMMUTABLE.has(t)) throw new Error(`table '${t}' is append-only (immutable audit history)`);
    return this.tx(() => this._up({ o: 'd', t, id }));
  }

  /* ---------- price history ---------- */
  histFor(marketId) { return this.hist[marketId] || []; }
  pushHist(marketId, ts, price) {
    this.tx(() => this._up({ o: 'h', s: String(marketId), p: [ts, price] }));
  }

  /* ---------- SQL durability ---------- */
  async flush() {
    if (this.failure) throw this.failure;
    if (this._chain) return this._chain;
    if (!this._queue.length) return null;
    this._chain = this._drain().finally(() => { this._chain = null; });
    return this._chain;
  }

  async _drain() {
    const ops = this._queue.splice(0, this._queue.length);
    const c = await this.pool.connect();
    try {
      await c.query('BEGIN');
      // row-level locking: lock every existing row this transaction touches
      // (wallets, positions, orders, markets, idem, …) before writing, so a
      // concurrent writer can never interleave on the same rows
      const touched = new Map();
      for (const op of ops) {
        if (op.o === 'h') continue;
        const id = op.o === 'u' ? op.r.id : op.id;
        if (id === undefined || id === null) continue;
        if (!touched.has(op.t)) touched.set(op.t, new Set());
        touched.get(op.t).add(id);
      }
      for (const [t, ids] of touched) {
        await c.query(`SELECT id FROM ${t} WHERE id = ANY($1) FOR UPDATE`, [[...ids]]);
      }
      for (const op of ops) await this._exec(c, op);
      await c.query('COMMIT');
      c.release();
    } catch (e) {
      try { await c.query('ROLLBACK'); } catch {}
      c.release();
      this._queue.unshift(...ops); // keep unwritten ops for post-mortem
      this.failure = e;
      console.error('‼️  [pg] SQL TRANSACTION ROLLED BACK:', e.message, '— memory and database have diverged');
      throw e;
    }
  }

  async _exec(c, op) {
    if (op.o === 'h') {
      return c.query('INSERT INTO market_hist (book_key, ts, price) VALUES ($1, $2, $3)', [op.s, op.p[0], op.p[1]]);
    }
    if (op.o === 'd') {
      return c.query(`DELETE FROM ${op.t} WHERE id = $1`, [op.id]);
    }
    const cols = COLS[op.t] || [];
    const row = op.r;
    const names = ['id', ...cols.map((x) => x[0]), 'data'];
    const vals = [row.id, ...cols.map(([, key, kind]) => colVal(row, key, kind)), JSON.stringify(row)];
    const ph = names.map((_, i) => '$' + (i + 1));
    const sets = [...cols.map((x) => x[0]), 'data'].map((n) => `${n} = EXCLUDED.${n}`).join(', ');
    return c.query(
      `INSERT INTO ${op.t} (${names.join(', ')}) VALUES (${ph.join(', ')}) ON CONFLICT (id) DO UPDATE SET ${sets}`,
      vals,
    );
  }

  /* open a SECOND store on the same database (used by restart tests) —
     it borrows this pool, so closing it will not end the pool */
  async reopen() {
    const s2 = new PgStore(this._cfg.pool ? { pool: this.pool } : { config: this._cfg.config });
    s2._ownsPool = false;
    await s2.load();
    return s2;
  }

  async close() {
    if (this._lockClient) {
      const c = this._lockClient;
      this._lockClient = null;
      try { await c.query("SELECT pg_advisory_unlock(hashtext('predix-writer:' || current_database()))"); } catch {}
      c.release();
    }
    if (this._ownsPool) await this.pool.end();
  }
}

module.exports = { PgStore, TABLES };
