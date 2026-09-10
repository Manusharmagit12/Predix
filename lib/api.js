'use strict';
/**
 * API — REST routes. All JSON. Auth via httpOnly session cookie.
 * Also hosts the SSE endpoint /api/events.
 */
const { seed, CATEGORIES, slugify } = require('./seed');
const { Auth, ApiError, SESSION_TTL_MS, verifyPassword, hashPassword } = require('./auth');
const { validateFeedConfig, SUPPORTED_ASSETS, assetMeta, describeFeed } = require('./feed');
const { AnalyticsEngine } = require('./analytics');

class Api {
  constructor(db, engine, hub, liveSync) {
    this.db = db;
    this.engine = engine;
    this.hub = hub;
    this.liveSync = liveSync;
    this.auth = new Auth(db);
    this.analytics = new AnalyticsEngine(db, engine, null);
    this.rate = new Map(); // ip -> {n, t}
    this.locks = new (require('./lock').MutexMap)(); // per user+market exclusion — concurrent-safe trading
  }

  /* ------------ plumbing ------------ */

  async handle(req, res) {
    const url = new URL(req.url, 'http://localhost');
    const p = url.pathname;
    const method = req.method;
    try {
      if (p === '/api/events' && method === 'GET') return this.events(req, res);

      if (!this._allow(req, res)) throw new ApiError(429, 'Too many requests — slow down.');

      let m;
      if (p === '/api/auth/signup' && method === 'POST') { return this.json(res, 201, await this.signup(await this.readJson(req))); }
      if (p === '/api/auth/login' && method === 'POST') return await this.login(await this.readJson(req), res);
      if (p === '/api/auth/logout' && method === 'POST') return this.logout(req, res);

      if (p === '/api/me' && method === 'GET') return this.me(req, res);
      if (p === '/api/markets' && method === 'GET') return this.markets(req, res, url);
      if ((m = p.match(/^\/api\/markets\/([\w-]+)$/)) && method === 'GET') return this.marketDetail(res, m[1], req);
      if (p === '/api/orders' && method === 'POST') return await this.placeOrder(req, res);
      if (p === '/api/deposit' && method === 'POST') return await this.deposit(req, res);
      if (p === '/api/wallet' && method === 'GET') return this.walletOverview(req, res);
      if (p === '/api/withdrawals' && method === 'GET') return this.myWithdrawals(req, res);
      if (p === '/api/withdrawals' && method === 'POST') return await this.requestWithdrawal(req, res);
      if ((m = p.match(/^\/api\/withdrawals\/(\d+)\/cancel$/)) && method === 'POST') return await this.cancelWithdrawal(req, res, +m[1]);
      if (p === '/api/admin/withdrawals' && method === 'GET') return this.adminWithdrawals(req, res);
      if ((m = p.match(/^\/api\/admin\/withdrawals\/(\d+)\/(approve|reject|complete)$/)) && method === 'POST') return await this.adminWithdrawalAction(req, res, +m[1], m[2]);
      if ((m = p.match(/^\/api\/orders\/(\d+)\/cancel$/)) && method === 'POST') return await this.cancelOrder(req, res, +m[1]);
      if (p === '/api/portfolio' && method === 'GET') return this.portfolio(req, res);
      if (p === '/api/promo/redeem' && method === 'POST') return await this.redeem(req, res);
      if (p === '/api/leaderboard' && method === 'GET') return this.leaderboard(res, url);
      if (p === '/api/meta' && method === 'GET') return this.json(res, 200, { categories: CATEGORIES });
      if (p === '/api/stats' && method === 'GET') return this.publicStats(res);
      if ((m = p.match(/^\/api\/markets\/([\w-]+)\/comments$/)) && method === 'GET') return this.marketComments(res, m[1]);
      if ((m = p.match(/^\/api\/markets\/([\w-]+)\/comments$/)) && method === 'POST') return await this.postComment(req, res, m[1]);
      if (p === '/api/me/alerts' && method === 'GET') return this.myAlerts(req, res);
      if (p === '/api/me/alerts' && method === 'POST') return await this.createAlert(req, res);
      if ((m = p.match(/^\/api\/me\/alerts\/(\d+)$/)) && method === 'DELETE') return this.deleteAlert(req, res, +m[1]);
      if (p === '/api/me/stats' && method === 'GET') return this.myStats(req, res);
      if (p === '/api/me/achievements' && method === 'GET') return this.myAchievements(req, res);
      if ((m = p.match(/^\/api\/traders\/([A-Za-z0-9_]{3,24})$/)) && method === 'GET') return this.traderProfile(res, m[1]);

      if (p === '/api/analytics' && method === 'GET') return this.platformAnalytics(res);
      if ((m = p.match(/^\/api\/markets\/([\w-]+)\/analytics$/)) && method === 'GET') return this.marketAnalytics(res, m[1], url);
      if (p === '/api/admin/sync-live' && method === 'POST') return await this.syncLiveMarkets(req, res);
      if (p === '/api/live-sync/stats' && method === 'GET') return this.liveSyncStats(req, res);

      if (p === '/api/watchlist' && method === 'GET') return this.watchlist(req, res);
      if (p === '/api/watchlist/toggle' && method === 'POST') return await this.watchToggle(req, res);
      if (p === '/api/me/notifications' && method === 'GET') return this.notifications(req, res);
      if (p === '/api/me/notifications/read' && method === 'POST') return this.notificationsRead(req, res);
      if (p === '/api/me/password' && method === 'POST') return await this.changePassword(req, res);

      if (p === '/api/admin/markets' && method === 'POST') return await this.adminCreateMarket(req, res);
      if (p === '/api/price' && method === 'GET') return await this.priceQuote(req, res);
      if (p === '/api/weather' && method === 'GET') return await this.weatherQuote(req, res);
      if ((m = p.match(/^\/api\/admin\/markets\/(\d+)\/feed-refresh$/)) && method === 'POST') return await this.adminFeedRefresh(req, res, +m[1]);
      if ((m = p.match(/^\/api\/admin\/markets\/(\d+)\/resolve$/)) && method === 'POST') return await this.adminResolve(req, res, +m[1]);
      if ((m = p.match(/^\/api\/admin\/markets\/(\d+)\/settle$/)) && method === 'POST') return await this.adminSettle(req, res, +m[1]);
      if ((m = p.match(/^\/api\/markets\/([\w.-]+)\/resolution$/)) && method === 'GET') return this.marketResolution(res, m[1]);
      if ((m = p.match(/^\/api\/admin\/markets\/(\d+)\/(halt|open)$/)) && method === 'POST') return await this.adminHalt(req, res, +m[1], m[2]);
      if (p === '/api/admin/stats' && method === 'GET') return this.adminStats(req, res);

      throw new ApiError(404, 'Not found.');
    } catch (e) {
      const status = e instanceof ApiError ? e.status : 500;
      if (status === 500) console.error('[api]', p, e);
      if (res.headersSent) { try { res.end(); } catch {} return; }
      return this.json(res, status, { error: e.message || 'Server error' });
    }
  }

  async json(res, status, data, headers) {
    try {
      if (this.db && this.db.flush) await this.db.flush(); // durability: commit SQL before the client sees a response
    } catch (e) {
      console.error('‼️ [api] persistence flush failed:', e.message);
      status = 500; data = { error: 'Persistence failure — operation rolled back.' };
    }
    const body = JSON.stringify(data);
    res.writeHead(status, Object.assign({
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    }, headers || {}));
    res.end(body);
  }

  readJson(req, limit = 100 * 1024) {
    return new Promise((resolve, reject) => {
      let size = 0; const chunks = [];
      req.on('data', (c) => {
        size += c.length;
        if (size > limit) { reject(new ApiError(413, 'Payload too large.')); req.destroy(); return; }
        chunks.push(c);
      });
      req.on('end', () => {
        if (!chunks.length) return resolve({});
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
        catch { reject(new ApiError(400, 'Invalid JSON body.')); }
      });
      req.on('error', reject);
    });
  }

  _allow(req) {
    const url = new URL(req.url, 'http://localhost');
    const authy = url.pathname.startsWith('/api/auth');
    const ip = (req.socket.remoteAddress || 'x') + (authy ? ':auth' : ':api'); // separate buckets so heavy browsing never locks out auth
    const cap = authy ? 40 : 600;
    const win = 60 * 1000;
    const now = Date.now();
    let b = this.rate.get(ip);
    if (!b || now - b.t > win) { b = { n: 0, t: now }; this.rate.set(ip, b); }
    b.n++;
    if (this.rate.size > 5000) this.rate.clear();
    return b.n <= cap;
  }

  user(req) {
    const u = this.auth.userForRequest(req);
    if (!u) throw new ApiError(401, 'Please log in.');
    return u;
  }

  /* ------------ SSE ------------ */

  events(req, res) {
    const user = this.auth.userForRequest(req);
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-store, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write('retry: 3000\n\n');
    const client = this.hub.addClient(res, user);
    this.send(client, 'init', {
      me: user ? this.publicUser(user) : null,
      snapshot: user ? this.engine.userSnapshot(user.id) : null,
      markets: this.db.all('markets').map((mk) => this.engine.marketPublic(mk)),
    });
  }

  send(client, event, data) { this.hub.send(client, event, data); }

  /* ------------ auth ------------ */

  publicUser(u) {
    return { id: u.id, username: u.username, email: u.email, role: u.role, createdAt: u.createdAt };
  }

  async signup(body) {
    const user = this.auth.signup(body);
    let promoApplied = null;
    const code = body && body.promo;
    const promo = code ? this.auth.lookupPromo(code) : null;
    if (promo) {
      const already = this.db.findOne('redemptions', (r) => r.userId === user.id && r.code === promo.code);
      if (!already) {
        this.db.insert('redemptions', { userId: user.id, code: promo.code, amount: promo.amount, ts: Date.now() });
        this.engine.creditWallet(user.id, promo.amount, 'promo', `Promo ${promo.code} — ${promo.label}`);
        promoApplied = { code: promo.code, amount: promo.amount };
      }
    }
    // referral program: both sides get $10 play money
    let referral = null;
    const ref = body && body.ref;
    if (ref) {
      const referrer = this.db.findOne('users', (u) => u.role !== 'bot' && u.username.toLowerCase() === String(ref).trim().toLowerCase());
      if (referrer && referrer.id !== user.id) {
        const REF_AMOUNT = 1000;
        this.db.insert('redemptions', { userId: user.id, code: 'REFERRAL:' + referrer.username, amount: REF_AMOUNT, ts: Date.now() });
        this.db.insert('redemptions', { userId: referrer.id, code: 'REFERRAL:' + user.username, amount: REF_AMOUNT, ts: Date.now() });
        this.engine.creditWallet(user.id, REF_AMOUNT, 'referral', `Referral bonus — you joined via @${referrer.username}`);
        await this.locks.run(['u:' + referrer.id], () => {
          this.engine.creditWallet(referrer.id, REF_AMOUNT, 'referral', `Referral bonus — @${user.username} joined with your code`);
        });
        referral = { by: referrer.username, amount: REF_AMOUNT };
      }
    }
    return { user: this.publicUser(user), promoApplied, referral, snapshot: this.engine.userSnapshot(user.id) };
  }

  async login(body, res) {
    const user = this.auth.login(body.identifier, body.password);
    const token = this.auth.createSession(user.id);
    this.json(res, 200, {
      user: this.publicUser(user),
      snapshot: this.engine.userSnapshot(user.id),
    }, { 'Set-Cookie': this.auth.sessionCookie(token, SESSION_TTL_MS / 1000) });
  }

  logout(req, res) {
    const token = this.auth.tokenForRequest(req);
    if (token) this.auth.destroySession(token);
    this.json(res, 200, { ok: true }, { 'Set-Cookie': this.auth.clearCookie() });
  }

  me(req, res) {
    const u = this.auth.userForRequest(req);
    if (!u) return this.json(res, 200, { user: null });
    const unread = this.db.find('notifications', (n) => n.userId === u.id && !n.read).length;
    const watching = this.db.find('watchlist', (w) => w.userId === u.id).length;
    this.json(res, 200, {
      user: this.publicUser(u),
      snapshot: this.engine.userSnapshot(u.id),
      rewards: this.engine.rewardsFor(u.id),
      unread, watching,
    });
  }

  /* ------------ markets ------------ */

  markets(req, res, url) {
    let list = this.db.all('markets').map((m) => this.engine.marketPublic(m));
    const cat = url.searchParams.get('category');
    const q = (url.searchParams.get('q') || '').toLowerCase();
    if (cat && cat !== 'All') {
      if (cat === 'Live' || cat === 'Live-Sync') list = list.filter((m) => m.isLiveSync);
      else list = list.filter((m) => m.category === cat);
    }
    if (q) list = list.filter((m) => (m.title + ' ' + m.category).toLowerCase().includes(q));
    // compact spark data for home-page charts (prices only, ~3 days hourly)
    list = list.map((m) => {
      const mk = this.db.findOne('markets', (r) => r.slug === m.slug);
      if (!mk) return m;
      return { ...m, spark: this.db.histFor(mk.id).slice(-72).map((p) => p[1]) };
    });
    const sort = url.searchParams.get('sort') || 'volume';
    list.sort((a, b) => {
      const ao = a.status === 'open' ? 0 : 1, bo = b.status === 'open' ? 0 : 1;
      if (ao !== bo) return ao - bo; // open markets first
      if (sort === 'closing' && ao === 0) return a.closeTime - b.closeTime;
      if (sort === 'newest') return b.createdAt - a.createdAt;
      if (sort === 'title') return a.title.localeCompare(b.title);
      return (b.vol24 || 0) - (a.vol24 || 0);
    });
    this.json(res, 200, { markets: list });
  }

  async marketDetail(res, slug, req) {
    const market = this.db.findOne('markets', (m) => m.slug === slug);
    if (!market) throw new ApiError(404, 'Market not found.');
    const out = this.engine.marketPublic(market);
    if (out.feed) {
      try { out.feedQuote = await this.engine.feedQuote(market); } catch { out.feedQuote = null; } // cached; never blocks the page
    }
    if (out.multi) {
      out.historyByOutcome = out.outcomes.map((o) => this.db.histFor(market.id + ':' + o.idx));
      out.bookByOutcome = out.outcomes.map((o) => this.engine.marketBook(market.id, o.idx));
    } else {
      out.history = this.db.histFor(market.id);
      out.book = this.engine.marketBook(market.id);
    }
    out.trades = this.db.find('trades', (t) => t.marketId === market.id)
      .sort((a, b) => b.ts - a.ts).slice(0, 40)
      .map((t) => ({
        id: t.id, price: t.price, qty: t.qty, ts: t.ts, takerKind: t.takerKind, outcomeIdx: t.outcomeIdx || 0,
        taker: this.engine._username(t.takerUserId), maker: this.engine._username(t.makerUserId),
      }));
    out.comments = this.db.find('comments', (c) => c.marketId === market.id)
      .sort((a, b) => b.id - a.id).slice(0, 100)
      .map((c) => ({ id: c.id, user: this.engine._username(c.userId), body: c.body, ts: c.ts }));
    const u = this.auth.userForRequest(req);
    if (u) {
      const snap = this.engine.userSnapshot(u.id);
      out.position = snap.positions.find((p) => p.marketId === market.id) || null;
      out.myOrders = snap.orders.filter((o) => o.marketId === market.id);
      out.myPastOrders = this.db.find('orders', (o) => o.userId === u.id && o.marketId === market.id && o.status !== 'open')
        .sort((a, b) => (b.updatedAt || b.createdAt || b.id) - (a.updatedAt || a.createdAt || a.id))
        .slice(0, 30)
        .map((o) => this.engine._publicOrder(o));
      out.myTrades = this.db.find('trades', (t) => t.marketId === market.id && (t.takerUserId === u.id || t.makerUserId === u.id))
        .sort((a, b) => b.ts - a.ts)
        .slice(0, 30)
        .map((t) => ({
          id: t.id, price: t.price, qty: t.qty, ts: t.ts, takerKind: t.takerKind,
          side: (t.takerUserId === u.id ? (t.takerKind === 'BY' || t.takerKind === 'BN' ? 'buy' : 'sell') : (t.makerKind === 'BY' || t.makerKind === 'BN' ? 'buy' : 'sell')),
          outcome: (t.takerUserId === u.id ? (t.takerKind === 'BY' || t.takerKind === 'SY' ? 'yes' : 'no') : (t.makerKind === 'BY' || t.makerKind === 'SY' ? 'yes' : 'no')),
          role: t.takerUserId === u.id ? 'Taker' : 'Maker',
        }));
      out.watching = !!this.db.findOne('watchlist', (w) => w.userId === u.id && w.marketId === market.id);
    }
    this.json(res, 200, out);
  }

  /* ------------ trading ------------ */

  /* ------------ external market data (CoinGecko, display/proposal only) ------------ */

  /** public cached quote: GET /api/price?asset=bitcoin — live reference price for the market UI */
  async priceQuote(req, res) {
    const url = new URL(req.url, 'http://x');
    const asset = (url.searchParams.get('asset') || '').toLowerCase();
    if (!SUPPORTED_ASSETS[asset]) throw new ApiError(400, 'asset must be one of: ' + Object.keys(SUPPORTED_ASSETS).join(', '));
    const meta = assetMeta(asset);
    const q = await this.engine.feeds.quote(asset, 'usd', {});
    this.json(res, 200, { ...q, label: meta.label, symbol: meta.symbol, emoji: meta.emoji, currency: 'USD' });
  }

  /** public cached quote: GET /api/weather?lat=18.52&lon=73.86&metric=temperature&unit=celsius */
  async weatherQuote(req, res) {
    const url = new URL(req.url, 'http://x');
    const q = await this.engine.weather.quote({
      latitude: parseFloat(url.searchParams.get('lat')),
      longitude: parseFloat(url.searchParams.get('lon')),
      metric: (url.searchParams.get('metric') || 'temperature').toLowerCase(),
      unit: (url.searchParams.get('unit') || '').toLowerCase() || undefined,
    });
    if (q.status === 'unavailable' && q.error && !/network|HTTP/i.test(q.error)) throw new ApiError(400, q.error);
    const met = describeFeed({ provider: 'open-meteo', metric: q.metric, unit: q.unit, latitude: q.latitude, longitude: q.longitude }) || {};
    this.json(res, 200, { ...q, metricLabel: met.metricLabel, unitLabel: met.unitLabel, latLonText: met.latLonText });
  }

  /** admin: force-refresh a market's feed and (re)generate its resolution proposal */
  async adminFeedRefresh(req, res, id) {
    this._admin(req);
    const market = this.db.get('markets', id);
    if (!market) throw new ApiError(404, 'Market not found.');
    if (!market.provider || (market.assetId == null && market.latitude == null)) throw new ApiError(400, 'This market has no data feed.');
    const proposal = await this.engine.updateFeedProposal(market, { force: true });
    const out = this.engine.marketPublic(market);
    this.json(res, 200, { feed: out.feed || null, feedProposal: out.feedProposal || proposal || null, rule: this.engine.feedRuleText(market) });
  }

  /* ------------ payments & deposits (play money simulation) ------------ */

  async deposit(req, res) {
    const user = this.user(req);
    const b = await this.readJson(req);
    const amountCents = Number(b.amountCents);
    if (!Number.isInteger(amountCents) || amountCents < 500 || amountCents > 10000000) {
      throw new ApiError(400, 'Deposit amount must be between $5.00 and $100,000.00.');
    }
    const method = String(b.method || 'card').toLowerCase();
    const memo = b.memo || (method === 'crypto'
      ? `Instant Crypto Deposit (USDC on ${b.network || 'Polygon'})`
      : method === 'bank'
      ? `ACH Bank Deposit (${b.bankName || 'Linked Bank'})`
      : `Instant Card Deposit (ending in ${b.last4 || '4242'})`);
    const txId = 'dep_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    return this.locks.run(['u:' + user.id], async () => {
      const w = this.engine.creditWallet(user.id, amountCents, 'deposit', memo, 'deposit', txId);
      this.json(res, 201, {
        ok: true,
        amount: amountCents,
        depositedCents: amountCents,
        balance: w.available,
        txId,
        method,
        memo,
        ts: Date.now(),
      });
    });
  }

  walletOverview(req, res) {
    const user = this.user(req);
    const snap = this.engine.userSnapshot(user.id);
    const ledger = (this.db.find('ledger', (l) => l.userId === user.id) || [])
      .sort((a, b) => b.id - a.id).slice(0, 100);
    const withdrawals = this.engine.withdrawalsFor(user.id);
    let totalDeposited = 0;
    for (const l of ledger) {
      if (l.type === 'deposit' || l.type === 'promo' || l.type === 'referral') {
        totalDeposited += l.amount;
      }
    }
    this.json(res, 200, {
      wallet: snap.wallet,
      cumulativeDeposits: totalDeposited,
      totalDeposited,
      withdrawals,
      ledger,
      demo: true,
    });
  }

  /* ------------ simulated withdrawals (play money only) ------------ */

  myWithdrawals(req, res) {
    const u = this.user(req);
    const w = this.engine._wallet(u.id);
    this.json(res, 200, {
      wallet: { available: w.available, reserved: w.reserved, withdrawReserved: w.withdrawReserved || 0, withdrawable: w.available },
      withdrawals: this.engine.withdrawalsFor(u.id),
      demo: true, // play-money withdrawal for demonstration purposes
    });
  }

  async requestWithdrawal(req, res) {
    const u = this.user(req);
    const b = await this.readJson(req);
    return this.locks.run(['u:' + u.id], async () => {
      const r = this.engine.requestWithdrawal(u.id, b.amountCents, { idemKey: b.idemKey });
      this.json(res, 201, r);
    });
  }

  async cancelWithdrawal(req, res, id) {
    const u = this.user(req);
    return this.locks.run(['u:' + u.id], async () => {
      this.json(res, 200, this.engine.cancelWithdrawal(u.id, id));
    });
  }

  adminWithdrawals(req, res) {
    this._admin(req);
    const rows = (this.db.all('withdrawals') || []).slice().sort((a, b) => b.id - a.id);
    this.json(res, 200, {
      withdrawals: rows.map((r) => ({ ...this.engine._publicWithdrawal(r), username: (this.db.get('users', r.userId) || {}).username || '?' })),
      counts: rows.reduce((acc, r) => { acc[r.status] = (acc[r.status] || 0) + 1; return acc; }, {}),
    });
  }

  async adminWithdrawalAction(req, res, id, action) {
    const admin = this._admin(req);
    const b = action === 'complete' || action === 'reject' ? await this.readJson(req) : {};
    const wd = this.db.get('withdrawals', id);
    if (!wd) throw new ApiError(404, 'Withdrawal not found.');
    return this.locks.run(['u:' + wd.userId], async () => {
      this.json(res, 200, this.engine.adminWithdrawal(admin, id, action, (b && b.note) || ''));
    });
  }

  async placeOrder(req, res) {
    const user = this.user(req);
    const body = await this.readJson(req);
    const market = this.db.findOne('markets', (m) => m.slug === body.market || m.id === body.marketId || (body.marketId && m.id === Number(body.marketId)));
    if (!market) throw new ApiError(404, 'Market not found.');
    // serialize per wallet + per market: same wallet can't double-spend, same
    // book can't be matched concurrently — unrelated users/markets stay parallel
    return this.locks.run(['u:' + user.id, 'm:' + market.id], async () => {
      const result = this.engine.place(user, market, {
        side: body.side, outcome: body.outcome, type: body.type, price: body.price, qty: body.qty,
        outcomeIdx: body.outcomeIdx, tif: body.tif, stp: body.stp, idemKey: body.idemKey,
      });
      this.json(res, 201, result);
    });
  }

  async cancelOrder(req, res, id) {
    const user = this.user(req);
    const order = this.engine.orderIndex.get(id);
    if (!order) throw new ApiError(404, 'Order not found or no longer open.');
    return this.locks.run(['u:' + user.id, 'm:' + order.marketId], async () => {
      this.engine.cancel(user.id, id); // cancel-vs-fill races serialize on the market lock
      this.json(res, 200, { ok: true });
    });
  }

  /* ------------ portfolio / promo / social ------------ */

  portfolio(req, res) {
    const user = this.user(req);
    const snap = this.engine.userSnapshot(user.id);
    const trades = this.db.find('trades', (t) => t.takerUserId === user.id || t.makerUserId === user.id)
      .sort((a, b) => b.ts - a.ts).slice(0, 100);
    const ledger = this.db.find('ledger', (l) => l.userId === user.id)
      .sort((a, b) => b.id - a.id).slice(0, 100);
    const referrals = this.db.find('redemptions', (r) => r.userId === user.id && String(r.code).startsWith('REFERRAL:')).length;
    const orderHistory = this.db.find('orders', (o) => o.userId === user.id && o.status !== 'open')
      .sort((a, b) => (b.updatedAt || b.createdAt || b.id) - (a.updatedAt || a.createdAt || a.id))
      .slice(0, 100)
      .map((o) => this.engine._publicOrder(o));
    this.json(res, 200, {
      ...snap, trades, ledger, orderHistory, user: this.publicUser(user),
      rewards: this.engine.rewardsFor(user.id), referralCount: referrals,
    });
  }

  /* ------------ watchlist / notifications / profile ------------ */

  watchlist(req, res) {
    const u = this.user(req);
    const rows = this.db.find('watchlist', (w) => w.userId === u.id);
    const markets = rows.map((r) => this.db.get('markets', r.marketId)).filter(Boolean)
      .map((mk) => {
        const pub = this.engine.marketPublic(mk);
        pub.spark = this.db.histFor(mk.id).slice(-72).map((p) => p[1]);
        return pub;
      });
    this.json(res, 200, { markets });
  }

  async watchToggle(req, res) {
    const u = this.user(req);
    const b = await this.readJson(req);
    const market = this.db.get('markets', Number(b.marketId));
    if (!market) throw new ApiError(404, 'Market not found.');
    const row = this.db.findOne('watchlist', (w) => w.userId === u.id && w.marketId === market.id);
    if (row) { this.db.remove('watchlist', row.id); return this.json(res, 200, { watching: false }); }
    this.db.insert('watchlist', { userId: u.id, marketId: market.id, ts: Date.now() });
    this.json(res, 200, { watching: true });
  }

  notifications(req, res) {
    const u = this.user(req);
    const list = this.db.find('notifications', (n) => n.userId === u.id)
      .sort((a, b) => b.id - a.id).slice(0, 50);
    const unread = this.db.find('notifications', (n) => n.userId === u.id && !n.read).length;
    this.json(res, 200, { notifications: list, unread });
  }

  notificationsRead(req, res) {
    const u = this.user(req);
    const rows = this.db.find('notifications', (n) => n.userId === u.id && !n.read);
    this.db.tx(() => { for (const n of rows) { n.read = true; this.db.update('notifications', n); } });
    this.json(res, 200, { ok: true });
  }

  async changePassword(req, res) {
    const u = this.user(req);
    const b = await this.readJson(req);
    if (!verifyPassword(b.current || '', u.salt, u.passHash)) throw new ApiError(401, 'Current password is incorrect.');
    if (!Auth.validatePassword(b.next)) throw new ApiError(400, 'New password must be at least 8 characters.');
    const { salt, hash } = hashPassword(b.next);
    u.salt = salt; u.passHash = hash;
    this.db.update('users', u);
    this.engine.notify(u.id, 'security', 'Password changed', 'Your password was updated successfully.');
    this.json(res, 200, { ok: true });
  }

  publicStats(res) {
    const traders = this.db.all('users').filter((u) => u.role !== 'bot').length;
    let vol24 = 0;
    const markets = this.db.all('markets');
    for (const m of markets) vol24 += this.engine.summary(m).vol24;
    this.json(res, 200, {
      traders, markets: markets.length,
      openMarkets: markets.filter((m) => m.status === 'open').length,
      trades: this.db.all('trades').length, vol24,
    });
  }

  /* ------------ comments ------------ */

  marketComments(res, slug) {
    const market = this.db.findOne('markets', (m) => m.slug === slug);
    if (!market) throw new ApiError(404, 'Market not found.');
    const list = this.db.find('comments', (c) => c.marketId === market.id)
      .sort((a, b) => b.id - a.id).slice(0, 100)
      .map((c) => ({ id: c.id, user: this.engine._username(c.userId), body: c.body, ts: c.ts }));
    this.json(res, 200, { comments: list });
  }

  async postComment(req, res, slug) {
    const u = this.user(req);
    const b = await this.readJson(req);
    const body = String(b.body || '').trim();
    if (body.length < 1 || body.length > 500) throw new ApiError(400, 'Comment must be 1–500 characters.');
    const market = this.db.findOne('markets', (m) => m.slug === slug);
    if (!market) throw new ApiError(404, 'Market not found.');
    this.db.insert('comments', { userId: u.id, marketId: market.id, body, ts: Date.now() });
    this.engine.checkAchievements(u.id);
    const comment = { id: Date.now(), user: u.username, body, ts: Date.now() };
    this.hub.broadcast('comment', { slug, comment });
    this.json(res, 201, { ok: true, comment });
  }

  /* ------------ alerts ------------ */

  myAlerts(req, res) {
    const u = this.user(req);
    const rows = this.db.find('alerts', (a) => a.userId === u.id).sort((a, b) => b.id - a.id).slice(0, 50)
      .map((a) => {
        const m = this.db.get('markets', a.marketId);
        return {
          id: a.id, marketId: a.marketId, slug: m ? m.slug : null, title: m ? m.title : '?',
          outcomeIdx: a.outcomeIdx || 0,
          optionLabel: m && m.outcomes && m.outcomes[a.outcomeIdx || 0] ? m.outcomes[a.outcomeIdx || 0].label : null,
          dir: a.dir, price: a.price, status: a.status, ts: a.ts,
        };
      });
    this.json(res, 200, { alerts: rows });
  }

  async createAlert(req, res) {
    const u = this.user(req);
    const b = await this.readJson(req);
    const market = this.db.get('markets', Number(b.marketId));
    if (!market) throw new ApiError(404, 'Market not found.');
    const price = Number(b.price);
    if (!Number.isInteger(price) || price < 1 || price > 99) throw new ApiError(400, 'Alert price must be 1–99¢.');
    if (!['above', 'below'].includes(b.dir)) throw new ApiError(400, 'Alert direction must be above or below.');
    const outcomeIdx = Number(b.outcomeIdx || 0) || 0;
    if (market.outcomes && market.outcomes.length > 2 && (outcomeIdx < 0 || outcomeIdx >= market.outcomes.length)) {
      throw new ApiError(400, 'Invalid outcome.');
    }
    const dupe = this.db.findOne('alerts', (a) => a.userId === u.id && a.marketId === market.id
      && (a.outcomeIdx || 0) === outcomeIdx && a.dir === b.dir && a.price === price && a.status === 'active');
    if (dupe) throw new ApiError(409, 'You already have this alert.');
    if (this.db.find('alerts', (a) => a.userId === u.id && a.status === 'active').length >= 20) {
      throw new ApiError(409, 'Maximum 20 active alerts.');
    }
    this.db.insert('alerts', { userId: u.id, marketId: market.id, outcomeIdx, dir: b.dir, price, status: 'active', ts: Date.now() });
    this.json(res, 201, { ok: true });
  }

  deleteAlert(req, res, id) {
    const u = this.user(req);
    const a = this.db.get('alerts', id);
    if (!a || a.userId !== u.id) throw new ApiError(404, 'Alert not found.');
    this.db.remove('alerts', id);
    this.json(res, 200, { ok: true });
  }

  /* ------------ personal stats & achievements ------------ */

  myStats(req, res) {
    const u = this.user(req);
    this.json(res, 200, { stats: this.engine.statsFor(u.id) });
  }

  myAchievements(req, res) {
    const u = this.user(req);
    this.json(res, 200, { achievements: this.engine.achievementsFor(u.id) });
  }

  /* ------------ public trader profile ------------ */

  traderProfile(res, username) {
    const u = this.db.findOne('users', (r) => r.username.toLowerCase() === username.toLowerCase());
    if (!u || u.role === 'bot') throw new ApiError(404, 'Trader not found.');
    const w = this.engine._wallet(u.id);
    let positionsValue = 0, deposits = 0;
    const positions = [];
    for (const p of this.db.find('positions', (r) => r.userId === u.id)) {
      if (!p.yesQty && !p.noQty) continue;
      const m = this.db.get('markets', p.marketId);
      if (!m) continue;
      const mk = this.engine.mark(p.marketId, p.outcomeIdx || 0);
      if (mk !== null) positionsValue += p.yesQty * mk + p.noQty * (100 - mk);
      positions.push({
        slug: m.slug, title: m.title, emoji: m.emoji,
        optionLabel: m.outcomes && m.outcomes[p.outcomeIdx || 0] ? m.outcomes[p.outcomeIdx || 0].label : null,
        yesQty: p.yesQty, noQty: p.noQty, mark: mk,
      });
    }
    for (const l of this.db.find('ledger', (r) => r.userId === u.id && (r.type === 'promo' || r.type === 'referral' || r.type === 'deposit'))) deposits += l.amount;
    const stats = this.engine.statsFor(u.id);
    this.json(res, 200, {
      trader: {
        username: u.username, createdAt: u.createdAt,
        equity: w.available + w.reserved + positionsValue,
        deposits, pnl: w.available + w.reserved + positionsValue - deposits,
        rewards: this.engine.rewardsFor(u.id),
        achievements: this.engine.achievementsFor(u.id).filter((a) => a.earned),
        stats, positions: positions.slice(0, 10),
      },
    });
  }

  async redeem(req, res) {
    const user = this.user(req);
    const body = await this.readJson(req);
    const promo = this.auth.lookupPromo(body.code);
    if (!promo) throw new ApiError(404, 'Invalid or expired promo code.');
    return this.locks.run(['u:' + user.id], async () => {
      const already = this.db.findOne('redemptions', (r) => r.userId === user.id && r.code === promo.code);
      if (already) throw new ApiError(409, 'You already redeemed this code.');
      this.db.insert('redemptions', { userId: user.id, code: promo.code, amount: promo.amount, ts: Date.now() });
      this.engine.creditWallet(user.id, promo.amount, 'promo', `Promo ${promo.code} — ${promo.label}`);
      this.json(res, 200, { ok: true, code: promo.code, amount: promo.amount });
    });
  }

  leaderboard(res, reqUrl) {
    const win = reqUrl ? (reqUrl.searchParams.get('window') || 'all') : 'all';
    const now = Date.now();
    const windows = { today: 864e5, week: 7 * 864e5 };
    const span = windows[win] || null;
    const rows = [];
    for (const u of this.db.all('users')) {
      if (u.role === 'bot') continue;
      const w = this.engine._wallet(u.id);
      let positionsValue = 0, deposits = 0;
      for (const p of this.db.find('positions', (r) => r.userId === u.id)) {
        const mark = this.engine.mark(p.marketId, p.outcomeIdx || 0);
        if (mark !== null) positionsValue += p.yesQty * mark + p.noQty * (100 - mark);
      }
      for (const l of this.db.find('ledger', (r) => r.userId === u.id && r.type === 'promo')) deposits += l.amount;
      const equity = w.available + w.reserved + positionsValue;
      let windowVolume = null;
      if (span) {
        windowVolume = 0;
        for (const t of this.db.all('trades')) {
          if (t.ts < now - span) continue;
          if (t.takerUserId === u.id || t.makerUserId === u.id) windowVolume += t.price * t.qty;
        }
      }
      rows.push({
        username: u.username, equity, deposits,
        pnl: equity - deposits,
        pnlPct: deposits > 0 ? +(100 * (equity - deposits) / deposits).toFixed(1) : null,
        windowVolume,
      });
    }
    rows.sort((a, b) => span ? (b.windowVolume || 0) - (a.windowVolume || 0) : b.equity - a.equity);
    rows.splice(25);
    this.json(res, 200, { leaderboard: rows, window: span ? win : 'all', metric: span ? 'volume' : 'equity' });
  }

  /* ------------ admin ------------ */

  _admin(req) {
    const u = this.user(req);
    if (u.role !== 'admin') throw new ApiError(403, 'Admin only.');
    return u;
  }

  async adminCreateMarket(req, res) {
    this._admin(req);
    const b = await this.readJson(req);
    const title = String(b.title || '').trim();
    if (title.length < 10 || title.length > 200) throw new ApiError(400, 'Title must be 10–200 characters.');
    const closeTime = Number(b.closeTime);
    if (!Number.isFinite(closeTime) || closeTime < Date.now() + 3600 * 1000) throw new ApiError(400, 'Close time must be at least 1 hour in the future.');
    let base = Number(b.baseProb);
    if (!Number.isFinite(base)) base = 50;
    base = Math.max(5, Math.min(95, Math.round(base)));
    // optional multi-outcome (3-8 options)
    let outcomes = null;
    if (Array.isArray(b.outcomes) && b.outcomes.length >= 3 && b.outcomes.length <= 8) {
      outcomes = b.outcomes.map((o) => ({
        label: String(typeof o === 'string' ? o : (o.label || '')).trim().slice(0, 60),
        emoji: String(typeof o === 'object' ? (o.emoji || '') : '').slice(0, 4),
      })).filter((o) => o.label.length > 0);
      if (outcomes.length < 3) outcomes = null;
    }
    const slugBase = slugify(title);
    let slug = slugBase, n = 1;
    while (this.db.findOne('markets', (m) => m.slug === slug)) slug = `${slugBase}-${++n}`;
    const now = Date.now();
    // optional CoinGecko price feed (BTC/ETH markets) — display + resolution proposal only
    let feedCfg = null;
    if (b.feed && (b.feed.assetId || b.feed.targetValue !== undefined)) {
      try {
        feedCfg = validateFeedConfig({ ...b.feed, resolutionTime: b.feed.resolutionTime || closeTime });
      } catch (e) { throw new ApiError(400, 'Market feed: ' + e.message); }
    }
    const market = this.db.insert('markets', {
      slug, title,
      emoji: String(b.emoji || '📊').slice(0, 8),
      category: CATEGORIES.includes(b.category) ? b.category : 'Politics',
      description: String(b.description || '').slice(0, 2000),
      resolutionSource: String(b.resolutionSource || 'Admin / committee decision').slice(0, 500),
      resolutionRules: String(b.resolutionRules || b.resolutionRule || 'Resolved by the market committee per published rules.').slice(0, 2000),
      expectedResolutionTime: Number(b.expectedResolutionTime) > 0 ? Number(b.expectedResolutionTime) : closeTime + 48 * 3600 * 1000,
      resolver: String(b.resolver || 'admin').slice(0, 40),
      closeTime, createdAt: now, status: 'open', outcome: null, featured: false,
      outcomes, // null = binary YES/NO
      last: outcomes ? null : base, lastTradeTs: now,
      ...(feedCfg ? {
        provider: feedCfg.provider, operator: feedCfg.operator, targetValue: feedCfg.targetValue,
        feedResolutionTime: feedCfg.resolutionTime || closeTime,
        ...(feedCfg.provider === 'open-meteo'
          ? { latitude: feedCfg.latitude, longitude: feedCfg.longitude, metric: feedCfg.metric, unit: feedCfg.unit, ...(feedCfg.location ? { location: feedCfg.location } : {}) }
          : { assetId: feedCfg.assetId, currency: feedCfg.currency }),
      } : {}),
    });
    if (outcomes) {
      // chart history per outcome book
      const per = Math.max(5, Math.min(95, Math.floor(92 / outcomes.length)));
      outcomes.forEach((o, i) => {
        let p = per + Math.floor(Math.random() * 8 - 4);
        for (let k = 48; k >= 0; k--) {
          p = Math.max(3, Math.min(96, Math.round(p + (Math.random() - 0.5) * 2 + (per - p) * 0.1)));
          this.db.pushHist(`${market.id}:${i}`, now - k * 1800 * 1000, p);
        }
      });
    } else {
      // seed some chart history so the page doesn't look empty
      let p = base;
      for (let i = 48; i >= 0; i--) {
        p = Math.max(4, Math.min(96, Math.round(p + (Math.random() - 0.5) * 3 + (base - p) * 0.1)));
        this.db.pushHist(market.id, now - i * 1800 * 1000, p);
      }
    }
    this.hub.broadcast('mkt', this.engine.marketPublic(market));
    this.json(res, 201, { market: this.engine.marketPublic(market) });
  }

  async adminResolve(req, res, id) {
    const admin = this._admin(req);
    const b = await this.readJson(req);
    const market = this.db.get('markets', id);
    if (!market) throw new ApiError(404, 'Market not found.');
    return this.locks.run(['m:' + id], async () => {
    const result = this.engine.resolve(
      market, market.outcomes && market.outcomes.length > 2 ? Number(b.outcomeIdx) : b.outcome,
      {
        evidence: b.evidence, notes: b.notes, confirm: !!b.confirm, force: !!b.force,
        actor: { id: admin.id, username: admin.username, role: admin.role },
      },
    );
    this.json(res, 200, { ...result, market: this.engine.marketPublic(market) });
    });
  }

  async adminSettle(req, res, id) {
    this._admin(req);
    const market = this.db.get('markets', id);
    if (!market) throw new ApiError(404, 'Market not found.');
    return this.locks.run(['m:' + id], async () => {
      this.json(res, 200, this.engine.settleMarket(id)); // market lock → concurrent settles serialize
    });
  }

  /* public resolution evidence + immutable audit history */
  marketResolution(res, slug) {
    const market = this.db.findOne('markets', (m) => m.slug === slug);
    if (!market) throw new ApiError(404, 'Market not found.');
    const audit = this.engine.resolutionAudit(market.id);
    this.json(res, 200, {
      market: { id: market.id, slug: market.slug, status: market.status, settledAt: market.settledAt || null },
      resolution: audit.length ? audit[audit.length - 1] : null,
      audit,
      verified: audit.every((r) => this.engine.verifyResolution(r)),
    });
  }

  async adminHalt(req, res, id, action) {
    this._admin(req);
    const market = this.db.get('markets', id);
    if (!market) throw new ApiError(404, 'Market not found.');
    return this.locks.run(['m:' + id], async () => {
    if (market.status === 'resolved') throw new ApiError(409, 'Market already resolved.');
    market.status = action === 'halt' ? 'halted' : 'open';
    if (action === 'open' && market.closeTime <= Date.now()) throw new ApiError(409, 'Close time already passed — market cannot reopen.');
    this.db.update('markets', market);
    this.hub.broadcast('mkt', this.engine.marketPublic(market));
    this.json(res, 200, { ok: true });
    });
  }

  adminStats(req, res) {
    this._admin(req);
    const users = this.db.all('users').filter((u) => u.role !== 'bot');
    const cash = this.db.all('wallets').reduce((s, w) => s + w.available + w.reserved, 0);
    let vol24 = 0;
    for (const m of this.db.all('markets')) vol24 += this.engine.summary(m).vol24;
    this.json(res, 200, {
      users: users.length,
      markets: this.db.all('markets').length,
      openMarkets: this.db.find('markets', (m) => m.status === 'open').length,
      openOrders: this.engine.orderIndex.size,
      trades: this.db.all('trades').length,
      vol24, cashInSystem: cash,
    });
  }

  platformAnalytics(res) {
    const data = this.analytics.getPlatformAnalytics();
    return this.json(res, 200, data);
  }

  marketAnalytics(res, slug, url) {
    const market = this.db.findOne('markets', (m) => m.slug === slug);
    if (!market) throw new ApiError(404, 'Market not found.');
    const outcomeIdx = Number(url.searchParams.get('o') || 0);
    const data = this.analytics.getMarketAnalytics(market, outcomeIdx);
    return this.json(res, 200, data);
  }

  async syncLiveMarkets(req, res) {
    this._admin(req);
    if (!this.liveSync) throw new ApiError(503, 'LiveSync service not initialized.');
    const added = await this.liveSync.syncTopMarkets(12);
    await this.liveSync.syncProbabilities();
    this.json(res, 200, { ok: true, added, syncedAt: Date.now() });
  }

  liveSyncStats(req, res) {
    const liveMarkets = this.db.find('markets', (m) => m.isLiveSync);
    this.json(res, 200, {
      activeCount: liveMarkets.filter((m) => m.status === 'open').length,
      totalCount: liveMarkets.length,
      lastSync: this.liveSync ? this.liveSync.lastSync : 0,
      source: 'Manifold Markets',
    });
  }
}

module.exports = { Api };
