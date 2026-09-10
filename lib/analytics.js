'use strict';
/**
 * Predix Real-Time Market Analytics Engine.
 * 
 * Computes statistical and institutional metrics across markets:
 *   • Order Flow Imbalance (Bid Depth vs Ask Depth pressure)
 *   • 24h Volume-Weighted Average Price (VWAP)
 *   • Probability Velocity & Volatility
 *   • Whale Trades Detection (trades >= 50 contracts or >= $25 volume)
 *   • Algorithmic Market Sentiment & Intelligence Summary
 *   • Platform-wide Movers, Volume Leaders, and Oracle Deviations
 */

class AnalyticsEngine {
  constructor(db, engine, feeds) {
    this.db = db;
    this.engine = engine;
    this.feeds = feeds;
  }

  /**
   * Computes comprehensive real-time analytics for a specific market outcome book.
   */
  getMarketAnalytics(market, outcomeIdx = 0) {
    const book = this.engine.marketBook(market.id, outcomeIdx);
    const bids = book.bids || [];
    const asks = book.asks || [];
    const trades = market.trades || [];

    // 1. Depth & Order Flow Imbalance
    const totalBidDepth = bids.reduce((acc, b) => acc + (b.qty || 0), 0);
    const totalAskDepth = asks.reduce((acc, a) => acc + (a.qty || 0), 0);
    const totalDepth = totalBidDepth + totalAskDepth;

    let imbalance = 0; // -100% (all asks) to +100% (all bids)
    let buyPressurePct = 50;
    let sellPressurePct = 50;

    if (totalDepth > 0) {
      imbalance = Math.round(((totalBidDepth - totalAskDepth) / totalDepth) * 100);
      buyPressurePct = Math.round((totalBidDepth / totalDepth) * 100);
      sellPressurePct = 100 - buyPressurePct;
    }

    // 2. Cumulative Depth Curve for visualization
    let cumBids = 0;
    const bidCurve = bids.map((b) => {
      cumBids += b.qty;
      return { price: b.price, qty: b.qty, cumQty: cumBids };
    });

    let cumAsks = 0;
    const askCurve = asks.map((a) => {
      cumAsks += a.qty;
      return { price: a.price, qty: a.qty, cumQty: cumAsks };
    });

    // 3. 24h VWAP (Volume-Weighted Average Price)
    const now = Date.now();
    const dayAgo = now - 24 * 3600 * 1000;
    const recentTrades = trades.filter((t) => (t.ts || t.time || now) >= dayAgo);
    let vwap = null;
    let totalVolumeShares = 0;
    let totalValueCents = 0;

    for (const t of recentTrades) {
      const q = t.qty || 0;
      const p = t.price || 0;
      totalVolumeShares += q;
      totalValueCents += p * q;
    }

    if (totalVolumeShares > 0) {
      vwap = Math.round(totalValueCents / totalVolumeShares);
    } else if (market.last !== null && market.last !== undefined) {
      vwap = market.last;
    } else {
      vwap = 50;
    }

    // Current price vs VWAP premium/discount
    const lastPrice = market.last !== null && market.last !== undefined ? market.last : 50;
    const vwapDiff = lastPrice - vwap;

    // 4. Whale Trades (large institutional positions)
    const whaleThresholdShares = 50;
    const whaleTrades = trades
      .filter((t) => (t.qty || 0) >= whaleThresholdShares || ((t.price || 0) * (t.qty || 0)) >= 2500)
      .slice(0, 8)
      .map((t) => ({
        id: t.id,
        price: t.price,
        qty: t.qty,
        totalValue: (t.price * t.qty) / 100,
        side: t.side || (t.price >= 50 ? 'yes' : 'no'),
        time: t.ts || t.time || now,
        taker: t.taker || 'Trader',
      }));

    // 5. Probability Velocity (% change rate)
    const change24h = market.change || 0;
    let velocityLabel = 'Stable';
    if (Math.abs(change24h) >= 15) velocityLabel = change24h > 0 ? 'Surging' : 'Plummeting';
    else if (Math.abs(change24h) >= 5) velocityLabel = change24h > 0 ? 'Trending Up' : 'Trending Down';

    // 6. Algorithmic Sentiment & Market Health Index
    let sentimentScore = 50; // 0 (extreme fear/bearish) to 100 (extreme greed/bullish)
    sentimentScore += Math.max(-25, Math.min(25, Math.round(imbalance * 0.25)));
    sentimentScore += Math.max(-25, Math.min(25, Math.round(change24h * 0.5)));
    sentimentScore = Math.max(5, Math.min(95, sentimentScore));

    let sentimentClassification = 'Neutral';
    if (sentimentScore >= 75) sentimentClassification = 'Strongly Bullish';
    else if (sentimentScore >= 58) sentimentClassification = 'Moderately Bullish';
    else if (sentimentScore <= 25) sentimentClassification = 'Strongly Bearish';
    else if (sentimentScore <= 42) sentimentClassification = 'Moderately Bearish';

    // Liquidity Rating (A+, A, B, C)
    let liquidityGrade = 'C';
    if (totalDepth >= 500) liquidityGrade = 'A+';
    else if (totalDepth >= 200) liquidityGrade = 'A';
    else if (totalDepth >= 50) liquidityGrade = 'B';

    // Spread in cents
    const bestBid = bids[0] ? bids[0].price : null;
    const bestAsk = asks[0] ? asks[0].price : null;
    const spread = (bestBid !== null && bestAsk !== null) ? bestAsk - bestBid : null;

    return {
      marketId: market.id,
      slug: market.slug,
      title: market.title,
      lastPrice,
      totalBidDepth,
      totalAskDepth,
      totalDepth,
      imbalance,
      buyPressurePct,
      sellPressurePct,
      vwap,
      vwapDiff,
      spread,
      bestBid,
      bestAsk,
      liquidityGrade,
      sentimentScore,
      sentimentClassification,
      velocityLabel,
      bidCurve,
      askCurve,
      whaleTrades,
      updatedAt: now,
    };
  }

  /**
   * Computes platform-wide real-time market intelligence.
   */
  getPlatformAnalytics() {
    const markets = this.db.find('markets', (m) => m.status === 'open');
    const allMarketAnalytics = markets.map((m) => this.getMarketAnalytics(m, 0));

    // 1. Top Probability Movers (highest 24h change magnitude)
    const topMovers = [...markets]
      .sort((a, b) => Math.abs(b.change || 0) - Math.abs(a.change || 0))
      .slice(0, 6)
      .map((m) => ({
        id: m.id,
        slug: m.slug,
        title: m.title,
        category: m.category,
        lastPrice: m.last,
        change: m.change || 0,
        vol24: m.vol24 || 0,
      }));

    // 2. Highest Order Flow Imbalances (Heavy Buy or Sell skew)
    const highImbalance = [...allMarketAnalytics]
      .filter((a) => a.totalDepth >= 10)
      .sort((a, b) => Math.abs(b.imbalance) - Math.abs(a.imbalance))
      .slice(0, 6);

    // 3. Deepest Liquidity Markets
    const mostLiquid = [...allMarketAnalytics]
      .sort((a, b) => b.totalDepth - a.totalDepth)
      .slice(0, 6);

    // 4. Recent Platform-Wide Whale Executions
    const allWhales = [];
    for (const m of markets) {
      for (const t of m.trades || []) {
        if ((t.qty || 0) >= 40 || ((t.price || 0) * (t.qty || 0)) >= 2000) {
          allWhales.push({
            marketTitle: m.title,
            slug: m.slug,
            price: t.price,
            qty: t.qty,
            totalValue: ((t.price * t.qty) / 100).toFixed(2),
            time: t.ts || t.time || Date.now(),
            side: t.price >= 50 ? 'yes' : 'no',
            taker: t.taker || 'Trader',
          });
        }
      }
    }
    allWhales.sort((a, b) => b.time - a.time);
    const recentWhales = allWhales.slice(0, 10);

    // 5. Aggregate Market Sentiment Distribution
    const bullishCount = allMarketAnalytics.filter((a) => a.imbalance > 15).length;
    const bearishCount = allMarketAnalytics.filter((a) => a.imbalance < -15).length;
    const neutralCount = allMarketAnalytics.length - bullishCount - bearishCount;

    return {
      totalActiveMarkets: markets.length,
      bullishMarkets: bullishCount,
      bearishMarkets: bearishCount,
      neutralMarkets: neutralCount,
      topMovers,
      highImbalance,
      mostLiquid,
      recentWhales,
      generatedAt: Date.now(),
    };
  }
}

module.exports = { AnalyticsEngine };
