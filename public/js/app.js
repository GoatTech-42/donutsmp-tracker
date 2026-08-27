const state = { overview: null, flips: [], market: [], salesPage: 1, view: 'overview' };
const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;' })[char]);
const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });
const number = new Intl.NumberFormat('en-US');
const money = value => `$${compact.format(Number(value) || 0)}`;
const relative = value => {
  if (!value) return '—';
  const seconds = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
};

async function request(url, options) {
  const response = await fetch(url, options);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `Request failed (${response.status})`);
  return payload;
}
function toast(message, error = false) {
  const node = document.createElement('div');
  node.className = `toast${error ? ' error' : ''}`;
  node.textContent = message;
  $('#toast-region').append(node);
  setTimeout(() => node.remove(), 3800);
}

const titles = { overview:['MARKET COMMAND CENTER','Overview'], opportunities:['ACTIONABLE SIGNALS','Opportunities'], market:['PRICE DISCOVERY','Market explorer'], sales:['COMPLETED TRADES','Sales ledger'], portfolio:['RISK-ADJUSTED ALLOCATION','Portfolio lab'], players:['PUBLIC PLAYER DATA','Player lookup'] };
function navigate(view) {
  state.view = view;
  $$('.view').forEach(node => node.classList.toggle('active', node.id === `view-${view}`));
  $$('.nav-link').forEach(node => node.classList.toggle('active', node.dataset.view === view));
  $('#page-eyebrow').textContent = titles[view][0];
  $('#page-title').textContent = titles[view][1];
  $('#sidebar').classList.remove('open');
  history.replaceState(null, '', `#${view}`);
  if (view === 'opportunities') loadFlips();
  if (view === 'market') loadMarket();
  if (view === 'sales') loadSales();
}
$$('.nav-link').forEach(node => node.addEventListener('click', () => navigate(node.dataset.view)));
$$('[data-go]').forEach(node => node.addEventListener('click', () => navigate(node.dataset.go)));
$('#menu-button').addEventListener('click', () => $('#sidebar').classList.toggle('open'));

function renderStatus(status) {
  $('#source-label').textContent = status.demo ? 'Demo feed' : 'Official API';
  $('#source-note').textContent = status.demo ? 'Safe sample data. Add DONUTSMP_API_KEY for the official live feed.' : status.ordersConfigured ? 'Official auctions plus a configured orders provider.' : 'Official auction and transaction data. Orders API unavailable.';
  $('#scan-count').textContent = `Scan #${status.scanCount}`;
  $('#last-scan').textContent = relative(status.lastSuccess);
  $('#feed-status').textContent = status.scanning ? 'Scanning' : status.lastError ? 'Degraded' : status.demo ? 'Demo live' : 'Live';
}

async function loadOverview() {
  try {
    const data = await request('/api/overview');
    state.overview = data;
    renderStatus(data.status);
    const s = data.summary;
    $('#hero-score').textContent = s.opportunities;
    $('#hero-caption').textContent = `${s.recordedSales} completed sales inform fair value`;
    $('#nav-opportunities').textContent = s.opportunities;
    $('#metric-grid').innerHTML = [
      ['Market value', money(s.marketValue), `${number.format(s.totalAuctions)} live listings`],
      ['Recorded turnover', money(s.salesValue), `${number.format(s.recordedSales)} completed sales`],
      ['Unique assets', number.format(s.uniqueItems), 'Normalized item markets'],
      ['Orders observed', number.format(s.orderListings), data.status.ordersConfigured ? 'External provider connected' : 'No public source available']
    ].map(x => `<div class="metric-card"><span class="label">${x[0]}</span><strong>${x[1]}</strong><small>${x[2]}</small></div>`).join('');
    $('#top-flips').classList.remove('loading-block');
    $('#top-flips').innerHTML = data.topFlips.length ? data.topFlips.map(f => `<button class="opportunity-row text-button" data-open-flips="${escapeHtml(f.name)}"><div><div class="asset-name">${escapeHtml(f.name)}</div><span class="strategy">${f.type} · ${f.risk.label} risk</span></div><div><div class="profit">+${money(f.profit)}</div><div class="roi">${f.roi}% ROI</div></div></button>`).join('') : empty('No qualified opportunities yet.');
    $$('[data-open-flips]').forEach(node => node.addEventListener('click', () => { navigate('opportunities'); $('#flip-search').value = node.dataset.openFlips; loadFlips(); }));
    $('#active-market').classList.remove('loading-block');
    $('#active-market').innerHTML = data.active.slice(0, 7).map(x => `<div class="compact-row"><span>${escapeHtml(x.name)}</span><b>${x.sales} sales</b><small>${money(x.salesValue)} turnover</small><small>${money(x.floor)} floor</small></div>`).join('') || empty('Waiting for sales data.');
    $('#movers').classList.remove('loading-block');
    $('#movers').innerHTML = data.movers.slice(0, 7).map(x => `<div class="compact-row"><span>${escapeHtml(x.name)}</span><b class="${x.change >= 0 ? 'up' : 'down'}">${x.change > 0 ? '+' : ''}${x.change}%</b><small>${money(x.floor)} floor</small><small>${x.confidence}% confidence</small></div>`).join('') || empty('More scans are needed for momentum.');
    $('#data-health').innerHTML = `<div class="health-item"><b>${data.status.demo ? 'Demonstration mode' : 'Official DonutSMP API'}</b><span>${data.status.demo ? 'Fully functional sample dataset' : 'Authenticated live market feed'}</span></div><div class="health-item"><b>${data.status.ordersConfigured ? 'Orders connected' : 'Orders unavailable'}</b><span>${data.status.ordersConfigured ? `${s.orderListings} buy orders normalized` : 'Official API has no /orders endpoint'}</span></div><div class="health-item"><b>${relative(data.status.lastSuccess)}</b><span>Last successful snapshot</span></div>`;
  } catch (error) { toast(error.message, true); }
}

async function loadFlips() {
  const params = new URLSearchParams({ search: $('#flip-search').value, type: $('#flip-type').value, minProfit: $('#flip-profit').value });
  try {
    const data = await request(`/api/flips?${params}`);
    state.flips = data.flips;
    $('#flip-grid').innerHTML = data.flips.length ? data.flips.map(f => `<article class="flip-card"><div class="flip-top"><div><h3>${escapeHtml(f.name)}</h3><div style="margin-top:7px"><span class="badge">${f.type}</span> <span class="badge risk-${f.risk.label.toLowerCase()}">${f.risk.label} risk</span></div></div><div><div class="flip-profit">+${money(f.profit)}</div><div class="roi">${f.roi}% ROI</div></div></div><div class="flip-route"><div><small>Acquire</small><b>${money(f.buyPrice)}</b></div><i>→</i><div><small>Target</small><b>${money(f.sellPrice)}</b></div></div><div class="flip-meta"><span>${f.volume} observed sales</span><span>${f.confidence}% confidence</span><span>Score ${compact.format(f.score)}</span></div></article>`).join('') : empty('No opportunities match these filters.');
  } catch (error) { toast(error.message, true); }
}

async function loadMarket() {
  const params = new URLSearchParams({ search: $('#market-search').value, sort: $('#market-sort').value, limit: 100 });
  try {
    const data = await request(`/api/market?${params}`);
    state.market = data.items;
    $('#market-body').innerHTML = data.items.map(x => `<tr><td class="asset">${escapeHtml(x.name)}</td><td class="mono">${money(x.floor)}</td><td class="mono">${money(x.fairValue)}</td><td>${x.sales}</td><td class="mono">${money(x.salesValue)}</td><td class="${x.change >= 0 ? 'up' : 'down'}">${x.change > 0 ? '+' : ''}${x.change}%</td><td><div class="confidence" title="${x.confidence}% confidence"><i style="width:${x.confidence}%"></i></div></td></tr>`).join('') || `<tr><td colspan="7">No matching assets.</td></tr>`;
  } catch (error) { toast(error.message, true); }
}

async function loadSales(page = 1) {
  state.salesPage = page;
  const params = new URLSearchParams({ search: $('#sales-search').value, page, limit: 40 });
  try {
    const data = await request(`/api/transactions?${params}`);
    $('#sales-body').innerHTML = data.transactions.map(x => `<tr><td class="asset">${escapeHtml(x.itemName)}</td><td>${number.format(x.count)}×</td><td class="mono">${money(x.price)}</td><td class="mono">${money(x.pricePerUnit)}</td><td>${escapeHtml(x.seller?.name || 'Unknown')}</td><td>${relative(x.dateSold)}</td></tr>`).join('') || `<tr><td colspan="6">No completed sales found.</td></tr>`;
    $('#sales-pagination').innerHTML = `${data.page > 1 ? '<button data-page="prev">← Previous</button>' : ''}<span>Page ${data.page} of ${data.pages}</span>${data.page < data.pages ? '<button data-page="next">Next →</button>' : ''}`;
    $$('[data-page]').forEach(node => node.addEventListener('click', () => loadSales(node.dataset.page === 'prev' ? data.page - 1 : data.page + 1)));
  } catch (error) { toast(error.message, true); }
}

async function calculatePortfolio() {
  const button = $('#calculate-button'); button.disabled = true;
  try {
    const data = await request(`/api/portfolio?budget=${encodeURIComponent($('#budget').value)}&risk=${$('#risk').value}`);
    $('#portfolio-results').innerHTML = `<div class="portfolio-summary">${[['Deployed',money(data.totalCost)],['Expected profit',money(data.totalProfit)],['Projected ROI',`${data.totalROI}%`],['Cash reserve',money(data.remaining)]].map(x => `<div class="metric-card"><span class="label">${x[0]}</span><strong>${x[1]}</strong></div>`).join('')}</div><div class="allocation">${data.allocation.map(x => `<div class="allocation-row"><div><small>Asset</small><b>${escapeHtml(x.flip.name)}</b></div><div><small>Strategy</small><b>${x.flip.type}</b></div><div><small>Units</small><b>${x.copies}</b></div><div><small>Capital</small><b>${money(x.totalCost)}</b></div><div><small>Profit</small><b class="up">+${money(x.expectedProfit)}</b></div></div>`).join('') || empty('No opportunities fit this capital and risk profile.')}</div>`;
  } catch (error) { toast(error.message, true); } finally { button.disabled = false; }
}

async function lookupPlayer(event) {
  event.preventDefault();
  const name = $('#player-name').value.trim();
  $('#player-results').textContent = 'Loading player profile…';
  try {
    const data = await request(`/api/player/${encodeURIComponent(name)}`);
    const profile = data.lookup?.result || data.lookup || {};
    const stats = data.stats?.result || data.stats || {};
    const safeStats = Object.entries(stats).filter(([key, value]) => key !== 'demo' && ['string','number'].includes(typeof value));
    $('#player-results').innerHTML = `<div class="player-header"><div class="player-avatar">${escapeHtml((profile.name || name).slice(0, 1).toUpperCase())}</div><div><h3>${escapeHtml(profile.name || name)}</h3><p>${escapeHtml(profile.uuid || 'Public DonutSMP profile')} · ${data.source} data</p></div></div><div class="player-stat-grid">${safeStats.map(([key,value]) => `<div class="player-stat"><small>${escapeHtml(key.replaceAll('_',' '))}</small><b>${typeof value === 'number' ? compact.format(value) : escapeHtml(value)}</b></div>`).join('')}</div>`;
  } catch (error) { $('#player-results').textContent = error.message; toast(error.message, true); }
}

function empty(message) { return `<div class="empty-message">${escapeHtml(message)}</div>`; }
function debounce(fn, delay = 250) { let timer; return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), delay); }; }
$('#flip-search').addEventListener('input', debounce(loadFlips));
$('#flip-type').addEventListener('change', loadFlips); $('#flip-profit').addEventListener('change', loadFlips);
$('#market-search').addEventListener('input', debounce(loadMarket)); $('#market-sort').addEventListener('change', loadMarket);
$('#sales-search').addEventListener('input', debounce(() => loadSales(1)));
$('#risk').addEventListener('input', event => $('#risk-value').textContent = event.target.value);
$('#calculate-button').addEventListener('click', calculatePortfolio); $('#player-form').addEventListener('submit', lookupPlayer);
$('#refresh-button').addEventListener('click', async () => { const button = $('#refresh-button'); button.disabled = true; try { await request('/api/scan', { method:'POST' }); await loadOverview(); toast('Market feed refreshed'); } catch (error) { toast(error.message, true); } finally { button.disabled = false; } });

const socket = io();
socket.on('scan:status', renderStatus);
socket.on('scan:update', status => { renderStatus(status); if (state.view === 'overview') loadOverview(); });
socket.on('connect_error', () => $('#feed-status').textContent = 'Reconnecting');

const initial = location.hash.slice(1);
if (titles[initial]) navigate(initial); else navigate('overview');
loadOverview();
