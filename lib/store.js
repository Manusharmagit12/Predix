'use strict';
/**
 * Store — durable, zero-dependency persistence.
 *
 * All tables live in memory as arrays of plain row objects. Every mutation is
 * appended to a write-ahead journal (JSONL) synchronously, and replayed on
 * startup. Periodically (and on boot) the journal is compacted into a single
 * snapshot file. This gives us crash-safe, auditable persistence without any
 * external database — good enough for a demo-scale exchange.
 */
const fs = require('fs');
const path = require('path');

const TABLES = [
  'users', 'sessions', 'wallets', 'orders', 'trades', 'positions',
  'ledger', 'markets', 'promos', 'redemptions', 'watchlist', 'notifications',
  'comments', 'alerts', 'achievements', 'settled', 'idem', 'resolutions', 'ltx', 'lent', 'withdrawals',
];
const IMMUTABLE = new Set(['resolutions', 'ltx', 'lent']); // append-only: audit history + double-entry ledger

class Store {
  constructor(dir) {
    this.dir = dir;
    this.snapPath = path.join(dir, 'snapshot.json');
    this.journalPath = path.join(dir, 'journal.jsonl');
    this.data = {};
    this.hist = {}; // marketId -> [[ts, priceCents], ...] price history
    this.seq = {};
    for (const t of TABLES) this.data[t] = [];
    fs.mkdirSync(dir, { recursive: true });
    this._load();
    this.journalLines = 0;
    this.fh = fs.openSync(this.journalPath, 'a');
    this._pending = null;
  }

  /* ---------- load / replay / compact ---------- */

  _load() {
    try {
      if (fs.existsSync(this.snapPath)) {
        const s = JSON.parse(fs.readFileSync(this.snapPath, 'utf8'));
        for (const t of TABLES) this.data[t] = s.data[t] || [];
        this.hist = s.hist || {};
      }
    } catch (e) {
      console.error('[store] snapshot load failed:', e.message);
    }
    let replayed = 0;
    try {
      if (fs.existsSync(this.journalPath)) {
        const raw = fs.readFileSync(this.journalPath, 'utf8');
        for (const line of raw.split('\n')) {
          if (!line.trim()) continue;
          let op;
          try { op = JSON.parse(line); } catch { break; } // truncated tail after crash — ignore
          this._apply(op);
          replayed++;
        }
      }
    } catch (e) {
      console.error('[store] journal replay error:', e.message);
    }
    // recompute id sequences
    for (const t of TABLES) {
      let m = 0;
      for (const r of this.data[t]) if (typeof r.id === 'number' && r.id > m) m = r.id;
      this.seq[t] = m;
    }
    this._compact(replayed);
  }

  _apply(op) {
    if (op.o === 'u') {
      const arr = this.data[op.t];
      if (!arr) return;
      const i = arr.findIndex((r) => r.id === op.r.id);
      if (i >= 0) arr[i] = op.r; else arr.push(op.r);
    } else if (op.o === 'd') {
      const arr = this.data[op.t];
      if (!arr) return;
      const i = arr.findIndex((r) => r.id === op.id);
      if (i >= 0) arr.splice(i, 1);
    } else if (op.o === 'h') {
      if (!this.hist[op.s]) this.hist[op.s] = [];
      this.hist[op.s].push(op.p);
      // cap history at ~4000 points per market
      if (this.hist[op.s].length > 4000) this.hist[op.s].splice(0, this.hist[op.s].length - 4000);
    }
  }

  _compact(replayed) {
    try {
      const tmp = this.snapPath + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify({ data: this.data, hist: this.hist, seq: this.seq }));
      fs.renameSync(tmp, this.snapPath);
      if (this.fh !== undefined) { try { fs.closeSync(this.fh); } catch {} }
      fs.writeFileSync(this.journalPath, '');
      this.fh = fs.openSync(this.journalPath, 'a');
      this.journalLines = 0;
      if (typeof replayed === 'number' && replayed > 0) {
        console.log(`[store] compacted ${replayed} journal ops into snapshot`);
      }
      console.log('[store] tables: ' + TABLES.map((t) => `${t}=${this.data[t].length}`).join(' '));
    } catch (e) {
      console.error('[store] compact failed:', e.message);
    }
  }

  /* ---------- transactions ---------- */

  tx(fn) {
    if (this._pending) return fn(); // nested — join outer tx
    this._pending = [];
    let out;
    try {
      out = fn();
    } catch (e) {
      this._pending = null;
      throw e;
    }
    const ops = this._pending;
    this._pending = null;
    if (ops.length) {
      const chunk = ops.map((o) => JSON.stringify(o)).join('\n') + '\n';
      fs.writeSync(this.fh, chunk);
      this.journalLines += ops.length;
      if (this.journalLines > 40000) this._compact(0);
    }
    return out;
  }

  _up(op) {
    if (!this._pending) throw new Error('mutation outside tx');
    this._apply(op);
    this._pending.push(op);
  }

  /* ---------- CRUD ---------- */

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

  update(t, row) { // full-row upsert (row must carry id)
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

  async flush() { /* JSON journal writes synchronously — nothing to drain */ }
  async reopen() { return new Store(this.dir); }
  async close() {}
}

module.exports = { Store, TABLES };
