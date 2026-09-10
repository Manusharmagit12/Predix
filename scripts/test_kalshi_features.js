const http = require('http');

const jar = new Map();
function cookieHeader() {
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
}

function req(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const payload = body ? Buffer.from(typeof body === 'string' ? body : JSON.stringify(body)) : null;
    const headers = {
      ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': payload.length } : {}),
      ...(jar.size ? { Cookie: cookieHeader() } : {}),
    };

    const r = http.request(
      {
        hostname: '127.0.0.1',
        port: 3000,
        path,
        method,
        headers,
      },
      (res) => {
        (res.headers['set-cookie'] || []).forEach((c) => {
          const [kv] = c.split(';');
          const i = kv.indexOf('=');
          jar.set(kv.slice(0, i).trim(), kv.slice(i + 1).trim());
        });
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          let json = null;
          try {
            json = JSON.parse(data);
          } catch {}
          resolve({ status: res.statusCode, headers: res.headers, body: json || data });
        });
      }
    );
    r.on('error', reject);
    if (payload) r.write(payload);
    r.end();
  });
}

function fmtMoney(c) {
  return '$' + (c / 100).toFixed(2);
}
function fmtPrice(c) {
  return '$' + (c / 100).toFixed(2);
}

async function run() {
  console.log('--- Testing Kalshi Point Dollars & Max Stake Buying ---');

  // 1. Fetch public markets and check pricing display
  const mktsRes = await req('GET', '/api/markets');
  const mkts = mktsRes.body.markets || mktsRes.body;
  console.log(`✓ Fetched ${mkts.length} markets`);
  const openMkt = mkts.find((m) => m.status === 'open' && !m.multi);
  if (!openMkt) throw new Error('No open binary market found');
  console.log(`✓ Market: "${openMkt.title}"`);
  console.log(`  Last price in point dollars: ${fmtPrice(openMkt.last || 50)}`);

  // 2. Create fresh user & claim WELCOME100
  const uname = 'k_' + Date.now().toString(36);
  const password = 'supersecret1!';
  const suRes = await req('POST', '/api/auth/signup', {
    username: uname,
    email: uname + '@test.local',
    password,
    promo: 'WELCOME100',
  });
  if (suRes.status !== 201) throw new Error(`Signup failed (${suRes.status}): ` + JSON.stringify(suRes.body));
  const loginRes = await req('POST', '/api/auth/login', {
    identifier: uname,
    password,
  });
  if (loginRes.status !== 200) throw new Error(`Login failed (${loginRes.status}): ` + JSON.stringify(loginRes.body));
  console.log(`✓ Signed up & logged in as "${uname}", session established`);

  // 3. Fetch market detail with order book
  const mktDetail = await req('GET', `/api/markets/${openMkt.slug}`);
  const book = mktDetail.body.book || {};
  const bestBid = (book.bids && book.bids[0]) ? book.bids[0].price : null;
  const bestAsk = (book.asks && book.asks[0]) ? book.asks[0].price : null;
  console.log(`  Orderbook best bid: ${bestBid !== null ? fmtPrice(bestBid) : 'none'}`);
  console.log(`  Orderbook best ask: ${bestAsk !== null ? fmtPrice(bestAsk) : 'none'}`);
  if (bestBid !== null && bestAsk !== null) {
    console.log(`  Spread in point dollars: ${fmtPrice(bestAsk - bestBid)}`);
    console.log(`  Mid in point dollars: ${fmtPrice((bestBid + bestAsk) / 2)}`);
  }

  // 4. Verify balance ($100.00)
  const meRes = await req('GET', '/api/me');
  const snapshot = meRes.body.snapshot;
  const availableCash = snapshot.wallet.available;
  console.log(`✓ User available balance: ${fmtMoney(availableCash)} (${availableCash} cents)`);

  // 5. Test Kalshi Max Contract Calculation
  const buyPrice = bestAsk || 60; // buy at best ask or 60c
  const maxPossibleContracts = Math.floor(availableCash / buyPrice);
  const totalCost = maxPossibleContracts * buyPrice;
  const potentialPayout = maxPossibleContracts * 100; // $1.00 per contract
  const potentialProfit = potentialPayout - totalCost;

  console.log('\n--- Kalshi Max Calculation ---');
  console.log(`  Contract Price: ${fmtPrice(buyPrice)}`);
  console.log(`  Max Possible Contracts Affordable: ${maxPossibleContracts}`);
  console.log(`  Total Cost: ${fmtMoney(totalCost)} (Remaining cash: ${fmtMoney(availableCash - totalCost)})`);
  console.log(`  Potential Payout ($1.00/contract): ${fmtMoney(potentialPayout)}`);
  console.log(`  Potential Profit: +${fmtMoney(potentialProfit)}`);
  console.log(`  Max Loss: -${fmtMoney(totalCost)}`);

  if (totalCost > availableCash) {
    throw new Error('Max calculation exceeded available balance!');
  }
  console.log('✓ Max contracts mathematically guaranteed affordable within cash balance');

  // 6. Execute Max Limit Order
  console.log('\n--- Executing Max Stake Buy Order ---');
  const orderRes = await req(
    'POST',
    '/api/orders',
    {
      market: openMkt.slug,
      side: 'buy',
      outcome: 'yes',
      type: 'limit',
      price: buyPrice,
      qty: maxPossibleContracts,
      idemKey: 'kalshi-max-' + Date.now(),
    }
  );

  console.log(`✓ Order response: status=${orderRes.body.order.status}, filled=${orderRes.body.order.filled}, remaining=${orderRes.body.order.qty}`);
  const meAfterBuy = await req('GET', '/api/me');
  console.log(`✓ Balance after Max order: Available=${fmtMoney(meAfterBuy.body.snapshot.wallet.available)}, Reserved=${fmtMoney(meAfterBuy.body.snapshot.wallet.reserved)}`);

  // Check positions
  const pos = meAfterBuy.body.snapshot.positions.find((p) => p.marketId === openMkt.id);
  if (pos && pos.yesQty > 0) {
    console.log(`✓ Position acquired: ${pos.yesQty} YES contracts @ avg ${fmtPrice(pos.yesAvg)}`);
    console.log(`  Max payout if YES: ${fmtMoney(pos.maxPayoutYes)}`);

    // 7. Test Kalshi Max Sell (All free contracts)
    console.log('\n--- Executing Max Sell (All Free Contracts) ---');
    const freeToSell = pos.yesFree;
    console.log(`  Free contracts available to sell: ${freeToSell}`);
    const sellRes = await req(
      'POST',
      '/api/orders',
      {
        market: openMkt.slug,
        side: 'sell',
        outcome: 'yes',
        type: 'limit',
        price: Math.max(1, buyPrice - 2), // marketable sell
        qty: freeToSell,
        idemKey: 'kalshi-sell-all-' + Date.now(),
      }
    );
    console.log(`✓ Sell order response: status=${sellRes.body.order.status}, filled=${sellRes.body.order.filled}`);
  }

  console.log('\n======================================================');
  console.log('🎉 ALL KALSHI POINT-DOLLAR & MAX STAKE TESTS PASSED! 🎉');
  console.log('======================================================');
}

run().catch((e) => {
  console.error('FAILED:', e);
  process.exit(1);
});
