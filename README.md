# Predix — Prediction Market Platform

A **fully functional, full-stack prediction market** (Kalshi-style) where traders buy and sell
YES/NO event contracts through a real **order-book matching engine**. The stack is deliberately
light: a single runtime npm dependency (`pg`, for PostgreSQL persistence), a no-build-step
vanilla-JS frontend, and an optional zero-dependency JSON-journal mode — `node server.js` is all
it takes to run.

> **Play money only.** All balances are virtual. Real-money operation requires DCM/DCO
> registration, KYC/AML, geofencing etc. — see the compliance notes at the bottom.

---

## Quick start

**With PostgreSQL (recommended):**
```bash
npm install                    # installs pg (runtime) + jsdom (dev/tests)
cp .env.example .env           # optional: configure PORT / DATABASE_URL / ADMIN_PASSWORD
npm run db:init                # create the `predix` database + apply migrations
npm run db:import              # (optional) import existing JSON data from ./data
PREDIX_DB=pg npm start         # or set DATABASE_URL / standard PG* env vars
```
Connection env follows libpq conventions (`PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`,
`PGDATABASE`) or a single `DATABASE_URL`. Migrations auto-apply on boot.

**JSON-journal mode** (no PostgreSQL needed, unchanged legacy behavior): `npm start`.

```bash
node server.js          # → http://localhost:3000   (PORT env to change)
```

**Production:** `NODE_ENV=production` **refuses to start without `ADMIN_PASSWORD`** and warns
if you're still on the JSON store.

- **Sign up** with promo code **`WELCOME100`** → your account is credited **$100.00** instantly.
- Extra codes (redeem in Portfolio): `TOPUP25` ($25), `CRYPTO50` ($50) — one redemption per user each.
- **Referral program:** share your username as a code (or `/#/signup?ref=YOURNAME`) — both sides get **$10**.
- **Admin panel:** log in as `admin` with the password from `ADMIN_PASSWORD`
  (a dev-only default exists when unset — production startup refuses to run without it).

## What's implemented

| Area | Details |
|---|---|
| **Auth** | Signup/login (scrypt hashing), httpOnly cookie sessions, rate limiting, promo-code signup bonus, referrals, password change |
| **Matching engine** | One order book per market, price–time priority, limit & market orders, partial fills, resting orders with cash/share reserves, maker-price execution |
| **Kalshi trading model** | Buy YES / Sell YES / Buy NO / Sell NO through a single YES-denominated book. Four fill types: YES transfer, NO transfer, **pair mint** (two buyers fund $1) and **pair burn** ($1 released). Every pair fully collateralised — cash conserved to the cent |
| **Wallet & ledger** | Available/reserved balances, per-trade ledger with running balance, cost-basis tracking, realised/unrealised P&L |
| **External data feeds** | 🪙🪦 Real-world reference data, backend-only, zero new deps, one shared caching framework (per-key cache, TTL, LIVE/STALE windows, single-flight, never-throws). **Providers:** **CoinGecko** (Bitcoin / Ethereum USD prices; metadata `provider`, `assetId`, `currency`, `operator`, `targetValue`, `resolutionTime` — migration 004) and **Open-Meteo** (weather: temperature & precipitation only, by lat/lon; metadata `provider`, `latitude`, `longitude`, `metric`, `operator`, `targetValue`, `unit`, `resolutionTime` — migration 005). The market page shows the live external value with **source + location (weather) + last-updated + LIVE/STALE badge** and the resolution rule. The prediction probability is never derived from any feed — it stays 100% order-book. At resolution time a feed generates a **proposal only** (evidence = source + value + timestamp, stored immutably); an admin still confirms through the existing audited two-step resolution. Stale/unavailable data or a still-trading market blocks proposals entirely. No sports or stock feeds (yet) |
| **Simulated withdrawals** | 💸 **Play-money only** (no real payment rails). Users request withdrawals from their *available* balance (reserved trading funds are never touchable); the amount moves to a separate withdrawal escrow (`withdraw_reserved`, unspendable) while the request is `PENDING`. Admin approves → completes (paid out through the balanced double-entry ledger to an `equity:withdraw` sink) or rejects; users can cancel while pending. Cancel/reject refund the escrow. One active request per user, idempotency keys for retry-safe submissions, per-user locks + PG row locking make double withdrawals and negative balances impossible |
| **Settlement** | Admin resolves YES/NO → orders cancelled, reserves released, winning shares pay **$1 each** |
| **Market lifecycle** | open → halted / closed (auto at close time) → resolved, with admin controls |
| **Real-time data** | SSE: live order books, trade tape, price ticks, wallet/position updates, push notifications |
| **Market data** | Interactive line chart with crosshair tooltip (1H/24H/7D/ALL), 24h volume/high/low, day change, card sparklines, live ticker tape of top movers |
| **Watchlists** | Star any market, personal watchlist page, live sidebar count |
| **Notifications** | In-app notification center (bell): fills, settlements, promo/referral credits, security changes — with unread badge and mark-all-read |
| **Rewards program** | 1 point per $1 traded, four tiers (Bronze → Platinum) with progress bars and perks |
| **Referrals** | Per-user code, $10 for both sides, referral history |
| **Series / collections** | Related markets grouped (e.g. “IPL 2027 playoffs race”, “Crypto checkpoints · Oct 1”) |
| **Multi-outcome markets** | Markets with 3–8 options (“Who wins IPL 2027?”) — one order book per option, winner pays $1, losing YES and winning NO settle correctly. Admin creates them via comma-separated options |
| **Comments** | Live discussion thread per market (SSE-updated), 500-char limit |
| **Trading statistics** | Win rate, volume, realized P&L + P&L-over-time chart, streaks, best/worst settlements |
| **Achievements** | 12 unlockable badges (First Trade 🥉 → Whale 🐋) with automatic toasts |
| **Price alerts** | Per-market “notify above/below X¢” alerts, checked every 20s, fire into the notification center |
| **Dollar orders** | Order panel accepts share *or* dollar amounts (auto-converted) |
| **Dark mode** | Full dark theme, toggle in the top bar, persisted per browser |
| **Candlestick charts** | Line ↔ candle chart toggle with OHLC buckets per range |
| **Leaderboard windows** | All-time (equity) / This week / Today (volume) |
| **Public trader profiles** | `/trader/username` — stats, achievements, positions |
| **Related markets** | Same-series/category suggestions on market pages |
| **How-it-works / FAQ** | `/learn` page with basics, order mechanics and FAQ |
| **CSV export** | One-click trade-history download from Portfolio |
| **Liquidity** | 3 market-maker bots quote two-sided markets around drifting fair value and take resting human orders |
| **Resolution & settlement audit** | Every resolution is a two-step, publicly auditable event: admin proposes (preview of winning shares / payout / holders), then confirms. Each confirmed resolution permanently stores the winning outcome, resolver identity, timestamp, source, evidence/reference, notes and a **SHA-256 hash of the canonical evidence payload**, appended to an **immutable, hash-chained audit table** (store refuses updates/deletes; each record chains onto the previous hash). Settlement is extracted into a guarded, **idempotent** `settleMarket` — it refuses to run unless the market is closed+resolved with a hash-verified record, and re-running pays nothing twice. Markets carry `expectedResolutionTime` and `resolver`; `GET /api/markets/:slug/resolution` exposes the evidence and full audit history; `POST /api/admin/markets/:id/settle` re-drives settlement safely. The market page's Resolution card shows rule, source, closing + expected times, resolver, resolved outcome, evidence, notes and the verification hash |
| **PostgreSQL persistence** | `lib/store-pg.js` is a drop-in Postgres backend for the same synchronous Store interface — the engine, matching logic, invariants, SSE, bots and frontend are untouched. Every engine transaction is flushed to PostgreSQL as ONE SQL transaction (`BEGIN … COMMIT`); API responses are only sent after the commit. Schema (`migrations/001_init.sql`) enforces unique IDs, non-negative balances, valid order qty/price ranges (`1–99¢`, `0 ≤ filled ≤ origQty`), reserved ≤ owned shares, foreign keys across users/wallets/markets/orders/trades/positions, `UNIQUE(user_id, key)` idempotency keys and an append-only trigger on the hash-chained `resolutions` audit table. Money is BIGINT cents end-to-end (the adapter rejects non-integer money synchronously). Boot with `PREDIX_DB=pg` (or `DATABASE_URL`); migrations auto-apply. Without PG env the legacy JSON journal still works |
| **Premium UI (v7)** | Plus Jakarta Sans throughout, refreshed light/dark fintech palettes, glass topbar, layered hero gradient, unified button system with hover/pressed/loading states, refined order book depth + stat strip + trade panel + auth + tables (dark-mode row borders fixed), keyboard-friendly focus, `prefers-reduced-motion` support, and tightened tablet/mobile layouts — all via CSS tokens/layers with zero JS or markup hooks changed |
| **QA polish pass** | Verified demo-ready: all 16 routes render with zero console errors, every API edge returns the right status (404/400/401), auth forms have loading/disabled states with duplicate-submit protection and Enter-key submission from every field, friendly client-side validation before any request, keyboard `:focus-visible` outlines everywhere, empty states on every list, tables scroll on mobile, no dead code. `NODE_ENV=production` runs startup checks (default admin password + persistence warnings) |
| **Concurrency hardening** | Race-safe trading under load, three layers deep: (1) **per-key async mutex** (`lib/lock.js`) — mutating API handlers hold `u:<userId>` + `m:<marketId>` locks in sorted, deadlock-free order, so one wallet can never double-spend and one book can never match concurrently, while unrelated users/markets trade fully in parallel (no global lock); (2) **PostgreSQL row locking** — every flushed SQL transaction pre-locks all rows it touches with `SELECT … FOR UPDATE` (wallets, positions, orders, idem, markets) before writing; (3) **single-writer advisory lock** — a second Predix process booting on the same database is refused instantly (no split-brain double fills / double settlement). Idempotency uniqueness and settlement once-only pay are additionally backed by DB constraints, and cancel-vs-fill / fill-vs-fill consistency is enforced by the invariant checker after every operation |
| **Double-entry ledger** | `lib/ledger.js` — every money-moving event (credits, bot funding, order reserve/release, trade transfers, pair mint/burn collateral, settlement payouts) posts a balanced transaction to `ltx`/`lent` (PostgreSQL, BIGINT cents): total debits must equal total credits or the operation is refused *before* any state change, and a deferred COMMIT-time trigger refuses to commit unbalanced rows at the database level. Both tables are append-only (DB triggers + store guard). Accounts: `avail:<uid>`, `rsvd:<uid>`, `collat:<market>:<idx>` ($1 per outstanding pair), `equity:promo/botfunding/opening`. Entries reference orderId / tradeId / marketId / settlementId / userId. `reconcile()` proves wallets + reserves + collateral pools match the ledger exactly, every tx balances, and the whole ledger is zero-sum — run at boot, every 5 minutes, and after every test suite (a `bootstrap()` 'opening' transaction adopts pre-ledger balances on first activation) |
| **Order safety** | Production-style protections on `/api/orders`: **idempotency keys** (retried requests replay the exact original response — same order id, no duplicate execution; key reuse with a different order → 409), **IOC** (unfilled remainder killed, reserves released), **FOK** (pre-trade fillability scan incl. STP + available cash — all-or-nothing), **POST_ONLY** (rejected if it would immediately match, guaranteed maker otherwise), **explicit self-trade prevention** (`stp`: `skip` legacy default / `cancel_taker` kills the incoming order at your own resting order / `reject` refuses up front), market orders validated against live liquidity with zero stranded reserves, and a clear status model — `statusText`: OPEN / PARTIALLY_FILLED / FILLED / CANCELLED / REJECTED (legacy lowercase `status` preserved for compatibility) |
| **Runtime invariant checker** | `lib/invariants.js` — a reusable, read-only validator the engine runs after **every** order, trade batch, cancellation, credit, bot funding and settlement: wallets never negative, positions never negative, share/cash reserves exactly match resting orders, YES supply == NO supply per market+outcome, every minted pair stays fully collateralized (K = Σ balances + $1 × YES supply is conserved across all operations), unique trade/order IDs, filled ≤ order qty, book/index/disk consistency, and settlements never pay more than the market holds. Violations log loudly and abort the call with a 500 |
| **Randomized stress suite** | `tests/stress.test.js` — seeded PRNG, 14 users, 8 000 mixed Buy/Sell/Cancel/Credit/Settle ops (~2 000 real fills across all four fill types), invariant-checked after **every single operation** |
| **Pro market detail** | Exchange-style market page: live stat strip (best bid/ask, spread, mid · probability, last trade w/ time, 24h volume/range, liquidity = Σ resting value), stacked order book with YES/NO toggle (NO prices mirrored 100−p), depth bars, per-level qty + cumulative, click-to-load prices, spread/mid row, and a pre-trade summary (total cost, potential payout, potential profit, max loss, fee, cash-after) plus sell-side cost-basis & est. realized P&L |
| **Resolution transparency** | Every market page shows a 3-step resolution timeline (created → live status → close/settle), resolution source and rules |
| **Frontend** | Kalshi-inspired SPA (vanilla JS, no build step): sidebar navigation, categories, trending/new/ending-soon views, hero with live platform stats, search, market pages, portfolio, leaderboard, profile, admin |
| **Persistence** | PostgreSQL (transactions, constraints, FKs, immutable audit trigger, integer BIGINT cents) via `PREDIX_DB=pg`, or the original write-ahead JSONL journal + snapshot compaction — both survive restart, books included |

## Repo layout

```
prediction-market/
├── server.js          # HTTP server, static files, timers, wiring
├── lib/
│   ├── store.js       # durable storage: journal + snapshot, replay on boot
│   ├── auth.js        # scrypt passwords, sessions, cookies, promos
│   ├── engine.js      # matching engine, wallets, positions, ledger, settlement, notifications, rewards
│   ├── feed.js        # shared feed framework (cache/TTL/LIVE-STALE/single-flight) + CoinGecko & Open-Meteo providers, config validation, descriptors
│   ├── api.js         # REST routes + SSE endpoint
│   ├── hub.js         # SSE fan-out (public broadcasts + per-user events)
│   ├── bots.js        # market makers (liquidity)
│   └── seed.js        # admin, bots, promo codes, 18 starter markets, series/collections
├── public/            # index.html, styles.css, app.js  (the SPA)
├── lib/store-pg.js        # PostgreSQL persistence (same Store interface; SQL tx per engine tx)
├── lib/migrate.js         # migration runner (migrations/*.sql, tracked in schema_migrations)
├── migrations/001_init.sql # schema: constraints, FKs, unique idempotency keys, immutability trigger
├── scripts/migrate.js     # npm run db:init / db:migrate
├── scripts/import-json.js # npm run db:import — JSON store → PostgreSQL, verified
├── lib/ledger.js          # immutable double-entry ledger (balanced or refused; DB-level append-only)
├── migrations/002_ledger.sql # ltx/lent tables, append-only triggers, COMMIT-time balance constraint
├── migrations/003_withdrawals.sql # wallets.withdraw_reserved + withdrawals table (statuses, idempotency index)
├── migrations/004_market_feeds.sql # markets.provider/asset_id/currency/operator/target_value/feed_resolution_time
├── migrations/005_market_weather.sql # markets.latitude/longitude/metric/unit (Open-Meteo weather feeds)
├── lib/invariants.js      # reusable invariant checker (runs inside the engine after every mutation)
├── tests/engine.test.js   # 37 assertions: fill types, conservation, restarts, settlement
├── tests/multi.test.js    # 11 assertions: multi-outcome mint/transfer/settlement
├── tests/stress.test.js   # 8 000 randomized ops, invariant-checked after each one
├── tests/safety.test.js   # idempotency / IOC / FOK / post-only / STP / status model
├── tests/resolution.test.js # two-step resolution, audit immutability, evidence hashing, idempotent settlement
└── data/              # runtime DB (created automatically)
```

## API overview

```
POST /api/auth/signup        {username,email,password,promo,ref}    → user + wallet (+promo +referral)
POST /api/auth/login         {identifier,password}                  → session cookie
GET  /api/me                 → user + snapshot + rewards + unread + watch count
POST /api/me/password        {current,next}
GET  /api/me/notifications   → latest 50 + unread count
POST /api/me/notifications/read
GET  /api/markets            ?category=&q=&sort=                    → summaries + spark data
GET  /api/markets/:slug      → market + history + book + trades + your position/orders
POST /api/orders             {market,side,outcome,type,price,qty}
POST /api/orders/:id/cancel
GET  /api/portfolio          → wallet, marked positions, open orders, trades, ledger, rewards
GET  /api/price?asset=bitcoin|ethereum → cached CoinGecko quote (value, source, status LIVE/STALE, fetchedAt) — backend-fetched, play-money reference data
GET  /api/weather?lat=18.52&lon=73.86&metric=temperature&unit=celsius → cached Open-Meteo weather reading (temperature/precipitation only)
POST /api/admin/markets/:id/feed-refresh → force-refresh a market's feed + (re)generate its resolution proposal (blocked if stale/unavailable/still trading)
GET  /api/withdrawals        → withdrawable balance + withdrawal history (play money, demo only)
POST /api/withdrawals        → request withdrawal { amountCents, idemKey } (from available only; one active at a time)
POST /api/withdrawals/:id/cancel → user cancels a PENDING request (escrow refunded)
GET  /api/admin/withdrawals  → admin desk: all requests + status counts
POST /api/admin/withdrawals/:id/approve|reject|complete → admin review; reject refunds, complete pays out via ledger
POST /api/promo/redeem       {code}
GET  /api/watchlist          → watched markets
POST /api/watchlist/toggle   {marketId}
GET  /api/stats              → public platform stats (hero)
GET  /api/leaderboard
GET  /api/events             → SSE stream (init | mkt | book | trade | user | notify)
POST /api/admin/markets      (admin) create market
POST /api/admin/markets/:id/{halt|open|resolve}   (admin) lifecycle
```

## Order model (quick reference)

Prices are integer **cents (1–99)** = implied probability. Each market has a YES and a NO
contract; **NO price = 100 − YES price**. Order kinds:

| You say | Engine kind | Rests on | Meaning |
|---|---|---|---|
| Buy YES @ p | `BY` | bid @ p | pay p¢, receive 1 YES per share |
| Sell YES @ p | `SY` | ask @ p | need YES shares, receive p¢ |
| Buy NO @ q | `BN` | ask @ 100−q | pay q¢, receive 1 NO per share |
| Sell NO @ q | `SN` | bid @ 100−q | need NO shares, receive q¢ |

Any bid × ask combination is a valid trade (YES transfer / NO transfer / mint / burn).
Buys reserve cash at the limit price; sells reserve shares. Takers get price improvement at
the maker's price. No self-matching. All money math is integer cents.

## Tests

```bash
npm test    # runs every suite below in order (all 13)
```
Every suite runs against an isolated, freshly-migrated PostgreSQL test database (set
`PGHOST`/`PGUSER`/`PGPASSWORD` as needed; `PREDIX_TEST_STORE=json` runs the legacy store
instead). The two UI suites (`qa`, `md`) drive a real browser DOM via jsdom against a running
server — start `npm start` first, otherwise they report `SKIPPED` (exit 0) so CI stays green.

```bash
node tests/engine.test.js   # 37 engine assertions (fill types, conservation, restart, settlement)
node tests/multi.test.js    # 11 multi-outcome assertions (mint/transfer/settlement, collateral conservation)
node tests/stress.test.js   # randomized: 8 000 ops (incl. IOC/FOK/POST_ONLY/STP/idempotent retries), invariants verified after every operation
node tests/safety.test.js   # 73 order-safety assertions: idempotency, IOC, FOK, post-only, STP, statuses
node tests/resolution.test.js # 51 resolution/settlement assertions: guards, hashing, immutability, idempotency
node tests/pg.test.js         # 25 PostgreSQL assertions: constraints, FKs, immutability trigger, atomicity, import, reload
node tests/feed.test.js        # 46 CoinGecko-feed assertions (fully offline via injected fetch): parse/cache/TTL/staleness/single-flight, operator validation, BTC/ETH-only curation, proposal lifecycle (waiting → ready/blocked), stale & unavailable blocks, evidence (source+value+timestamp) through the audited resolve path, feedTick batching, invariants + ledger reconciliation
node tests/weather.test.js     # 56 Open-Meteo weather assertions (fully offline): URL/unit parameters, cache/staleness/single-flight reuse of the shared framework, lat/lon/metric/unit validation, weather proposal lifecycle, stale/unavailable blocks, evidence through the audited resolve path, mixed-provider feedTick, invariants + reconciliation (fully offline via injected fetch): parse/cache/TTL/staleness/single-flight, operator validation, BTC/ETH-only curation, proposal lifecycle (waiting → ready/blocked), stale & unavailable blocks, evidence (source+value+timestamp) through the audited resolve path, feedTick batching, invariants + ledger reconciliation
node tests/withdrawal.test.js # 49 simulated-withdrawal assertions: request/escrow, insufficient funds, idempotent replays, cancel, reject, approve→complete payout, W3/W5 coexistence, 8-way race, lifecycle storm + full reconciliation
node tests/ledger.test.js     # 36 double-entry assertions: balanced trades, reserve/release, mint/burn, settlement, tamper attempts, storm + full reconciliation
node tests/concurrency.test.js # 57 concurrency assertions: same-wallet storms, taker storms vs one maker, cancel-vs-fill, settlement storms, idem storms, cross-market, writer lock
node tests/qa.test.js        # 13 UX assertions: auth loading states, Enter-key submit, validation messages, logout, production startup checks
node tests/md.test.js       # 33 market-detail e2e checks (needs the server running + `npm i jsdom`)
```

`tests/md.test.js` drives the real UI in jsdom against the live server: signs up + logs in through
the real API, opens a market, verifies every stat-strip number against the book API (bid/ask/spread/
mid), checks the YES⇄NO mirrored book view, the resolution timeline and the pre-trade summary
(cost/payout/profit/max loss), then **places a real order that fills against the real book** and
asserts the wallet debit and resulting position. It also smoke-tests all main views.

## Design notes

- **Typography & look:** Inter (via Google Fonts, with system fallback), light neutral theme,
  white cards, black primary actions, green YES / red NO — inspired by modern exchange design
  (Kalshi/Polymarket). No proprietary assets are copied.
- **Architecture vs. the design doc:** Kafka/Redis/K8s collapsed into an in-process event hub +
  journal store so the whole exchange runs as one dependency-free Node process; domain logic
  (engine, ledger, lifecycle) is isolated in `lib/` and maps 1:1 to the doc's service boundaries
  if you later split it out.
- **Phase coverage:** Phase 1–2 complete; Phase 3 largely done (categories, search, collections,
  notifications, multi-outcome markets, discussion). Oracle auto-resolution, stop orders and
  real money (KYC/AML, payments, fund segregation) remain future work / out of scope.

## Compliance note (from the design doc)

Operating a real-money prediction market requires CFTC/SEC/state-by-state legal review, DCM/DCO
or partner licensing, KYC/AML, geofencing and fund segregation. This codebase is a technology
demo / play-money platform and must not be used with real money without that legal work.
