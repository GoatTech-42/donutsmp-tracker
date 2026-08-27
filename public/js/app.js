const socket = io();
let state = { trends: [], overview: {}, auctions: [], transactions: [], leaderboards: {}, aiAnalysis: null };
let scanCount = 0;
let aiAutoInterval = null;
const AI_INTERVAL = 300000;

// ── Markdown ──
marked.setOptions({ breaks: true, gfm: true });

// ── Number Formatting ──
function fmtNum(n) {
  if (n == null) return '0';
  const num = typeof n === 'string' ? parseFloat(n.replace(/[^0-9.\-]/g, '')) : Number(n);
  if (isNaN(num)) return String(n);
  const abs = Math.abs(num), sign = num < 0 ? '-' : '';
  if (abs >= 1e9) return sign + (abs / 1e6).toFixed(0) + 'M';
  if (abs >= 1e6) return sign + (abs / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
  if (abs >= 1e4) return sign + (abs / 1e3).toFixed(1).replace(/\.0$/, '') + 'k';
  if (abs >= 1e3) return sign + (abs / 1e3).toFixed(2).replace(/\.?0+$/, '') + 'k';
  return num.toLocaleString();
}
function fmtPrice(n) { return n != null ? fmtNum(n) + 'c' : '0c'; }
function fmtTime(s) {
  if (!s || s <= 0) return '0s';
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = Math.floor(s % 60);
  if (h > 0) return h + 'h ' + m + 'm';
  if (m > 0) return m + 'm ' + sec + 's';
  return sec + 's';
}
function fmtPct(n) { return (n > 0 ? '+' : '') + (n || 0).toFixed(1) + '%'; }

function renderMd(text) {
  if (!text) return '';
  try { return marked.parse(text); } catch { return esc(text); }
}

// ── Socket ──
socket.on('init', (d) => {
  state.trends = d.trends || [];
  state.overview = d.market || {};
  state.auctions = d.lastAuctions || [];
  state.transactions = d.lastTransactions || [];
  state.leaderboards = d.leaderboards || {};
  if (d.aiAnalysis) { state.aiAnalysis = d.aiAnalysis; renderAIOutput(d.aiAnalysis.content); }
  renderAll();
  startAutoAI();
});

socket.on('market:update', (d) => {
  state.trends = d.trends || [];
  state.overview = d.overview || {};
  scanCount++;
  renderDashboard();
  updateSidebarStats(d.snapshot);
});

socket.on('transactions:update', (d) => { state.transactions = d; if (currentTab() === 'transactions') renderTransactions(); });
socket.on('leaderboards:update', (d) => { state.leaderboards = d; if (currentTab() === 'leaderboards') renderLeaderboard(); });
socket.on('ai:analysis', (d) => { state.aiAnalysis = d; renderAIOutput(d.content); enableAI(); });
socket.on('ai:answer', (d) => { addAIChat(d.question, d.answer); enableAI(); });
socket.on('ai:error', (d) => { addAIChat('Error', d.error); enableAI(); });
socket.on('player:result', (d) => renderPlayer(d));
socket.on('player:error', (d) => { document.getElementById('player-result').innerHTML = '<div class="empty-state">' + esc(d.error) + '</div>'; });
socket.on('auction:results', (d) => { state.auctions = d.result || []; renderAuctions(); });

// ── Auto AI ──
function startAutoAI() {
  if (aiAutoInterval) clearInterval(aiAutoInterval);
  runAIAnalysis();
  aiAutoInterval = setInterval(() => {
    const btn = document.getElementById('ai-btn');
    if (btn && !btn.disabled) runAIAnalysis();
  }, AI_INTERVAL);
}

// ── Tabs ──
document.querySelectorAll('.nav-item').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
    btn.classList.add('active');
    const tab = btn.dataset.tab;
    document.getElementById('tab-' + tab).classList.add('active');
    document.getElementById('page-title').textContent = btn.dataset.title;
    updateActions(tab);
  });
});

function currentTab() { const a = document.querySelector('.nav-item.active'); return a ? a.dataset.tab : 'dashboard'; }

function updateActions(tab) {
  const el = document.getElementById('topbar-actions');
  if (tab === 'auctions') el.innerHTML = '<button class="btn btn-ghost" onclick="refreshAuctions()">Refresh</button>';
  else if (tab === 'ai') el.innerHTML = '<button class="btn btn-primary" onclick="runAIAnalysis()" id="ai-top-btn">Analyze</button>';
  else el.innerHTML = '';
}

// ── Render ──
function renderAll() { renderDashboard(); renderAuctions(); renderTransactions(); renderLeaderboard(); updateSidebarStats(); }

function updateSidebarStats(snap) {
  document.getElementById('s-items').textContent = fmtNum(snap ? snap.items : (state.overview.totalItems || 0));
  document.getElementById('s-listings').textContent = fmtNum(snap ? snap.total : (state.overview.totalListings || 0));
  document.getElementById('s-scans').textContent = scanCount;
}

function renderDashboard() {
  const o = state.overview;
  document.getElementById('ov-items').textContent = fmtNum(o.totalItems || 0);
  document.getElementById('ov-listings').textContent = fmtNum(o.totalListings || 0);
  document.getElementById('ov-buys').textContent = fmtNum(o.buys || 0);
  document.getElementById('ov-sells').textContent = fmtNum(o.sells || 0);

  const gainers = (o.topGainers || []);
  document.getElementById('dash-gainers').innerHTML = gainers.length ? gainers.map(t =>
    '<div class="data-row"><span class="data-name">' + esc(t.name) + '</span><span class="data-val pos">' + fmtPct(t.priceChange) + '</span><span class="data-val">' + fmtPrice(t.currentMin) + '</span></div>'
  ).join('') : '<div class="empty-state">Collecting data...</div>';

  const losers = (o.topLosers || []);
  document.getElementById('dash-losers').innerHTML = losers.length ? losers.map(t =>
    '<div class="data-row"><span class="data-name">' + esc(t.name) + '</span><span class="data-val neg">' + fmtPct(t.priceChange) + '</span><span class="data-val">' + fmtPrice(t.currentMin) + '</span></div>'
  ).join('') : '<div class="empty-state">Collecting data...</div>';

  if (state.aiAnalysis) {
    const preview = document.getElementById('dash-ai');
    if (preview && !preview.dataset.userScroll) {
      preview.innerHTML = renderMd(state.aiAnalysis.content.slice(0, 1200) + (state.aiAnalysis.content.length > 1200 ? '...' : ''));
    }
    const ts = state.aiAnalysis.timestamp;
    if (ts) {
      const elapsed = Math.floor((Date.now() - ts) / 60000);
      document.getElementById('ai-last-run').textContent = elapsed < 1 ? 'just now' : elapsed + 'm ago';
    }
  }
}

// ── Auctions ──
function renderAuctions() {
  const body = document.getElementById('ah-body');
  if (!state.auctions.length) { body.innerHTML = '<tr><td colspan="6" class="empty-state">No auctions loaded.</td></tr>'; return; }
  body.innerHTML = state.auctions.map(a => {
    const name = a.item?.display_name || a.item?.id || '?';
    const count = a.item?.count || 1;
    const perUnit = Math.round(a.price / count);
    const enchants = a.item?.enchants?.enchantments?.levels;
    const enchantStr = enchants ? Object.entries(enchants).map(([k,v]) => k + ' ' + v).join(', ') : '';
    return '<tr><td class="item-name">' + esc(name) + (enchantStr ? '<br><span style="color:var(--text-subtle);font-size:10px">' + esc(enchantStr) + '</span>' : '') + '</td><td>' + fmtNum(count) + '</td><td class="price">' + fmtPrice(a.price) + '</td><td>' + fmtPrice(perUnit) + '</td><td>' + esc(a.seller?.name || '?') + '</td><td>' + fmtTime(a.time_left) + '</td></tr>';
  }).join('');
}

function searchAuctions() { socket.emit('auction:search', { search: document.getElementById('ah-search').value, sort: document.getElementById('ah-sort').value }); }
function refreshAuctions() { socket.emit('auction:search', { search: '', sort: '' }); }

// ── Transactions ──
function renderTransactions() {
  const body = document.getElementById('tx-body');
  if (!state.transactions.length) { body.innerHTML = '<tr><td colspan="5" class="empty-state">No transactions loaded.</td></tr>'; return; }
  body.innerHTML = state.transactions.map(tx => {
    const name = tx.item?.display_name || tx.item?.id || '?';
    const date = tx.unixMillisDateSold ? new Date(tx.unixMillisDateSold).toLocaleString() : '?';
    return '<tr><td class="item-name">' + esc(name) + '</td><td>' + fmtNum(tx.item?.count || 1) + '</td><td class="price">' + fmtPrice(tx.price) + '</td><td>' + esc(tx.seller?.name || '?') + '</td><td>' + date + '</td></tr>';
  }).join('');
}

// ── Leaderboards ──
function renderLeaderboard() {
  const type = document.getElementById('lb-type').value;
  const data = state.leaderboards[type];
  const body = document.getElementById('lb-body');
  if (!data?.result) { body.innerHTML = '<tr><td colspan="3" class="empty-state">Select a leaderboard.</td></tr>'; return; }
  body.innerHTML = data.result.map((r, i) =>
    '<tr><td>' + (i+1) + '</td><td class="item-name">' + esc(r.username) + '</td><td class="price">' + fmtNum(r.value) + '</td></tr>'
  ).join('');
}

function loadLeaderboard() {
  const type = document.getElementById('lb-type').value;
  fetch('/api/leaderboard/' + type).then(r=>r.json()).then(d => { state.leaderboards[type] = d; renderLeaderboard(); });
}

// ── Players ──
function lookupPlayer() {
  const user = document.getElementById('player-name').value.trim();
  if (!user) return;
  document.getElementById('player-result').innerHTML = '<div class="empty-state">Loading...</div>';
  socket.emit('player:lookup', { user });
}

function renderPlayer(d) {
  const l = d.lookup, s = d.stats;
  document.getElementById('player-result').innerHTML = '<div class="player-card">' +
    '<div class="player-name">' + esc(d.user) + '</div>' +
    '<div class="player-meta">' + esc(l?.rank || 'Unknown') + ' &middot; ' + esc(l?.location || '?') + '</div>' +
    '<div class="player-stats">' +
      '<div class="player-stat"><div class="player-stat-label">Money</div><div class="player-stat-value">' + fmtPrice(s?.money) + '</div></div>' +
      '<div class="player-stat"><div class="player-stat-label">Shards</div><div class="player-stat-value">' + fmtNum(s?.shards) + '</div></div>' +
      '<div class="player-stat"><div class="player-stat-label">Kills</div><div class="player-stat-value">' + fmtNum(s?.kills) + '</div></div>' +
      '<div class="player-stat"><div class="player-stat-label">Deaths</div><div class="player-stat-value">' + fmtNum(s?.deaths) + '</div></div>' +
      '<div class="player-stat"><div class="player-stat-label">Mobs Killed</div><div class="player-stat-value">' + fmtNum(s?.mobs_killed) + '</div></div>' +
      '<div class="player-stat"><div class="player-stat-label">Blocks Broken</div><div class="player-stat-value">' + fmtNum(s?.broken_blocks) + '</div></div>' +
      '<div class="player-stat"><div class="player-stat-label">Blocks Placed</div><div class="player-stat-value">' + fmtNum(s?.placed_blocks) + '</div></div>' +
      '<div class="player-stat"><div class="player-stat-label">Playtime</div><div class="player-stat-value">' + fmtTime(s?.playtime) + '</div></div>' +
      '<div class="player-stat"><div class="player-stat-label">/sell Earnings</div><div class="player-stat-value">' + fmtPrice(s?.money_made_from_sell) + '</div></div>' +
      '<div class="player-stat"><div class="player-stat-label">/shop Spent</div><div class="player-stat-value">' + fmtPrice(s?.money_spent_on_shop) + '</div></div>' +
    '</div></div>';
}

// ── AI ──
function runAIAnalysis() {
  const btn = document.getElementById('ai-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Analyzing...'; }
  const topBtn = document.getElementById('ai-top-btn');
  if (topBtn) { topBtn.disabled = true; topBtn.textContent = 'Analyzing...'; }
  document.getElementById('ai-output').innerHTML = '<div class="empty-state">Analyzing market data...</div>';
  socket.emit('ai:analyze');
}

function enableAI() {
  const btn = document.getElementById('ai-btn');
  if (btn) { btn.disabled = false; btn.textContent = 'Run Analysis'; }
  const topBtn = document.getElementById('ai-top-btn');
  if (topBtn) { topBtn.disabled = false; topBtn.textContent = 'Analyze'; }
}

function renderAIOutput(text) {
  document.getElementById('ai-output').innerHTML = renderMd(text);
  const preview = document.getElementById('dash-ai');
  if (preview && !preview.dataset.userScroll) {
    preview.innerHTML = renderMd(text.slice(0, 1200) + (text.length > 1200 ? '...' : ''));
  }
}

function askAI() {
  const input = document.getElementById('ai-input');
  const q = input.value.trim();
  if (!q) return;
  input.value = '';
  addAIChat(q, 'Thinking...');
  socket.emit('ai:ask', { question: q });
}

function addAIChat(q, a) {
  const el = document.getElementById('ai-chat-messages');
  el.innerHTML += '<div class="ai-msg"><div class="ai-msg-q">Q: ' + esc(q) + '</div><div class="ai-msg-a">' + esc(a) + '</div></div>';
  el.scrollTop = el.scrollHeight;
}

// ── Shield ──
function loadShield() {
  const service = document.getElementById('shield-service').value.trim();
  const platform = document.getElementById('shield-platform').value;
  if (!service) return;
  ['shield-config','shield-metrics','shield-stats'].forEach(id => document.getElementById(id).textContent = 'Loading...');
  fetch('/api/shield/config/' + encodeURIComponent(service) + '?platform=' + platform).then(r=>r.json()).then(d => {
    document.getElementById('shield-config').textContent = JSON.stringify(d, null, 2);
  }).catch(e => { document.getElementById('shield-config').textContent = 'Error: ' + e.message; });
  fetch('/api/shield/metrics/' + encodeURIComponent(service)).then(r=>r.json()).then(d => {
    document.getElementById('shield-metrics').textContent = JSON.stringify(d, null, 2);
  }).catch(e => { document.getElementById('shield-metrics').textContent = 'Error: ' + e.message; });
  fetch('/api/shield/stats/' + encodeURIComponent(service)).then(r=>r.json()).then(d => {
    document.getElementById('shield-stats').textContent = JSON.stringify(d, null, 2);
  }).catch(e => { document.getElementById('shield-stats').textContent = 'Error: ' + e.message; });
}

function esc(s) { if (!s) return ''; const d = document.createElement('div'); d.textContent = String(s); return d.innerHTML; }
