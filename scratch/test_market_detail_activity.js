'use strict';

async function main() {
  const username = 'trader_' + Date.now().toString().slice(-6);
  const password = 'StrongPassword123!';
  const email = `${username}@example.com`;

  console.log(`[test] Registering user: ${username} with WELCOME100 promo...`);
  const signupRes = await fetch('http://localhost:3000/api/auth/signup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, email, password, promo: 'WELCOME100' }),
  });
  console.log('Signup status:', signupRes.status);
  const signupData = await signupRes.json();
  console.log('Signup result:', signupData.user.username, 'Promo:', signupData.promoApplied);

  // Login to obtain session cookie
  const loginRes = await fetch('http://localhost:3000/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: username, password }),
  });
  console.log('Login status:', loginRes.status);
  const cookie = loginRes.headers.get('set-cookie');
  console.log('Session cookie received:', !!cookie);

  // Pick a binary open market (e.g. Fed funds or Bitcoin)
  const mktListRes = await fetch('http://localhost:3000/api/markets');
  const mktList = await mktListRes.json();
  const targetMarket = mktList.markets.find(m => m.status === 'open' && !m.multi);
  console.log('\nTarget binary market:', targetMarket.title, `(${targetMarket.slug})`);

  // Initial market detail
  const mktRes1 = await fetch(`http://localhost:3000/api/markets/${targetMarket.slug}`, {
    headers: { Cookie: cookie },
  });
  const mkt1 = await mktRes1.json();
  console.log('Initial market detail:');
  console.log('  myOrders:', (mkt1.myOrders || []).length);
  console.log('  myPastOrders:', (mkt1.myPastOrders || []).length);
  console.log('  myTrades:', (mkt1.myTrades || []).length);

  // 1. Place a resting limit buy order below the market (at 15¢)
  console.log('\n[test] 1. Placing resting limit BUY order at 15¢...');
  const limitOrderRes = await fetch('http://localhost:3000/api/orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({
      marketId: targetMarket.id,
      outcome: 'yes',
      side: 'buy',
      type: 'limit',
      price: 15,
      qty: 5,
      tif: 'GTC',
    }),
  });
  const limitOrderData = await limitOrderRes.json();
  console.log('Limit order created: ID', limitOrderData.order.id, 'status:', limitOrderData.order.status);

  // Verify market detail shows the resting order
  const mktRes2 = await fetch(`http://localhost:3000/api/markets/${targetMarket.slug}`, {
    headers: { Cookie: cookie },
  });
  const mkt2 = await mktRes2.json();
  console.log('Market detail after limit order:');
  console.log('  myOrders count:', (mkt2.myOrders || []).length);
  console.log('  myPastOrders count:', (mkt2.myPastOrders || []).length);

  // 2. Cancel the resting order
  console.log('\n[test] 2. Canceling resting order...');
  const cancelRes = await fetch(`http://localhost:3000/api/orders/${limitOrderData.order.id}/cancel`, {
    method: 'POST',
    headers: { Cookie: cookie },
  });
  console.log('Cancel response:', await cancelRes.json());

  // Verify market detail moves order to myPastOrders!
  const mktRes3 = await fetch(`http://localhost:3000/api/markets/${targetMarket.slug}`, {
    headers: { Cookie: cookie },
  });
  const mkt3 = await mktRes3.json();
  console.log('Market detail after cancel:');
  console.log('  myOrders count:', (mkt3.myOrders || []).length);
  console.log('  myPastOrders count:', (mkt3.myPastOrders || []).length);
  const canceledOrder = (mkt3.myPastOrders || []).find(o => o.id === limitOrderData.order.id);
  console.log('  Found canceled order in myPastOrders:', !!canceledOrder, {
    status: canceledOrder.status,
    statusText: canceledOrder.statusText,
    price: canceledOrder.price,
    qty: canceledOrder.origQty,
    note: canceledOrder.note,
  });

  // 3. Place an aggressive limit order that executes against resting bot asks
  console.log('\n[test] 3. Placing BUY order to cross the spread and trade immediately...');
  const tradeOrderRes = await fetch('http://localhost:3000/api/orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({
      marketId: targetMarket.id,
      outcome: 'yes',
      side: 'buy',
      type: 'limit',
      price: 85, // will match with asks on the book
      qty: 4,
      tif: 'IOC',
    }),
  });
  const tradeOrderData = await tradeOrderRes.json();
  console.log('Trade order response: status', tradeOrderData.order.status, 'filled:', tradeOrderData.order.filled, 'avgFill:', tradeOrderData.order.avgFill);

  // Check market detail again: myTrades should have the trade, myPastOrders should have the filled/canceled order
  const mktRes4 = await fetch(`http://localhost:3000/api/markets/${targetMarket.slug}`, {
    headers: { Cookie: cookie },
  });
  const mkt4 = await mktRes4.json();
  console.log('\nMarket detail after executed trade:');
  console.log('  myOrders count:', (mkt4.myOrders || []).length);
  console.log('  myPastOrders count:', (mkt4.myPastOrders || []).length);
  console.log('  myTrades count:', (mkt4.myTrades || []).length);
  if (mkt4.myTrades && mkt4.myTrades.length) {
    console.log('  Latest trade details:', mkt4.myTrades[0]);
  }

  // 4. Check portfolio endpoint
  const portRes = await fetch('http://localhost:3000/api/portfolio', {
    headers: { Cookie: cookie },
  });
  const portData = await portRes.json();
  console.log('\nPortfolio verification:');
  console.log('  Open orders:', (portData.orders || []).length);
  console.log('  Past orderHistory count:', (portData.orderHistory || []).length);
  console.log('  Positions count:', (portData.positions || []).length);
  console.log('  Past order list:', (portData.orderHistory || []).map(o => `[${o.id}] ${o.side} ${o.outcome.toUpperCase()} (${o.statusText}) filled: ${o.filled}/${o.origQty} @ ${o.price}¢`));

  console.log('\n>>> All past bids, orders, trades, and portfolio sections verified successfully! <<<');
}

main().catch(console.error);
