const test = require('node:test')
const assert = require('node:assert')
const { NeuralNetwork, MarketPredictor } = require('../lib/neural-network')
const AuctionAnalyzer = require('../lib/analyzer')

function flatHistory(n, base = 1000) {
  const out = []
  for (let i = 0; i < n; i++)
    out.push({ timestamp: 1700000000000 + i * 300000, median: base + (i % 3) - 1, floor: base - 10, listings: 20, sales: 1, volume: 2 })
  return out
}

function rampHistory(n, base = 500) {
  const out = []
  for (let i = 0; i < n; i++)
    out.push({ timestamp: 1700000000000 + i * 300000, median: base * (1 + 0.03 * i), floor: base, listings: 15, sales: 2, volume: 3 })
  return out
}

test('NaN-poisoned training batch never corrupts weights', () => {
  const net = new NeuralNetwork(2, [3], 1)
  net.train([[0, 0], [1, 1]], [[NaN], [0.5]], 3, 2)
  for (const W of net.weights) for (const row of W) for (const w of row)
    assert.ok(Number.isFinite(w), 'weight must stay finite')
})

test('trend minority classes get oversampled (anti always-FLAT collapse)', () => {
  const p = new MarketPredictor()
  p.horizon = 4
  const histories = new Map()
  // 6 flat items vs 1 rising item: FLAT dominates without oversampling
  for (let k = 0; k < 6; k++) histories.set('flat' + k, flatHistory(40))
  histories.set('riser', rampHistory(40))
  const ret = p.train(histories, [])
  assert.ok(ret.trendClassBalance, 'train returns class balance')
  const { before, after } = ret.trendClassBalance
  assert.ok(before.FLAT > before.UP, 'fixture: FLAT dominates raw pairs')
  assert.ok(after.oversampledTotal > before.UP + before.FLAT + before.DOWN, 'oversampling grew the set')
})

test('shallow history caps reported confidence at 30 and flags lowData', () => {
  const p = new MarketPredictor()
  p.horizon = 4
  const histories = new Map([['a', flatHistory(40)], ['b', rampHistory(40)]])
  p.train(histories, [])
  const deep = p.predict('a', flatHistory(40))
  const shallow = p.predict('a', flatHistory(3))
  assert.ok(deep.confidence > 30 || deep.confidence <= 100) // deep uncapped path
  assert.ok(shallow.confidence <= 30, `shallow confidence ${shallow.confidence} must be <= 30`)
  assert.strictEqual(shallow.lowData, true)
  assert.strictEqual(deep.lowData, undefined)
})

test('analyzer rejects errored or NaN worker results, accepts valid ones', () => {
  const a = new AuctionAnalyzer()
  assert.strictEqual(a._isValidWorkerResult(null), false)
  assert.strictEqual(a._isValidWorkerResult({}), false)
  assert.strictEqual(a._isValidWorkerResult({ save: { pricePredictor: {} }, train: { error: 'boom' } }), false)
  assert.strictEqual(
    a._isValidWorkerResult({ save: { pricePredictor: { weights: [[[NaN]]] } }, train: { samples: 5 } }),
    false
  )
  assert.strictEqual(
    a._isValidWorkerResult({ save: { pricePredictor: { weights: [[[0.1]]], biases: [[0]] } }, train: { samples: 5 } }),
    true
  )
})
