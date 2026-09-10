'use strict';

// Run browser suites against their own PostgreSQL database, never the user's app.
require('../lib/load-env');
const { spawn } = require('child_process');
const path = require('path');
const { createTestStore } = require('./pg-helper');
const root = path.join(__dirname, '..');

(async () => {
  const suite = process.argv[2];
  if (!['qa.test.js', 'md.test.js'].includes(suite)) throw new Error('Unknown UI suite');
  const store = await createTestStore(suite.split('.')[0]);
  const database = store.pool.options.database;
  await store.close();
  const env = { ...process.env, DATABASE_URL: '', PGDATABASE: database,
    PREDIX_DB: 'pg', NODE_ENV: 'development', PORT: '0' };
  // Reserve a local test port. The application logs its configured port.
  const net = require('net');
  const probe = net.createServer();
  await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
  env.PORT = String(probe.address().port);
  await new Promise(resolve => probe.close(resolve));
  const server = spawn(process.execPath, ['--env-file=.env', 'server.js'], {
    cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  });
  // Do not forward server logs: startup can contain admin credentials.
  server.stderr.resume();
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Test server startup timed out')), 15000);
      let output = '';
      server.stdout.on('data', chunk => {
        output += chunk;
        if (output.includes('http://localhost:')) { clearTimeout(timer); resolve(); }
      });
      server.once('exit', () => { clearTimeout(timer); reject(new Error('Test server exited before ready')); });
      server.once('error', reject);
    });
    const base = `http://127.0.0.1:${env.PORT}`;
    // A fresh server can listen before its first bot quote has completed.
    // The market-detail suite requires an already populated order book.
    if (suite === 'md.test.js') {
      const deadline = Date.now() + 15000;
      let ready = false;
      while (Date.now() < deadline) {
        const { markets } = await (await fetch(base + '/api/markets')).json();
        const market = markets.find(m => !m.multi && m.status === 'open');
        if (market) {
          const { book } = await (await fetch(base + '/api/markets/' + market.slug)).json();
          if (book?.bids?.length && book?.asks?.length) { ready = true; break; }
        }
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      if (!ready) throw new Error('Test market quotes not ready');
    }
    const child = spawn(process.execPath, ['--env-file=.env', path.join('tests', suite)], {
      cwd: root, env: { ...env, PREDIX_TEST_BASE_URL: base },
      stdio: 'inherit', windowsHide: true,
    });
    process.exitCode = await new Promise((resolve, reject) => {
      child.once('exit', code => resolve(code === null ? 1 : code));
      child.once('error', reject);
    });
  } finally {
    server.kill();
  }
})().catch(() => { console.error('Isolated UI test setup failed'); process.exitCode = 1; });
