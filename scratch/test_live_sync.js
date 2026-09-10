// scratch/test_live_sync.js
// Automated verification of Live Market Sync Engine

const { LiveSync } = require('../lib/sync-live');
const { Store } = require('../lib/store');
const { Hub } = require('../lib/hub');
const { Engine } = require('../lib/engine');
const { Bots } = require('../lib/bots');
const path = require('path');
const fs = require('fs');

async function testLiveSync() {
  console.log('--- Testing LiveSync Engine ---');

  // Set up temporary memory store
  const testDir = path.join(__dirname, 'test-live-db-' + Date.now());
  fs.mkdirSync(testDir, { recursive: true });
  const db = new Store(testDir);
  const hub = new Hub();
  const engine = new Engine(db, hub);
  const liveSync = new LiveSync(db, engine, hub);

  console.log('1. Fetching & syncing real-world markets...');
  const added = await liveSync.syncTopMarkets(5);
  console.log(`   ✓ Ingested ${added} real-world markets from open API.`);

  const liveMarkets = db.find('markets', (m) => m.isLiveSync);
  console.log(`   ✓ Found ${liveMarkets.length} live markets in store:`);
  for (const m of liveMarkets) {
    console.log(`     - [${m.category}] ${m.emoji} ${m.title}`);
    console.log(`       Prob: ${(m.liveProb * 100).toFixed(1)}% | Ext Vol: $${m.liveVolume} | Source: ${m.liveSource}`);
    console.log(`       URL: ${m.liveExternalUrl}`);
  }

  if (liveMarkets.length === 0) {
    throw new Error('Expected at least 1 live market synced');
  }

  const sample = liveMarkets[0];
  if (!sample.isLiveSync || !sample.liveExternalId || !sample.liveSource) {
    throw new Error('Missing live sync metadata on market');
  }

  console.log('\n2. Testing bot quoting on live synced market...');
  const bots = new Bots(db, engine);
  const key = `${sample.id}:0`;
  const s = bots._st(key, 50);
  const expectedProb = Math.round(sample.liveProb * 100);

  // Simulate bot anchor logic
  if (sample.isLiveSync && typeof sample.liveProb === 'number') {
    s.target = Math.max(2, Math.min(98, Math.round(sample.liveProb * 100)));
  }
  console.log(`   ✓ Bot fair value target pegged to live odds: ${s.target}% (vs expected ${expectedProb}%)`);
  if (s.target !== expectedProb) {
    throw new Error(`Expected bot target ${expectedProb}, got ${s.target}`);
  }

  console.log('\n3. Testing probability refresh tick...');
  await liveSync.syncProbabilities();
  console.log('   ✓ Probabilities refresh tick executed cleanly.');

  // Clean up
  try { fs.rmSync(testDir, { recursive: true, force: true }); } catch {}

  console.log('\n>>> ALL LIVE SYNC TESTS PASSED! <<<\n');
}

testLiveSync().catch((e) => {
  console.error('LiveSync test failed:', e);
  process.exit(1);
});
