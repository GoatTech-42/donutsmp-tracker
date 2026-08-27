const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const donutsmp = require('./lib/donutsmp');
const AuctionAnalyzer = require('./lib/analyzer');
const ai = require('./lib/ai');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

const analyzer = new AuctionAnalyzer();
let lastAuctions = [];
let lastTransactions = [];
let lastLeaderboards = {};
let aiAnalysis = null;
let aiTimestamp = null;
let scanInterval = null;
let playerCache = {};

// --- API Routes ---

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', snapshots: analyzer.snapshots.length, uptime: Math.floor(process.uptime()) });
});

app.get('/api/auction/list', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const search = req.query.search || '';
    const sort = req.query.sort || '';
    const data = await donutsmp.auctionList(page, search, sort);
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/auction/transactions', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const data = await donutsmp.auctionTransactions(page);
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/player/lookup/:user', async (req, res) => {
  try {
    const data = await donutsmp.playerLookup(req.params.user);
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/player/stats/:user', async (req, res) => {
  try {
    const data = await donutsmp.playerStats(req.params.user);
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/leaderboard/:type', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const data = await donutsmp.leaderboard(req.params.type, page);
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/leaderboards', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const data = await donutsmp.allLeaderboards(page);
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/shield/config/:service', async (req, res) => {
  try {
    const platform = req.query.platform || 'java';
    const data = await donutsmp.shieldConfig(req.params.service, platform);
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/shield/metrics/:service', async (req, res) => {
  try {
    const data = await donutsmp.shieldMetrics(req.params.service);
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/shield/stats/:service', async (req, res) => {
  try {
    const data = await donutsmp.shieldStats(req.params.service);
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/market/overview', (req, res) => {
  res.json(analyzer.getMarketOverview());
});

app.get('/api/market/history/:item', (req, res) => {
  res.json(analyzer.getItemHistory(decodeURIComponent(req.params.item)));
});

app.get('/api/market/trends', (req, res) => {
  res.json(analyzer.getTrends());
});

app.get('/api/market/summary', (req, res) => {
  res.json(analyzer.getSnapshotSummary());
});

app.post('/api/ai/analyze', async (req, res) => {
  try {
    const context = analyzer.getChatContext();
    const result = await ai.analyze(context, req.body.context || '');
    aiAnalysis = result;
    aiTimestamp = Date.now();
    io.emit('ai:analysis', { content: result.content, timestamp: aiTimestamp });
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/ai/ask', async (req, res) => {
  try {
    const context = analyzer.getChatContext();
    const answer = await ai.quickInsight(req.body.question, context);
    res.json({ answer });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// --- Socket.IO ---

io.on('connection', (socket) => {
  console.log(`[Tracker] Client: ${socket.id}`);
  socket.emit('init', {
    market: analyzer.getMarketOverview(),
    summary: analyzer.getSnapshotSummary(),
    trends: analyzer.getTrends().slice(0, 20),
    lastAuctions: lastAuctions.slice(0, 50),
    lastTransactions: lastTransactions.slice(0, 50),
    leaderboards: lastLeaderboards,
    aiAnalysis: aiAnalysis ? { content: aiAnalysis.content, timestamp: aiTimestamp } : null
  });

  socket.on('player:lookup', async (data) => {
    try {
      const lookup = await donutsmp.playerLookup(data.user);
      const stats = await donutsmp.playerStats(data.user);
      socket.emit('player:result', { user: data.user, lookup: lookup.result, stats: stats.result });
    } catch (e) { socket.emit('player:error', { error: e.message }); }
  });

  socket.on('auction:search', async (data) => {
    try {
      const result = await donutsmp.auctionList(1, data.search || '', data.sort || '');
      socket.emit('auction:results', result);
    } catch (e) { socket.emit('error', { error: e.message }); }
  });

  socket.on('ai:analyze', async () => {
    try {
      const context = analyzer.getChatContext();
      const result = await ai.analyze(context);
      aiAnalysis = result;
      aiTimestamp = Date.now();
      socket.emit('ai:analysis', { content: result.content, timestamp: aiTimestamp });
    } catch (e) { socket.emit('ai:error', { error: e.message }); }
  });

  socket.on('ai:ask', async (data) => {
    try {
      const context = analyzer.getChatContext();
      const answer = await ai.quickInsight(data.question, context);
      socket.emit('ai:answer', { answer, question: data.question });
    } catch (e) { socket.emit('ai:error', { error: e.message }); }
  });
});

// --- Data Fetching Loop ---

async function scanAuctions() {
  try {
    let allAuctions = [];
    for (let page = 1; page <= 5; page++) {
      const data = await donutsmp.auctionList(page);
      if (data.result && data.result.length) allAuctions.push(...data.result);
      else break;
    }
    lastAuctions = allAuctions;
    const snapshot = analyzer.recordSnapshot(allAuctions);
    io.emit('market:update', {
      snapshot: { items: Object.keys(snapshot.items).length, total: Object.values(snapshot.items).reduce((s, i) => s + i.count, 0) },
      trends: analyzer.getTrends().slice(0, 30),
      overview: analyzer.getMarketOverview()
    });
    console.log(`[Tracker] Scan: ${Object.keys(snapshot.items).length} items, ${allAuctions.length} listings`);
  } catch (e) { console.error(`[Tracker] Scan error: ${e.message}`); }
}

async function scanTransactions() {
  try {
    let allTx = [];
    for (let page = 1; page <= 3; page++) {
      const data = await donutsmp.auctionTransactions(page);
      if (data.result && data.result.length) allTx.push(...data.result);
      else break;
    }
    lastTransactions = allTx;
    io.emit('transactions:update', allTx.slice(0, 50));
  } catch (e) { console.error(`[Tracker] TX error: ${e.message}`); }
}

async function scanLeaderboards() {
  try {
    lastLeaderboards = await donutsmp.allLeaderboards(1);
    io.emit('leaderboards:update', lastLeaderboards);
  } catch (e) { console.error(`[Tracker] LB error: ${e.message}`); }
}

async function fullScan() {
  await Promise.allSettled([scanAuctions(), scanTransactions(), scanLeaderboards()]);
}

// --- Start ---

const PORT = process.env.PORT || 3001;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`[Tracker] http://0.0.0.0:${PORT}`);
  fullScan();
  scanInterval = setInterval(fullScan, 60000);
});

process.on('SIGTERM', () => { clearInterval(scanInterval); server.close(() => process.exit(0)); });
process.on('SIGINT', () => { clearInterval(scanInterval); server.close(() => process.exit(0)); });
