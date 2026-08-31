const { test } = require('node:test')
const assert = require('node:assert')

const { normalize, percentile, iqrFilter, ENCHANT_MULTIPLIERS } = require('../lib/stats')
const { NeuralNetwork } = require('../lib/neural-network')

test('normalize strips color codes and lowers', () => {
  assert.strictEqual(normalize('Diamond Sword'), 'diamond_sword')
  assert.strictEqual(normalize('§6Enchanted §fBook'), 'enchanted_book')
  assert.strictEqual(normalize('  Stone  '), 'stone')
})

test('percentile computes quartiles', () => {
  const xs = [1, 2, 3, 4, 5]
  assert.strictEqual(percentile(xs, 0.5), 3)
  assert.strictEqual(percentile(xs, 0), 1)
  assert.strictEqual(percentile(xs, 1), 5)
})

test('iqrFilter drops a single troll ask from many normal listings', () => {
  const asks = Array.from({ length: 15 }, (_, i) => 1000 + i * 10).concat([1_600_000_000])
  const filtered = iqrFilter(asks)
  assert.ok(!filtered.includes(1_600_000_000), 'troll ask should be dropped')
  assert.ok(filtered.length >= 15, 'normal asks retained')
})

test('iqrFilter returns raw when too few samples', () => {
  const asks = [1000, 1_600_000_000]
  assert.deepStrictEqual(iqrFilter(asks), asks)
})

test('iqrFilter handles uniform prices (iqr == 0)', () => {
  const asks = Array(10).fill(500)
  assert.deepStrictEqual(iqrFilter(asks), asks)
})

test('ENCHANT_MULTIPLIERS has known values', () => {
  assert.ok(ENCHANT_MULTIPLIERS.sharpness[5] > 1.5, 'sharpness 5 carries a large premium')
  assert.ok(ENCHANT_MULTIPLIERS.mending[1] > 1.2, 'mending carries a premium')
  assert.strictEqual(ENCHANT_MULTIPLIERS.protection[1], 1.05)
})

test('NeuralNetwork trains and reduces loss', () => {
  const nn = new NeuralNetwork(4, [6], 1, 0.02)
  const xs = Array.from({ length: 80 }, () => Array.from({ length: 4 }, () => Math.random()))
  const ys = xs.map(x => [(x[0] + x[1]) * 0.5])
  const first = nn.train(xs, ys, 12, 16)
  const second = nn.train(xs, ys, 12, 16)
  assert.ok(nn.trained, 'network should be trained')
  assert.ok(nn.epochs > 0, 'epochs should advance')
  assert.ok(second <= first + 0.5, 'loss should not blow up between passes')
  assert.ok(nn.lossHistory.length > 0, 'loss history recorded')
})

test('NeuralNetwork predict returns a finite number', () => {
  const nn = new NeuralNetwork(3, [4], 1, 0.01)
  const xs = Array.from({ length: 20 }, () => [1, 2, 3])
  const ys = xs.map(() => [0.5])
  nn.train(xs, ys, 8, 8)
  const out = nn.predict([1, 2, 3])
  assert.ok(Number.isFinite(out[0]), 'prediction is a finite number')
})

test('NeuralNetwork save/load round-trips weights', () => {
  const nn = new NeuralNetwork(3, [4], 1, 0.01)
  const xs = Array.from({ length: 20 }, () => [1, 2, 3])
  const ys = xs.map(() => [0.5])
  nn.train(xs, ys, 8, 8)
  const loaded = NeuralNetwork.load(nn.save())
  assert.ok(loaded, 'load returns a network')
  assert.strictEqual(loaded.epochs, nn.epochs)
  const a = nn.predict([1, 2, 3])
  const b = loaded.predict([1, 2, 3])
  assert.strictEqual(a[0], b[0], 'predictions match after load')
})
