function gauss() {
  let u = 0, v = 0
  while (u === 0) u = Math.random()
  while (v === 0) v = Math.random()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}

function softmaxInPlace(a) {
  const m = Math.max(...a)
  for (let i = 0; i < a.length; i++) a[i] = Math.exp(a[i] - m)
  const s = a.reduce((x, y) => x + y, 0) || 1
  for (let i = 0; i < a.length; i++) a[i] /= s
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}

class NeuralNetwork {
  constructor(inputSize, hiddenSizes, outputSize, learningRate = 0.008) {
    this.inputSize = inputSize
    this.hiddenSizes = hiddenSizes.slice()
    this.outputSize = outputSize
    this.learningRate = learningRate
    this.dropoutRate = 0.06
    this.trained = false
    this.epochs = 0
    this.lossHistory = []
    this.inMean = new Array(inputSize).fill(0)
    this.inVar = new Array(inputSize).fill(1)
    this.t = 0
    this._init()
  }

  _init() {
    const sizes = [this.inputSize, ...this.hiddenSizes, this.outputSize]
    this.weights = []
    this.biases = []
    this.mW = []
    this.vW = []
    this.mB = []
    this.vB = []
    for (let l = 0; l < sizes.length - 1; l++) {
      const rows = sizes[l + 1]
      const cols = sizes[l]
      const std = Math.sqrt(2 / cols)
      this.weights.push(
        Array.from({ length: rows }, () => Array.from({ length: cols }, () => gauss() * std))
      )
      this.biases.push(new Array(rows).fill(0))
      this.mW.push(Array.from({ length: rows }, () => new Array(cols).fill(0)))
      this.vW.push(Array.from({ length: rows }, () => new Array(cols).fill(0)))
      this.mB.push(new Array(rows).fill(0))
      this.vB.push(new Array(rows).fill(0))
    }
  }

  _normInput(x) {
    const out = new Array(x.length)
    for (let i = 0; i < x.length; i++) {
      const v = (x[i] - this.inMean[i]) / Math.sqrt(this.inVar[i] + 1e-5)
      out[i] = Number.isFinite(v) ? Math.max(-5, Math.min(5, v)) : 0
    }
    return out
  }

  _updateInputStats(batch) {
    const n = batch.length
    if (!n) return
    const d = batch[0].length
    const mu = new Array(d).fill(0)
    for (const x of batch) for (let i = 0; i < d; i++) mu[i] += x[i]
    for (let i = 0; i < d; i++) mu[i] /= n
    const va = new Array(d).fill(0)
    for (const x of batch) for (let i = 0; i < d; i++) va[i] += (x[i] - mu[i]) ** 2
    for (let i = 0; i < d; i++) va[i] = va[i] / n + 1e-6
    const a = 0.12
    for (let i = 0; i < d; i++) {
      this.inMean[i] = (1 - a) * this.inMean[i] + a * mu[i]
      this.inVar[i] = (1 - a) * this.inVar[i] + a * va[i]
    }
  }

  _forward(x, training) {
    const acts = [x]
    const zs = []
    const masks = []
    let cur = x
    for (let l = 0; l < this.weights.length; l++) {
      const W = this.weights[l]
      const b = this.biases[l]
      const z = new Array(W.length)
      for (let j = 0; j < W.length; j++) {
        let s = b[j]
        const row = W[j]
        for (let k = 0; k < row.length; k++) s += row[k] * cur[k]
        z[j] = s
      }
      zs.push(z.slice())
      let h
      if (l < this.weights.length - 1) {
        h = z.map(v => (v > 0 ? v : 0))
        if (training && this.dropoutRate > 0) {
          const scale = 1 / (1 - this.dropoutRate)
          const m = new Array(h.length)
          for (let j = 0; j < h.length; j++) {
            m[j] = Math.random() > this.dropoutRate ? scale : 0
            h[j] *= m[j]
          }
          masks.push(m)
        } else masks.push(null)
      } else {
        h = z.slice()
        if (this.outputSize > 1) softmaxInPlace(h)
        masks.push(null)
      }
      acts.push(h)
      cur = h
    }
    return { acts, zs, masks, out: acts[acts.length - 1].slice() }
  }

  _loss(out, target) {
    if (this.outputSize > 1) {
      let s = 0
      for (let i = 0; i < out.length; i++) s += -target[i] * Math.log(Math.max(1e-9, out[i]))
      return s
    }
    let s = 0
    for (let i = 0; i < out.length; i++) s += (out[i] - target[i]) ** 2
    return s / out.length
  }

  train(inputs, targets, epochs = 40, batchSize = 64) {
    if (!inputs.length) return 0
    this._updateInputStats(inputs)
    const X = inputs.map(x => this._normInput(x))
    const n = X.length
    const order = Array.from({ length: n }, (_, i) => i)
    let lastLoss = 0
    const clip = 1.5
    for (let ep = 0; ep < epochs; ep++) {
      shuffle(order)
      let epochLoss = 0
      let batches = 0
      for (let s = 0; s < n; s += batchSize) {
        const idxs = order.slice(s, s + batchSize)
        const gW = this.weights.map(W => W.map(row => new Array(row.length).fill(0)))
        const gB = this.biases.map(b => new Array(b.length).fill(0))
        let batchLoss = 0
        for (const idx of idxs) {
          const { acts, zs, masks, out } = this._forward(X[idx], true)
          batchLoss += this._loss(out, targets[idx])
          let delta
          if (this.outputSize > 1) delta = out.map((v, i) => v - targets[idx][i])
          else delta = [out[0] - targets[idx][0]]
          for (let l = this.weights.length - 1; l >= 0; l--) {
            const prev = acts[l]
            const gWl = gW[l]
            const gBl = gB[l]
            for (let j = 0; j < delta.length; j++) {
              const d = Math.max(-clip, Math.min(clip, delta[j]))
              gBl[j] += d
              const grow = gWl[j]
              for (let k = 0; k < prev.length; k++) grow[k] += d * prev[k]
            }
            if (l > 0) {
              const W = this.weights[l]
              const next = new Array(prev.length).fill(0)
              for (let j = 0; j < W.length; j++) {
                const d = delta[j]
                if (d === 0) continue
                const row = W[j]
                for (let k = 0; k < row.length; k++) next[k] += d * row[k]
              }
              const mask = masks[l - 1]
              const zPrev = zs[l - 1]
              for (let k = 0; k < next.length; k++) {
                if (zPrev[k] <= 0) next[k] = 0
                if (mask) next[k] *= mask[k]
              }
              delta = next
            }
          }
        }
        // Reliability: never apply a poisoned gradient batch (NaN/Inf in the
        // data would otherwise corrupt every weight and stall the model forever).
        if (Number.isFinite(batchLoss)) {
          this._adamStep(gW, gB, idxs.length)
          epochLoss += batchLoss / idxs.length
          batches++
        }
      }
      lastLoss = epochLoss / (batches || 1)
      if (!Number.isFinite(lastLoss)) break
      this.lossHistory.push(lastLoss)
      if (this.lossHistory.length > 220) this.lossHistory.shift()
      this.epochs++
    }
    this.trained = true
    return lastLoss
  }

  _adamStep(gW, gB, batchSize) {
    this.t++
    const b1 = 0.9, b2 = 0.999, eps = 1e-8
    const bc1 = 1 - Math.pow(b1, this.t)
    const bc2 = 1 - Math.pow(b2, this.t)
    for (let l = 0; l < this.weights.length; l++) {
      const W = this.weights[l], mW = this.mW[l], vW = this.vW[l]
      const gWl = gW[l], mB = this.mB[l], vB = this.vB[l], gBl = gB[l], b = this.biases[l]
      for (let j = 0; j < W.length; j++) {
        const row = W[j], mrow = mW[j], vrow = vW[j], grow = gWl[j]
        for (let k = 0; k < row.length; k++) {
          const g = grow[k] / batchSize
          mrow[k] = b1 * mrow[k] + (1 - b1) * g
          vrow[k] = b2 * vrow[k] + (1 - b2) * g * g
          row[k] -= this.learningRate * (mrow[k] / bc1) / (Math.sqrt(vrow[k] / bc2) + eps)
        }
        const gb = gBl[j] / batchSize
        mB[j] = b1 * mB[j] + (1 - b1) * gb
        vB[j] = b2 * vB[j] + (1 - b2) * gb * gb
        b[j] -= this.learningRate * (mB[j] / bc1) / (Math.sqrt(vB[j] / bc2) + eps)
      }
    }
  }

  predict(input) {
    const x = this._normInput(input)
    const { out } = this._forward(x, false)
    return out.slice()
  }

  save() {
    return {
      version: 2,
      inputSize: this.inputSize,
      hiddenSizes: this.hiddenSizes,
      outputSize: this.outputSize,
      learningRate: this.learningRate,
      weights: this.weights,
      biases: this.biases,
      inMean: this.inMean,
      inVar: this.inVar,
      epochs: this.epochs,
      lossHistory: this.lossHistory,
      trained: this.trained,
      dropoutRate: this.dropoutRate
    }
  }

  static load(data) {
    if (!data || data.version !== 2) return null
    const nn = new NeuralNetwork(data.inputSize, data.hiddenSizes, data.outputSize, data.learningRate)
    nn.weights = data.weights
    nn.biases = data.biases
    nn.inMean = data.inMean || new Array(data.inputSize).fill(0)
    nn.inVar = data.inVar || new Array(data.inputSize).fill(1)
    nn.epochs = data.epochs || 0
    nn.lossHistory = data.lossHistory || []
    nn.trained = !!data.trained
    nn.dropoutRate = data.dropoutRate ?? 0.06
    // re-init Adam state fresh
    const sizes = [nn.inputSize, ...nn.hiddenSizes, nn.outputSize]
    nn.mW = []; nn.vW = []; nn.mB = []; nn.vB = []
    for (let l = 0; l < sizes.length - 1; l++) {
      const rows = sizes[l + 1], cols = sizes[l]
      nn.mW.push(Array.from({ length: rows }, () => new Array(cols).fill(0)))
      nn.vW.push(Array.from({ length: rows }, () => new Array(cols).fill(0)))
      nn.mB.push(new Array(rows).fill(0))
      nn.vB.push(new Array(rows).fill(0))
    }
    nn.t = 0
    return nn
  }
}

function toEntries(h) {
  if (!h) return []
  if (h instanceof Map) return [...h.entries()]
  return Object.entries(h)
}

function groupByName(rows) {
  const m = new Map()
  for (const r of rows || []) {
    const k = r.itemName || r.item?.display_name || r.itemId || r.item?.id
    if (!k || k === 'undefined') continue
    if (!m.has(k)) m.set(k, [])
    m.get(k).push(r)
  }
  return m
}

class MarketPredictor {
  constructor() {
    this.pricePredictor = new NeuralNetwork(32, [48, 24], 1, 0.004)
    this.trendPredictor = new NeuralNetwork(32, [32, 16], 3, 0.004)
    this.anomalyDetector = new NeuralNetwork(24, [22, 12], 1, 0.004) // legacy, no longer trained (was tautological)
    this.trainingData = []
    this.maxTrainingSamples = 1500
    this.lastTrainingTime = 0
    this.trainingInterval = 60 * 1000
    this.featureNames = this.getFeatureNames()
    this.experienceReplay = []
    this.maxExperienceBuffer = 500
    this.lastEval = null
    this.calibration = null
    this.horizon = Math.max(6, Number(process.env.PREDICT_HORIZON_SNAPSHOTS || 24))
    this.trendThreshold = Number(process.env.TREND_THRESHOLD || 0.02)
    this.minHistory = 60
  }

  getFeatureNames() {
    return [
      'price','avg5','avg10','avg20','avg50','min20','max20','volatility','momentum1','momentum5',
      'listings','avgListingPrice','spread','avg5_avg10_diff','avg10_avg20_diff','price_avg5_diff',
      'historyDepth','salesVelocity','volumeNorm','volatilityNorm','pricePosition','rsi14','macdSignal',
      'bbPosition','timeOfDay','dayOfWeek','listingsChange','salesChange','priceAcceleration',
      'volumeAcceleration','liquidityScore','riskScore'
    ]
  }

  normPrice(p) { return Math.log10(Math.max(1, p)) / 9 }

  extractFeatures(itemName, priceHistory, timestamp) {
    const rawLen = priceHistory.length
    const prices = priceHistory.slice(-50).map(h => h.median || h.floor || h.price || 0).filter(p => p > 0)
    if (!prices.length) prices.push(0)
    while (prices.length < 50) prices.unshift(prices[0])
    const logPrices = prices.map(p => this.normPrice(p))
    const currentPrice = prices[prices.length - 1] || 0
    const logCurrent = this.normPrice(currentPrice)
    const avg = a => a.reduce((x, y) => x + y, 0) / a.length
    const avg5 = avg(prices.slice(-5)), avg10 = avg(prices.slice(-10))
    const avg20 = avg(prices.slice(-20)), avg50 = avg(prices)
    const min20 = Math.min(...prices.slice(-20)), max20 = Math.max(...prices.slice(-20))
    const logAvg5 = this.normPrice(avg5), logAvg10 = this.normPrice(avg10)
    const logAvg20 = this.normPrice(avg20), logAvg50 = this.normPrice(avg50)
    const volatility = this.calcVolatility(prices.slice(-20))
    const momentum1 = prices.length >= 2 ? (prices[prices.length - 1] - prices[prices.length - 2]) / (prices[prices.length - 2] || 1) : 0
    const momentum5 = prices.length >= 6 ? (prices[prices.length - 1] - prices[prices.length - 6]) / (prices[prices.length - 6] || 1) : 0
    const last = priceHistory[priceHistory.length - 1] || {}
    const listings = last.listings || 0
    const sales = last.sales || 0
    const volRaw = last.volume || 0
    const avgListingPrice = last.avg || last.median || currentPrice
    const spread = avgListingPrice > 0 ? (avgListingPrice - currentPrice) / (currentPrice || 1) : 0
    const historyDepth = Math.min(rawLen / this.minHistory, 1)
    const salesVelocity = Math.min(sales / 10, 1)
    const volumes = priceHistory.slice(-10).map(h => h.volume || 0).filter(v => v > 0)
    const volumeNorm = volumes.length ? Math.min(avg(volumes) / 100, 1) : 0
    const volatilityNorm = Math.min(volatility / 50, 1)
    const pricePosition = max20 > min20 ? (currentPrice - min20) / (max20 - min20) : 0.5
    const rsi14 = this.calcRSI(prices.slice(-14))
    const macdSignal = Math.max(-1, Math.min(1, this.calcMACD(prices)))
    const bbPosition = this.calcBBPosition(prices.slice(-20), currentPrice)
    const d = timestamp ? new Date(timestamp) : new Date()
    const timeOfDay = d.getHours() / 24, dayOfWeek = d.getDay() / 7
    const listingsChange = priceHistory.length >= 2 ? (listings - (priceHistory[priceHistory.length - 2].listings || 0)) / 10 : 0
    const salesChange = priceHistory.length >= 2 ? (sales - (priceHistory[priceHistory.length - 2].sales || 0)) / 10 : 0
    const priceAcceleration = prices.length >= 3 ? (prices[prices.length - 1] - 2 * prices[prices.length - 2] + prices[prices.length - 3]) / (prices[prices.length - 3] || 1) : 0
    const volumeAcceleration = volumes.length >= 3 ? (volumes[volumes.length - 1] - 2 * volumes[volumes.length - 2] + volumes[volumes.length - 3]) / (volumes[volumes.length - 3] || 1) : 0
    const liquidityScore = Math.min(listings * 0.1 + salesVelocity * 0.5, 1)
    const riskScore = Math.min(volatilityNorm * 0.5 + (1 - liquidityScore) * 0.5, 1)
    const c = v => Math.max(-5, Math.min(5, v))
    return [
      logCurrent, logAvg5, logAvg10, logAvg20, logAvg50,
      this.normPrice(min20), this.normPrice(max20),
      c(volatility), c(momentum1), c(momentum5),
      Math.min(listings / 50, 1), this.normPrice(avgListingPrice), c(spread),
      c(logAvg5 - logAvg10), c(logAvg10 - logAvg20), c(logCurrent - logAvg5),
      historyDepth, c(salesVelocity), volumeNorm, volatilityNorm,
      Math.max(0, Math.min(1, pricePosition)), rsi14, macdSignal, Math.max(0, Math.min(1, bbPosition)),
      timeOfDay, dayOfWeek, c(listingsChange), c(salesChange), c(priceAcceleration), c(volumeAcceleration),
      liquidityScore, riskScore
    ]
  }

  calcVolatility(prices) {
    if (prices.length < 2) return 0
    const mean = prices.reduce((a, b) => a + b, 0) / prices.length
    const v = prices.reduce((s, p) => s + (p - mean) ** 2, 0) / prices.length
    return Math.sqrt(v) / (mean || 1)
  }

  calcRSI(prices) {
    if (prices.length < 2) return 0.5
    let gains = 0, losses = 0
    for (let i = 1; i < prices.length; i++) {
      const d = prices[i] - prices[i - 1]
      if (d > 0) gains += d; else losses -= d
    }
    const avgGain = gains / (prices.length - 1), avgLoss = losses / (prices.length - 1)
    if (avgLoss === 0) return 1
    const rs = avgGain / avgLoss
    return (100 - 100 / (1 + rs)) / 100
  }

  calcMACD(prices) {
    if (prices.length < 26) return 0
    const ema12 = this.ema(prices, 12), ema26 = this.ema(prices, 26)
    return (ema12 - ema26) / (ema26 || 1)
  }

  ema(prices, period) {
    const k = 2 / (period + 1); let e = prices[0]
    for (let i = 1; i < prices.length; i++) e = prices[i] * k + e * (1 - k)
    return e
  }

  calcBBPosition(prices, currentPrice) {
    if (prices.length < 20) return 0.5
    const mean = prices.reduce((a, b) => a + b, 0) / prices.length
    const std = Math.sqrt(prices.reduce((s, p) => s + (p - mean) ** 2, 0) / prices.length)
    const upper = mean + 2 * std, lower = mean - 2 * std
    return upper > lower ? (currentPrice - lower) / (upper - lower) : 0.5
  }

  prepareTrainingData(priceHistories, auctions) {
    const pairs = []
    for (const [itemName, history] of toEntries(priceHistories)) {
      if (history.length < this.horizon + 6) continue
      const start = Math.max(2, Math.min(8, Math.floor(history.length / 2)))
      for (let i = start; i < history.length - this.horizon; i++) {
        const past = history.slice(0, i + 1)
        const cur = history[i]
        const nxt = history[i + this.horizon]
        const curPrice = cur.median || cur.floor || cur.price || 0
        const nxtPrice = nxt.median || nxt.floor || nxt.price || 0
        if (!curPrice || !nxtPrice) continue
        const timestamp = cur.timestamp || Date.now()
        const features = this.extractFeatures(itemName, past, timestamp)
        const change = (nxtPrice - curPrice) / curPrice
        const trend = change > this.trendThreshold ? [1, 0, 0] : change < -this.trendThreshold ? [0, 0, 1] : [0, 1, 0]
        const targetPrice = Math.log10(nxtPrice + 1) / 9
        pairs.push({ features, targetPrice, change, trend, itemName, timestamp })
      }
    }
    return pairs
  }

  train(priceHistories, auctions) {
    const pairs = this.prepareTrainingData(priceHistories, auctions)
    if (pairs.length < 5) return { loss: 0, samples: pairs.length }
    pairs.sort((a, b) => a.timestamp - b.timestamp)
    const holdCount = Math.max(5, Math.floor(pairs.length * 0.15))
    const trainPairs = pairs.slice(0, pairs.length - holdCount)
    const holdPairs = pairs.slice(pairs.length - holdCount)
    if (trainPairs.length < 5) return { loss: 0, samples: pairs.length }
    const useHold = holdPairs.length >= 5
    const recent = trainPairs.slice(-this.maxTrainingSamples)
    const useReplay = recent.length > 20 && this.experienceReplay.length > 0
    const replaySample = useReplay ? this.experienceReplay.slice(-Math.min(100, Math.floor(recent.length * 0.3))) : []
    const mixed = useReplay ? [...recent, ...replaySample] : recent
    this.experienceReplay.push(...recent.slice(-50))
    if (this.experienceReplay.length > this.maxExperienceBuffer) this.experienceReplay = this.experienceReplay.slice(-this.maxExperienceBuffer)
    // Accuracy: auction windows are overwhelmingly FLAT, which collapses the
    // trend net to always-FLAT (great dirAccuracy, useless calls). Oversample
    // UP/DOWN pairs so minority classes keep gradient signal.
    const byClass = { up: [], flat: [], down: [] }
    for (const p of mixed) {
      if (p.trend[0]) byClass.up.push(p)
      else if (p.trend[2]) byClass.down.push(p)
      else byClass.flat.push(p)
    }
    const before = { UP: byClass.up.length, FLAT: byClass.flat.length, DOWN: byClass.down.length }
    const target = Math.max(1, Math.floor(Math.max(before.UP, before.FLAT, before.DOWN) * 0.6))
    const oversampled = [...mixed]
    for (const cls of [byClass.up, byClass.down]) {
      if (!cls.length) continue
      let copies = Math.min(target - cls.length, cls.length * 3)
      for (let i = 0; copies > 0; i++, copies--) oversampled.push(cls[i % cls.length])
    }
    const trendClassBalance = { before, after: {
      UP: before.UP, FLAT: before.FLAT, DOWN: before.DOWN,
      oversampledTotal: oversampled.length
    } }
    const priceInputs = oversampled.map(p => p.features)
    const priceTargets = oversampled.map(p => [p.targetPrice])
    const trendTargets = oversampled.map(p => p.trend)
    const epPrice = recent.length > 80 ? 18 : 28
    const epTrend = recent.length > 80 ? 12 : 18
    const priceLoss = this.pricePredictor.train(priceInputs, priceTargets, epPrice, 64)
    const trendLoss = this.trendPredictor.train(priceInputs, trendTargets, epTrend, 64)
    this.trainingData.push(...recent.slice(-200))
    this.lastTrainingTime = Date.now()
    let mae = 0, dirOk = 0, holdN = 0
    const buckets = { UP: { n: 0, ok: 0 }, FLAT: { n: 0, ok: 0 }, DOWN: { n: 0, ok: 0 } }
    const evalSet = useHold ? holdPairs : mixed.slice(-Math.max(5, Math.floor(mixed.length * 0.1)))
    for (const p of evalSet) {
      const pred = this.pricePredictor.predict(p.features)[0]
      mae += Math.abs(pred - p.targetPrice)
      const tLab = p.trend[0] ? 'UP' : p.trend[2] ? 'DOWN' : 'FLAT'
      const predRaw = this.trendPredictor.predict(p.features)
      const predLab = ['UP','FLAT','DOWN'][predRaw.indexOf(Math.max(...predRaw))]
      const b = buckets[predLab]
      b.n++
      if (predLab === tLab) { b.ok++; dirOk++ }
      holdN++
    }
    const pct = b => b.n ? Math.round(b.ok / b.n * 100) : 0
    this.lastEval = holdN ? { mae: +(mae/holdN).toFixed(4), dirAccuracy: Math.round(dirOk/holdN*100), calibration: { UP: pct(buckets.UP), FLAT: pct(buckets.FLAT), DOWN: pct(buckets.DOWN) }, samples: holdN, heldOut: useHold } : null
    this.calibration = this.lastEval ? this.lastEval.calibration : this.calibration
    return { priceLoss: priceLoss.toFixed(6), trendLoss: trendLoss.toFixed(6), samples: mixed.length, replaySamples: replaySample.length, epochs: this.pricePredictor.epochs, eval: this.lastEval, trendClassBalance }
  }

  shouldTrain() { return Date.now() - this.lastTrainingTime > this.trainingInterval }

  predict(itemName, priceHistory, allAuctions = []) {
    if (!this.pricePredictor.trained) return null
    const ts = priceHistory[priceHistory.length - 1]?.timestamp || Date.now()
    const features = this.extractFeatures(itemName, priceHistory, ts)
    const raw = this.pricePredictor.predict(features)[0]
    const predictedPrice = Math.round(Math.pow(10, Math.max(-0.5, Math.min(1.4, raw)) * 9) - 1)
    const trend = this.trendPredictor.predict(features)
    const labels = ['UP', 'FLAT', 'DOWN']
    const predictedTrend = labels[trend.indexOf(Math.max(...trend))]
    const cal = this.calibration && this.calibration[predictedTrend] != null ? this.calibration[predictedTrend] : (this.lastEval ? this.lastEval.dirAccuracy : 50)
    // Honesty: with a shallow history the model is guessing - cap reported confidence.
    const shallow = (priceHistory.length || 0) < 10
    const confidence = shallow ? Math.min(Math.round(cal), 30) : Math.round(cal)
    const currentPrice = priceHistory[priceHistory.length - 1]?.median || priceHistory[priceHistory.length - 1]?.floor || priceHistory[priceHistory.length - 1]?.price || 0
    const expectedChange = predictedPrice - currentPrice
    const expectedChangePct = currentPrice > 0 ? (expectedChange / currentPrice) * 100 : 0
    const horizonLabel = this.horizon * 5 >= 60 ? `${Math.round(this.horizon * 5 / 60)}h` : `${this.horizon * 5}m`
    return { currentPrice, predictedPrice: Math.max(1, predictedPrice), expectedChange: Math.round(expectedChange), expectedChangePct: Math.round(expectedChangePct * 100) / 100, trend: predictedTrend, confidence, lowData: shallow || undefined, timeHorizon: horizonLabel }
  }

  detectAnomalies(priceHistories, auctions) {
    // Honest: delegate to statistical z-score/IQR (detectStatisticalOutliers is the
    // non-tautological implementation). Maps its fields to the legacy anomaly shape
    // so callers (getIntelligence) keep working. o.sales here IS the current
    // listings count (detectStatisticalOutliers stores curAuctions.length as sales).
    const out = this.detectStatisticalOutliers(priceHistories, auctions)
    return out.slice(0, 20).map(o => ({
      item: o.name,
      anomalyScore: Math.round(Math.min(100, Math.abs(o.zScore) * 25)),
      currentPrice: o.price,
      avgPrice: o.avg,
      deviation: o.deviation,
      type: o.direction === 'overpriced' ? 'price_spike' : 'price_drop',
      listings: o.sales
    }))
  }

  detectStatisticalOutliers(priceHistories, auctions) {
    const byName = auctions ? groupByName(auctions) : new Map()
    const outliers = []
    for (const [itemName, history] of toEntries(priceHistories)) {
      if (history.length < 10) continue
      if (!byName.size || (!byName.has(itemName) && !(auctions||[]).some(a => (a.itemName||a.item?.display_name) === itemName))) continue
      const prices = history.slice(-20).map(h => h.median || h.floor || h.price).filter(p => p > 0)
      if (prices.length < 5) continue
      const currentPrice = history[history.length - 1].median || history[history.length - 1].floor || history[history.length - 1].price
      const mean = prices.reduce((a, b) => a + b, 0) / prices.length
      const std = Math.sqrt(prices.reduce((s, p) => s + (p - mean) ** 2, 0) / prices.length) || 1
      const zScore = (currentPrice - mean) / std
      const sorted = [...prices].sort((a, b) => a - b)
      const q1 = sorted[Math.floor(sorted.length * 0.25)], q3 = sorted[Math.floor(sorted.length * 0.75)]
      const iqr = q3 - q1, iqrLower = q1 - 1.5 * iqr, iqrUpper = q3 + 1.5 * iqr
      const iqrOutlier = currentPrice < iqrLower || currentPrice > iqrUpper
      if (Math.abs(zScore) > 2 || iqrOutlier) {
        const avgPrice = history.slice(-10).reduce((s, h) => s + (h.median || h.floor || h.price || 0), 0) / 10
        const curAuctions = byName.get(itemName) || []
        outliers.push({ name: itemName, price: currentPrice, avg: Math.round(mean), zScore: Math.round(zScore * 100) / 100, iqrOutlier, iqrLower: Math.round(iqrLower), iqrUpper: Math.round(iqrUpper), sales: curAuctions.length, salesValue: curAuctions.reduce((s, a) => s + (a.price || 0), 0), deviation: Math.round(((currentPrice - avgPrice) / (avgPrice || 1)) * 100 * 100) / 100, direction: currentPrice > mean ? 'overpriced' : 'underpriced' })
      }
    }
    return outliers.sort((a, b) => Math.abs(b.zScore) - Math.abs(a.zScore))
  }

  getModelStats() {
    return {
      pricePredictor: { trained: this.pricePredictor.trained, epochs: this.pricePredictor.epochs, lastLoss: this.pricePredictor.lossHistory[this.pricePredictor.lossHistory.length - 1] || 0 },
      trendPredictor: { trained: this.trendPredictor.trained, epochs: this.trendPredictor.epochs, lastLoss: this.trendPredictor.lossHistory[this.trendPredictor.lossHistory.length - 1] || 0 },
      anomalyDetector: { trained: this.anomalyDetector.trained, epochs: this.anomalyDetector.epochs },
      trainingSamples: this.trainingData.length,
      lastTraining: this.lastTrainingTime,
      lastEval: this.lastEval || null,
      calibration: this.calibration || null,
      horizon: this.horizon,
      trendThreshold: this.trendThreshold,
    }
  }

  save() {
    return {
      version: 2,
      pricePredictor: this.pricePredictor.save(),
      trendPredictor: this.trendPredictor.save(),
      anomalyDetector: this.anomalyDetector.save(),
      trainingData: this.trainingData.slice(-500),
      experienceReplay: this.experienceReplay.slice(-this.maxExperienceBuffer),
      lastTrainingTime: this.lastTrainingTime,
      lastEval: this.lastEval,
      calibration: this.calibration,
    }
  }

  load(data) {
    if (!data || data.version !== 2) return
    const pp = NeuralNetwork.load(data.pricePredictor), tp = NeuralNetwork.load(data.trendPredictor), ad = NeuralNetwork.load(data.anomalyDetector)
    if (pp) this.pricePredictor = pp
    if (tp) this.trendPredictor = tp
    if (ad) this.anomalyDetector = ad
    this.trainingData = data.trainingData || []
    this.experienceReplay = data.experienceReplay || []
    this.lastTrainingTime = data.lastTrainingTime || 0
    this.lastEval = data.lastEval || null
    this.calibration = data.calibration || null
    this.horizon = data.horizon || this.horizon
    this.trendThreshold = data.trendThreshold || this.trendThreshold
  }
}

module.exports = { NeuralNetwork, MarketPredictor }
