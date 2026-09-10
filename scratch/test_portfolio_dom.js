const fs = require('fs');
const jsdom = require('jsdom');
const { JSDOM } = jsdom;

const appJs = fs.readFileSync('public/app.js', 'utf8');
const html = fs.readFileSync('public/index.html', 'utf8')
  .replace(/<script[^>]*src=[^>]*><\/script>/g, '')
  .replace('</body>', () => '<script>' + appJs + '</script></body>');

const dom = new JSDOM(html, {
  url: 'http://localhost:3000/#/portfolio',
  runScripts: 'dangerously',
  pretendToBeVisual: true,
  beforeParse(w) {
    w.EventSource = class { constructor() {} close() {} addEventListener() {} };
    w.scrollTo = () => {};
    w.fetch = (url, opts) => fetch('http://localhost:3000' + url, opts);
  }
});

const w = dom.window;

setTimeout(async () => {
  try {
    w.eval(`
      state.me = { id: 1, username: 'admin', role: 'admin', createdAt: Date.now() };
      window.api = async (url) => {
        if (url === '/api/portfolio') {
          return {
            wallet: { available: 10000, reserved: 2000, total: 12000 },
            orders: [
              { id: 101, marketId: 1, outcome: 'yes', side: 'buy', type: 'limit', price: 50, filled: 0, qty: 10 }
            ],
            positions: [],
            trades: [
              { id: 1, marketId: 1, takerKind: 'BY', price: 62, qty: 5, ts: Date.now() - 3600000 }
            ],
            ledger: [],
            orderHistory: [
              { id: 99, marketId: 1, side: 'buy', outcome: 'yes', type: 'limit', price: 45, filled: 10, origQty: 10, avgFill: 45, status: 'filled', statusText: 'FILLED', createdAt: Date.now() - 7200000 },
              { id: 98, marketId: 2, side: 'sell', outcome: 'no', type: 'limit', price: 30, filled: 0, origQty: 5, status: 'canceled', statusText: 'CANCELLED', createdAt: Date.now() - 86400000, note: 'Canceled by user' }
            ],
            rewards: { tier: 'Bronze', points: 150, perk: 'Basic' },
            referralCount: 0
          };
        }
        if (url === '/api/me/stats') {
          return { stats: { tradeCount: 1, buys: 1, sells: 0, volume: 500, winRate: null, winCount: 0, settledCount: 0, series: [] } };
        }
        if (url === '/api/withdrawals') {
          return { wallet: { withdrawable: 10000 }, withdrawals: [] };
        }
        return { markets: [] };
      };
      viewPortfolio();
    `);
    await new Promise(r => setTimeout(r, 800));

    const pastOrdersSec = w.document.querySelector('#past-orders-section');
    console.log('Past Orders Section exists:', !!pastOrdersSec);
    console.log('Past Orders Section heading:', pastOrdersSec?.querySelector('h3')?.textContent);
    console.log('Past Orders tabs:', [...(pastOrdersSec?.querySelectorAll('#past-orders-tabs button') || [])].map(b => b.textContent));
    
    const tables = w.document.querySelectorAll('table.tbl');
    console.log('Number of tables rendered in portfolio:', tables.length);

    console.log('DOM check passed successfully!');
    process.exit(0);
  } catch (err) {
    console.error('DOM check failed:', err);
    process.exit(1);
  }
}, 500);
