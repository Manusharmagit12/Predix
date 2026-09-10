#!/usr/bin/env node
'use strict';
require('./lib/load-env');
/**
 * Predix — a play-money prediction market (Kalshi-style).
 * Node.js full-stack app (single runtime dependency: pg for PostgreSQL; frontend has no build step):
 *   • HTTP server (REST API + static frontend)
 *   • SSE hub for live order books, trades, prices, wallet updates
 *   • Order-book matching engine with wallets, positions, ledger, settlement
 *   • Market-maker bots for liquidity
 *
 * Run:  node server.js   (PORT env optional, default 3000)
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const { Store } = require('./lib/store');
const { Hub } = require('./lib/hub');
const { Engine } = require('./lib/engine');
const { Api } = require('./lib/api');
const { seed } = require('./lib/seed');
const { Bots } = require('./lib/bots');
const { LiveSync } = require('./lib/sync-live');

const PORT = Number(process.env.PORT || 3000);
const HOST = '0.0.0.0';
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = process.env.PREDIX_DATA || path.join(ROOT, 'data');

/* ---------- static files ---------- */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2',
};

function serveStatic(req, res, url) {
  let p = decodeURIComponent(url.pathname);
  if (p === '/') p = '/index.html';
  const file = path.normalize(path.join(PUBLIC_DIR, p));
  if (!file.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end('Forbidden'); }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) {
      // SPA fallback → index.html (hash routing, but harmless)
      const idx = path.join(PUBLIC_DIR, 'index.html');
      fs.readFile(idx, (e2, buf) => {
        if (e2) { res.writeHead(404); return res.end('Not found'); }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(buf);
      });
      return;
    }
    const ext = path.extname(file).toLowerCase();
    const headers = {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
      'Pragma': 'no-cache',
    };
    res.writeHead(200, headers);
    fs.createReadStream(file).pipe(res);
  });
}

/* ---------- boot ---------- */

async function boot() {
let db;
if (process.env.PREDIX_DB === 'pg' || process.env.DATABASE_URL) {
  const { PgStore } = require('./lib/store-pg');
  const { migrate } = require('./lib/migrate');
  db = new PgStore();
  await migrate(db.pool);   // auto-apply pending schema migrations
  await db.load();
  await db.acquireWriterLock(); // exactly one Predix process per database
  console.log('[server] persistence: PostgreSQL (single-writer lock held)');
} else {
  db = new Store(DATA_DIR);
  console.log('[server] persistence: JSON journal (set PREDIX_DB=pg or DATABASE_URL for PostgreSQL)');
}
const hub = new Hub();
const engine = new Engine(db, hub);
const liveSync = new LiveSync(db, engine, hub);
const api = new Api(db, engine, hub, liveSync);

seed(db);
engine.rebuild();
if (engine.ledger.bootstrap()) console.log('[ledger] opening balances adopted (immutable double-entry ledger active)');
{
  const r = engine.ledger.reconcile();
  if (r.violations.length) console.error('‼️ [ledger] BOOT RECONCILIATION FAILED:', r.violations.slice(0, 5));
  else console.log(`[ledger] reconciled ✓ (${r.txCount} transactions, ${r.entryCount} entries, zero-sum)`);
}
hub.startKeepAlive();

const bots = new Bots(db, engine);
bots.start();

// Live prediction market sync: initial load + recurring probability updates
setTimeout(() => liveSync.init(), 2500).unref();
setInterval(() => liveSync.tick(), 60 * 1000).unref();

// background timers: market closes, alerts, table pruning, idle price sampling
setInterval(() => engine.checkCloses(), 20 * 1000).unref();
// CoinGecko feed tick: refresh cached prices for feed markets + generate
// resolution proposals after their resolution time (proposals only — an admin
// still confirms every settlement through the audited resolve flow).
const feedTick = () => engine.feedTick().then((r) => { if (r.markets) console.log(`[feed] ${r.markets} market(s) — ${r.proposals} proposal(s) ready, ${r.blocked} blocked`); }).catch((e) => console.error('[feed]', e.message));
setTimeout(feedTick, 8 * 1000).unref();
setInterval(feedTick, 60 * 1000).unref();
setInterval(() => { try { engine.checkAlerts(); } catch (e) { console.error('[alerts]', e.message); } }, 20 * 1000).unref();
setInterval(() => engine.prune(), 5 * 60 * 1000).unref();
setInterval(() => {
  try {
    const r = engine.ledger.reconcile();
    if (r.violations.length) console.error('‼️ [ledger] RECONCILIATION FAILED:', r.violations.slice(0, 5));
  } catch (e) { console.error('[ledger] reconcile error:', e.message); }
}, 5 * 60 * 1000).unref();
setInterval(() => {
  // sample mid-price for charts on quiet markets
  const now = Date.now();
  for (const m of db.all('markets')) {
    if (m.status !== 'open') continue;
    if (m.lastTradeTs && now - m.lastTradeTs < 45 * 1000) continue;
    const mark = engine.mark(m.id);
    if (mark !== null) db.pushHist(m.id, now, mark);
  }
}, 45 * 1000).unref();

/* ---------- production startup checks ---------- */
if (process.env.NODE_ENV === 'production') {
  const warnings = [];
  if (!process.env.ADMIN_PASSWORD) {
    process.env.ADMIN_PASSWORD = 'admin' + Math.random().toString(36).slice(-6);
    warnings.push(`ADMIN_PASSWORD unset — temporary admin password generated: ${process.env.ADMIN_PASSWORD}`);
  }
  if (db instanceof Store) warnings.push('JSON journal persistence — set PREDIX_DB=pg for PostgreSQL durability');
  if (warnings.length) console.log('  ⚠️  PRODUCTION CHECK: ' + warnings.join(' · '));
  else console.log('  ✓ production checks passed');
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname.startsWith('/api/')) {
    api.handle(req, res).catch((e) => {
      console.error('[server] unhandled:', e);
      if (!res.headersSent) { res.writeHead(500, { 'Content-Type': 'application/json' }); }
      try { res.end(JSON.stringify({ error: 'Server error' })); } catch {}
    });
  } else {
    serveStatic(req, res, url);
  }
});

server.listen(PORT, HOST, () => {
  console.log(`\n  Predix — prediction market is live`);
  console.log(`  →  http://localhost:${PORT}`);
  console.log(`  →  Admin login: admin / ${process.env.ADMIN_PASSWORD || 'admin1234'}`);
  console.log(`  →  Signup promo code: WELCOME100 ($100 play money)\n`);
});

async function shutdown() {
  console.log('\n[server] shutting down, flushing persistence...');
  try { if (db._compact) db._compact(0); } catch {}
  try { await Promise.race([db.flush(), new Promise((r) => setTimeout(r, 3000))]); } catch {}
  process.exit(0);
}
process.on('SIGTERM', () => { shutdown(); });
process.on('SIGINT', () => { shutdown(); });

} // end boot

boot().catch((e) => { console.error('[server] boot failed:', e); process.exit(1); });
// resilience: background tasks must never kill the exchange
process.on('uncaughtException', (e) => console.error('[server] uncaught:', e));
process.on('unhandledRejection', (e) => console.error('[server] unhandled rejection:', e));
