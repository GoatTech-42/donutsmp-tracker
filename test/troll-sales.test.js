const { test } = require('node:test')
const assert = require('node:assert')

const AuctionAnalyzer = require('../lib/analyzer')

const mkListing = (name, price) => ({ itemName: name, price, count: 1 })
const mkSale = (name, price) => ({ itemName: name, price, count: 1 })

test('troll sales cannot anchor fairValue above the ask market', () => {
  const a = new AuctionAnalyzer()
  // Five $100 asks establish the real market; 5 sales where 3 are $10M jokes.
  const asks = [95, 100, 100, 102, 105].map(p => mkListing('Oak Button', p))
  const sales = [100, 100, 10_000_000, 10_000_000, 10_000_000].map(p => mkSale('Oak Button', p))
  const market = a.buildMarket(asks, sales)
  const row = market.find(x => x.name === 'Oak Button')
  assert.ok(row, 'market row exists')
  // Trolls dragged the sales median to 10M; trusted sales must fall back to asks.
  assert.ok(row.fairValue < 500, `fairValue ${row.fairValue} should track the ~$100 ask market`)
})

test('one troll sale does not explode volatility', () => {
  const a = new AuctionAnalyzer()
  const asks = [99, 100, 100, 101, 102].map(p => mkListing('Oak Button', p))
  const sales = [99, 100, 100, 101, 102, 50_000].map(p => mkSale('Oak Button', p))
  const market = a.buildMarket(asks, sales)
  const row = market.find(x => x.name === 'Oak Button')
  assert.ok(row.volatility < 10, `volatility ${row.volatility} should stay single-digit`)
})

test('troll sales do not boost confidence', () => {
  const a = new AuctionAnalyzer()
  const asks = [99, 100, 100, 101, 102].map(p => mkListing('Oak Button', p))
  // 5 joke sales at $10M against a $100 ask market: zero of them are trustworthy.
  const sales = [10_000_000, 10_000_000, 10_000_000, 10_000_000, 10_000_000].map(p => mkSale('Oak Button', p))
  const market = a.buildMarket(asks, sales)
  const row = market.find(x => x.name === 'Oak Button')
  assert.ok(row.confidence <= 40, `confidence ${row.confidence} should be capped without trusted sales`)
})

test('normal sales still anchor fairValue when nothing is fishy', () => {
  const a = new AuctionAnalyzer()
  const asks = [95, 100, 100, 102, 105].map(p => mkListing('Oak Button', p))
  const sales = [98, 100, 100, 101, 103, 99].map(p => mkSale('Oak Button', p))
  const market = a.buildMarket(asks, sales)
  const row = market.find(x => x.name === 'Oak Button')
  assert.ok(row.fairValue >= 95 && row.fairValue <= 105, `fairValue ${row.fairValue} should stay ~100`)
  assert.strictEqual(row.fairValueSource, 'sales_median')
})
