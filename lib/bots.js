'use strict';
/**
 * Bots — market makers. They quote two-sided markets around a drifting "fair
 * value" (so the book is never empty and charts move), and occasionally take
 * resting orders — preferring human orders within their value band — so user
 * limit orders get filled. Bots trade through the exact same engine path as
 * humans; no shortcuts, no free money. Multi-outcome markets get one quoted
 * book per outcome.
 */
const { ApiError } = require('./auth');

class Bots {
  constructor(db, engine) {
    this.db = db;
    this.engine = engine;
    this.state = new Map(); // bookKey -> {target, momentum, lastQuote}
  }

  start() {
    const safe = (label, fn) => () => Promise.resolve()
      .then(fn)
      .catch((e) => console.error(`[bots] ${label}:`, e.message));
    this.quoteTimer = setInterval(safe('quote', () => this.quoteTick()), 3200);
    this.takeTimer = setInterval(safe('take', () => this.takeTick()), 5200);
    this.quoteTimer.unref(); this.takeTimer.unref();
    console.log('[bots] market makers running');
  }

  bots() { return this.db.find('users', (u) => u.role === 'bot'); }

  _st(key, init) {
    let s = this.state.get(key);
    if (!s) { s = { target: init, momentum: 0, lastQuote: 0 }; this.state.set(key, s); }
    return s;
  }

  _drift(s) {
    s.momentum = s.momentum * 0.86 + (Math.random() - 0.5) * 2.4;
    s.target += s.momentum + (50 - s.target) * 0.012;
    if (Math.random() < 0.035) s.target += (Math.random() - 0.5) * 14; // occasional news jump
    s.target = Math.max(6, Math.min(94, s.target));
    return s;
  }

  _botFor(keySeed) {
    const bots = this.bots();
    if (!bots.length) return null;
    const n = Number(keySeed) || 0;
    return bots[n % bots.length];
  }

  quoteTick() {
    const markets = this.db.find('markets', (m) => m.status === 'open' && m.closeTime > Date.now());
    const now = Date.now();
    for (const market of markets) {
      const multi = !!(market.outcomes && market.outcomes.length > 2);
      const bookCount = multi ? market.outcomes.length : 1;
      for (let idx = 0; idx < bookCount; idx++) {
        const key = `${market.id}:${idx}`;
        const s = this._st(key, this.engine.mark(market.id, idx) ?? (multi ? Math.floor(90 / bookCount) : 50));
        const jitter = (idx + market.id) % 3 * 3000;
        if (now - (s.lastQuote || 0) < 9000 + jitter) continue;
        const bot = this._botFor(market.id + idx);
        if (!bot) continue;
        this.engine.ensureBotFunds(bot, 2000000, 20000000);
        if (market.isLiveSync && typeof market.liveProb === 'number') {
          const liveFair = Math.max(2, Math.min(98, Math.round(market.liveProb * 100)));
          s.target = liveFair + (Math.random() - 0.5) * 1.2;
        } else {
          this._drift(s);
        }
        this._requote(market, idx, bot, s);
        s.lastQuote = now;
      }
    }
  }

  _requote(market, idx, bot, s) {
    const target = Math.round(s.target);
    const spread = 1 + Math.floor(Math.random() * 3); // 1..3 each side
    const bidP = Math.max(2, Math.min(97, target - spread));
    const askYesP = Math.max(bidP + 2, Math.min(98, target + spread));
    const bidQty = 60 + Math.floor(Math.random() * 220);
    const askQty = 60 + Math.floor(Math.random() * 220);
    const input = (side, outcome, price) => ({ side, outcome, type: 'limit', price, qty: 0, outcomeIdx: idx });

    // cancel my resting orders on this book, then quote both sides
    const mine = [...this.engine.orderIndex.values()].filter((o) => o.marketId === market.id && (o.outcomeIdx || 0) === idx && o.userId === bot.id);
    for (const o of mine) {
      try { this.engine.cancel(bot.id, o.id); } catch {}
    }
    try {
      this.engine.place(bot, market, { side: 'buy', outcome: 'yes', type: 'limit', price: bidP, qty: bidQty, outcomeIdx: idx });
      this.engine.place(bot, market, { side: 'buy', outcome: 'no', type: 'limit', price: 100 - askYesP, qty: askQty, outcomeIdx: idx });
    } catch (e) {
      if (!(e instanceof ApiError)) throw e; // engine rejections are fine; real bugs are not
    }
  }

  takeTick() {
    if (Math.random() < 0.45) return; // pace the tape
    const markets = this.db.find('markets', (m) => m.status === 'open' && m.closeTime > Date.now());
    if (!markets.length) return;
    const market = markets[Math.floor(Math.random() * markets.length)];
    const multi = !!(market.outcomes && market.outcomes.length > 2);
    const idx = multi ? Math.floor(Math.random() * market.outcomes.length) : 0;
    const key = `${market.id}:${idx}`;
    const s = this._drift(this._st(key, this.engine.mark(market.id, idx) ?? 50));
    const target = s.target;
    const bots = this.bots();
    if (!bots.length) return;
    const taker = bots[Math.floor(Math.random() * bots.length)];
    this.engine.ensureBotFunds(taker, 2000000, 20000000);

    const book = this.engine.marketBook(market.id, idx);
    const band = 5;
    // prefer taking HUMAN orders near fair value
    const humanBid = book.bids.find((o) => !o.isBot && o.price >= target - band);
    const humanAsk = book.asks.find((o) => !o.isBot && o.price <= target + band);

    try {
      if (humanBid && Math.random() < 0.75) {
        const qty = Math.min(humanBid.qty, 25 + Math.floor(Math.random() * 90));
        const kind = Math.random() < 0.5 ? 'BN' : 'SY';
        this.engine.place(taker, market, kind === 'SY'
          ? { side: 'sell', outcome: 'yes', type: 'limit', price: humanBid.price, qty, outcomeIdx: idx }
          : { side: 'buy', outcome: 'no', type: 'limit', price: 100 - humanBid.price, qty, outcomeIdx: idx });
      } else if (humanAsk && Math.random() < 0.75) {
        const qty = Math.min(humanAsk.qty, 25 + Math.floor(Math.random() * 90));
        const kind = Math.random() < 0.5 ? 'BY' : 'SN';
        this.engine.place(taker, market, kind === 'BY'
          ? { side: 'buy', outcome: 'yes', type: 'limit', price: humanAsk.price, qty, outcomeIdx: idx }
          : { side: 'sell', outcome: 'no', type: 'limit', price: 100 - humanAsk.price, qty, outcomeIdx: idx });
      } else if (Math.random() < 0.5) {
        // tape filler: take another bot's quote (never our own — engine blocks self-match)
        const mm = this._botFor(market.id + idx);
        const botBid = book.bids.find((o) => o.price >= target - 2);
        const botAsk = book.asks.find((o) => o.price <= target + 2);
        const qty = 15 + Math.floor(Math.random() * 60);
        if (botAsk && taker.id !== mm.id) {
          this.engine.place(taker, market, { side: 'buy', outcome: 'yes', type: 'limit', price: botAsk.price, qty, outcomeIdx: idx });
        } else if (botBid && taker.id !== mm.id) {
          this.engine.place(taker, market, { side: 'buy', outcome: 'no', type: 'limit', price: 100 - botBid.price, qty, outcomeIdx: idx });
        }
      }
    } catch (e) {
      if (!(e instanceof ApiError)) throw e;
    }
  }
}

module.exports = { Bots };
