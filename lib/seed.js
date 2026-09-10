'use strict';
/**
 * Seed — creates admin account, market-maker bots, promo codes, and the initial
 * markets (with 7 days of synthetic price history) on first run. Idempotent.
 */
const { hashPassword } = require('./auth');

const DAY = 24 * 3600 * 1000;

const CATEGORIES = ['Politics', 'Economics', 'Crypto', 'Sports', 'Tech', 'Entertainment', 'Science', 'Weather'];

function slugify(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
}

// base prob is in percent (5..95); close dates are relative to seed time in days
const MARKETS = [
  {
    title: 'Will the Fed cut rates at the September 2026 FOMC meeting?',
    emoji: '🏦', category: 'Economics', base: 62, closeInDays: 13, featured: true,
    description: 'Resolves YES if the Federal Reserve lowers the federal funds target range at its September 15–16, 2026 FOMC meeting.',
    resolutionSource: 'Official FOMC statement on federalreserve.gov',
    resolutionRules: 'Resolves YES if the post-meeting FOMC statement announces a lower target range for the federal funds rate, effective on or before September 17, 2026. Otherwise NO.',
  },
  {
    title: 'Will Bitcoin trade above $120,000 on October 1, 2026?',
    emoji: '₿', category: 'Crypto', base: 47, closeInDays: 28, featured: true,
    description: 'Resolves YES if the BTC/USD price is above $120,000 at 12:00 UTC on October 1, 2026.',
    resolutionSource: 'Global Spot Index BTC/USD',
    resolutionRules: 'Resolves YES if BTC/USD ≥ $120,000.01 at 12:00 UTC on Oct 1, 2026 per official spot index snapshot. A single snapshot is used; exchange outages do not pause resolution.',
  },
  {
    title: 'Will there be a US federal government shutdown in October 2026?',
    emoji: '🏛️', category: 'Politics', base: 35, closeInDays: 58,
    description: 'Resolves YES if a lapse in federal appropriations causes agencies to begin shutdown procedures at any point in October 2026.',
    resolutionSource: 'Official OMB / agency shutdown notices',
    resolutionRules: 'Resolves YES if any federal agency announces a funding lapse shutdown on/before Oct 31, 2026 lasting at least 1 hour. Otherwise NO.',
  },
  {
    title: 'Will the RBI cut the repo rate at its October 2026 policy meeting?',
    emoji: '💹', category: 'Economics', base: 55, closeInDays: 30,
    description: 'Resolves YES if the Reserve Bank of India lowers the policy repo rate at its October 2026 Monetary Policy Committee meeting.',
    resolutionSource: 'RBI press release (rbi.org.in)',
    resolutionRules: 'Resolves YES if the RBI MPC reduces the repo rate in its October 2026 resolution. Status quo or a hike resolves NO.',
  },
  {
    title: 'Will OpenAI release GPT-6 before January 1, 2027?',
    emoji: '🤖', category: 'Tech', base: 58, closeInDays: 119, featured: true,
    description: 'Resolves YES if OpenAI publicly releases a model officially branded "GPT-6" (general availability or research preview) before Jan 1, 2027.',
    resolutionSource: 'Official OpenAI announcement (openai.com/blog)',
    resolutionRules: 'Resolves YES on an official OpenAI release post naming "GPT-6" before 2027-01-01 00:00 UTC. Rumors, leaks and trademarks do not count.',
  },
  {
    title: 'Will SpaceX land Starship after an orbital launch in 2026?',
    emoji: '🚀', category: 'Science', base: 33, closeInDays: 119,
    description: 'Resolves YES if a Starship booster or ship completes a controlled landing (catch or pad) after an orbital-class launch in calendar 2026.',
    resolutionSource: 'SpaceX webcast + FAA filings',
    resolutionRules: 'Resolves YES if SpaceX confirms a successful controlled landing of either stage following an orbital flight test in 2026.',
  },
  {
    title: 'Will Apple announce a foldable iPhone by March 31, 2027?',
    emoji: '📱', category: 'Tech', base: 22, closeInDays: 209,
    description: 'Resolves YES if Apple officially announces a foldable iPhone model on or before March 31, 2027.',
    resolutionSource: 'Apple newsroom (apple.com/newsroom)',
    resolutionRules: 'Resolves YES on an official Apple announcement of a foldable iPhone. Analyst reports and supply-chain rumors do not count.',
  },
  {
    title: 'Will Mumbai Indians qualify for the IPL 2027 playoffs?',
    emoji: '🏏', category: 'Sports', base: 45, closeInDays: 240,
    description: 'Resolves YES if Mumbai Indians finish in the top four of the IPL 2027 league stage and qualify for the playoffs.',
    resolutionSource: 'Official IPL points table (iplt20.com)',
    resolutionRules: 'Resolves YES if MI appears in the top 4 of the final league-stage points table for IPL 2027.',
  },
  {
    title: 'Will Manchester City win the 2026–27 Premier League title?',
    emoji: '⚽', category: 'Sports', base: 30, closeInDays: 270,
    description: 'Resolves YES if Manchester City finish first in the 2026–27 Premier League table.',
    resolutionSource: 'Official Premier League table',
    resolutionRules: 'Resolves YES if Man City hold 1st place in the final 2026–27 Premier League table. Points deductions before the final table count.',
  },
  {
    title: 'Will Taylor Swift announce a new world tour before April 1, 2027?',
    emoji: '🎤', category: 'Entertainment', base: 41, closeInDays: 209,
    description: 'Resolves YES if Taylor Swift officially announces a new concert tour (any continent) before April 1, 2027.',
    resolutionSource: 'Official announcement via Taylor Swift\'s channels',
    resolutionRules: 'Resolves YES on an official tour announcement. Residency extensions of existing shows do not count.',
  },
  {
    title: 'Will India\'s 2026 monsoon rainfall be above normal (100% of LPA)?',
    emoji: '🌧️', category: 'Weather', base: 38, closeInDays: 27,
    description: 'Resolves YES if the all-India southwest monsoon seasonal rainfall (Jun–Sep 2026) is above 100% of the Long Period Average.',
    resolutionSource: 'IMD seasonal monsoon report',
    resolutionRules: 'Resolves YES if IMD\'s final 2026 seasonal report states all-India rainfall ≥ 100% of LPA. Otherwise NO.',
  },
  {
    title: 'Will Ethereum outperform Bitcoin in Q4 2026?',
    emoji: 'Ξ', category: 'Crypto', base: 44, closeInDays: 119,
    description: 'Resolves YES if ETH has a higher percentage return than BTC over Q4 2026 (Oct 1 – Dec 31, 2026).',
    resolutionSource: 'Official spot index prices at 00:00 UTC on Oct 1 and Dec 31, 2026',
    resolutionRules: 'Return = (end/start − 1) per asset. Resolves YES if ETH return > BTC return. Equal returns resolve NO.',
  },
  {
    title: 'Will Delhi record a maximum temperature above 40°C in October 2026?',
    emoji: '🌡️', category: 'Weather', base: 18, closeInDays: 58,
    description: 'Resolves YES if any IMD station in Delhi reports a maximum temperature above 40.0°C during October 2026.',
    resolutionSource: 'IMD daily bulletins (Safdarjung / Palam stations)',
    resolutionRules: 'Resolves YES if either Safdarjung or Palam reports max temp > 40.0°C on any day in Oct 2026.',
  },
  {
    title: 'Will an AI system win a gold medal at the 2027 International Math Olympiad?',
    emoji: '🧮', category: 'Science', base: 36, closeInDays: 320,
    description: 'Resolves YES if an AI system achieves a gold-medal-level score in the official 2027 IMO under exam conditions.',
    resolutionSource: 'IMO 2027 official results + accepted AI attempt publications',
    resolutionRules: 'Resolves YES if a formally verified AI attempt, run under competition time constraints, scores ≥ gold-medal cutoff at IMO 2027.',
  },
  {
    title: 'Will a new country join the United Nations in 2026?',
    emoji: '🌍', category: 'Politics', base: 12, closeInDays: 119,
    description: 'Resolves YES if the UN General Assembly admits at least one new member state in calendar year 2026.',
    resolutionSource: 'United Nations membership list (un.org)',
    resolutionRules: 'Resolves YES if the UN member count increases beyond 193 during 2026.',
  },
];

function gauss() {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function genHistory(base, days = 7) {
  // hourly points doing a random walk that ends near base
  const n = days * 24;
  const pts = [];
  let p = Math.round(Math.min(95, Math.max(5, base + gauss() * 8)));
  const now = Date.now();
  const start = now - n * 3600 * 1000;
  for (let i = 0; i < n; i++) {
    const pull = (base - p) * 0.02;
    p = Math.round(Math.min(96, Math.max(4, p + pull + gauss() * 1.4)));
    pts.push([start + i * 3600 * 1000, p]);
  }
  pts.push([now, base]);
  return pts;
}

function seed(db) {
  const already = db.all('markets').length > 0;

  // ---- promo codes ----
  if (db.all('promos').length === 0) {
    const promos = [
      { code: 'WELCOME100', label: 'Welcome bonus', amount: 10000, active: true, signupOnly: false },
      { code: 'TOPUP25', label: 'Top-up bonus', amount: 2500, active: true, signupOnly: false },
      { code: 'CRYPTO50', label: 'Crypto traders bonus', amount: 5000, active: true, signupOnly: false },
    ];
    db.tx(() => { for (const p of promos) db.insert('promos', p); });
  }

  // ---- admin ----
  if (!db.findOne('users', (u) => u.username === 'admin')) {
    const { salt, hash } = hashPassword(process.env.ADMIN_PASSWORD || 'admin1234');
    db.tx(() => {
      const admin = db.insert('users', {
        username: 'admin', email: 'admin@predix.local', salt, passHash: hash,
        role: 'admin', createdAt: Date.now(),
      });
      db.insert('wallets', { userId: admin.id, available: 0, reserved: 0 });
    });
    console.log('[seed] created admin account (username: admin)');
  }

  // ---- market-maker bots ----
  if (db.find('users', (u) => u.role === 'bot').length === 0) {
    const bots = ['LiquidityLakshmi', 'QuoteRaja', 'BookBala'];
    db.tx(() => {
      for (const name of bots) {
        const { salt, hash } = hashPassword(require('crypto').randomBytes(24).toString('hex'));
        const bot = db.insert('users', {
          username: name, email: `${name.toLowerCase()}@bots.predix.local`, salt, passHash: hash,
          role: 'bot', createdAt: Date.now(),
        });
        db.insert('wallets', { userId: bot.id, available: 20000000, reserved: 0 });
      }
    });
    console.log('[seed] created 3 market-maker bots');
  }

  // ---- markets ----
  if (!already) {
    const now = Date.now();
    db.tx(() => {
      for (const m of MARKETS) {
        const row = db.insert('markets', {
          slug: slugify(m.title), title: m.title, emoji: m.emoji, category: m.category,
          description: m.description,
          resolutionSource: m.resolutionSource, resolutionRules: m.resolutionRules,
          closeTime: now + m.closeInDays * DAY, createdAt: now - Math.floor(Math.random() * 5 + 1) * DAY,
          status: 'open', outcome: null, featured: !!m.featured,
          last: m.base, lastTradeTs: now - Math.floor(Math.random() * 3600 * 1000),
        });
        for (const [ts, p] of genHistory(m.base)) db.pushHist(row.id, ts, p);
      }
    });
    console.log(`[seed] created ${MARKETS.length} markets with price history`);
  }

  ensureCollections(db);
}

/* ---- series/collections + extra markets (idempotent — runs on existing DBs too) ---- */

const SERIES_CRYPTO = { slug: 'crypto-oct1', name: 'Crypto checkpoints · Oct 1, 2026', emoji: '⛓️' };
const SERIES_IPL = { slug: 'ipl-2027', name: 'IPL 2027 playoffs race', emoji: '🏏' };

const EXTRA_MARKETS = [
  {
    slug: 'will-ethereum-trade-above-4-000-on-october-1-2026',
    title: 'Will Ethereum trade above $4,000 on October 1, 2026?',
    emoji: 'Ξ', category: 'Crypto', base: 41, closeInDays: 28,
    series: SERIES_CRYPTO,
    description: 'Resolves YES if the ETH/USD price is above $4,000 at 12:00 UTC on October 1, 2026.',
    resolutionSource: 'Global Spot Index ETH/USD',
    resolutionRules: 'Resolves YES if ETH/USD ≥ $4,000.01 at 12:00 UTC on Oct 1, 2026 per spot index snapshot.',
  },
  {
    slug: 'will-chennai-super-kings-qualify-for-the-ipl-2027-playoffs',
    title: 'Will Chennai Super Kings qualify for the IPL 2027 playoffs?',
    emoji: '🏏', category: 'Sports', base: 42, closeInDays: 240,
    series: SERIES_IPL,
    description: 'Resolves YES if Chennai Super Kings finish in the top four of the IPL 2027 league stage.',
    resolutionSource: 'Official IPL points table',
    resolutionRules: 'Resolves YES if CSK appear in the top 4 of the final league-stage points table for IPL 2027.',
  },
  {
    slug: 'will-royal-challengers-bengaluru-qualify-for-the-ipl-2027-pl',
    title: 'Will RCB qualify for the IPL 2027 playoffs?',
    emoji: '🏏', category: 'Sports', base: 46, closeInDays: 240,
    series: SERIES_IPL,
    description: 'Resolves YES if Royal Challengers Bengaluru finish in the top four of the IPL 2027 league stage.',
    resolutionSource: 'Official IPL points table (iplt20.com)',
    resolutionRules: 'Resolves YES if RCB appear in the top 4 of the final league-stage points table for IPL 2027.',
  },
];

/* ---- multi-outcome markets (3+ options, one book per option) ---- */
const MULTI_MARKETS = [
  {
    slug: 'who-wins-ipl-2027',
    title: 'Who wins the IPL 2027 title?',
    emoji: '🏆', category: 'Sports', closeInDays: 250, featured: true,
    description: 'Which team will lift the IPL 2027 trophy? Each option trades independently — buy the team you believe in.',
    resolutionSource: 'Official IPL final result (iplt20.com)',
    resolutionRules: 'Resolves to the team that wins the IPL 2027 final. If a team not listed wins, "Another team" resolves the winner.',
    outcomes: [
      { label: 'Mumbai Indians', emoji: '🔵', base: 30 },
      { label: 'Chennai Super Kings', emoji: '🟡', base: 24 },
      { label: 'Royal Challengers Bengaluru', emoji: '🔴', base: 21 },
      { label: 'Gujarat Titans', emoji: '🔷', base: 14 },
      { label: 'Another team', emoji: '🏳️', base: 11 },
    ],
  },
  {
    slug: 'rbis-next-repo-rate-move',
    title: 'RBI\'s next repo rate move',
    emoji: '🏦', category: 'Economics', closeInDays: 45, featured: true,
    description: 'What will the Reserve Bank of India do to the repo rate at its next policy meeting?',
    resolutionSource: 'RBI MPC resolution (rbi.org.in)',
    resolutionRules: 'Resolves to the RBI\'s action on the repo rate in its next MPC resolution. "No change" wins if the rate stays put.',
    outcomes: [
      { label: 'Cut by 25bps+',      emoji: '📉', base: 38 },
      { label: 'No change',          emoji: '➖', base: 41 },
      { label: 'Hike by 25bps+',     emoji: '📈', base: 12 },
    ],
  },
  {
    slug: 'next-bitcoin-100k-milestone',
    title: 'Bitcoin\'s next milestone first?',
    emoji: '🪙', category: 'Crypto', closeInDays: 90,
    description: 'Which Bitcoin price milestone gets hit first before January 1, 2027?',
    resolutionSource: 'Global Spot Index BTC/USD',
    resolutionRules: 'Resolves to whichever level BTC/USD touches first (per 1-minute spot index data). "Below $80k" wins if BTC trades under $80,000 before any upper level is reached.',
    outcomes: [
      { label: '$150,000', emoji: '🚀', base: 22 },
      { label: '$130,000', emoji: '📈', base: 27 },
      { label: '$110,000', emoji: '🔹', base: 26 },
      { label: 'Below $80,000', emoji: '🕳️', base: 15 },
    ],
  },
];

const SERIES_STAMPS = {
  'will-bitcoin-trade-above-120-000-on-october-1-2026': SERIES_CRYPTO,
  'will-mumbai-indians-qualify-for-the-ipl-2027-playoffs': SERIES_IPL,
};

function ensureCollections(db) {
  const now = Date.now();
  let added = 0;
  db.tx(() => {
    for (const x of EXTRA_MARKETS) {
      if (db.findOne('markets', (m) => m.slug === x.slug)) continue;
      db.insert('markets', {
        slug: x.slug, title: x.title, emoji: x.emoji, category: x.category,
        description: x.description, resolutionSource: x.resolutionSource, resolutionRules: x.resolutionRules,
        closeTime: now + x.closeInDays * DAY, createdAt: now - Math.floor(Math.random() * 3 + 1) * DAY,
        status: 'open', outcome: null, featured: false,
        seriesSlug: x.series.slug, seriesName: x.series.name, seriesEmoji: x.series.emoji,
        last: x.base, lastTradeTs: now,
      });
      added++;
    }
  });
  // price history for freshly added markets (pushHist keys by market id — redo properly)
  if (added) {
    for (const x of EXTRA_MARKETS) {
      const m = db.findOne('markets', (r) => r.slug === x.slug);
      if (!m || db.histFor(m.id).length) continue;
      for (const [ts, p] of genHistory(x.base, 7)) db.pushHist(m.id, ts, p);
    }
  }
  // stamp series onto existing base markets
  let stamped = 0;
  for (const [slug, s] of Object.entries(SERIES_STAMPS)) {
    const m = db.findOne('markets', (r) => r.slug === slug);
    if (m && !m.seriesSlug) {
      m.seriesSlug = s.slug; m.seriesName = s.name; m.seriesEmoji = s.emoji;
      db.update('markets', m);
      stamped++;
    }
  }

  // multi-outcome markets (idempotent)
  let multiAdded = 0;
  for (const x of MULTI_MARKETS) {
    if (db.findOne('markets', (m) => m.slug === x.slug)) continue;
    const row = db.insert('markets', {
      slug: x.slug, title: x.title, emoji: x.emoji, category: x.category,
      description: x.description, resolutionSource: x.resolutionSource, resolutionRules: x.resolutionRules,
      closeTime: now + x.closeInDays * DAY, createdAt: now - Math.floor(Math.random() * 2 + 1) * DAY,
      status: 'open', outcome: null, featured: !!x.featured,
      outcomes: x.outcomes.map((o) => ({ label: o.label, emoji: o.emoji, base: o.base })),
      last: null, lastTradeTs: now,
    });
    x.outcomes.forEach((o, i) => {
      let p = o.base;
      for (let k = 48; k >= 0; k--) {
        p = Math.max(3, Math.min(96, Math.round(p + (Math.random() - 0.5) * 2 + (o.base - p) * 0.1)));
        db.pushHist(`${row.id}:${i}`, now - k * 1800 * 1000, p);
      }
    });
    multiAdded++;
  }

  if (added || stamped || multiAdded) {
    console.log(`[seed] collections: +${added} markets, ${stamped} stamped, +${multiAdded} multi-outcome markets`);
  }
}

module.exports = { seed, CATEGORIES, slugify };
