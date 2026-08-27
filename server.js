const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const AuctionAnalyzer = require('./lib/analyzer');
const api = require('./lib/donutsmp');
const ai = require('./lib/ai');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { serveClient: true });
const PORT = Number(process.env.PORT || 3001);
const SCAN_INTERVAL = Math.max(60_000, Number(process.env.SCAN_INTERVAL_MS || 300_000));
const analyzer = new AuctionAnalyzer();
const state = { auctions: [], transactions: [], scanCount: 0, scanning: false, lastScan: null, lastSuccess: null, lastError: null, source: api.hasApiKey ? 'live' : 'demo' };

app.disable('x-powered-by');
app.use(express.json({ limit: '64kb' }));
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  next();
});
app.use(express.static(path.join(__dirname, 'public'), { maxAge: process.env.NODE_ENV === 'production' ? '1h' : 0 }));

const numberParam = (value, fallback, min, max) => Math.min(max, Math.max(min, Number(value) || fallback));
const asyncRoute = handler => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);

app.get('/api/health', (req, res) => res.json({ status: state.lastError && !state.lastSuccess ? 'degraded' : 'ok', ...publicStatus(), uptime: Math.round(process.uptime()) }));
app.get('/api/status', (req, res) => res.json(publicStatus()));

app.get('/api/overview', (req, res) => res.json({ ...analyzer.getIntelligence(state.auctions, state.transactions), status: publicStatus() }));
app.get('/api/flips', (req, res) => {
  let flips = analyzer.detectFlips(state.auctions, state.transactions);
  const minProfit = numberParam(req.query.minProfit, 0, 0, 1e15);
  const minRoi = numberParam(req.query.minRoi, 0, 0, 10000);
  if (req.query.type) flips = flips.filter(x => x.type === req.query.type);
  if (req.query.search) flips = flips.filter(x => x.name.toLowerCase().includes(String(req.query.search).toLowerCase()));
  flips = flips.filter(x => x.profit >= minProfit && x.roi >= minRoi);
  res.json({ flips, total: flips.length, generatedAt: new Date().toISOString() });
});

app.get('/api/market', (req, res) => {
  let rows = analyzer.buildMarket(state.auctions, state.transactions);
  const search = String(req.query.search || '').toLowerCase();
  if (search) rows = rows.filter(x => x.name.toLowerCase().includes(search));
  const allowed = ['salesValue', 'sales', 'listings', 'floor', 'change', 'name', 'confidence', 'volatility'];
  const sort = allowed.includes(req.query.sort) ? req.query.sort : 'salesValue';
  const direction = req.query.direction === 'asc' ? 1 : -1;
  rows.sort((a, b) => typeof a[sort] === 'string' ? a[sort].localeCompare(b[sort]) * direction : (a[sort] - b[sort]) * direction);
  const page = numberParam(req.query.page, 1, 1, 10000);
  const limit = numberParam(req.query.limit, 40, 10, 100);
  res.json({ items: rows.slice((page - 1) * limit, page * limit), total: rows.length, page, pages: Math.max(1, Math.ceil(rows.length / limit)) });
});

app.get('/api/market/:name', (req, res) => {
  const item = analyzer.buildMarket(state.auctions, state.transactions).find(x => x.name.toLowerCase() === req.params.name.toLowerCase());
  if (!item) return res.status(404).json({ error: 'Item not found' });
  const listings = state.auctions.filter(x => x.itemName === item.name).sort((a, b) => a.pricePerUnit - b.pricePerUnit).slice(0, 20);
  const sales = state.transactions.filter(x => x.itemName === item.name).slice(0, 30);
  res.json({ item, listings, sales, history: analyzer.getHistory(item.name, 100) });
});

app.get('/api/transactions', (req, res) => {
  let rows = state.transactions;
  const search = String(req.query.search || '').toLowerCase();
  if (search) rows = rows.filter(x => x.itemName.toLowerCase().includes(search));
  const page = numberParam(req.query.page, 1, 1, 10000);
  const limit = numberParam(req.query.limit, 40, 10, 100);
  res.json({ transactions: rows.slice((page - 1) * limit, page * limit), total: rows.length, page, pages: Math.max(1, Math.ceil(rows.length / limit)) });
});

app.get('/api/portfolio', (req, res) => res.json(analyzer.calculatePortfolio(numberParam(req.query.budget, 5_000_000, 1_000, 1e15), state.auctions, state.transactions, numberParam(req.query.risk, 55, 10, 95))));
app.get('/api/leaderboards/:type', asyncRoute(async (req, res) => res.json(await api.leaderboard(req.params.type, numberParam(req.query.page, 1, 1, 100)))));
app.get('/api/player/:name', asyncRoute(async (req, res) => {
  if (!/^[A-Za-z0-9_]{1,36}$/.test(req.params.name)) return res.status(400).json({ error: 'Invalid player name' });
  const [lookup, stats] = await Promise.allSettled([api.playerLookup(req.params.name), api.playerStats(req.params.name)]);
  res.json({ lookup: lookup.status === 'fulfilled' ? lookup.value : null, stats: stats.status === 'fulfilled' ? stats.value : null, source: state.source });
}));

// Neural Network endpoints
app.get('/api/neural/stats', (req, res) => {
  const intel = analyzer.getIntelligence(state.auctions, state.transactions);
  res.json(intel.neuralNet);
});

app.get('/api/neural/predictions', (req, res) => {
  const intel = analyzer.getIntelligence(state.auctions, state.transactions);
  res.json({ predictions: intel.predictions, anomalies: intel.anomalies, generatedAt: new Date().toISOString() });
});

app.get('/api/neural/history', (req, res) => {
  const predictor = analyzer.predictor;
  res.json({ lossHistory: predictor.pricePredictor.lossHistory.slice(-100), trendLossHistory: predictor.trendPredictor.lossHistory.slice(-100), epochs: predictor.pricePredictor.epochs });
});

app.post('/api/neural/train', asyncRoute(async (req, res) => {
  const result = analyzer.trainPredictor(state.auctions);
  res.json({ ok: true, ...result });
}));

app.post('/api/ai/analyze', asyncRoute(async (req, res) => {
  const intel = analyzer.getIntelligence(state.auctions, state.transactions);
  const nnStats = intel.neuralNet;
  const context = JSON.stringify({ 
    summary: intel.summary, 
    topFlips: intel.topFlips, 
    movers: intel.movers,
    anomalies: intel.anomalies,
    predictions: intel.predictions,
    neuralNet: nnStats
  }, null, 2);
  const result = await ai.analyze(context, String(req.body?.prompt || '').slice(0, 2000));
  res.json({ response: result.content, model: result.model, usage: result.usage, neuralNetStats: nnStats });
}));

app.post('/api/ai/ask', asyncRoute(async (req, res) => {
  const question = String(req.body?.question || '').trim().slice(0, 1000);
  if (!question) return res.status(400).json({ error: 'Question is required' });
  const intel = analyzer.getIntelligence(state.auctions, state.transactions);
  const nnContext = JSON.stringify({ 
    summary: intel.summary, 
    topFlips: intel.topFlips.slice(0, 5),
    neuralNet: intel.neuralNet,
    predictions: intel.predictions.slice(0, 5)
  });
  res.json({ response: await ai.quickInsight(question, nnContext) });
}));

app.use('/api', (req, res) => res.status(404).json({ error: 'Endpoint not found' }));
app.use((error, req, res, next) => {
  console.error(`[HTTP] ${req.method} ${req.path}:`, error.message);
  res.status(error.status >= 400 && error.status < 600 ? error.status : 500).json({ error: error.message || 'Internal server error' });
});

function publicStatus() {
  return { source: state.source, demo: state.source === 'demo', auctions: state.auctions.length, transactions: state.transactions.length, scanCount: state.scanCount, scanning: state.scanning, lastScan: state.lastScan, lastSuccess: state.lastSuccess, lastError: state.lastError };
}

async function runScan() {
  state.scanning = true;
  state.lastScan = new Date().toISOString();
  io.emit('scan:status', publicStatus());
  try {
    const [auctions, transactions] = await Promise.all([api.fetchAllAuctions(), api.fetchTransactions()]);
    if (!auctions.length) throw new Error('Upstream returned no auctions');
    state.auctions = auctions;
    state.transactions = transactions;
    state.scanCount += 1;
    state.lastSuccess = new Date().toISOString();
    state.lastError = null;
    analyzer.addSnapshot(auctions);
  } catch (error) {
    state.lastError = error.message;
    console.error('[Scanner]', error.message);
    throw error;
  } finally {
    state.scanning = false;
    io.emit('scan:update', publicStatus());
  }
}

let scanTimer;
async function start() {
  try { await runScan(); } catch (_) { /* health endpoint reports the failure */ }
  scanTimer = setInterval(() => runScan().catch(() => {}), SCAN_INTERVAL);
  server.listen(PORT, '0.0.0.0', () => console.log(`[Pulse] listening on http://0.0.0.0:${PORT} (${state.source} data)`));
}
function shutdown() { clearInterval(scanTimer); server.close(() => process.exit(0)); }
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

if (require.main === module) start();
module.exports = { app, server, analyzer, state, runScan, start };