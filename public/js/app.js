const socket = io();
let currentTab = 'dashboard';
let allFlips = [];
let allAuctions = [];
let allTransactions = [];

// === UTILS ===
function fmt(n) {
  if (n === null || n === undefined) return '-';
  if (n >= 1e15) return (n/1e15).toFixed(1)+'Q';
  if (n >= 1e12) return (n/1e12).toFixed(1)+'T';
  if (n >= 1e9) return (n/1e9).toFixed(1)+'B';
  if (n >= 1e6) return (n/1e6).toFixed(1)+'M';
  if (n >= 1e3) return (n/1e3).toFixed(1)+'K';
  return n.toLocaleString();
}

function fmtPrice(n) {
  if (n === null || n === undefined) return '-';
  return '$' + fmt(n);
}

function timeAgo(ms) {
  if (!ms) return '-';
  const s = Math.floor(ms / 1000);
  if (s < 60) return s + 's';
  if (s < 3600) return Math.floor(s/60) + 'm';
  if (s < 86400) return Math.floor(s/3600) + 'h';
  return Math.floor(s/86400) + 'd';
}

function riskBadge(risk) {
  if (!risk) return '';
  const cls = risk.score < 30 ? 'pill-green' : risk.score > 70 ? 'pill-red' : 'pill-yellow';
  return `<span class="pill ${cls}">${risk.label} risk</span>`;
}

function typeBadge(type) {
  const colors = { craft: 'pill-blue', market: 'pill-purple', snipe: 'pill-green' };
  return `<span class="pill ${colors[type] || 'pill-accent'}">${type}</span>`;
}

function profitClass(n) { return n > 0 ? 'pos' : n < 0 ? 'neg' : ''; }

// === NAV ===
document.querySelectorAll('.nav-item').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
    btn.classList.add('active');
    const tab = btn.dataset.tab;
    currentTab = tab;
    document.getElementById('tab-' + tab).classList.add('active');
    document.getElementById('page-title').textContent = btn.dataset.title || tab;
    if (tab === 'dashboard') loadDashboard();
    if (tab === 'flips') loadFlips();
    if (tab === 'auctions') loadAuctions();
    if (tab === 'transactions') loadTransactions();
    if (tab === 'leaderboards') loadLeaderboard();
  });
});

// === DASHBOARD ===
async function loadDashboard() {
  try {
    const res = await fetch('/api/intelligence');
    const data = await res.json();
    renderDashboardStats(data.summary);
    renderTopFlips(data.topFlips);
    renderTopListed(data.topListed);
    renderRisingFalling(data.risingItems, data.fallingItems);
    document.getElementById('flip-count').textContent = data.summary.profitableFlips;
  } catch (e) { console.error('Dashboard error:', e); }
}

function renderDashboardStats(s) {
  document.getElementById('stats-grid').innerHTML = `
    <div class="stat-card blue"><div class="stat-label">Auctions</div><div class="stat-value">${fmt(s.totalAuctions)}</div><div class="stat-sub">Total listings</div></div>
    <div class="stat-card green"><div class="stat-label">Profitable Flips</div><div class="stat-value">${fmt(s.profitableFlips)}</div><div class="stat-sub">Found by scanner</div></div>
    <div class="stat-card yellow"><div class="stat-label">Avg Flip Profit</div><div class="stat-value">${fmtPrice(s.avgFlipProfit)}</div><div class="stat-sub">Per flip</div></div>
    <div class="stat-card red"><div class="stat-label">Market Value</div><div class="stat-value">${fmtPrice(s.totalAuctionValue)}</div><div class="stat-sub">Total listed value</div></div>
  `;
}

function renderTopFlips(flips) {
  const el = document.getElementById('dash-top-flips');
  if (!flips || flips.length === 0) { el.innerHTML = '<div class="empty-state">No flips found yet</div>'; return; }
  el.innerHTML = flips.slice(0, 10).map(f => `
    <div class="data-row">
      <span class="data-name">${typeBadge(f.type)} ${f.name}</span>
      <span class="data-val ${profitClass(f.profit)}">${fmtPrice(f.profit)}</span>
      <span class="data-val" style="color:var(--text3);min-width:55px;text-align:right">${f.roi > 0 ? '+'+f.roi.toFixed(1)+'%' : f.roi.toFixed(1)+'%'}</span>
    </div>
  `).join('');
}

function renderTopListed(items) {
  const el = document.getElementById('dash-top-listed');
  if (!items || items.length === 0) { el.innerHTML = '<div class="empty-state">No data yet</div>'; return; }
  el.innerHTML = items.slice(0, 10).map(i => `
    <div class="data-row">
      <span class="data-name">${i.item}</span>
      <span class="data-val">${i.count} listings</span>
      <span class="data-val" style="color:var(--text3)">${fmtPrice(i.avgPrice)} avg</span>
    </div>
  `).join('');
}

function renderRisingFalling(rising, falling) {
  const rEl = document.getElementById('dash-rising');
  const fEl = document.getElementById('dash-falling');
  if (rising && rising.length > 0) {
    rEl.innerHTML = rising.map(i => `<div class="data-row"><span class="data-name">${i.item}</span><span class="data-val pos">+${i.change.toFixed(1)}%</span><span class="data-val" style="color:var(--text3)">${fmtPrice(i.recentAvg)}</span></div>`).join('');
  } else { rEl.innerHTML = '<div class="empty-state">No rising items</div>'; }
  if (falling && falling.length > 0) {
    fEl.innerHTML = falling.map(i => `<div class="data-row"><span class="data-name">${i.item}</span><span class="data-val neg">${i.change.toFixed(1)}%</span><span class="data-val" style="color:var(--text3)">${fmtPrice(i.recentAvg)}</span></div>`).join('');
  } else { fEl.innerHTML = '<div class="empty-state">No falling items</div>'; }
}

// === FLIPS ===
async function loadFlips() {
  try {
    const type = document.getElementById('flip-type-filter').value;
    const minProfit = document.getElementById('flip-profit-filter').value;
    let url = '/api/flips?minProfit=' + minProfit;
    if (type) url += '&type=' + type;
    const res = await fetch(url);
    const data = await res.json();
    allFlips = data.flips;
    renderFlips(allFlips);
  } catch (e) { console.error('Flips error:', e); }
}

function renderFlips(flips) {
  const search = document.getElementById('flip-search').value.toLowerCase();
  let filtered = flips;
  if (search) filtered = flips.filter(f => f.name.toLowerCase().includes(search));

  const grid = document.getElementById('flips-grid');
  if (filtered.length === 0) { grid.innerHTML = '<div class="empty-state">No flips match your filters</div>'; return; }

  grid.innerHTML = filtered.map(f => {
    let stepsHtml = '';
    if (f.type === 'craft' && f.ingredients) {
      stepsHtml = f.ingredients.map((ing, i) =>
        `<div class="flip-step"><span class="flip-step-num buy">${i+1}</span> Buy ${ing.count}x ${ing.name} @ ${fmtPrice(ing.unitPrice)}</div>`
      ).join('') + `<div class="flip-step"><span class="flip-step-num sell">→</span> Craft & sell ${f.name} @ ${fmtPrice(f.sellPrice)}</div>`;
    } else if (f.type === 'market') {
      stepsHtml = `
        <div class="flip-step"><span class="flip-step-num buy">1</span> Buy ${f.name} @ ${fmtPrice(f.buyPrice)}</div>
        <div class="flip-step"><span class="flip-step-num sell">2</span> Relist @ ${fmtPrice(f.sellPrice)}</div>
      `;
    } else if (f.type === 'snipe') {
      stepsHtml = `
        <div class="flip-step"><span class="flip-step-num buy">1</span> Snipe ${f.name} @ ${fmtPrice(f.buyPrice)}</div>
        <div class="flip-step"><span class="flip-step-num sell">2</span> Sell @ market ~${fmtPrice(f.sellPrice)}</div>
      `;
    }

    return `
      <div class="flip-card">
        <div class="flip-header">
          <div><div class="flip-title">${f.name}</div><div style="margin-top:4px">${typeBadge(f.type)} ${riskBadge(f.risk)} <span class="pill pill-accent">${f.volume || 0} listed</span></div></div>
          <div class="flip-profit ${f.profit > 0 ? '' : 'negative'}">${fmtPrice(f.profit)}</div>
        </div>
        <div class="flip-steps">${stepsHtml}</div>
        <div class="flip-meta">
          <span class="pill pill-blue">Cost: ${fmtPrice(f.totalCost || f.buyPrice)}</span>
          <span class="pill pill-green">ROI: ${f.roi > 0 ? '+' : ''}${f.roi.toFixed(1)}%</span>
        </div>
      </div>
    `;
  }).join('');
}

document.getElementById('flip-search').addEventListener('input', () => renderFlips(allFlips));
document.getElementById('flip-type-filter').addEventListener('change', loadFlips);
document.getElementById('flip-profit-filter').addEventListener('change', loadFlips);

// === PORTFOLIO ===
async function calculatePortfolio() {
  const budget = parseInt(document.getElementById('portfolio-budget').value) || 5000000;
  try {
    const res = await fetch('/api/portfolio?budget=' + budget);
    const data = await res.json();
    renderPortfolio(data);
  } catch (e) { console.error('Portfolio error:', e); }
}

function renderPortfolio(p) {
  const el = document.getElementById('portfolio-results');
  if (p.allocation.length === 0) { el.innerHTML = '<div class="empty-state">No profitable flips found for this budget</div>'; return; }
  el.innerHTML = `
    <div class="stat-grid">
      <div class="stat-card blue"><div class="stat-label">Investment</div><div class="stat-value">${fmtPrice(p.investment)}</div></div>
      <div class="stat-card green"><div class="stat-label">Expected Profit</div><div class="stat-value">${fmtPrice(p.totalProfit)}</div></div>
      <div class="stat-card yellow"><div class="stat-label">Total ROI</div><div class="stat-value">${p.totalROI}%</div></div>
      <div class="stat-card red"><div class="stat-label">Flips Used</div><div class="stat-value">${p.flipCount}</div><div class="stat-sub">${fmtPrice(p.remaining)} remaining</div></div>
    </div>
    <div class="table-wrap">
      <table class="data-table">
        <thead><tr><th>Item</th><th>Type</th><th>Copies</th><th>Cost</th><th>Expected Profit</th><th>ROI</th></tr></thead>
        <tbody>
          ${p.allocation.map(a => `
            <tr>
              <td class="item-name">${a.flip.name}</td>
              <td>${typeBadge(a.flip.type)}</td>
              <td>${a.copies}</td>
              <td class="price">${fmtPrice(a.totalCost)}</td>
              <td class="price ${profitClass(a.expectedProfit)}">${fmtPrice(a.expectedProfit)}</td>
              <td class="price">${a.expectedROI > 0 ? '+' : ''}${a.expectedROI.toFixed(1)}%</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

// === AUCTIONS ===
let auctionPage = 1;
async function loadAuctions(page) {
  auctionPage = page || 1;
  const search = document.getElementById('auction-search').value;
  try {
    const res = await fetch(`/api/auctions?page=${auctionPage}&search=${encodeURIComponent(search)}`);
    const data = await res.json();
    allAuctions = data.auctions;
    renderAuctions(data);
  } catch (e) { console.error('Auctions error:', e); }
}

function renderAuctions(data) {
  const body = document.getElementById('auctions-body');
  body.innerHTML = data.auctions.map(a => `
    <tr>
      <td class="item-name">${a.itemName}</td>
      <td>${a.count}</td>
      <td class="price">${fmtPrice(a.price)}</td>
      <td class="price">${fmtPrice(a.pricePerUnit)}</td>
      <td>${a.seller?.name || '-'}</td>
      <td>${timeAgo(a.timeLeft)}</td>
    </tr>
  `).join('');
  renderPagination('auctions-pagination', data.page, data.pages, loadAuctions);
}

document.getElementById('auction-search').addEventListener('keydown', e => { if (e.key === 'Enter') loadAuctions(); });

// === TRANSACTIONS ===
let txPage = 1;
async function loadTransactions(page) {
  txPage = page || 1;
  try {
    const res = await fetch(`/api/transactions?page=${txPage}`);
    const data = await res.json();
    allTransactions = data.transactions;
    renderTransactions(data);
  } catch (e) { console.error('Transactions error:', e); }
}

function renderTransactions(data) {
  const body = document.getElementById('tx-body');
  body.innerHTML = data.transactions.map(t => `
    <tr>
      <td class="item-name">${t.itemName}</td>
      <td>${t.count}</td>
      <td class="price">${fmtPrice(t.price)}</td>
      <td>${t.seller?.name || '-'}</td>
      <td>${t.dateSold ? new Date(t.dateSold).toLocaleDateString() : '-'}</td>
    </tr>
  `).join('');
  renderPagination('tx-pagination', data.page, data.pages, loadTransactions);
}

// === LEADERBOARDS ===
async function loadLeaderboard() {
  const type = document.getElementById('lb-type').value;
  try {
    const res = await fetch(`/api/leaderboards/${type}`);
    const data = await res.json();
    const body = document.getElementById('lb-body');
    body.innerHTML = (data.result || []).map((p, i) => `
      <tr>
        <td>${i + 1}</td>
        <td class="item-name">${p.player || p.name || '-'}</td>
        <td class="price">${fmt(p.value || p.score || 0)}</td>
      </tr>
    `).join('');
  } catch (e) { console.error('Leaderboard error:', e); }
}

// === PLAYER ===
async function lookupPlayer() {
  const name = document.getElementById('player-search').value;
  if (!name) return;
  try {
    const res = await fetch(`/api/player/${encodeURIComponent(name)}`);
    const data = await res.json();
    renderPlayer(data);
  } catch (e) { console.error('Player error:', e); }
}

function renderPlayer(data) {
  const el = document.getElementById('player-results');
  const lookup = data.lookup?.result || data.lookup;
  const stats = data.stats?.result || data.stats;
  if (!lookup && !stats) { el.innerHTML = '<div class="empty-state">Player not found</div>'; return; }
  el.innerHTML = `
    <div class="player-card">
      <div class="player-name">${lookup?.name || document.getElementById('player-search').value}</div>
      <div class="player-meta">UUID: ${lookup?.uuid || '-'}</div>
      <div class="player-stats">
        ${stats ? Object.entries(stats).map(([k, v]) => `
          <div class="player-stat"><div class="player-stat-label">${k.replace(/_/g,' ')}</div><div class="player-stat-value">${typeof v === 'number' ? fmt(v) : v}</div></div>
        `).join('') : '<div class="empty-state">No stats available</div>'}
      </div>
    </div>
  `;
}

document.getElementById('player-search').addEventListener('keydown', e => { if (e.key === 'Enter') lookupPlayer(); });

// === AI ===
async function runAI() {
  const output = document.getElementById('ai-output');
  output.innerHTML = '<div class="empty-state">Analyzing market data...</div>';
  try {
    const [intRes, flipRes] = await Promise.all([fetch('/api/intelligence'), fetch('/api/flips?minProfit=1000')]);
    const intel = await intRes.json();
    const flips = await flipRes.json();
    const topFlips = (flips.flips || []).slice(0, 10).map(f => `${f.name}: ${f.type} flip, profit ${fmtPrice(f.profit)}, ROI ${f.roi.toFixed(1)}%, risk ${f.risk?.label || '?'}`).join('\n');
    const rising = (intel.risingItems || []).slice(0, 5).map(i => `${i.item}: +${i.change.toFixed(1)}%`).join(', ');
    const falling = (intel.fallingItems || []).slice(0, 5).map(i => `${i.item}: ${i.change.toFixed(1)}%`).join(', ');
    const prompt = `Analyze this DonutSMP market data and give actionable trading advice:
Auctions: ${intel.summary.totalAuctions}, Total value: ${fmtPrice(intel.summary.totalAuctionValue)}
Profitable flips found: ${intel.summary.profitableFlips}, Avg profit: ${fmtPrice(intel.summary.avgFlipProfit)}
Top flips: ${topFlips || 'None'}
Rising: ${rising || 'None'}
Falling: ${falling || 'None'}
Give specific advice on what to flip, buy, or sell. Format as markdown.`;
    const aiRes = await fetch('/api/ai/analyze', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt })
    });
    const aiData = await aiRes.json();
    if (aiData.error) { output.innerHTML = `<div class="empty-state">AI Error: ${aiData.error}</div>`; return; }
    output.innerHTML = marked.parse(aiData.response || aiData.content || 'No response');
  } catch (e) { output.innerHTML = `<div class="empty-state">Error: ${e.message}</div>`; }
}

function clearAI() {
  document.getElementById('ai-output').innerHTML = '<div class="empty-state">Click "Run Analysis" to get AI market insights</div>';
}

// === PAGINATION ===
function renderPagination(id, current, total, callback) {
  const el = document.getElementById(id);
  if (total <= 1) { el.innerHTML = ''; return; }
  let html = '';
  if (current > 1) html += `<button onclick="window.${callback.name}(${current-1})">Prev</button>`;
  for (let i = Math.max(1, current - 2); i <= Math.min(total, current + 2); i++) {
    html += `<button class="${i === current ? 'active' : ''}" onclick="window.${callback.name}(${i})">${i}</button>`;
  }
  if (current < total) html += `<button onclick="window.${callback.name}(${current+1})">Next</button>`;
  el.innerHTML = html;
}

// === SCAN ===
async function triggerScan() {
  try {
    document.getElementById('tb-status').textContent = 'Scanning...';
    await fetch('/api/scan', { method: 'POST' });
    document.getElementById('tb-status').textContent = 'Live';
    if (currentTab === 'dashboard') loadDashboard();
    if (currentTab === 'flips') loadFlips();
  } catch (e) { console.error('Scan error:', e); }
}

// === SOCKET ===
socket.on('scan:update', (data) => {
  document.getElementById('s-count').textContent = fmt(data.auctions);
  document.getElementById('s-last').textContent = new Date(data.lastScan).toLocaleTimeString();
  document.getElementById('s-status').textContent = 'Online';
  document.getElementById('tb-scan').textContent = 'Scan #' + data.scanCount;
});

// === INIT ===
loadDashboard();
