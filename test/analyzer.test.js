const test = require('node:test');
const assert = require('node:assert/strict');
const AuctionAnalyzer = require('../lib/analyzer');
const { demoAuctions, demoTransactions } = require('../lib/demo-data');

const analyzer = new AuctionAnalyzer();
const auctions = demoAuctions();
const transactions = demoTransactions();
analyzer.addSnapshot(auctions);

test('buildMarket produces sale-backed normalized markets', () => {
  const market = analyzer.buildMarket(auctions, transactions);
  assert.ok(market.length >= 25);
  const diamond = market.find(item => item.name === 'Diamond');
  assert.ok(diamond.floor > 0);
  assert.ok(diamond.fairValue > 0);
  assert.ok(diamond.sales > 0);
  assert.ok(diamond.confidence > 0 && diamond.confidence <= 100);
});

test('flip scanner produces finite, profitable opportunities', () => {
  const flips = analyzer.detectFlips(auctions, transactions);
  assert.ok(flips.length > 0);
  for (const flip of flips) {
    assert.ok(Number.isFinite(flip.profit));
    assert.ok(flip.profit > 0);
    assert.ok(flip.roi >= 6);
    assert.ok(flip.risk.score >= 0 && flip.risk.score <= 100);
  }
});

test('portfolio respects budget and risk ceiling', () => {
  const portfolio = analyzer.calculatePortfolio(5_000_000, auctions, transactions, [], 55);
  assert.ok(portfolio.totalCost <= 5_000_000);
  assert.equal(portfolio.remaining, 5_000_000 - portfolio.totalCost);
  assert.ok(portfolio.allocation.every(row => row.flip.risk.score <= 55));
});

test('order arbitrage uses full buyer price without auction tax', () => {
  const market = analyzer.buildMarket(auctions, transactions);
  const diamond = market.find(item => item.name === 'Diamond');
  const flips = analyzer.detectFlips(auctions, transactions, [{ itemName: 'Diamond', pricePerUnit: diamond.floor * 1.8, quantity: 64 }]);
  const order = flips.find(item => item.type === 'order' && item.name === 'Diamond');
  assert.ok(order);
  assert.equal(order.afterTax, order.sellPrice);
});
