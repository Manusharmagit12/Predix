const http = require('http');

function req(path) {
  return new Promise((resolve, reject) => {
    const r = http.request(
      {
        hostname: '127.0.0.1',
        port: 3000,
        path,
        method: 'GET',
      },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, body: JSON.parse(data) });
          } catch (e) {
            resolve({ status: res.statusCode, body: data });
          }
        });
      }
    );
    r.on('error', reject);
    r.end();
  });
}

async function run() {
  console.log('=== TESTING REAL-TIME ANALYTICS API ===\n');

  // 1. Test platform analytics
  console.log('1. Testing GET /api/analytics...');
  const platRes = await req('/api/analytics');
  if (platRes.status !== 200) throw new Error('GET /api/analytics failed: ' + platRes.status);
  const pData = platRes.body;
  console.log(`✓ Active Markets: ${pData.totalActiveMarkets}`);
  console.log(`✓ Market Sentiment Breakdown: ${pData.bullishMarkets} Bullish, ${pData.bearishMarkets} Bearish, ${pData.neutralMarkets} Neutral`);
  console.log(`✓ Top Movers: ${pData.topMovers.length} found`);
  console.log(`✓ High Imbalance Markets: ${pData.highImbalance.length} found`);
  console.log(`✓ Most Liquid Markets: ${pData.mostLiquid.length} found`);
  console.log(`✓ Recent Whale Trades: ${pData.recentWhales.length} found`);

  // 2. Test market-level analytics
  console.log('\n2. Testing GET /api/markets/:slug/analytics...');
  const mktsRes = await req('/api/markets');
  const mkts = mktsRes.body.markets || mktsRes.body;
  const sampleMkt = mkts.find((m) => m.status === 'open');
  if (!sampleMkt) throw new Error('No open market found for testing');

  const mktRes = await req(`/api/markets/${sampleMkt.slug}/analytics`);
  if (mktRes.status !== 200) throw new Error(`GET /api/markets/${sampleMkt.slug}/analytics failed: ${mktRes.status}`);
  const mData = mktRes.body;
  console.log(`✓ Market: "${mData.title}"`);
  console.log(`  Last Price: $${(mData.lastPrice / 100).toFixed(2)} | 24h VWAP: $${(mData.vwap / 100).toFixed(2)}`);
  console.log(`  Order Flow Imbalance: ${mData.imbalance}% (${mData.buyPressurePct}% Buy vs ${mData.sellPressurePct}% Sell)`);
  console.log(`  Sentiment: ${mData.sentimentClassification} (Score: ${mData.sentimentScore}/100)`);
  console.log(`  Liquidity Grade: ${mData.liquidityGrade} (Total Depth: ${mData.totalDepth} shares)`);
  console.log(`  Depth Curves: ${mData.bidCurve.length} bid levels, ${mData.askCurve.length} ask levels`);

  console.log('\n========================================');
  console.log('🎉 ALL ANALYTICS API TESTS PASSED! 🎉');
  console.log('========================================');
}

run().catch((e) => {
  console.error('FAILED:', e);
  process.exit(1);
});
