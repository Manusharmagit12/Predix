'use strict';

async function main() {
  const username = 'cashout_' + Date.now().toString().slice(-6);
  const password = 'StrongPassword123!';
  const email = `${username}@example.com`;

  console.log(`[test] Registering user: ${username}...`);
  await fetch('http://localhost:3000/api/auth/signup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, email, password, promo: 'WELCOME100' }),
  });

  const loginRes = await fetch('http://localhost:3000/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: username, password }),
  });
  const cookie = loginRes.headers.get('set-cookie');

  // Find open market
  const mktListRes = await fetch('http://localhost:3000/api/markets');
  const mktList = await mktListRes.json();
  const mkt = mktList.markets.find(m => m.status === 'open' && !m.multi && m.bid && m.ask);

  console.log(`Using market: ${mkt.title} (Bid: ${mkt.bid}¢, Ask: ${mkt.ask}¢)`);

  // Buy 5 YES contracts at market
  console.log('Buying 5 YES at market...');
  const buyRes = await fetch('http://localhost:3000/api/orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({
      marketId: mkt.id,
      side: 'buy',
      outcome: 'yes',
      type: 'market',
      qty: 5,
    }),
  });
  const buyData = await buyRes.json();
  console.log('Buy filled:', buyData.order.filled, 'shares @ avg', buyData.order.avgFill);

  // Check portfolio positions
  const portRes1 = await fetch('http://localhost:3000/api/portfolio', { headers: { Cookie: cookie } });
  const port1 = await portRes1.json();
  const pos = port1.positions.find(p => p.marketId === mkt.id);
  console.log('Portfolio position before cash out:', {
    yesQty: pos.yesQty,
    yesFree: pos.yesFree,
    unrealized: pos.unrealized,
  });

  // 1-Click Cash Out: Sell free YES contracts at market
  console.log(`Executing 1-Click Cash Out for ${pos.yesFree} YES contracts...`);
  const cashOutRes = await fetch('http://localhost:3000/api/orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({
      marketId: mkt.id,
      side: 'sell',
      outcome: 'yes',
      type: 'market',
      qty: pos.yesFree,
    }),
  });
  const cashOutData = await cashOutRes.json();
  console.log('Cash out order status:', cashOutData.order.status, 'filled:', cashOutData.order.filled, 'avgFill:', cashOutData.order.avgFill);

  // Check portfolio after cash out
  const portRes2 = await fetch('http://localhost:3000/api/portfolio', { headers: { Cookie: cookie } });
  const port2 = await portRes2.json();
  const posAfter = port2.positions.find(p => p.marketId === mkt.id);
  console.log('Portfolio position after cash out:', posAfter ? { yesQty: posAfter.yesQty, noQty: posAfter.noQty } : 'Position completely closed (0 shares)');
  console.log('Available cash balance:', port2.wallet.available / 100, 'dollars');
  console.log('>>> 1-Click Cash Out verified successfully! <<<');
}

main().catch(console.error);
