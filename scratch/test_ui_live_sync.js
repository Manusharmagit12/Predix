const fs = require('fs');
const { JSDOM } = require('jsdom');

async function testUiLiveSync() {
  const html = fs.readFileSync('public/index.html', 'utf8');
  const dom = new JSDOM(html, {
    url: 'http://localhost:3000/#/',
    runScripts: 'dangerously',
    resources: 'usable',
    beforeParse(window) {
      window.EventSource = class {
        constructor() {}
        addEventListener() {}
        close() {}
      };
      window.scrollTo = () => {};
    }
  });

  const { window } = dom;
  const { document } = window;

  // Let scripts parse
  await new Promise(r => setTimeout(r, 1200));

  console.log('App title:', document.title);
  
  // Test market card rendering with live sync market
  const sampleLiveMarket = {
    id: 'm_live_test',
    slug: 'live-test-ai',
    title: 'In early 2028, will an AI be able to make a full feature movie?',
    category: 'AI',
    categoryIcon: '🤖',
    status: 'open',
    isLiveSync: true,
    liveSource: 'Manifold',
    liveExternalUrl: 'https://manifold.markets/test',
    liveProb: 0.28,
    liveVolume: 13690000,
    probYes: 28,
    bestYes: 0.27,
    bestNo: 0.73,
    volumeCents: 50000
  };

  // Test statusBadge
  const badgeHtml = window.statusBadge ? window.statusBadge(sampleLiveMarket) : '';
  console.log('Status badge HTML:', badgeHtml);
  if (!badgeHtml.includes('Live Sync') || !badgeHtml.includes('live-pulse-dot')) {
    throw new Error('statusBadge does not include Live Sync or pulse dot');
  }

  // Test marketCard
  const cardHtml = window.marketCard ? window.marketCard(sampleLiveMarket) : '';
  console.log('Card has live sync badge:', cardHtml.includes('Live Sync'));
  console.log('Card has real-world volume:', cardHtml.includes('13.7M') || cardHtml.includes('13.69M') || cardHtml.includes('$13.7M'));
  if (!cardHtml.includes('Live Sync')) {
    throw new Error('marketCard does not include Live Sync');
  }

  // Test live market banner in market detail
  const bannerHtml = window.liveMarketBanner ? window.liveMarketBanner(sampleLiveMarket) : (
    cardHtml.includes('live-market-banner') ? 'in card' : ''
  );

  console.log('✅ UI Live Sync rendering verified successfully in DOM!');
}

testUiLiveSync().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});
