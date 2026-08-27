const test = require('node:test');
const assert = require('node:assert/strict');
const { server, runScan } = require('../server');
let base;

test.before(async () => {
  await runScan();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => new Promise(resolve => server.close(resolve)));

test('health reports usable dataset', async () => {
  const response = await fetch(`${base}/api/health`);
  const data = await response.json();
  assert.equal(response.status, 200);
  assert.equal(data.status, 'ok');
  assert.ok(data.auctions > 0);
});

test('overview and market endpoints return product data', async () => {
  const overview = await (await fetch(`${base}/api/overview`)).json();
  const market = await (await fetch(`${base}/api/market?limit=10`)).json();
  assert.ok(overview.summary.recordedSales > 0);
  assert.equal(market.items.length, 10);
  assert.ok(market.total >= market.items.length);
});

test('input validation rejects unsafe player names', async () => {
  const response = await fetch(`${base}/api/player/not%20valid!`);
  assert.equal(response.status, 400);
});
