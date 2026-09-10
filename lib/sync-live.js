'use strict';
/**
 * LiveSync — Real-world prediction market synchronization engine.
 * Pulls active, high-volume markets and live consensus probabilities
 * from open prediction market APIs (e.g. Manifold Markets).
 * 
 * Features:
 *  - Auto-ingests trending real-world prediction questions
 *  - Dynamically updates real-world probabilities in real time
 *  - Pegs market-maker bots directly to real-world consensus odds
 *  - Detects external resolutions and triggers automated settlement
 */

const { slugify } = require('./seed');

const API_TIMEOUT_MS = 6000;

class LiveSync {
  constructor(db, engine, hub) {
    this.db = db;
    this.engine = engine;
    this.hub = hub;
    this.syncing = false;
    this.lastSync = 0;
    this.syncedCount = 0;
  }

  async init() {
    console.log('[live-sync] Initializing Real-World Prediction Market Engine...');
    try {
      await this.syncTopMarkets(12);
    } catch (e) {
      console.error('[live-sync] Initial sync warning:', e.message);
    }
  }

  async tick() {
    if (this.syncing) return;
    this.syncing = true;
    try {
      await this.syncProbabilities();
      // Periodically check for new trending markets (every ~10 mins)
      if (Date.now() - this.lastSync > 10 * 60 * 1000) {
        await this.syncTopMarkets(6);
      }
    } catch (e) {
      console.error('[live-sync] Tick warning:', e.message);
    } finally {
      this.syncing = false;
    }
  }

  categorize(title, desc) {
    const text = `${title} ${desc}`.toLowerCase();
    if (/(bitcoin|crypto|ethereum|solana|btc|eth|token|blockchain|doge|binance)/.test(text)) {
      return { category: 'Crypto', emoji: '🪙' };
    }
    if (/(ai\b|gpt|openai|llm|deepseek|claude|anthropic|robot|model|neural|nvidia|apple|google|meta)/.test(text)) {
      return { category: 'Tech', emoji: '🤖' };
    }
    if (/(election|president|trump|biden|vance|harris|congress|senate|republican|democrat|white house|vote|war\b|ukraine|russia|nato)/.test(text)) {
      return { category: 'Politics', emoji: '🏛️' };
    }
    if (/(inflation|cpi|gdp|fed\b|interest rate|fomc|recession|stock market|s&p|nasdaq|tariff|economy)/.test(text)) {
      return { category: 'Economics', emoji: '📈' };
    }
    if (/(space\b|spacex|starship|nasa|mars|moon|physics|quantum|fusion|cure|cancer|biology|math|dna)/.test(text)) {
      return { category: 'Science', emoji: '🚀' };
    }
    if (/(movie|oscar|box office|grammy|taylor swift|music|song|album|hollywood|netflix|gta|game)/.test(text)) {
      return { category: 'Entertainment', emoji: '🎬' };
    }
    if (/(nba|nfl|fifa|champions league|premier league|messi|ronaldo|ipl|cricket|tennis|super bowl)/.test(text)) {
      return { category: 'Sports', emoji: '🏆' };
    }
    return { category: 'Tech', emoji: '🌐' };
  }

  async fetchJson(url) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), API_TIMEOUT_MS);
    try {
      const res = await fetch(url, { signal: ctrl.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Fetches top active binary markets from open API and upserts them.
   */
  async syncTopMarkets(limit = 10) {
    const url = `https://api.manifold.markets/v0/search-markets?term=&filter=open&sort=liquidity&limit=${limit * 2}`;
    const rawMarkets = await this.fetchJson(url);
    if (!Array.isArray(rawMarkets)) return 0;

    // Filter to binary, open markets with substantial volume and valid probabilities
    const binaryMarkets = rawMarkets.filter((m) =>
      m.outcomeType === 'BINARY' &&
      !m.isResolved &&
      typeof m.probability === 'number' &&
      m.probability >= 0.02 &&
      m.probability <= 0.98 &&
      m.volume >= 1000
    ).slice(0, limit);

    let addedCount = 0;
    const now = Date.now();

    for (const ext of binaryMarkets) {
      let existing = this.db.findOne('markets', (m) => m.liveExternalId === ext.id);
      const probPct = Math.max(2, Math.min(98, Math.round(ext.probability * 100)));

      if (existing) {
        // Update live stats on existing market
        existing.liveProb = ext.probability;
        existing.liveVolume = Math.round(ext.volume || 0);
        existing.liveLastSync = now;
        this.db.update('markets', existing);
        continue;
      }

      // Create new market
      let baseSlug = slugify(ext.question || 'live-market');
      if (this.db.findOne('markets', (m) => m.slug === baseSlug)) {
        baseSlug = `${baseSlug.slice(0, 70)}-live-${ext.id.slice(0, 5).toLowerCase()}`;
      }

      const { category, emoji } = this.categorize(ext.question, ext.textDescription || '');
      const closeTime = ext.closeTime && ext.closeTime > now ? ext.closeTime : now + 90 * 24 * 3600 * 1000;

      const newMarket = {
        slug: baseSlug,
        title: ext.question.trim(),
        emoji,
        category,
        description: `Live real-world prediction market tracked in real time from Manifold Markets. Probability updates dynamically as global trades occur.`,
        resolutionSource: `Manifold Markets live resolution feed (ID: ${ext.id})`,
        resolutionRules: `Resolves to the official real-world outcome reported on Manifold Markets. When the underlying event settles, Predix automatically distributes payouts.`,
        closeTime,
        createdAt: now,
        status: 'open',
        outcome: null,
        featured: addedCount === 0,
        last: probPct,
        lastTradeTs: now,
        // Live sync attributes
        isLiveSync: true,
        liveSource: 'Manifold',
        liveExternalId: ext.id,
        liveExternalUrl: ext.url || `https://manifold.markets/${ext.creatorUsername || 'm'}/${ext.slug}`,
        liveProb: ext.probability,
        liveVolume: Math.round(ext.volume || 0),
        liveLastSync: now,
      };

      const inserted = this.db.insert('markets', newMarket);
      if (inserted) {
        addedCount++;
        this.syncedCount++;
        // Initialize chart history point
        this.db.pushHist(inserted.id, now, probPct);
        this.hub.broadcast('mkt', this.engine.marketPublic(inserted));
      }
    }

    this.lastSync = now;
    if (addedCount > 0) {
      console.log(`[live-sync] Ingested ${addedCount} new live real-world markets into exchange.`);
    }
    return addedCount;
  }

  /**
   * Updates real-world consensus probabilities and checks for resolutions.
   */
  async syncProbabilities() {
    const liveMarkets = this.db.find('markets', (m) => m.isLiveSync && m.liveExternalId && m.status === 'open');
    if (!liveMarkets.length) return;

    for (const m of liveMarkets) {
      try {
        const url = `https://api.manifold.markets/v0/market/${m.liveExternalId}`;
        const ext = await this.fetchJson(url);
        if (!ext) continue;

        const now = Date.now();

        // Check for resolution
        if (ext.isResolved) {
          const resUpper = String(ext.resolution || '').toUpperCase();
          const outcome = resUpper === 'YES' ? 'yes' : (resUpper === 'NO' ? 'no' : null);
          if (outcome) {
            console.log(`[live-sync] External event resolved for #${m.id} (${m.title}) -> ${outcome.toUpperCase()}`);
            this.engine.resolveMarket(m.id, outcome, `Real-world market settled ${outcome.toUpperCase()} on ${m.liveSource}`);
            continue;
          }
        }

        // Update probability if changed
        if (typeof ext.probability === 'number' && Math.abs(ext.probability - (m.liveProb || 0)) >= 0.005) {
          m.liveProb = ext.probability;
          m.liveVolume = Math.round(ext.volume || 0);
          m.liveLastSync = now;
          const newPrice = Math.max(2, Math.min(98, Math.round(ext.probability * 100)));
          m.last = newPrice;
          m.lastTradeTs = now;
          this.db.update('markets', m);
          this.db.pushHist(m.id, now, newPrice);
          this.hub.broadcast('mkt', this.engine.marketPublic(m));
        }
      } catch {
        // Skip quietly on individual network glitch
      }
    }
  }
}

module.exports = { LiveSync };
