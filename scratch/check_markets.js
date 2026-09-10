const { Client } = require('pg');
require('../lib/load-env');

async function main() {
  const client = new Client();
  await client.connect();
  const res = await client.query(`
    SELECT 
      id, 
      slug, 
      status, 
      data->>'title' as title, 
      data->>'category' as category, 
      (data->>'vol24')::int as vol24, 
      data->>'resolved' as resolved,
      created_at
    FROM markets 
    ORDER BY id ASC
  `);
  console.table(res.rows);
  await client.end();
}

main().catch(console.error);
