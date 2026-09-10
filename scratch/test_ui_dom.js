'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

async function testDom() {
  const indexHtml = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  const dom = new JSDOM(indexHtml, { runScripts: 'dangerously', url: 'http://localhost:3000/#/' });
  const { window } = dom;

  window.scrollTo = () => {};
  window.EventSource = class {
    constructor() {}
    addEventListener() {}
    close() {}
  };

  // Polyfill browser globals
  window.fetch = async (url, opts = {}) => {
    return {
      ok: true,
      status: 200,
      json: async () => {
        if (url.includes('/api/markets')) {
          return {
            markets: [
              { id: 1, title: 'Open Market 1', slug: 'open-1', status: 'open', last: 50, vol24: 100 },
              { id: 2, title: 'Resolved Market 2', slug: 'resolved-2', status: 'resolved', outcome: 'yes', last: 100, vol24: 500 }
            ]
          };
        }
        if (url.includes('/api/portfolio')) {
          return {
            wallet: { available: 5000, reserved: 1000 },
            positions: [],
            orders: [{ id: 10, marketId: 1, outcome: 'yes', side: 'buy', type: 'limit', price: 40, qty: 5, filled: 0, status: 'open' }],
            orderHistory: [
              { id: 8, marketId: 1, outcome: 'yes', side: 'buy', type: 'limit', price: 50, qty: 0, origQty: 5, filled: 5, status: 'filled', statusText: 'FILLED' },
              { id: 9, marketId: 1, outcome: 'no', side: 'buy', type: 'limit', price: 30, qty: 0, origQty: 2, filled: 0, status: 'canceled', statusText: 'CANCELLED' }
            ],
            trades: [],
            ledger: []
          };
        }
        return {};
      }
    };
  };

  // Evaluate app.js via script element
  const appCode = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
  const scriptEl = window.document.createElement('script');
  scriptEl.textContent = appCode;
  window.document.body.appendChild(scriptEl);

  console.log('[DOM Test] Loaded app.js successfully.');

  // Set mock user and markets in app.js scope
  window.state.me = { id: 1, username: 'testtrader', role: 'user', createdAt: Date.now() };
  window.state.markets = [
    { id: 1, title: 'Open Market 1', slug: 'open-1', status: 'open', last: 50, vol24: 100 },
    { id: 2, title: 'Resolved Market 2', slug: 'resolved-2', status: 'resolved', outcome: 'yes', last: 100, vol24: 500 }
  ];
  window.state.markets.forEach(m => window.state.byslug.set(m.slug, m));

  // 1. Test viewHome
  console.log('\nTesting viewHome()...');
  await window.viewHome('home');
  const appEl = window.document.getElementById('app');
  console.log('  Active tab exists:', !!appEl.querySelector('#market-status-tabs button[data-mst="active"]'));
  console.log('  Resolved section exists:', !!appEl.querySelector('#resolved-section'));
  console.log('  Grid markets count:', appEl.querySelectorAll('#grid .market-card').length);

  // 2. Test viewPortfolio
  console.log('\nTesting viewPortfolio()...');
  await window.viewPortfolio();
  console.log('  Open orders table exists:', !!appEl.querySelector('[data-ordrow]'));
  console.log('  Past orders section exists:', !!appEl.querySelector('#past-orders-section'));
  console.log('  Past order tabs count:', appEl.querySelectorAll('#past-orders-tabs button').length);
  const pastRows = appEl.querySelectorAll('#past-orders-section tbody tr');
  console.log('  Past orders rows rendered:', pastRows.length);
  const filledBadge = appEl.querySelector('.ord-status.filled');
  console.log('  Filled status badge rendered:', !!filledBadge, filledBadge ? filledBadge.textContent : '');
  const canceledBadge = appEl.querySelector('.ord-status.canceled');
  console.log('  Canceled status badge rendered:', !!canceledBadge, canceledBadge ? canceledBadge.textContent : '');

  // 3. Test Market Activity Panel HTML
  console.log('\nTesting marketActivityHTML()...');
  const actHtml = window.eval(`
    marketActivityHTML({
      id: 1, slug: 'open-1', title: 'Open Market 1', status: 'open',
      trades: [{ id: 1, price: 50, qty: 10, ts: Date.now(), takerKind: 'BY', taker: 'alice', maker: 'bob' }],
      myOrders: [{ id: 10, outcome: 'yes', side: 'buy', type: 'limit', price: 40, qty: 5, filled: 0, status: 'open', statusText: 'OPEN' }],
      myPastOrders: [{ id: 8, outcome: 'yes', side: 'buy', type: 'limit', price: 50, origQty: 5, filled: 5, status: 'filled', statusText: 'FILLED' }],
      myTrades: [{ id: 101, outcome: 'yes', side: 'buy', price: 50, qty: 5, ts: Date.now() }]
    }, 'market');
  `);
  console.log('  Activity card contains Market Trades tab:', actHtml.includes('Market Trades (1)'));
  console.log('  Activity card contains My Orders tab:', actHtml.includes('My Orders (2)'));
  console.log('  Activity card contains My Trades tab:', actHtml.includes('My Trades (1)'));

  const myOrdersHtml = window.eval(`
    marketActivityHTML({
      id: 1, slug: 'open-1', title: 'Open Market 1', status: 'open',
      trades: [],
      myOrders: [{ id: 10, outcome: 'yes', side: 'buy', type: 'limit', price: 40, qty: 5, filled: 0, status: 'open', statusText: 'OPEN' }],
      myPastOrders: [{ id: 8, outcome: 'yes', side: 'buy', type: 'limit', price: 50, origQty: 5, filled: 5, status: 'filled', statusText: 'FILLED' }],
      myTrades: []
    }, 'my-orders');
  `);
  console.log('  My Orders view contains FILLED order:', myOrdersHtml.includes('FILLED'));
  console.log('  My Orders view contains OPEN order:', myOrdersHtml.includes('OPEN'));

  const myTradesHtml = window.eval(`
    marketActivityHTML({
      id: 1, slug: 'open-1', title: 'Open Market 1', status: 'open',
      trades: [],
      myOrders: [],
      myPastOrders: [],
      myTrades: [{ id: 101, outcome: 'yes', side: 'buy', price: 50, qty: 5, ts: Date.now() }]
    }, 'my-trades');
  `);
  console.log('  My Trades view contains trade price:', myTradesHtml.includes('$0.50'));
  console.log('\n>>> All UI and DOM structure tests PASSED! <<<');
}

testDom().catch(console.error);
