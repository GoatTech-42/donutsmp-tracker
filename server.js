const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const AuctionAnalyzer = require('./lib/analyzer');
const { fetchAllAuctions, fetchTransactions, leaderboard, playerLookup, playerStats } = require('./lib/donutsmp');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3001;

const analyzer = new AuctionAnalyzer();
let lastAuctions = [];
let lastTransactions = [];
let scanCount = 0;
let lastScanTime = null;

app.use(express.static(path.join(__dirname, 'public')));

// Health
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', auctions: lastAuctions.length, snapshots: analyzer.snapshots.length, scanCount, lastScan: lastScanTime, uptime: process.uptime() });
});

// Flips
app.get('/api/flips', (req, res) => {
  const flips = analyzer.detectFlips(lastAuctions);
  const minProfit = parseInt(req.query.minProfit) || 0;
  const minROI = parseFloat(req.query.minROI) || 0;
  const type = req.query.type || '';
  const category = req.query.category || '';
  let filtered = flips;
  if (minProfit > 0) filtered = filtered.filter(f => f.profit >= minProfit);
  if (minROI > 0) filtered = filtered.filter(f => f.roi >= minROI);
  if (type) filtered = filtered.filter(f => f.type === type);
  if (category) filtered = filtered.filter(f => f.category === category);
  res.json({ flips: filtered, total: filtered.length });
});

// Market intelligence
app.get('/api/intelligence', (req, res) => {
  const intel = analyzer.getMarketIntelligence(lastAuctions);
  res.json(intel);
});

// Portfolio optimizer
app.get('/api/portfolio', (req, res) => {
  const investment = parseInt(req.query.budget) || 1000000;
  const portfolio = analyzer.calculatePortfolio(investment, lastAuctions);
  res.json(portfolio);
});

// Auctions
app.get('/api/auctions', (req, res) => {
  const search = req.query.search || '';
  const page = parseInt(req.query.page) || 1;
  const perPage = 50;
  let filtered = lastAuctions;
  if (search) {
    const q = search.toLowerCase();
    filtered = lastAuctions.filter(a => a.itemName.toLowerCase().includes(q));
  }
  const start = (page - 1) * perPage;
  const paged = filtered.slice(start, start + perPage);
  res.json({ auctions: paged, total: filtered.length, page, pages: Math.ceil(filtered.length / perPage) });
});

// Transactions
app.get('/api/transactions', (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const perPage = 50;
  const start = (page - 1) * perPage;
  const paged = lastTransactions.slice(start, start + perPage);
  res.json({ transactions: paged, total: lastTransactions.length, page, pages: Math.ceil(lastTransactions.length / perPage) });
});

// Leaderboards
app.get('/api/leaderboards/:type', async (req, res) => {
  try {
    const data = await leaderboard(req.params.type, parseInt(req.query.page) || 1);
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Player
app.get('/api/player/:name', async (req, res) => {
  try {
    const [lookup, stats] = await Promise.allSettled([
      playerLookup(req.params.name),
      playerStats(req.params.name)
    ]);
    res.json({ lookup: lookup.status === 'fulfilled' ? lookup.value : null, stats: stats.status === 'fulfilled' ? stats.value : null });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Tracked items
app.get('/api/items', (req, res) => {
  const items = analyzer.getTrackedItems();
  res.json({ items, count: items.length });
});

// Item price history
app.get('/api/item/:name/history', (req, res) => {
  const history = analyzer.getHistory(req.params.name, parseInt(req.query.limit) || 50);
  res.json({ item: req.params.name, history });
});

// Scan trigger
app.post('/api/scan', async (req, res) => {
  try {
    await runScan();
    res.json({ ok: true, auctions: lastAuctions.length, scanCount });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

async function runScan() {
  console.log(`[Scanner] Starting scan #${scanCount + 1}...`);
  const auctions = await fetchAllAuctions();
  if (auctions.length > 0) {
    lastAuctions = auctions;
    analyzer.addSnapshot(auctions);
    scanCount++;
    lastScanTime = new Date().toISOString();
    console.log(`[Scanner] Scan #${scanCount} complete: ${auctions.length} auctions`);
    io.emit('scan:update', { auctions: auctions.length, scanCount, lastScan: lastScanTime });
  }
}

// Auto-scan every 5 minutes
setInterval(runScan, 5 * 60 * 1000);

// Socket.IO
io.on('connection', (socket) => {
  console.log('[WS] Client connected');
  socket.emit('init', { auctions: lastAuctions.length, scanCount, lastScan: lastScanTime });
  socket.on('disconnect', () => console.log('[WS] Client disconnected'));
});

// Initial scan
runScan().then(() => {
  // Fetch transactions in background
  fetchTransactions(10).then(tx => { lastTransactions = tx; console.log(`[Scanner] Loaded ${tx.length} transactions`); });
});

server.listen(PORT, '0.0.0.0', () => console.log(`[Tracker] http://0.0.0.0:${PORT}`));
