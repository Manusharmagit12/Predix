'use strict';
/**
 * Engine — order matching, wallets, positions, ledger, settlement.
 *
 * Model (Kalshi-style): every market is binary with a YES and a NO contract
 * that each pay $1 at resolution (winner) / $0 (loser). Prices are integer
 * cents 1..99 and are the market's implied probability.
 *
 * A single, YES-denominated order book per market. Four order kinds:
 *   BY — buy YES   (rests on BIDS at p)   pays p per share,   receives YES
 *   SY — sell YES  (rests on ASKS at p)   needs YES shares,   receives p
 *   BN — buy NO    (rests on ASKS at 100-q) pays q per share, receives NO
 *   SN — sell NO   (rests on BIDS at 100-q) needs NO shares,  receives q
 *
 * All four bid×ask combinations are valid trades:
 *   BY×SY — YES share transfer      BY×BN — pair minted (both sides fund $1)
 *   SN×SY — pair burned ($1 freed)  SN×BN — NO share transfer
 * Execution happens at the resting (maker) price. Price-time priority.
 * Money conservation: every outstanding share pair is backed by exactly $1.
 */
const crypto = require('crypto');
const { ApiError } = require('./auth');
const { checkEngine } = require('./invariants');
const { Ledger } = require('./ledger');
const { CoinGeckoFeed, OpenMeteoFeed, OPERATORS, operatorText, assetMeta, describeFeed } = require('./feed');

const MAX_QTY = 5000;
const KIND_MAP = { buy_yes: 'BY', sell_yes: 'SY', buy_no: 'BN', sell_no: 'SN' };

const REWARD_TIERS = [
  { name: 'Bronze', min: 0, perk: 'Standard rewards rate' },
  { name: 'Silver', min: 2000, perk: '1.25× rewards rate' },
  { name: 'Gold', min: 10000, perk: '1.5× rewards + badge on leaderboard' },
  { name: 'Platinum', min: 50000, perk: '2× rewards + priority support' },
];

class Engine {
  constructor(db, hub) {
    this.db = db;
    this.hub = hub;
    this.books = new Map();       // bookKey -> {bids:[], asks:[]}
    this.orderIndex = new Map();  // orderId -> order row (open only)
    this.tape = new Map();        // bookKey -> [{ts, price, qty}] recent trades
    this.lastByBook = new Map();  // bookKey -> last trade price (multi-outcome books)
    this.ledger = new Ledger(db);  // immutable double-entry ledger (balanced or refused)
    this.feeds = new CoinGeckoFeed(); // crypto price provider (CoinGecko) — cached, never throws; tests may swap this
    this.weather = new OpenMeteoFeed(); // weather provider (Open-Meteo) — same caching framework; tests may swap this
    this.auditEnabled = true;     // run invariant checks after every mutation
    this.kExpected = null;        // lazy baseline for cash/collateral conservation (C1)
  }

  /* ============ invariant audit (post-commit, fail-loud) ============
     Runs the reusable checker in lib/invariants.js after every order,
                     trade/fill batch, cancellation, credit, bot funding
                     and settlement. Audits run AFTER the journal commit:
                     the store cannot roll back in-memory state, so a
                     violation must never abort mid-transaction. */
  _audit(event, ctx = {}) {
    if (!this.auditEnabled) return [];
    const { violations, k } = checkEngine(this, ctx);
    if (this.kExpected === null) this.kExpected = k; // first audit = baseline
    else if (ctx.kExpected !== undefined && ctx.kExpected !== null && k !== ctx.kExpected) {
      violations.push(`C1 cash/collateral NOT conserved after ${event}: K=${k}, expected ${ctx.kExpected}`);
    }
    if (violations.length) {
      const msg = `INVARIANT VIOLATION after ${event}: ${violations.join(' | ')}`;
      console.error('‼️  ' + msg);
      throw new ApiError(500, 'Internal consistency check failed: ' + violations[0]);
    }
    return violations;
  }

  /* ============ book keys: binary keeps legacy key (back-compat), multi uses market:idx ============ */
  static bookKey(marketId, idx) { return idx ? `${marketId}:${idx}` : String(marketId); }
  bookKeyOf(o) { return Engine.bookKey(o.marketId, o.outcomeIdx || 0); }

  /* ================= boot ================= */

  rebuild() {
    const dayAgo = Date.now() - 24 * 3600 * 1000;
    this.books.clear();
    this.orderIndex.clear();
    this.tape.clear();
    for (const w of this.db.all('wallets')) if (w.withdrawReserved === undefined) w.withdrawReserved = 0; // memory-only normalization (no write)
    for (const o of this.db.all('orders')) {
      if (o.status !== 'open') continue;
      const b = this._book(o.marketId, o.outcomeIdx || 0);
      this._sortedInsert(b, o);
      this.orderIndex.set(o.id, o);
    }
    for (const t of this.db.all('trades')) {
      if (t.ts < dayAgo) continue;
      const key = Engine.bookKey(t.marketId, t.outcomeIdx || 0);
      const arr = this.tape.get(key) || [];
      arr.push({ ts: t.ts, price: t.price, qty: t.qty });
      this.tape.set(key, arr);
      if (t.outcomeIdx) this.lastByBook.set(key, t.price);
    }
  }

  _book(marketId, idx = 0) {
    const key = Engine.bookKey(marketId, idx);
    let b = this.books.get(key);
    if (!b) { b = { bids: [], asks: [] }; this.books.set(key, b); }
    return b;
  }

  _sortedInsert(book, order) {
    const arr = (order.kind === 'BY' || order.kind === 'SN') ? book.bids : book.asks;
    const bidSide = arr === book.bids;
    let i = 0;
    while (i < arr.length) {
      const better = bidSide
        ? (arr[i].price > order.price || (arr[i].price === order.price && arr[i].createdAt <= order.createdAt))
        : (arr[i].price < order.price || (arr[i].price === order.price && arr[i].createdAt <= order.createdAt));
      if (better) i++; else break;
    }
    arr.splice(i, 0, order);
  }

  _removeFromBook(order) {
    const key = this.bookKeyOf(order);
    const b = this.books.get(key);
    if (!b) return;
    b.bids = b.bids.filter((o) => o.id !== order.id);
    b.asks = b.asks.filter((o) => o.id !== order.id);
  }

  /* ================= helpers ================= */

  _wallet(userId) {
    let w = this.db.findOne('wallets', (r) => r.userId === userId);
    if (!w) w = this.db.insert('wallets', { userId, available: 0, reserved: 0, withdrawReserved: 0 });
    if (w.withdrawReserved === undefined) w.withdrawReserved = 0;
    return w;
  }

  _position(userId, marketId, idx = 0) {
    let p = this.db.findOne('positions', (r) => r.userId === userId && r.marketId === marketId && (r.outcomeIdx || 0) === idx);
    if (!p) {
      p = this.db.insert('positions', {
        userId, marketId, outcomeIdx: idx, yesQty: 0, noQty: 0, yesCost: 0, noCost: 0,
        yesAvg: 0, noAvg: 0, yesReserved: 0, noReserved: 0,
      });
    }
    return p;
  }

  _ledger(userId, type, amount, balanceAfter, refType, refId, memo) {
    const user = this.db.get('users', userId);
    if (user && user.role === 'bot') return; // keep the ledger human-readable
    this.db.insert('ledger', {
      userId, type, amount: Math.round(amount), balanceAfter: Math.round(balanceAfter),
      refType, refId: refId || null, memo: memo || '', ts: Date.now(),
    });
  }

  mark(marketId, idx = 0) {
    const m = this.db.findOne('markets', (r) => r.id === marketId);
    if (!m) return null;
    if (m.outcomes && m.outcomes.length > 2) {
      if (this.lastByBook.has(Engine.bookKey(marketId, idx))) return this.lastByBook.get(Engine.bookKey(marketId, idx));
      const b = this.books.get(Engine.bookKey(marketId, idx));
      if (b && b.bids.length && b.asks.length) return Math.round((b.bids[0].price + b.asks[0].price) / 2);
      if (b && b.bids.length) return b.bids[0].price;
      if (b && b.asks.length) return b.asks[0].price;
      const opt = (m.outcomes || [])[idx];
      return opt && typeof opt.base === 'number' ? opt.base : null;
    }
    if (typeof m.last === 'number') return m.last;
    const b = this.books.get(Engine.bookKey(marketId, 0));
    if (b && b.bids.length && b.asks.length) return Math.round((b.bids[0].price + b.asks[0].price) / 2);
    if (b && b.bids.length) return b.bids[0].price;
    if (b && b.asks.length) return b.asks[0].price;
    return null;
  }

  /* ================= notifications & rewards ================= */

  notify(userId, type, title, body) {
    const u = this.db.get('users', userId);
    if (!u || u.role === 'bot') return;
    this.db.insert('notifications', { userId, type, title, body: body || '', ts: Date.now(), read: false });
    this.hub.sendUser(userId, 'notify', { type, title, body: body || '', ts: Date.now() });
  }

  /* ================= achievements ================= */

  static ACHIEVEMENTS = [
    { code: 'FIRST_TRADE', icon: '🥉', name: 'First Trade', desc: 'Place your first order' },
    { code: 'TEN_TRADES', icon: '🎯', name: 'Getting Busy', desc: 'Place 10 orders' },
    { code: 'FIFTY_TRADES', icon: '💥', name: 'Power Trader', desc: 'Place 50 orders' },
    { code: 'FIRST_WIN', icon: '🏆', name: 'First Win', desc: 'Win a market settlement' },
    { code: 'STREAK_3', icon: '🔥', name: 'On a Roll', desc: 'Win 3 settlements in a row' },
    { code: 'SNIPER', icon: '🎖️', name: 'Sniper', desc: 'Win with an average cost under 10¢' },
    { code: 'HIGH_ROLLER', icon: '💰', name: 'High Roller', desc: 'Place a single order worth $50+' },
    { code: 'WHALE', icon: '🐋', name: 'Whale', desc: 'Place a single order worth $200+' },
    { code: 'RICH', icon: '👑', name: 'Half K Club', desc: 'Reach $500 equity' },
    { code: 'SOCIAL', icon: '💬', name: 'Voice of the Market', desc: 'Post your first comment' },
    { code: 'WATCHER', icon: '⭐', name: 'Watcher', desc: 'Add your first watchlist market' },
    { code: 'DIVERSIFIED', icon: '🌱', name: 'Diversified', desc: 'Hold positions in 3+ markets at once' },
  ];

  hasAchievement(uid, code) {
    return !!this.db.findOne('achievements', (a) => a.userId === uid && a.code === code);
  }

  checkAchievements(uid) {
    const u = this.db.get('users', uid);
    if (!u || u.role === 'bot') return [];
    const earned = [];
    const grant = (code) => {
      if (this.hasAchievement(uid, code)) return;
      const meta = Engine.ACHIEVEMENTS.find((a) => a.code === code);
      if (!meta) return;
      this.db.insert('achievements', { userId: uid, code, ts: Date.now() });
      this.notify(uid, 'achievement', `Achievement unlocked: ${meta.icon} ${meta.name}`, meta.desc);
      earned.push(meta);
    };

    const orders = this.db.find('orders', (o) => o.userId === uid);
    if (orders.length >= 1) grant('FIRST_TRADE');
    if (orders.length >= 10) grant('TEN_TRADES');
    if (orders.length >= 50) grant('FIFTY_TRADES');
    for (const o of orders) {
      if (o.type === 'limit' && o.userPrice && o.origQty * o.userPrice >= 5000) { grant('HIGH_ROLLER'); break; }
    }
    for (const o of orders) {
      if (o.type === 'limit' && o.userPrice && o.origQty * o.userPrice >= 20000) { grant('WHALE'); break; }
    }

    const settled = this.db.find('settled', (s) => s.userId === uid).sort((a, b) => a.ts - b.ts);
    if (settled.some((s) => s.win)) grant('FIRST_WIN');
    if (settled.some((s) => s.win && s.cost > 0 && (s.payout - s.cost) / Math.max(1, s.yesQty + s.noQty) >= 90)) grant('SNIPER');
    let streak = 0, best = 0;
    for (const s of settled) { streak = s.win ? streak + 1 : 0; best = Math.max(best, streak); }
    if (best >= 3) grant('STREAK_3');

    const w = this._wallet(uid);
    let posVal = 0;
    for (const p of this.db.find('positions', (r) => r.userId === uid)) {
      const mk = this.mark(p.marketId, p.outcomeIdx || 0);
      if (mk !== null) posVal += p.yesQty * mk + p.noQty * (100 - mk);
    }
    if (w.available + w.reserved + posVal >= 50000) grant('RICH');
    const distinctMarkets = new Set(this.db.find('positions', (r) => r.userId === uid && (r.yesQty > 0 || r.noQty > 0)).map((p) => p.marketId));
    if (distinctMarkets.size >= 3) grant('DIVERSIFIED');

    if (this.db.findOne('comments', (c) => c.userId === uid)) grant('SOCIAL');
    if (this.db.findOne('watchlist', (c) => c.userId === uid)) grant('WATCHER');
    return earned;
  }

  achievementsFor(uid) {
    const has = new Set(this.db.find('achievements', (a) => a.userId === uid).map((a) => a.code));
    return Engine.ACHIEVEMENTS.map((a) => ({ ...a, earned: has.has(a.code), ts: undefined }));
  }

  /* ================= trading stats ================= */

  statsFor(uid) {
    const trades = this.db.find('trades', (t) => t.takerUserId === uid || t.makerUserId === uid);
    let volume = 0, buys = 0, sells = 0;
    for (const t of trades) { volume += t.price * t.qty; if (t.takerUserId === uid) { (t.takerKind === 'BY' || t.takerKind === 'BN') ? buys++ : sells++; } }
    const settled = this.db.find('settled', (s) => s.userId === uid).sort((a, b) => a.ts - b.ts);
    const wins = settled.filter((s) => s.win);
    let streak = 0;
    for (let i = settled.length - 1; i >= 0; i--) { if (settled[i].win) streak++; else break; }
    let bestWin = null, worstLoss = null;
    for (const s of settled) {
      const net = s.payout - s.cost;
      if (net > 0 && (bestWin === null || net > bestWin.net)) {
        const m = this.db.get('markets', s.marketId);
        bestWin = { net, title: m ? m.title : 'Market' };
      }
      if (net < 0 && (worstLoss === null || net < worstLoss.net)) {
        const m = this.db.get('markets', s.marketId);
        worstLoss = { net, title: m ? m.title : 'Market' };
      }
    }
    // realized P&L series (daily cumulative) from the ledger
    const ledger = this.db.find('ledger', (l) => l.userId === uid && (l.type === 'trade' || l.type === 'settlement'))
      .sort((a, b) => a.id - b.id);
    let cum = 0;
    const series = ledger.map((l) => {
      cum += l.amount;
      return { ts: l.ts, cum };
    });
    const realized = cum;
    return {
      tradeCount: trades.length, volume, buys, sells,
      settledCount: settled.length, winCount: wins.length,
      winRate: settled.length ? +(100 * wins.length / settled.length).toFixed(1) : null,
      streak, bestWin, worstLoss, realized, series,
    };
  }

  /* ================= price alerts ================= */

  checkAlerts() {
    const rows = this.db.find('alerts', (a) => a.status === 'active');
    for (const a of rows) {
      const price = this.mark(a.marketId, a.outcomeIdx || 0);
      if (price === null || price === undefined) continue;
      const hit = (a.dir === 'above' && price >= a.price) || (a.dir === 'below' && price <= a.price);
      if (!hit) continue;
      a.status = 'triggered';
      a.triggeredAt = Date.now();
      a.triggerPrice = price;
      this.db.update('alerts', a);
      const m = this.db.get('markets', a.marketId);
      const label = m && m.outcomes && m.outcomes[a.outcomeIdx] ? ` — ${m.outcomes[a.outcomeIdx].label}` : '';
      this.notify(a.userId, 'alert', `🔔 Price alert triggered${label}`,
        `${m ? m.title.slice(0, 80) : 'Market'} crossed ${a.price}¢ (now ${price}¢).`);
      this.hub.sendUser(a.userId, 'user', this.userSnapshot(a.userId));
    }
  }

  /* ================= market data ================= */

  rewardsFor(uid) {
    let notional = 0;
    for (const t of this.db.all('trades')) {
      if (t.takerUserId === uid || t.makerUserId === uid) notional += t.price * t.qty;
    }
    const points = Math.floor(notional / 100); // 1 reward point per $1 traded
    let tier = REWARD_TIERS[0], next = null;
    for (let i = REWARD_TIERS.length - 1; i >= 0; i--) {
      if (points >= REWARD_TIERS[i].min) { tier = REWARD_TIERS[i]; next = REWARD_TIERS[i + 1] || null; break; }
    }
    return { points, tier: tier.name, perk: tier.perk, next: next ? next.name : null, nextAt: next ? next.min : null };
  }

  /* ================= market data ================= */

  summary(market) {
    const now = Date.now();
    const multi = market.outcomes && market.outcomes.length > 2;
    const keys = multi ? market.outcomes.map((_, i) => Engine.bookKey(market.id, i)) : [String(market.id)];
    let vol24 = 0, hi = null, lo = null, last = null, bid = null, ask = null;
    for (const key of keys) {
      const tape = (this.tape.get(key) || []).filter((t) => t.ts > now - 24 * 3600 * 1000);
      this.tape.set(key, tape);
      for (const t of tape) {
        vol24 += t.qty;
        if (hi === null || t.price > hi) hi = t.price;
        if (lo === null || t.price < lo) lo = t.price;
      }
      const b = this.books.get(key);
      if (b && b.bids.length && (bid === null || b.bids[0].price > (multi ? bid : -1))) {
        if (multi || bid === null) bid = b.bids[0].price;
      }
      if (b && b.asks.length && (ask === null || (!multi && true))) {
        if (!multi && ask === null) ask = b.asks[0].price;
        else if (!multi) ask = b.asks[0].price;
      }
      if (multi) {
        const l = this.lastByBook.get(key);
        if (l !== undefined && (last === null || l > last)) last = l;
      }
    }
    if (!multi) {
      last = typeof market.last === 'number' ? market.last : null;
      const b = this.books.get(String(market.id));
      bid = b && b.bids.length ? b.bids[0].price : null;
      ask = b && b.asks.length ? b.asks[0].price : null;
    } else {
      // front-runner's book bid/ask
      if (last !== null) {
        const fr = market.outcomes.map((_, i) => i).find((i) => this.lastByBook.get(Engine.bookKey(market.id, i)) === last);
        if (fr !== undefined) {
          const b = this.books.get(Engine.bookKey(market.id, fr));
          bid = b && b.bids.length ? b.bids[0].price : null;
          ask = b && b.asks.length ? b.asks[0].price : null;
        }
      }
    }
    // reference price ~24h ago for the day-change indicator (binary only)
    let change = null, changePct = null;
    if (!multi) {
      const hist = this.db.histFor(market.id);
      const cutoff = now - 24 * 3600 * 1000;
      let ref = null;
      if (hist.length) {
        ref = hist[0][1];
        for (let i = hist.length - 1; i >= 0; i--) {
          if (hist[i][0] <= cutoff) { ref = hist[i][1]; break; }
          ref = hist[i][1];
        }
      }
      if (last !== null && ref !== null) {
        change = last - ref;
        changePct = ref ? +(100 * change / ref).toFixed(2) : null;
      }
    }
    return { last, bid, ask, vol24, high24: hi, low24: lo, change, changePct };
  }

  marketBook(marketId, idx = 0) {
    const b = this.books.get(Engine.bookKey(marketId, idx)) || { bids: [], asks: [] };
    const botIds = new Set(this.db.find('users', (u) => u.role === 'bot').map((u) => u.id));
    const shape = (arr, label) => {
      let cum = 0;
      return arr.map((o) => {
        cum += o.qty;
        return {
          price: o.price, qty: o.qty, cum,
          kind: o.kind, userPrice: o.kind === 'BY' || o.kind === 'SY' ? o.price : 100 - o.price,
          isBot: botIds.has(o.userId),
          label,
        };
      });
    };
    return { bids: shape(b.bids, 'bid'), asks: shape(b.asks, 'ask') };
  }

  /* ================= order entry ================= */

  place(user, market, input) {
    const { side, outcome, type, price, qty } = input;
    if (market.status !== 'open') {
      throw new ApiError(423, market.status === 'halted' ? 'Trading is halted on this market.' : 'This market is not open for trading.');
    }
    const multi = !!(market.outcomes && market.outcomes.length > 2);
    let outcomeIdx = Number(input.outcomeIdx || 0) || 0;
    if (multi && (!Number.isInteger(outcomeIdx) || outcomeIdx < 0 || outcomeIdx >= market.outcomes.length)) {
      throw new ApiError(400, 'Invalid outcome.');
    }
    if (!multi) outcomeIdx = 0;
    const q = Number(qty);
    if (!Number.isInteger(q) || q < 1 || q > MAX_QTY) throw new ApiError(400, `Quantity must be a whole number between 1 and ${MAX_QTY}.`);
    if (!['buy', 'sell'].includes(side) || !['yes', 'no'].includes(outcome)) throw new ApiError(400, 'Invalid side/outcome.');
    if (!['limit', 'market'].includes(type)) throw new ApiError(400, 'Invalid order type.');
    let p = null;
    if (type === 'limit') {
      p = Number(price);
      if (!Number.isInteger(p) || p < 1 || p > 99) throw new ApiError(400, 'Price must be a whole number between 1¢ and 99¢.');
    }
    const tif = type === 'limit' ? String(input.tif || 'GTC').toUpperCase() : null;
    if (type === 'limit' && !['GTC', 'IOC', 'FOK', 'POST_ONLY'].includes(tif)) {
      throw new ApiError(400, 'Invalid time-in-force (GTC, IOC, FOK, POST_ONLY).');
    }
    const stp = String(input.stp || 'skip').toLowerCase();
    if (!['skip', 'cancel_taker', 'reject'].includes(stp)) {
      throw new ApiError(400, 'Invalid self-trade prevention mode (skip, cancel_taker, reject).');
    }
    // idempotency: a retried request with the same key replays the exact original response
    const idemKey = input.idemKey ? String(input.idemKey).slice(0, 80) : null;
    const idemFp = idemKey
      ? JSON.stringify([user.id, market.id, side, outcome, outcomeIdx, type, tif, stp, type === 'limit' ? p : null, q])
      : null;
    if (idemKey) {
      const prev = (this.db.all('idem') || []).find((r) => r.userId === user.id && r.key === idemKey);
      if (prev) {
        if (prev.fp !== idemFp) throw new ApiError(409, 'Idempotency key reused with a different order.');
        return JSON.parse(JSON.stringify(prev.response)); // no new order, no side effects
      }
    }
    const kind = KIND_MAP[`${side}_${outcome}`];
    const isBidKind = kind === 'BY' || kind === 'SN';       // BY, SN rest on bids
    const isYesSpace = kind === 'BY' || kind === 'SY';      // BY, SY are quoted in YES cents
    const limitYes = type === 'market' ? (isBidKind ? 99 : 1) : (isYesSpace ? p : 100 - p);
    // for BUY orders the reserve basis is the price in the order's own space
    const basis = (side === 'buy' && type === 'limit') ? p : null;
    const now = Date.now();

    const result = this.db.tx(() => {
      // limit buys must be fully fundable up front (Kalshi-style)
      if (side === 'buy' && type === 'limit') {
        const w = this._wallet(user.id);
        if (basis * q > w.available) {
          throw new ApiError(400, `Insufficient funds — this order costs $${(basis * q / 100).toFixed(2)} at your limit price, you have $${(w.available / 100).toFixed(2)}.`);
        }
      }
      // ---- order-safety pre-checks: post-only, FOK, STP-reject ----
      if (type === 'limit') {
        const book = this._book(market.id, outcomeIdx);
        const spec = { userId: user.id, kind, price: limitYes, qty: q, stp };
        let why = null;
        if (tif === 'POST_ONLY' && this._wouldMatch(book, spec)) why = 'Post-only order would immediately match — rejected.';
        else if (tif === 'FOK' && this._fillable(book, spec, this._wallet(user.id).available) < q) why = 'FOK not fully fillable — killed.';
        else if (stp === 'reject' && this._crossesSelf(book, spec)) why = 'Self-trade prevention — order rejected.';
        if (why) {
          const ro = this.db.insert('orders', {
            userId: user.id, marketId: market.id, outcomeIdx, kind, type,
            price: limitYes, userPrice: p, basis: null,
            qty: q, origQty: q, filled: 0, notional: 0,
            status: 'rejected', note: why, tif, stp, idemKey,
            createdAt: now, updatedAt: now,
          });
          return { order: this._publicOrder(ro), trades: [] };
        }
      }

      // sellers must own free (unreserved) shares — reserve them now
      if (side === 'sell') {
        const pos = this._position(user.id, market.id, outcomeIdx);
        if (outcome === 'yes') {
          if (pos.yesQty - pos.yesReserved < q) throw new ApiError(400, `You only have ${pos.yesQty - pos.yesReserved} free YES shares.`);
          pos.yesReserved += q; this.db.update('positions', pos);
        } else {
          if (pos.noQty - pos.noReserved < q) throw new ApiError(400, `You only have ${pos.noQty - pos.noReserved} free NO shares.`);
          pos.noReserved += q; this.db.update('positions', pos);
        }
      }

      const order = this.db.insert('orders', {
        userId: user.id, marketId: market.id, outcomeIdx, kind, type,
        price: limitYes,                 // yes-space limit
        userPrice: type === 'limit' ? p : null, // price as the user entered it (own space)
        basis,                            // per-share cash reserve basis for resting BUY orders
        qty: q, origQty: q, filled: 0, notional: 0,
        status: 'open', tif, stp, idemKey,
        createdAt: now, updatedAt: now,
      });

      const trades = this._matchTaker(market, order);
      const stpHit = !!order.stpHit; delete order.stpHit; // transient — never journaled

      if (order.qty > 0) {
        if (type === 'limit') {
          const kill = tif === 'IOC' || stpHit; // IOC and STP cancel-taker never rest a remainder
          if (kill) {
            if (side === 'sell') { // release the remainder's share reserve
              const pos = this._position(user.id, market.id, outcomeIdx);
              if (outcome === 'yes') pos.yesReserved = Math.max(0, pos.yesReserved - order.qty);
              else pos.noReserved = Math.max(0, pos.noReserved - order.qty);
              this.db.update('positions', pos);
            }
            order.status = 'canceled';
            order.note = stpHit ? 'Self-trade prevention — remaining order canceled.' : 'IOC — unfilled remainder canceled.';
            order.updatedAt = Date.now();
          } else {
            if (side === 'buy') {
              const w = this._wallet(user.id);
              const cost = basis * order.qty;
              if (w.available < cost) {
                order.status = 'canceled';
                order.note = w.available >= basis ? 'Insufficient funds for the unfilled remainder.' : 'Insufficient funds.';
                order.updatedAt = Date.now();
                this.db.update('orders', order);
              } else {
                w.available -= cost; w.reserved += cost;
                this.db.update('wallets', w);
                this.ledger.post('reserve',
                  [{ a: `avail:${user.id}`, d: cost }, { a: `rsvd:${user.id}`, c: cost }],
                  { orderId: order.id, marketId: market.id, userId: user.id, memo: `reserve ${order.qty} × ${basis}¢` });
              }
            }
            if (order.status === 'open') {
              this._sortedInsert(this._book(market.id, outcomeIdx), order);
              this.orderIndex.set(order.id, order);
            }
          }
        } else {
          if (side === 'sell') { // market orders never rest — release the unfilled remainder's share reserve
            const pos = this._position(user.id, market.id, outcomeIdx);
            if (outcome === 'yes') pos.yesReserved = Math.max(0, pos.yesReserved - order.qty);
            else pos.noReserved = Math.max(0, pos.noReserved - order.qty);
            this.db.update('positions', pos);
          }
          order.status = 'canceled';
          order.note = order.filled > 0 ? 'Market order — unfilled remainder canceled.' : 'No liquidity available.';
          order.updatedAt = Date.now();
        }
      } else {
        order.status = 'filled';
        order.updatedAt = Date.now();
      }
      this.db.update('orders', order);

      this._emitBook(market, outcomeIdx);
      this._emitMarket(market);
      this.checkAchievements(user.id);
      if (user.role !== 'bot') this.hub.sendUser(user.id, 'user', this.userSnapshot(user.id));
      return { order: this._publicOrder(order), trades };
    });
    if (idemKey) this._saveIdem(user.id, idemKey, idemFp, result);
    this._audit('place', { kExpected: this.kExpected });
    return result;
  }

  _saveIdem(userId, key, fp, response) {
    this.db.tx(() => {
      const rows = this.db.all('idem') || [];
      if (rows.length > 2000) for (const r of rows.slice(0, rows.length - 1500)) this.db.remove('idem', r.id);
      this.db.insert('idem', { userId, key, fp, response: JSON.parse(JSON.stringify(response)), ts: Date.now() });
    });
  }

  cancel(userId, orderId, isAdmin = false) {
    const order = this.orderIndex.get(orderId);
    if (!order) throw new ApiError(404, 'Order not found or no longer open.');
    if (order.userId !== userId && !isAdmin) throw new ApiError(403, 'Not your order.');
    const market = this.db.get('markets', order.marketId);
    this._cancelOrder(order, isAdmin ? 'Canceled by admin' : 'Canceled by user');
    this._emitBook(market, order.outcomeIdx || 0);
    this.hub.sendUser(order.userId, 'user', this.userSnapshot(order.userId));
    this._audit('cancel', { kExpected: this.kExpected });
    return { ok: true };
  }

  _cancelOrder(order, reason) {
    this.db.tx(() => {
      if (order.kind === 'BY' || order.kind === 'BN') {
        if (order.basis && order.qty > 0) {
          const w = this._wallet(order.userId);
          const release = order.basis * order.qty;
          w.reserved -= release;
          w.available += release;
          this.db.update('wallets', w);
          this.ledger.post('release',
            [{ a: `rsvd:${order.userId}`, d: release }, { a: `avail:${order.userId}`, c: release }],
            { orderId: order.id, marketId: order.marketId, userId: order.userId, memo: 'order canceled — reserve released' });
        }
      } else {
        const pos = this._position(order.userId, order.marketId, order.outcomeIdx || 0);
        if (order.kind === 'SY') pos.yesReserved = Math.max(0, pos.yesReserved - order.qty);
        else pos.noReserved = Math.max(0, pos.noReserved - order.qty);
        this.db.update('positions', pos);
      }
      order.status = 'canceled';
      order.note = reason;
      order.updatedAt = Date.now();
      this.db.update('orders', order);
      this._removeFromBook(order);
      this.orderIndex.delete(order.id);
    });
  }

  /* ================= matching ================= */

  _matchTaker(market, order) {
    const book = this._book(market.id, order.outcomeIdx || 0);
    const isBid = order.kind === 'BY' || order.kind === 'SN';
    const opp = isBid ? book.asks : book.bids;
    const trades = [];
    let stpStop = false;
    let i = 0;
    while (order.qty > 0 && i < opp.length) {
      const maker = opp[i];
      if (maker.userId === order.userId) { // explicit self-trade prevention
        if (order.stp === 'cancel_taker') { stpStop = true; break; }
        i++; continue; // default 'skip': trade through, own orders are invisible
      }
      const cross = isBid ? order.price >= maker.price : order.price <= maker.price;
      if (!cross) break;
      let f = Math.min(order.qty, maker.qty);
      // taker buys pay from available cash at fill time — clamp to what's affordable
      if (order.kind === 'BY' || order.kind === 'BN') {
        const per = order.kind === 'BY' ? maker.price : 100 - maker.price;
        if (per <= 0) break;
        const w = this._wallet(order.userId);
        f = Math.min(f, Math.floor(w.available / per));
        if (f <= 0) break;
      }
      this._fill(market, order, maker, maker.price, f, trades);
      if (maker.qty === 0) i++;
    }
    if (stpStop) order.stpHit = true; // transient flag — place() deletes it before journalling
    if (trades.length) {
      book.asks = book.asks.filter((o) => o.qty > 0 && o.status === 'open');
      book.bids = book.bids.filter((o) => o.qty > 0 && o.status === 'open');
    }
    return trades;
  }

  /* -------- order-safety helpers (pre-trade checks mirror matcher logic) -------- */
  _oppSide(book, order) { return (order.kind === 'BY' || order.kind === 'SN') ? book.asks : book.bids; }
  _crosses(order, m) { return (order.kind === 'BY' || order.kind === 'SN') ? order.price >= m.price : order.price <= m.price; }
  _wouldMatch(book, order) { // would the taker immediately execute against a non-self order?
    for (const m of this._oppSide(book, order)) {
      if (!this._crosses(order, m)) break;
      if (m.userId !== order.userId) return true;
    }
    return false;
  }
  _crossesSelf(book, order) { // any own resting order in the crossing region?
    for (const m of this._oppSide(book, order)) {
      if (!this._crosses(order, m)) break;
      if (m.userId === order.userId) return true;
    }
    return false;
  }
  _fillable(book, order, availCash) { // max shares executable now (STP- and cash-aware)
    let fillable = 0, cash = availCash;
    const isBuy = order.kind === 'BY' || order.kind === 'BN';
    for (const m of this._oppSide(book, order)) {
      if (!this._crosses(order, m)) break;
      if (m.userId === order.userId) { if (order.stp === 'cancel_taker') break; continue; }
      let f = Math.min(order.qty - fillable, m.qty);
      if (isBuy) {
        const per = order.kind === 'BY' ? m.price : 100 - m.price;
        if (per <= 0) break;
        f = Math.min(f, Math.floor(cash / per));
        if (f <= 0) break;
        cash -= f * per;
      }
      fillable += f;
      if (fillable >= order.qty) return fillable;
    }
    return fillable;
  }

  _fill(market, taker, maker, p, f, trades) {
    const now = Date.now();
    const payOf = { BY: p * f, BN: (100 - p) * f };
    const recvOf = { SY: p * f, SN: (100 - p) * f };
    const multi = !!(market.outcomes && market.outcomes.length > 2);
    const oIdx = (taker.outcomeIdx || 0);
    const bk = Engine.bookKey(market.id, oIdx);

    this.db.tx(() => {
      const trade = this.db.insert('trades', {
        marketId: market.id, outcomeIdx: oIdx, price: p, qty: f, ts: now,
        takerOrderId: taker.id, makerOrderId: maker.id,
        takerUserId: taker.userId, makerUserId: maker.userId,
        takerKind: taker.kind, makerKind: maker.kind,
      });
      trades.push(trade);

      // tape + price history + market last
      const tape = this.tape.get(bk) || [];
      tape.push({ ts: now, price: p, qty: f });
      if (tape.length > 3000) tape.splice(0, tape.length - 3000);
      this.tape.set(bk, tape);
      this.db.pushHist(bk, now, p);
      if (multi) {
        this.lastByBook.set(bk, p);
        market.lastTradeTs = now;
        this.db.update('markets', market);
      } else {
        market.last = p; market.lastTradeTs = now;
        this.db.update('markets', market);
      }

      for (const [o, isMaker] of [[taker, false], [maker, true]]) {
        const per = (o.kind === 'BY' || o.kind === 'SY') ? p : 100 - p; // own-space exec price
        o.qty -= f; o.filled += f; o.notional += per * f; o.updatedAt = now;
        if (o.qty === 0) { o.status = 'filled'; this.orderIndex.delete(o.id); }
        this.db.update('orders', o);

        const w = this._wallet(o.userId);
        let ledgerAmt = 0;
        if (o.kind === 'BY' || o.kind === 'BN') {
          const pay = payOf[o.kind];
          ledgerAmt = -pay;
          if (isMaker && o.basis) {
            const release = o.basis * f;
            w.reserved -= release;
            w.available += release - pay;
          } else {
            w.available -= pay;
          }
        } else {
          const recv = recvOf[o.kind];
          ledgerAmt = recv;
          w.available += recv;
        }
        this.db.update('wallets', w);

        // position + cost basis
        const pos = this._position(o.userId, market.id, oIdx);
        let realized = null;
        if (o.kind === 'BY') { pos.yesQty += f; pos.yesCost += payOf.BY; pos.yesAvg = pos.yesQty ? pos.yesCost / pos.yesQty : 0; }
        else if (o.kind === 'BN') { pos.noQty += f; pos.noCost += payOf.BN; pos.noAvg = pos.noQty ? pos.noCost / pos.noQty : 0; }
        else if (o.kind === 'SY') {
          realized = recvOf.SY - pos.yesAvg * f;
          pos.yesQty -= f; pos.yesCost = Math.max(0, pos.yesCost - pos.yesAvg * f);
          pos.yesReserved = Math.max(0, pos.yesReserved - f);
          if (pos.yesQty === 0) { pos.yesCost = 0; pos.yesAvg = 0; }
        } else if (o.kind === 'SN') {
          realized = recvOf.SN - pos.noAvg * f;
          pos.noQty -= f; pos.noCost = Math.max(0, pos.noCost - pos.noAvg * f);
          pos.noReserved = Math.max(0, pos.noReserved - f);
          if (pos.noQty === 0) { pos.noCost = 0; pos.noAvg = 0; }
        }
        this.db.update('positions', pos);

        const verb = (o.kind === 'BY' && 'Bought') || (o.kind === 'BN' && 'Bought') || 'Sold';
        const which = (o.kind === 'BY' || o.kind === 'SY') ? 'YES' : 'NO';
        this._ledger(o.userId, 'trade', ledgerAmt, w.available, 'trade', trade.id,
          `${verb} ${f} ${which} @ ${per}¢${realized !== null ? ` (realized ${realized >= 0 ? '+' : ''}${(realized / 100).toFixed(2)})` : ''}`);
        this.notify(o.userId, 'fill', 'Order filled', `${verb} ${f} ${which} @ ${per}¢ — ${market.title.slice(0, 80)}`);
      }

      /* double-entry ledger: cash legs of this fill, always balanced.
         maker BY/BN fills decompose into reserve release + payment (matching
         the wallet math above: reserved -= basis·f, available += basis·f − pay). */
      {
        const tBuy = taker.kind === 'BY' || taker.kind === 'BN';
        const mBuy = maker.kind === 'BY' || maker.kind === 'BN';
        const tAmt = tBuy ? payOf[taker.kind] : recvOf[taker.kind];
        const mAmt = mBuy ? payOf[maker.kind] : recvOf[maker.kind];
        const entries = [];
        if (mBuy && maker.basis) {
          const rel = maker.basis * f;
          entries.push({ a: `rsvd:${maker.userId}`, d: rel }, { a: `avail:${maker.userId}`, c: rel });
        }
        const coll = `collat:${market.id}:${oIdx}`;
        const refs = { orderId: taker.id, tradeId: trade.id, marketId: market.id, userId: taker.userId };
        if (tBuy && mBuy) {            // BY × BN — pair minted, both sides fund $1
          entries.push({ a: `avail:${taker.userId}`, d: tAmt }, { a: `avail:${maker.userId}`, d: mAmt }, { a: coll, c: 100 * f });
          this.ledger.post('mint', entries, { ...refs, memo: `mint ${f} pairs @ ${p}¢` });
        } else if (!tBuy && !mBuy) {   // SN × SY — pair burned, $1 collateral released
          entries.push({ a: coll, d: 100 * f }, { a: `avail:${taker.userId}`, c: tAmt }, { a: `avail:${maker.userId}`, c: mAmt });
          this.ledger.post('burn', entries, { ...refs, memo: `burn ${f} pairs @ ${p}¢` });
        } else {                        // share transfer: buyer pays seller
          const buyerAmt = tBuy ? tAmt : mAmt;
          entries.push({ a: `avail:${(tBuy ? taker : maker).userId}`, d: buyerAmt }, { a: `avail:${(tBuy ? maker : taker).userId}`, c: buyerAmt });
          this.ledger.post('trade', entries, { ...refs, memo: `transfer ${f} @ ${p}¢` });
        }
      }

      this.hub.broadcast('trade', {
        slug: market.slug, outcomeIdx: oIdx, price: p, qty: f, ts: now,
        takerKind: taker.kind, taker: this._username(taker.userId),
        maker: this._username(maker.userId),
      });
      if (f >= 40 || (p * f) >= 2000) {
        this.hub.broadcast('whale', {
          marketTitle: market.title,
          slug: market.slug,
          price: p,
          qty: f,
          totalValue: ((p * f) / 100).toFixed(2),
          side: p >= 50 ? 'yes' : 'no',
          time: now,
          taker: this._username(taker.userId),
        });
      }
      for (const uid of new Set([taker.userId, maker.userId])) {
        const u = this.db.get('users', uid);
        if (u && u.role !== 'bot') this.hub.sendUser(uid, 'user', this.userSnapshot(uid));
      }
    });
  }

  _username(uid) {
    const u = this.db.get('users', uid);
    return u ? u.username : '?';
  }

  /* ================= resolution & settlement ================= */

  /* ================= resolution & settlement (audited, two-step, idempotent) ================= */

  resolutionAudit(marketId) {
    return (this.db.all('resolutions') || []).filter((r) => r.marketId === marketId).sort((a, b) => a.id - b.id);
  }

  /* canonical, field-ordered payload → SHA-256 evidence hash (hash-chained audit history) */
  static resolutionPayload(rec) {
    return {
      v: 1, marketId: rec.marketId, slug: rec.slug, multi: !!rec.multi,
      outcome: rec.outcome, winnerIdx: rec.winnerIdx,
      resolvedBy: rec.resolvedBy, resolvedAt: rec.resolvedAt,
      source: rec.source, evidence: rec.evidence, notes: rec.notes || '',
      prevHash: rec.prevHash,
    };
  }
  hashResolution(rec) {
    return crypto.createHash('sha256').update(JSON.stringify(Engine.resolutionPayload(rec))).digest('hex');
  }
  verifyResolution(rec) {
    return !!rec && typeof rec.hash === 'string' && this.hashResolution(rec) === rec.hash;
  }

  _resolutionPreview(market, multi, winnerIdx, outcome) {
    let winningQty = 0; const holders = new Set();
    for (const pos of this.db.find('positions', (r) => r.marketId === market.id)) {
      const idx = pos.outcomeIdx || 0;
      const wq = multi ? (idx === winnerIdx ? pos.yesQty : pos.noQty) : (outcome === 'yes' ? pos.yesQty : pos.noQty);
      if (wq > 0) { winningQty += wq; holders.add(pos.userId); }
    }
    return { winningQty, payout: winningQty * 100, holders: holders.size };
  }

  /**
   * resolve(market, outcome, opts)
   *   opts.evidence  — required reference/URL justifying the outcome
   *   opts.notes     — optional free-form notes (stored, hashed)
   *   opts.confirm   — false/absent → returns a confirmation preview, writes only a proposal
   *                   true        → finalizes: appends the immutable record, resolves, settles
   *   opts.force     — admin override allowing resolution while still open (emergency)
   *   opts.actor     — { id, username, role } of the resolver (stored in the record)
   */
  resolve(market, outcome, opts = {}) {
    const multi = !!(market.outcomes && market.outcomes.length > 2);
    let winnerIdx = null;
    if (multi) {
      winnerIdx = Number(outcome);
      if (!Number.isInteger(winnerIdx) || winnerIdx < 0 || winnerIdx >= market.outcomes.length) {
        throw new ApiError(400, 'Invalid winning outcome.');
      }
    } else if (!['yes', 'no'].includes(outcome)) {
      throw new ApiError(400, 'Outcome must be yes or no.');
    }
    if (market.status === 'resolved') throw new ApiError(409, 'Market already resolved.');
    if (market.status === 'open' && !opts.force) {
      throw new ApiError(400, 'Market is still trading — it must close before resolution (force=true overrides for emergencies).');
    }
    const evidence = String(opts.evidence || '').trim();
    if (!evidence) throw new ApiError(400, 'Resolution evidence/reference is required.');
    const notes = String(opts.notes || '').trim();
    const actor = opts.actor || { id: null, username: 'system', role: 'system' };
    const now = Date.now();
    const label = multi ? market.outcomes[winnerIdx].label : outcome.toUpperCase();

    /* ---- step 1: confirmation — nothing final is written until re-submitted with confirm ---- */
    if (!opts.confirm) {
      const preview = this._resolutionPreview(market, multi, winnerIdx, outcome);
      market.proposal = {
        outcome: label, winnerIdx: multi ? winnerIdx : (outcome === 'yes' ? 0 : 1),
        evidence, notes, proposedBy: actor.username, proposedAt: now, preview,
      };
      this.db.update('markets', market);
      this._emitMarket(market);
      return { confirmationRequired: true, proposal: market.proposal };
    }

    /* ---- step 2a: append the immutable, hash-chained resolution record + resolve + cancel orders ---- */
    const allRecs = this.db.all('resolutions') || [];
    const prevHash = allRecs.length ? allRecs[allRecs.length - 1].hash : 'GENESIS';
    const rec = {
      marketId: market.id, slug: market.slug, multi,
      outcome: label, winnerIdx: multi ? winnerIdx : (outcome === 'yes' ? 0 : 1),
      resolvedBy: { id: actor.id, username: actor.username, role: actor.role },
      resolvedAt: now, source: market.resolutionSource || '', evidence, notes,
      prevHash,
    };
    rec.hash = this.hashResolution(rec);
    const affected = new Set();
    this.db.tx(() => {
      this.db.insert('resolutions', rec);
      market.status = 'resolved';
      market.outcome = multi ? winnerIdx : outcome;
      market.winnerIdx = rec.winnerIdx;
      market.resolvedAt = now;
      market.resolutionHash = rec.hash;
      delete market.proposal;
      this.db.update('markets', market);

      for (const o of [...this.orderIndex.values()]) {
        if (o.marketId === market.id) {
          affected.add(o.userId);
          this._cancelOrder(o, 'Market resolved');
        }
      }
      for (let i = 0; i < 25; i++) {
        const k = Engine.bookKey(market.id, i);
        if (this.books.has(k)) this.books.set(k, { bids: [], asks: [] });
      }
      this.books.set(market.id, { bids: [], asks: [] });
    });
    this._audit('resolve', { kExpected: this.kExpected });

    /* ---- step 2b: guarded, idempotent settlement ---- */
    const settle = this.settleMarket(market.id);
    return { ok: true, market, resolution: { ...rec }, settle };
  }

  /**
   * settleMarket(marketId) — pays winners exactly once.
   * Guards: market must be resolved (i.e. closed + valid resolution record);
   * the record's SHA-256 evidence hash is re-verified before any cash moves.
   * Re-running a completed settlement is a safe no-op.
   */
  settleMarket(marketId) {
    const market = this.db.get('markets', marketId);
    if (!market) throw new ApiError(404, 'Market not found.');
    if (market.status !== 'resolved') {
      throw new ApiError(409, 'Settlement requires the market to be closed and resolved first.');
    }
    const audit = this.resolutionAudit(marketId);
    const rec = audit[audit.length - 1];
    if (!rec) throw new ApiError(409, 'No resolution record for this market — settlement refused.');
    if (!this.verifyResolution(rec)) {
      throw new ApiError(500, 'Resolution record failed hash verification — settlement refused.');
    }
    if (market.settledAt) {
      return { ok: true, alreadySettled: true, settledAt: market.settledAt, payoutTotal: market.settledPayout || 0 };
    }

    const multi = !!(market.outcomes && market.outcomes.length > 2);
    const winnerIdx = market.winnerIdx;
    const outcome = market.outcome;
    const now = Date.now();
    const affected = new Set();
    const settledRows = [];
    const outcomeLabel = () => rec.outcome;
    let collateral = 0;
    for (const p of this.db.find('positions', (r) => r.marketId === market.id)) collateral += 100 * (p.yesQty || 0);
    let payoutTotal = 0;

    this.db.tx(() => {
      for (const pos of this.db.find('positions', (r) => r.marketId === market.id)) {
        const idx = pos.outcomeIdx || 0;
        let winningQty = 0;
        if (multi) {
          // YES of the winning option pays $1; NO of every losing option pays $1
          winningQty = idx === winnerIdx ? pos.yesQty : pos.noQty;
        } else {
          winningQty = outcome === 'yes' ? pos.yesQty : pos.noQty;
        }
        const payout = winningQty * 100;
        payoutTotal += payout;
        const cost = Math.round(pos.yesCost + pos.noCost);
        // archive for trading stats & achievements (both winners and losers)
        if (pos.userId !== undefined) {
          const u = this.db.get('users', pos.userId);
          if (u && u.role !== 'bot' && (pos.yesQty > 0 || pos.noQty > 0)) {
            settledRows.push(this.db.insert('settled', {
              userId: pos.userId, marketId: market.id, outcomeIdx: idx,
              yesQty: pos.yesQty, noQty: pos.noQty, cost, payout,
              win: payout > 0, ts: now,
            }));
          }
        }
        if (payout > 0) {
          const w = this._wallet(pos.userId);
          w.available += payout;
          this.db.update('wallets', w);
          this.ledger.post('settlement',
            [{ a: `collat:${market.id}:${idx}`, d: payout }, { a: `avail:${pos.userId}`, c: payout }],
            { marketId: market.id, settlementId: rec.id, userId: pos.userId, memo: `payout ${winningQty} × $1 — ${outcomeLabel()}` });
          this._ledger(pos.userId, 'settlement', payout, w.available, 'market', market.id,
            `Settlement: ${market.title} → ${outcomeLabel()} (${winningQty} winning shares × $1)`);
          this.notify(pos.userId, 'settlement', `Market resolved ${outcomeLabel()} — paid out`,
            `${market.title.slice(0, 80)} — ${winningQty} winning shares paid $1 each.`);
        }
        affected.add(pos.userId);
        pos.yesQty = 0; pos.noQty = 0; pos.yesCost = 0; pos.noCost = 0;
        pos.yesAvg = 0; pos.noAvg = 0; pos.yesReserved = 0; pos.noReserved = 0;
        this.db.update('positions', pos);
      }
      market.settledAt = now;
      market.settledPayout = payoutTotal;
      this.db.update('markets', market);
    });

    this._audit('settlement', { kExpected: this.kExpected, payout: payoutTotal, collateral });
    this._emitMarket(market);
    this._emitBooks(market);
    for (const uid of affected) {
      this.hub.sendUser(uid, 'user', this.userSnapshot(uid));
      const u = this.db.get('users', uid);
      if (u && u.role !== 'bot') {
        const hasWin = settledRows.some((r) => r.userId === uid && r.payout > 0);
        const held = settledRows.some((r) => r.userId === uid);
        if (!hasWin && !held) {
          this.notify(uid, 'settlement', `Market resolved ${outcomeLabel()}`, `${market.title.slice(0, 90)}`);
        }
        this.checkAchievements(uid);
      }
    }
    return { ok: true, alreadySettled: false, settledAt: now, payoutTotal };
  }

  checkCloses() {
    const now = Date.now();
    for (const m of this.db.all('markets')) {
      if (m.status === 'open' && m.closeTime <= now) {
        m.status = 'closed';
        this.db.update('markets', m);
        this._emitMarket(m);
      }
    }
  }

  /* ================= user snapshots ================= */

  _publicOrder(o) {
    return {
      id: o.id, marketId: o.marketId, outcomeIdx: o.outcomeIdx || 0, kind: o.kind, type: o.type,
      side: o.kind === 'BY' || o.kind === 'BN' ? 'buy' : 'sell',
      outcome: o.kind === 'BY' || o.kind === 'SY' ? 'yes' : 'no',
      price: o.userPrice !== null && o.userPrice !== undefined ? o.userPrice : (o.type === 'limit' ? o.price : null),
      yesPrice: o.price,
      qty: o.qty, origQty: o.origQty, filled: o.filled,
      avgFill: o.filled && o.notional ? Math.round(o.notional / o.filled) : null,
      status: o.status, note: o.note || null, createdAt: o.createdAt,
      updatedAt: o.updatedAt || o.createdAt,
      tif: o.tif || (o.type === 'market' ? 'IOC' : 'GTC'),
      statusText: o.status === 'rejected' ? 'REJECTED'
        : o.status === 'canceled' ? 'CANCELLED'
        : o.status === 'filled' ? 'FILLED'
        : (o.filled > 0 ? 'PARTIALLY_FILLED' : 'OPEN'),
    };
  }

  userSnapshot(uid) {
    const w = this._wallet(uid);
    const orders = [...this.orderIndex.values()].filter((o) => o.userId === uid).map((o) => this._publicOrder(o));
    const positions = this.db.find('positions', (r) => r.userId === uid)
      .filter((p) => p.yesQty > 0 || p.noQty > 0)
      .map((p) => this._markPosition(p));
    return { wallet: { available: w.available, reserved: w.reserved, total: w.available + w.reserved + (w.withdrawReserved || 0), withdrawReserved: w.withdrawReserved || 0 }, orders, positions };
  }

  _markPosition(p) {
    const m = this.db.get('markets', p.marketId);
    const idx = p.outcomeIdx || 0;
    const mark = this.mark(p.marketId, idx);
    const optLabel = m && m.outcomes && m.outcomes[idx] ? m.outcomes[idx].label : null;
    const mkt = m ? { slug: m.slug, title: m.title, emoji: m.emoji, status: m.status, outcome: m.outcome || null, outcomeIdx: idx, optionLabel: optLabel, multi: !!(m.outcomes && m.outcomes.length > 2), closeTime: m.closeTime } : null;
    const yesValue = mark !== null ? p.yesQty * mark : null;
    const noValue = mark !== null ? p.noQty * (100 - mark) : null;
    const unrealized = mark !== null
      ? (p.yesQty * (mark - p.yesAvg)) + (p.noQty * ((100 - mark) - p.noAvg))
      : null;
    return {
      marketId: p.marketId, market: mkt,
      yesQty: p.yesQty, noQty: p.noQty,
      yesFree: Math.max(0, p.yesQty - p.yesReserved), noFree: Math.max(0, p.noQty - p.noReserved),
      yesAvg: Math.round(p.yesAvg), noAvg: Math.round(p.noAvg),
      yesCost: Math.round(p.yesCost), noCost: Math.round(p.noCost),
      mark, value: mark !== null ? (yesValue || 0) + (noValue || 0) : null,
      unrealized: unrealized !== null ? Math.round(unrealized) : null,
      maxPayoutYes: p.yesQty * 100, maxPayoutNo: p.noQty * 100,
    };
  }

  creditWallet(uid, amountCents, type, memo, refType, refId) {
    const w = this.db.tx(() => {
      const w = this._wallet(uid);
      w.available += amountCents;
      this.db.update('wallets', w);
      this.ledger.post('credit',
        [{ a: 'equity:promo', d: amountCents }, { a: `avail:${uid}`, c: amountCents }],
        { userId: uid, memo: `${type}: ${memo}` });
      this._ledger(uid, type, amountCents, w.available, refType || 'promo', refId || null, memo);
      if (type === 'promo' || type === 'referral') {
        this.notify(uid, type, 'Funds credited', `${memo} — $${(amountCents / 100).toFixed(2)} added to your balance.`);
      }
      this.hub.sendUser(uid, 'user', this.userSnapshot(uid));
      return w;
    });
    if (this.kExpected !== null) this.kExpected += amountCents; // deliberate injection
    this._audit('credit', { kExpected: this.kExpected });
    return w;
  }

  /* ================= simulated withdrawals (PLAY MONEY ONLY) =================
     PENDING → APPROVED → COMPLETED (paid out via the double-entry ledger),
     or CANCELLED (user) / REJECTED (admin) — both refund the escrow.
     Escrow lives in wallets.withdrawReserved, NEVER in wallet.reserved
     (which is exact-matched to resting buy orders by invariant W3). */

  _publicWithdrawal(wd) {
    return {
      id: wd.id, amount: wd.amount, status: wd.status,
      statusText: wd.status.toUpperCase(),
      requestedAt: wd.requestedAt, updatedAt: wd.updatedAt || null,
      processedAt: wd.processedAt || null, processedBy: wd.processedBy || null,
      note: wd.note || '', id: wd.id,
    };
  }

  requestWithdrawal(uid, amountCents, opts = {}) {
    const a = Number(amountCents);
    if (!Number.isInteger(a) || a <= 0) throw new ApiError(400, 'Withdrawal amount must be a positive whole number of cents.');
    const idemKey = opts.idemKey ? String(opts.idemKey).slice(0, 80) : null;
    const rows = this.db.all('withdrawals') || [];
    if (idemKey) {
      const prev = rows.find((r) => r.userId === uid && r.idemKey === idemKey);
      if (prev) return { withdrawal: this._publicWithdrawal(prev), replayed: true }; // retry-safe
    }
    const pending = rows.find((r) => r.userId === uid && (r.status === 'pending' || r.status === 'approved'));
    if (pending) throw new ApiError(409, 'You already have a withdrawal in review — cancel it or wait for it to be processed first.');
    const wd = this.db.tx(() => {
      const w = this._wallet(uid);
      if (w.available < a) {
        throw new ApiError(400, `Insufficient available balance — you can withdraw up to $${(w.available / 100).toFixed(2)} (reserved trading funds are not withdrawable).`);
      }
      w.available -= a; w.withdrawReserved += a;
      this.db.update('wallets', w);
      const row = this.db.insert('withdrawals', {
        userId: uid, amount: a, status: 'pending',
        requestedAt: Date.now(), updatedAt: Date.now(), processedAt: null, processedBy: null, note: '', idemKey,
      });
      this.ledger.post('wdraw_request',
        [{ a: `avail:${uid}`, d: a }, { a: `wdraw:${uid}`, c: a }],
        { userId: uid, memo: `withdrawal #${row.id} requested (play money)` });
      return row;
    });
    this._audit('withdrawal', { kExpected: this.kExpected });
    this.notify(uid, 'withdrawal', 'Withdrawal requested', `Your play-money withdrawal of $${(a / 100).toFixed(2)} is pending review.`);
    this.hub.sendUser(uid, 'user', this.userSnapshot(uid));
    return { withdrawal: this._publicWithdrawal(wd) };
  }

  cancelWithdrawal(uid, wdId) {
    const wd = this.db.get('withdrawals', wdId);
    if (!wd) throw new ApiError(404, 'Withdrawal not found.');
    if (wd.userId !== uid) throw new ApiError(403, 'Not your withdrawal.');
    if (wd.status !== 'pending') throw new ApiError(400, 'Only PENDING withdrawals can be cancelled.');
    this.db.tx(() => {
      const w = this._wallet(uid);
      w.withdrawReserved -= wd.amount; w.available += wd.amount;
      this.db.update('wallets', w);
      wd.status = 'cancelled'; wd.updatedAt = Date.now(); wd.processedAt = Date.now(); wd.processedBy = 'user';
      this.db.update('withdrawals', wd);
      this.ledger.post('wdraw_return',
        [{ a: `wdraw:${uid}`, d: wd.amount }, { a: `avail:${uid}`, c: wd.amount }],
        { userId: uid, memo: `withdrawal #${wd.id} cancelled — funds returned` });
    });
    this._audit('withdrawal_cancel', { kExpected: this.kExpected });
    this.notify(uid, 'withdrawal', 'Withdrawal cancelled', `$${(wd.amount / 100).toFixed(2)} returned to your available balance.`);
    this.hub.sendUser(uid, 'user', this.userSnapshot(uid));
    return { withdrawal: this._publicWithdrawal(wd) };
  }

  /** admin actions: approve | reject | complete */
  adminWithdrawal(admin, wdId, action, note = '') {
    const wd = this.db.get('withdrawals', wdId);
    if (!wd) throw new ApiError(404, 'Withdrawal not found.');
    if (!['approve', 'reject', 'complete'].includes(action)) throw new ApiError(400, 'Invalid withdrawal action.');
    if (wd.status !== 'pending' && wd.status !== 'approved') {
      throw new ApiError(409, `Withdrawal is already ${wd.status.toUpperCase()} — no further actions possible.`);
    }
    const now = Date.now();
    if (action === 'approve') {
      if (wd.status !== 'pending') throw new ApiError(409, 'Only PENDING withdrawals can be approved.');
      this.db.tx(() => {
        wd.status = 'approved'; wd.updatedAt = now; wd.processedBy = admin.username; if (note) wd.note = note;
        this.db.update('withdrawals', wd); // funds stay escrowed until completion
      });
      this.notify(wd.userId, 'withdrawal', 'Withdrawal approved', `Your $${(wd.amount / 100).toFixed(2)} withdrawal was approved and is being paid out.`);
    } else if (action === 'reject') {
      this.db.tx(() => {
        const w = this._wallet(wd.userId);
        w.withdrawReserved -= wd.amount; w.available += wd.amount;
        this.db.update('wallets', w);
        wd.status = 'rejected'; wd.updatedAt = now; wd.processedAt = now; wd.processedBy = admin.username; if (note) wd.note = note;
        this.db.update('withdrawals', wd);
        this.ledger.post('wdraw_return',
          [{ a: `wdraw:${wd.userId}`, d: wd.amount }, { a: `avail:${wd.userId}`, c: wd.amount }],
          { userId: wd.userId, memo: `withdrawal #${wd.id} rejected — funds returned` });
      });
      this.notify(wd.userId, 'withdrawal', 'Withdrawal rejected', `Your withdrawal was rejected — $${(wd.amount / 100).toFixed(2)} returned to your balance.${note ? ' Note: ' + note : ''}`);
    } else { // complete — the only path cash leaves the system (through the ledger)
      if (wd.status !== 'approved') throw new ApiError(409, 'Approve the withdrawal before marking it paid.');
      this.db.tx(() => {
        const w = this._wallet(wd.userId);
        w.withdrawReserved -= wd.amount;
        this.db.update('wallets', w);
        wd.status = 'completed'; wd.updatedAt = now; wd.processedAt = now; wd.processedBy = admin.username; if (note) wd.note = note;
        this.db.update('withdrawals', wd);
        this.ledger.post('wdraw_complete',
          [{ a: `wdraw:${wd.userId}`, d: wd.amount }, { a: 'equity:withdraw', c: wd.amount }],
          { userId: wd.userId, memo: `withdrawal #${wd.id} completed (simulated payout, play money)` });
      });
      if (this.kExpected !== null) this.kExpected -= wd.amount; // deliberate cash exit
      this.notify(wd.userId, 'withdrawal', 'Withdrawal completed', `$${(wd.amount / 100).toFixed(2)} paid out (play-money withdrawal for demonstration purposes).`);
    }
    this._audit('withdrawal_' + action, { kExpected: this.kExpected });
    this.hub.sendUser(wd.userId, 'user', this.userSnapshot(wd.userId));
    return { withdrawal: this._publicWithdrawal(wd) };
  }

  withdrawalsFor(uid) {
    return (this.db.all('withdrawals') || []).filter((r) => r.userId === uid).sort((a, b) => b.id - a.id).map((r) => this._publicWithdrawal(r));
  }

  /* ================= external market feeds (CoinGecko, play money) =================
     The external price NEVER touches trading, probabilities, wallets or the
     ledger. It is displayed in the market UI (source + last updated + LIVE/
     STALE) and, at resolution time, generates a PROPOSAL only. Settlement
     always runs through the existing audited, admin-confirmed resolve(). */

  /** provider dispatch: quote any feed market through its provider (cached, never throws) */
  _quoteFor(m, opts = {}) {
    if (m.provider === 'open-meteo') {
      return this.weather.quote({ latitude: m.latitude, longitude: m.longitude, metric: m.metric, unit: m.unit }, { force: !!opts.force });
    }
    return this.feeds.quote(m.assetId, m.currency || 'usd', { force: !!opts.force });
  }

  /** cached/live quote for a market's feed + display extras (refreshes if past TTL; never throws) */
  async feedQuote(m, opts = {}) {
    const fd = describeFeed(m);
    const q = await this._quoteFor(m, opts);
    if (fd && fd.kind === 'weather') {
      return { ...q, metricLabel: fd.metricLabel, unitLabel: fd.unitLabel, location: fd.location, latLonText: fd.latLonText };
    }
    return { ...q, symbol: assetMeta(m.assetId).symbol, label: assetMeta(m.assetId).label };
  }

  /** human-readable resolution rule, e.g. "YES if BTC ≥ $60,000 (CoinGecko BTC/USD)" or "YES if Temperature ≥ 25°C (Open-Meteo · Pune)" */
  feedRuleText(m) {
    const fd = describeFeed(m);
    if (fd && fd.kind === 'weather') {
      return `YES if ${fd.metricLabel} ${fd.operatorText} ${fd.targetText} at resolution time (Open-Meteo · ${fd.location ? fd.location + ' ' : ''}${fd.latLonText})`;
    }
    const meta = assetMeta(m.assetId);
    return `YES if ${meta.symbol} ${operatorText(m.operator)} $${Number(m.targetValue).toLocaleString('en-US')} at resolution time (CoinGecko ${meta.symbol}/${(m.currency || 'usd').toUpperCase()})`;
  }

  /** evidence string for the immutable resolution record: source + value + timestamp */
  _feedEvidence(m, q, outcome) {
    const at = new Date(q.remoteUpdatedAt || q.fetchedAt || Date.now()).toISOString();
    const fd = describeFeed(m);
    if (fd && fd.kind === 'weather') {
      return `[Open-Meteo] ${fd.metricLabel} @ ${fd.location ? fd.location + ' ' : ''}(${fd.latLonText}) = ${q.value}${fd.unitLabel} at ${at}`
        + ` — rule: ${this.feedRuleText(m)} → proposal ${outcome === 'yes' ? 'YES' : 'NO'}`;
    }
    return `[CoinGecko] ${assetMeta(m.assetId).symbol}/${(m.currency || 'usd').toUpperCase()} = $${q.value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} at ${at}`
      + ` — rule: ${this.feedRuleText(m)} → proposal ${outcome === 'yes' ? 'YES' : 'NO'}`;
  }

  /**
   * updateFeedProposal(market) — generate/refresh the resolution proposal from
   * the external price. Runs only at/after the market's resolution time; a
   * proposal is written ONLY when the quote is LIVE. Stale/unavailable data
   * writes a blocked marker instead (auto-resolution blocked). Never settles:
   * an admin must confirm through the existing two-step resolve().
   */
  async updateFeedProposal(m, opts = {}) {
    if (!m || !m.provider || (m.assetId == null && m.latitude == null)) return null;
    if (m.status === 'resolved' || m.status === 'settled') return m.feedProposal || null;
    const resolutionTime = m.feedResolutionTime || m.closeTime;
    const q = await this.feedQuote(m, opts);
    const now = Date.now();
    if (now < resolutionTime || m.status === 'open') {
      // before the resolution snapshot moment (or while trading is still live):
      // keep the price fresh, but never propose — no early outcome signals
      if (m.feedProposal) { delete m.feedProposal; this.db.update('markets', m); this._emitMarket(m); }
      return { state: 'waiting', resolutionTime, quote: q };
    }
    if (q.status !== 'live' || typeof q.value !== 'number') {
      const blocked = {
        state: 'blocked',
        reason: q.status === 'unavailable' ? 'data unavailable' : 'data stale',
        detail: q.error || `last fetch ${q.fetchedAt ? new Date(q.fetchedAt).toISOString() : 'never'}`,
        checkedAt: now,
        resolutionTime,
      };
      m.feedProposal = blocked;
      this.db.update('markets', m);
      this._emitMarket(m);
      return blocked;
    }
    const op = OPERATORS[m.operator];
    const outcome = op(q.value, m.targetValue) ? 'yes' : 'no';
    const fd = describeFeed(m);
    const kindExtras = fd && fd.kind === 'weather'
      ? { provider: 'open-meteo', latitude: m.latitude, longitude: m.longitude, location: fd.location || null, metric: m.metric, unit: m.unit, unitLabel: fd.unitLabel,
          valueText: `${q.value}${fd.unitLabel}`, targetText: fd.targetText }
      : { assetId: m.assetId, currency: (m.currency || 'usd').toUpperCase(),
          valueText: `$${q.value.toLocaleString('en-US')}`, targetText: fd ? fd.targetText : String(m.targetValue) };
    const proposal = {
      state: 'ready',
      outcome,
      source: fd && fd.kind === 'weather' ? 'Open-Meteo' : 'CoinGecko',
      value: q.value,
      operator: m.operator,
      operatorText: operatorText(m.operator),
      targetValue: m.targetValue,
      priceAt: q.remoteUpdatedAt || q.fetchedAt || now,
      fetchedAt: q.fetchedAt || now,
      generatedAt: now,
      resolutionTime,
      evidence: this._feedEvidence(m, q, outcome),
      ...kindExtras,
    };
    m.feedProposal = proposal;
    this.db.update('markets', m);
    this._emitMarket(m);
    return proposal;
  }

  /** background tick: refresh quotes + proposals for every unresolved feed market */
  async feedTick() {
    const feedMarkets = (this.db.all('markets') || []).filter((m) => m.provider && (m.assetId != null || m.latitude != null) && m.status !== 'resolved');
    // one quote per distinct provider key — shared cache dedupes HTTP calls
    const warms = new Map();
    for (const m of feedMarkets) {
      const k = m.provider === 'open-meteo'
        ? `om:${m.latitude}:${m.longitude}:${m.metric}:${m.unit || ''}`
        : `cg:${m.assetId}:${m.currency || 'usd'}`;
      if (!warms.has(k)) warms.set(k, () => this._quoteFor(m, {}));
    }
    await Promise.all([...warms.values()].map((fn) => fn()));
    let proposals = 0, blocked = 0;
    for (const m of feedMarkets) {
      try {
        const r = await this.updateFeedProposal(m, {});
        if (r && r.state === 'ready') proposals++;
        else if (r && r.state === 'blocked') blocked++;
      } catch (e) { console.error('[feed] proposal error for market ' + m.id + ':', e.message); }
    }
    return { markets: feedMarkets.length, proposals, blocked };
  }

  /* ================= housekeeping ================= */

  ensureBotFunds(botUser, minCents, topUpToCents) {
    const w = this._wallet(botUser.id);
    if (w.available + w.reserved < minCents) {
      w.available += topUpToCents;
      this.db.update('wallets', w);
      this.ledger.post('botfunding',
        [{ a: 'equity:botfunding', d: topUpToCents }, { a: `avail:${botUser.id}`, c: topUpToCents }],
        { userId: botUser.id, memo: 'Market-maker liquidity funding' });
      this._ledger(botUser.id, 'mm_funding', topUpToCents, w.available, 'system', null, 'Market-maker liquidity funding');
      if (this.kExpected !== null) this.kExpected += topUpToCents; // deliberate injection
      this._audit('funding', { kExpected: this.kExpected });
    }
  }

  prune() {
    // keep the tables bounded: old bot trades/orders, old ledger for bots is already skipped
    const trades = this.db.all('trades');
    if (trades.length > 30000) this.db.tx(() => {
      for (const t of trades.slice(0, trades.length - 25000)) this.db.remove('trades', t.id);
    });
    const orders = this.db.all('orders');
    const terminalBots = orders.filter((o) => {
      if (o.status === 'open') return false;
      const u = this.db.get('users', o.userId);
      return u && u.role === 'bot';
    });
    if (terminalBots.length > 4000) {
      const cutoff = Date.now() - 10 * 60 * 1000;
      const kill = terminalBots.filter((o) => o.updatedAt < cutoff);
      this.db.tx(() => { for (const o of kill) this.db.remove('orders', o.id); });
    }
    // sessions cleanup
    const now = Date.now();
    const dead = this.db.find('sessions', (s) => s.expiresAt < now);
    if (dead.length) this.db.tx(() => { for (const s of dead) this.db.remove('sessions', s.id); });
    // notifications: keep the latest 150 per user
    const byUser = new Map();
    for (const n of this.db.all('notifications')) {
      const arr = byUser.get(n.userId) || [];
      arr.push(n);
      byUser.set(n.userId, arr);
    }
    for (const [uid, arr] of byUser) {
      if (arr.length > 150) {
        const kill = arr.sort((a, b) => a.id - b.id).slice(0, arr.length - 150);
        this.db.tx(() => { for (const n of kill) this.db.remove('notifications', n.id); });
      }
    }
  }

  /* ================= SSE payloads ================= */

  _emitMarket(market) {
    this.hub.broadcast('mkt', this.marketPublic(market));
  }

  _emitBook(market, idx = 0) {
    this.hub.broadcast('book', { slug: market.slug, outcomeIdx: idx, ...this.marketBook(market.id, idx) });
  }

  _emitBooks(market) {
    if (market.outcomes && market.outcomes.length > 2) {
      market.outcomes.forEach((_, i) => this._emitBook(market, i));
    } else {
      this._emitBook(market, 0);
    }
  }

  marketPublic(m) {
    const out = {
      id: m.id, slug: m.slug, title: m.title, emoji: m.emoji, category: m.category,
      description: m.description, resolutionSource: m.resolutionSource, resolutionRules: m.resolutionRules,
      closeTime: m.closeTime, createdAt: m.createdAt, status: m.status, outcome: m.outcome || null,
      winnerIdx: m.winnerIdx !== undefined ? m.winnerIdx : null,
      expectedResolutionTime: m.expectedResolutionTime || m.closeTime,
      resolver: m.resolver || 'admin',
      resolutionRule: m.resolutionRules || null,
      settledAt: m.settledAt || null,
      featured: !!m.featured,
      seriesSlug: m.seriesSlug || null, seriesName: m.seriesName || null, seriesEmoji: m.seriesEmoji || null,
      ...this.summary(m),
    };
    const auditRecs = (this.db.all('resolutions') || []).filter((r) => r.marketId === m.id);
    out.auditCount = auditRecs.length;
    if (auditRecs.length) {
      const rec = auditRecs[auditRecs.length - 1];
      out.resolution = {
        outcome: rec.outcome, winnerIdx: rec.winnerIdx, resolvedBy: rec.resolvedBy,
        resolvedAt: rec.resolvedAt, source: rec.source, evidence: rec.evidence, notes: rec.notes,
        hash: rec.hash, prevHash: rec.prevHash, verified: this.verifyResolution(rec),
      };
    } else if (m.status === 'resolved') {
      out.resolution = { legacy: true, resolvedAt: m.resolvedAt, note: 'Resolved before the audit system existed' };
    }
    if (m.proposal) out.proposal = m.proposal;
    if (m.isLiveSync) {
      out.isLiveSync = true;
      out.liveSource = m.liveSource || 'Manifold';
      out.liveExternalId = m.liveExternalId;
      out.liveExternalUrl = m.liveExternalUrl;
      out.liveProb = m.liveProb;
      out.liveVolume = m.liveVolume;
      out.liveLastSync = m.liveLastSync;
    }
    const fd = describeFeed(m); // provider-agnostic: crypto (CoinGecko) or weather (Open-Meteo)
    if (fd) {
      out.feed = fd;
      if (m.feedProposal) out.feedProposal = m.feedProposal;
    }
    if (m.outcomes && m.outcomes.length > 2) {
      out.multi = true;
      out.outcomes = m.outcomes.map((o, i) => {
        const key = Engine.bookKey(m.id, i);
        const b = this.books.get(key);
        const tape = (this.tape.get(key) || []).filter((t) => t.ts > Date.now() - 864e5);
        let vol = 0; for (const t of tape) vol += t.qty;
        return {
          idx: i, label: o.label, emoji: o.emoji || '🔵',
          last: this.mark(m.id, i),
          bid: b && b.bids.length ? b.bids[0].price : null,
          ask: b && b.asks.length ? b.asks[0].price : null,
          vol24: vol,
        };
      });
    }
    return out;
  }
}

module.exports = { Engine, KIND_MAP, MAX_QTY };
