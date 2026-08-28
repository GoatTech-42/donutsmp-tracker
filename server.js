const express = require('express')
const http = require('http')
const path = require('path')
const { Server } = require('socket.io')
const AuctionAnalyzer = require('./lib/analyzer')
const api = require('./lib/donutsmp')
const ai = require('./lib/ai')
const storage = require('./lib/storage')

const app = express()
const server = http.createServer(app)
const io = new Server(server, { serveClient: true })
const PORT = Number(process.env.PORT || 3001)
const SCAN_INTERVAL = Math.max(60_000, Number(process.env.SCAN_INTERVAL_MS || 300_000))
const analyzer = new AuctionAnalyzer()
const state = {
  auctions: [],
  transactions: [],
  scanCount: 0,
  scanning: false,
  lastScan: null,
  lastSuccess: null,
  lastError: null,
  source: 'live'
}

app.disable('x-powered-by')
app.use(express.json({ limit: '64kb' }))
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
  next()
})
app.use(
  express.static(path.join(__dirname, 'public'), {
    maxAge: process.env.NODE_ENV === 'production' ? 3600000 : 0
  })
)

const numberParam = (value, fallback, min, max) => {
  const n = Number(value)
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback
}
const asyncRoute = handler => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next)

app.get('/api/health', (req, res) =>
  res.json({
    status: state.lastError && !state.lastSuccess ? 'degraded' : 'ok',
    ...publicStatus(),
    uptime: Math.round(process.uptime())
  })
)
app.get('/api/status', (req, res) => res.json(publicStatus()))

app.get('/api/overview', (req, res) =>
  res.json({ ...analyzer.getIntelligence(state.auctions, state.transactions), status: publicStatus() })
)
app.get('/api/flips', (req, res) => {
  let flips = analyzer.detectFlips(state.auctions, state.transactions)
  const minProfit = numberParam(req.query.minProfit, 0, 0, 1e15)
  const minRoi = numberParam(req.query.minRoi, 0, 0, 10000)
  if (req.query.type) flips = flips.filter(x => x.type === String(req.query.type).slice(0, 20))
  if (req.query.search)
    flips = flips.filter(x =>
      x.name.toLowerCase().includes(String(req.query.search).slice(0, 100).toLowerCase())
    )
  flips = flips.filter(x => x.profit >= minProfit && x.roi >= minRoi)
  res.json({ flips, total: flips.length, generatedAt: new Date().toISOString() })
})

app.get('/api/market', (req, res) => {
  let rows = analyzer.buildMarket(state.auctions, state.transactions)
  const search = String(req.query.search || '').toLowerCase()
  if (search) rows = rows.filter(x => x.name.toLowerCase().includes(search))
  const allowed = ['salesValue', 'sales', 'listings', 'floor', 'change', 'name', 'confidence', 'volatility']
  const sort = allowed.includes(req.query.sort) ? req.query.sort : 'salesValue'
  const direction = req.query.direction === 'asc' ? 1 : -1
  rows.sort((a, b) =>
    typeof a[sort] === 'string' ? a[sort].localeCompare(b[sort]) * direction : (a[sort] - b[sort]) * direction
  )
  const page = numberParam(req.query.page, 1, 1, 10000)
  const limit = numberParam(req.query.limit, 40, 10, 100)
  res.json({
    items: rows.slice((page - 1) * limit, page * limit),
    total: rows.length,
    page,
    pages: Math.max(1, Math.ceil(rows.length / limit))
  })
})

app.get('/api/market/:name', (req, res) => {
  const item = analyzer
    .buildMarket(state.auctions, state.transactions)
    .find(x => x.name.toLowerCase() === req.params.name.toLowerCase())
  if (!item) return res.status(404).json({ error: 'Item not found' })
  const rawListings = state.auctions
    .filter(x => x.itemName === item.name)
    .sort((a, b) => a.pricePerUnit - b.pricePerUnit)
    .slice(0, 30)
  // Flag listings that sit outside the IQR keep-range so the UI can grey them out.
  const rawPrices = rawListings.map(x => x.pricePerUnit)
  let lo = -Infinity,
    hi = Infinity
  if (rawPrices.length >= 10) {
    const sorted = [...rawPrices].sort((a, b) => a - b)
    const pct = (arr, p) => {
      const i = (arr.length - 1) * p
      const lo2 = Math.floor(i)
      return arr[lo2] + (arr[Math.ceil(i)] - arr[lo2]) * (i - lo2)
    }
    const q1 = pct(sorted, 0.25),
      q3 = pct(sorted, 0.75),
      iqr = q3 - q1
    if (iqr > 0) {
      lo = q1 - 1.5 * iqr
      hi = q3 + 1.5 * iqr
    }
  }
  const listings = rawListings.map(x => ({ ...x, isOutlier: x.pricePerUnit < lo || x.pricePerUnit > hi }))
  const sales = state.transactions.filter(x => x.itemName === item.name).slice(0, 30)
  res.json({ item, listings, sales, history: analyzer.getHistory(item.name, 100) })
})

app.get('/api/transactions', (req, res) => {
  let rows = state.transactions
  const search = String(req.query.search || '').toLowerCase()
  if (search) rows = rows.filter(x => x.itemName.toLowerCase().includes(search))
  const page = numberParam(req.query.page, 1, 1, 10000)
  const limit = numberParam(req.query.limit, 40, 10, 100)
  res.json({
    transactions: rows.slice((page - 1) * limit, page * limit),
    total: rows.length,
    page,
    pages: Math.max(1, Math.ceil(rows.length / limit))
  })
})

app.get(
  '/api/leaderboards/:type',
  asyncRoute(async (req, res) =>
    res.json(await api.leaderboard(req.params.type, numberParam(req.query.page, 1, 1, 100)))
  )
)
app.get(
  '/api/player/:name',
  asyncRoute(async (req, res) => {
    if (!/^[A-Za-z0-9_]{1,36}$/.test(req.params.name))
      return res.status(400).json({ error: 'Invalid player name' })
    const [lookup, stats] = await Promise.allSettled([
      api.playerLookup(req.params.name),
      api.playerStats(req.params.name)
    ])
    res.json({
      lookup: lookup.status === 'fulfilled' ? lookup.value : null,
      stats: stats.status === 'fulfilled' ? stats.value : null,
      source: state.source
    })
  })
)

// Neural Network endpoints
app.get('/api/neural/stats', (req, res) => {
  const intel = analyzer.getIntelligence(state.auctions, state.transactions)
  res.json(intel.neuralNet)
})

app.get('/api/outliers', (req, res) => {
  const outliers = analyzer.predictor.detectStatisticalOutliers(analyzer.priceHistoryMap, state.auctions)
  res.json({ outliers, generatedAt: new Date().toISOString() })
})

app.get('/api/flip-history', (req, res) => {
  const limit = numberParam(req.query.limit, 100, 1, 500)
  const item = req.query.item ? String(req.query.item).slice(0, 100) : null
  const history = item ? storage.getFlipHistoryByItem(item, limit) : storage.getFlipHistory(limit)
  res.json({ history, total: history.length })
})

app.get('/api/export', (req, res) => {
  const format = req.query.format || 'json'
  const intel = analyzer.getIntelligence(state.auctions, state.transactions)
  if (format === 'csv') {
    const flips = intel.topFlips
    const csvEscape = v => {
      const s = String(v ?? '')
      return s.match(/^[=+\-\t\r\n]/)
        ? `"${s.replace(/"/g, '""')}"`
        : s.includes(',') || s.includes('"')
          ? `"${s.replace(/"/g, '""')}"`
          : s
    }
    const header = 'Type,Name,Buy,Sell,Profit,ROI%,Risk,Confidence,Volume\n'
    const rows = flips
      .map(f =>
        [f.type, f.name, f.buyPrice, f.afterTax, f.profit, f.roi, f.risk.label, f.confidence, f.volume]
          .map(csvEscape)
          .join(',')
      )
      .join('\n')
    res.setHeader('Content-Type', 'text/csv')
    res.setHeader('Content-Disposition', `attachment; filename="pulse-export-${Date.now()}.csv"`)
    return res.send(header + rows)
  }
  res.setHeader('Content-Type', 'application/json')
  res.setHeader('Content-Disposition', `attachment; filename="pulse-export-${Date.now()}.json"`)
  res.json({
    exportedAt: new Date().toISOString(),
    flips: intel.topFlips,
    predictions: intel.predictions,
    anomalies: intel.anomalies,
    outliers: intel.outliers,
    summary: intel.summary
  })
})

app.get('/api/enchant-stats/:item', (req, res) => {
  try {
    const stats = storage.getEnchantmentStats(req.params.item)
    const combos = storage.getEnchantmentCombos(req.params.item)
    res.json({ stats, combos })
  } catch (e) {
    res.json({ stats: [], combos: [] })
  }
})

app.get('/api/enchant-trends/:enchant', (req, res) => {
  try {
    const days = numberParam(req.query.days, 7, 1, 90)
    const trends = storage.getEnchantmentTrends(req.params.enchant, days)
    res.json({ trends })
  } catch (e) {
    res.json({ trends: [] })
  }
})

app.get('/api/neural/predictions', (req, res) => {
  const intel = analyzer.getIntelligence(state.auctions, state.transactions)
  res.json({
    predictions: intel.predictions,
    anomalies: intel.anomalies,
    generatedAt: new Date().toISOString()
  })
})

app.get('/api/neural/history', (req, res) => {
  const predictor = analyzer.predictor
  res.json({
    lossHistory: predictor.pricePredictor.lossHistory.slice(-100),
    trendLossHistory: predictor.trendPredictor.lossHistory.slice(-100),
    epochs: predictor.pricePredictor.epochs
  })
})

app.post(
  '/api/neural/train',
  asyncRoute(async (req, res) => {
    const result = analyzer.trainPredictor(state.auctions)
    res.json({ ok: true, ...result })
  })
)

// Server-side cache: Groq is rate-limited, and Overview auto-refreshes on every scan.
// Cache for 90s so concurrent tabs and scan bursts don't hammer the provider.
let aiCache = { at: 0, body: null }
const AI_TTL_MS = 90_000
app.post(
  '/api/ai/analyze',
  asyncRoute(async (req, res) => {
    const now = Date.now()
    if (aiCache.body && now - aiCache.at < AI_TTL_MS) {
      return res.json({ ...aiCache.body, cached: true, cachedAgeMs: now - aiCache.at })
    }
    if (!process.env.GROQ_API_KEY)
      return res.status(503).json({ error: 'AI not configured (missing GROQ_API_KEY)' })
    const intel = analyzer.getIntelligence(state.auctions, state.transactions)
    const t0 = Date.now()
    const result = await ai.analyze(intel)
    const body = {
      response: result.content,
      model: result.model,
      usage: result.usage,
      neuralNetStats: intel.neuralNet,
      latencyMs: Date.now() - t0,
      cached: false
    }
    aiCache = { at: now, body }
    res.json(body)
  })
)

app.post(
  '/api/ai/ask',
  asyncRoute(async (req, res) => {
    const question = String(req.body?.question || '')
      .trim()
      .slice(0, 1000)
    if (!question) return res.status(400).json({ error: 'Question is required' })
    const intel = analyzer.getIntelligence(state.auctions, state.transactions)
    const nnContext = JSON.stringify({
      summary: intel.summary,
      topFlips: intel.topFlips.slice(0, 5),
      neuralNet: intel.neuralNet,
      predictions: intel.predictions.slice(0, 5)
    })
    res.json({ response: await ai.quickInsight(question, nnContext) })
  })
)

app.post(
  '/api/refresh',
  asyncRoute(async (req, res) => {
    if (state.scanning)
      return res.json({ ok: true, message: 'Scan already in progress', status: publicStatus() })
    runScan().catch(() => {})
    res.json({ ok: true, message: 'Scan triggered', status: publicStatus() })
  })
)

app.use('/api', (req, res) => res.status(404).json({ error: 'Endpoint not found' }))
app.use((error, req, res, next) => {
  console.error(`[HTTP] ${req.method} ${req.path}:`, error.message)
  res
    .status(error.status >= 400 && error.status < 600 ? error.status : 500)
    .json({ error: error.message || 'Internal server error' })
})

function publicStatus() {
  return {
    source: state.source,
    demo: state.source === 'demo',
    auctions: state.auctions.length,
    transactions: state.transactions.length,
    scanCount: state.scanCount,
    scanning: state.scanning,
    lastScan: state.lastScan,
    lastSuccess: state.lastSuccess,
    lastError: state.lastError
  }
}

async function runScan() {
  state.scanning = true
  state.lastScan = new Date().toISOString()
  io.emit('scan:status', publicStatus())
  let auctions = []
  let transactions = []
  try {
    const onProgress = info => io.emit('scan:progress', { ...info, status: publicStatus() })
    // Publish partial auction state every ~20 pages so the dashboard never sits on
    // "0 auctions" for 8 minutes. Previous scan's data stays visible until replaced.
    const onAuctionPartial = rows => {
      if (rows.length < 500) return
      state.auctions = rows.slice()
      io.emit('scan:partial', publicStatus())
    }
    auctions = await api.fetchAllAuctions(9999, onProgress, onAuctionPartial)
    if (auctions.length >= 500) {
      // Let the analyzer start building priceHistory even before transactions arrive,
      // so the progressive trainPredictor thresholds can fire and we don't sit at 0 epochs
      // for the whole 10-minute first scan.
      try {
        analyzer.storePartialAuctions(auctions)
      } catch (_) {}
    }
    transactions = await api.fetchTransactions(9999, onProgress)
    if (!auctions.length) throw new Error('Upstream returned no auctions')
    state.auctions = auctions
    state.transactions = transactions
    state.scanCount += 1
    state.lastSuccess = new Date().toISOString()
    state.lastError = null
    analyzer.addSnapshot(auctions, transactions)

    // Track flips found in this scan
    const flips = analyzer.detectFlips(auctions, transactions)
    for (const flip of flips.slice(0, 50)) {
      try {
        storage.saveFlip(flip)
      } catch (e) {
        console.warn('[Storage] Flip save failed:', e.message)
      }
    }
  } catch (error) {
    state.lastError = error.message
    console.error('[Scanner]', error.message)
    throw error
  } finally {
    state.scanning = false
    io.emit('scan:update', publicStatus())
  }
}

let scanTimer
async function start() {
  server.listen(PORT, '0.0.0.0', () =>
    console.log(`[Pulse] listening on http://0.0.0.0:${PORT} (${state.source} data)`)
  )
  runScan().catch(err => console.error('[Scanner] Startup scan failed:', err.message))
  scanTimer = setInterval(
    () => runScan().catch(err => console.error('[Scanner] Scheduled scan failed:', err.message)),
    SCAN_INTERVAL
  )
}
function shutdown() {
  clearInterval(scanTimer)
  try {
    storage.close()
  } catch (_) {}
  server.close(() => process.exit(0))
}
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)

if (require.main === module) start()
module.exports = { app, server, analyzer, state, runScan, start }
