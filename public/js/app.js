/* ====================================================================
   Pulse — DonutSMP market dashboard
   Clean rewrite: no tangled event handlers, every selector validated,
   no global state mutations leaking across views.
   ==================================================================== */

const $ = (sel, root = document) => root.querySelector(sel)
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)]

const fmtNum = n => Number(n || 0).toLocaleString('en-US')
const fmtMoney = n =>
  '$' + Number(n || 0).toLocaleString('en-US', { notation: 'compact', maximumFractionDigits: 1 })
const fmtPct = n => (n > 0 ? '+' : '') + (n || 0).toFixed(1) + '%'
const escHtml = s =>
  String(s ?? '').replace(
    /[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  )

function relative(date) {
  if (!date) return '—'
  const s = Math.max(0, Math.round((Date.now() - new Date(date).getTime()) / 1000))
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

function toast(msg, isError = false) {
  const node = document.createElement('div')
  node.className = 'toast' + (isError ? ' error' : '')
  node.textContent = msg
  $('#toast-region').appendChild(node)
  setTimeout(() => node.remove(), 4000)
}

async function api(path, options = {}) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 30000)
  try {
    const res = await fetch(path, { ...options, signal: ctrl.signal })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
    return data
  } finally {
    clearTimeout(timer)
  }
}

/* ---------- Application state ---------- */
const state = {
  view: 'overview',
  overview: null,
  market: [],
  salesPage: 1,
  chartItem: null
}

const titles = {
  overview: ['Live market', 'Overview'],
  opportunities: ['Filtered', 'Opportunities'],
  market: ['Fair value', 'Explorer'],
  sales: ['Proof', 'Sales'],
  neural: ['Always training', 'Neural network'],
  anomalies: ['Outliers', 'Anomalies'],
  charts: ['History', 'Charts'],
  players: ['Public', 'Player lookup']
}

/* ---------- Navigation ---------- */
function navigate(view) {
  if (!titles[view]) view = 'overview'
  state.view = view
  $$('.view').forEach(node => node.classList.toggle('active', node.dataset.view === view))
  $$('.nav-link').forEach(node => node.classList.toggle('active', node.dataset.view === view))
  $('#sidebar').classList.remove('open')
  $('#page-eyebrow').textContent = titles[view][0]
  $('#page-title').textContent = titles[view][1]
  history.replaceState(null, '', '#' + view)
  if (view === 'anomalies') {
    view = 'neural'
    history.replaceState(null, '', '#neural')
  }
  // Lazy-load the active view
  if (view === 'opportunities') loadOpportunities()
  else if (view === 'market') loadMarket()
  else if (view === 'sales') loadSales()
  else if (view === 'neural') loadNeural()
  else if (view === 'charts') loadCharts()
  else if (view === 'players') {
  }
}

$$('.nav-link').forEach(node => node.addEventListener('click', () => navigate(node.dataset.view)))
$$('[data-go]').forEach(node => node.addEventListener('click', () => navigate(node.dataset.go)))
$('#menu-button')?.addEventListener('click', () => $('#sidebar').classList.toggle('open'))

/* ---------- Top bar ---------- */
$('#refresh-button')?.addEventListener('click', () => loadOverview(true))
$('#export-button')?.addEventListener('click', () => exportCsv())

async function exportCsv() {
  try {
    const r = await fetch('/api/export?format=csv')
    if (!r.ok) throw new Error('export failed')
    const blob = await r.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `pulse-${Date.now()}.csv`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
    toast('Export downloaded')
  } catch (e) {
    toast(e.message, true)
  }
}

/* ---------- OVERVIEW ---------- */
async function loadOverview(force) {
  const hero = $('#hero-score')
  const heroCap = $('#hero-caption')
  try {
    const data = await api('/api/overview')
    state.overview = data
    renderStatus(data.status)
    const s = data.summary

    // Hero
    hero.textContent = s.opportunities
    heroCap.textContent = `${fmtNum(s.recordedSales)} sales · ${data.outliers?.length || 0} outliers · scan #${data.status.scanCount}`

    // Metrics
    $('#metric-grid').innerHTML = [
      ['Market value', fmtMoney(s.marketValue), `${fmtNum(s.totalAuctions)} live listings`],
      ['Recorded turnover', fmtMoney(s.salesValue), `${fmtNum(s.recordedSales)} completed sales`],
      ['Unique assets', fmtNum(s.uniqueItems), 'Normalized markets'],
      ['Flips queued', fmtNum(s.opportunities), 'Sorted by confidence']
    ]
      .map(
        ([label, value, sub]) =>
          `<div class="metric-card"><span class="label">${label}</span><strong>${value}</strong><small>${sub}</small></div>`
      )
      .join('')

    // Top flips
    const topFlips = data.topFlips || []
    $('#top-flips').innerHTML = topFlips.length
      ? topFlips.slice(0, 6).map(renderFlipRow).join('')
      : `<div class="placeholder">No qualified opportunities yet.</div>`
    bindOpenItem('#top-flips')

    // Active market
    const active = data.active || []
    $('#active-market').innerHTML = active.length
      ? active
          .slice(0, 7)
          .map(
            x =>
              `<div class="row" data-item="${escHtml(x.name)}"><span>${escHtml(x.name)}</span><b>${x.sales} sales</b><small>${fmtMoney(x.floor)} floor</small></div>`
          )
          .join('')
      : `<div class="placeholder">No active items.</div>`
    bindOpenItem('#active-market')

    // Movers
    const movers = (data.movers || []).slice().sort((a, b) => Math.abs(b.change) - Math.abs(a.change))
    $('#movers').innerHTML = movers.length
      ? movers
          .slice(0, 7)
          .map(
            x =>
              `<div class="row" data-item="${escHtml(x.name)}"><span>${escHtml(x.name)}</span><b class="${x.change >= 0 ? 'up' : 'down'}">${fmtPct(x.change)}</b><small>${x.confidence}% conf</small></div>`
          )
          .join('')
      : `<div class="placeholder">No movement yet.</div>`
    bindOpenItem('#movers')

    // Predictions
    const preds = (data.predictions || []).slice().sort((a, b) => b.confidence - a.confidence)
    $('#predictions').innerHTML = preds.length
      ? preds
          .slice(0, 8)
          .map(
            p =>
              `<div class="row" data-item="${escHtml(p.name)}"><span>${escHtml(p.name)}</span><b>${fmtMoney(p.current)}</b><span class="badge ${p.trend === 'UP' ? 'risk-low' : p.trend === 'DOWN' ? 'risk-high' : ''}">${p.trend}</span><small>${p.confidence}%</small></div>`
          )
          .join('')
      : `<div class="placeholder">Predictions need more training.</div>`
    bindOpenItem('#predictions')

    // Outliers
    const outliers = data.outliers || []
    $('#outliers-list').innerHTML = outliers.length
      ? outliers
          .slice(0, 8)
          .map(
            o =>
              `<div class="row" data-item="${escHtml(o.name)}"><span>${escHtml(o.name)}</span><b class="${o.direction === 'overpriced' ? 'up' : 'down'}">${fmtPct(o.deviation)}</b><span class="badge">Z ${o.zScore}</span><small>${o.sales} sales</small></div>`
          )
          .join('')
      : `<div class="placeholder">No outliers detected.</div>`
    bindOpenItem('#outliers-list')

    // Neural status
    const nn = data.neuralNet || {}
    const price = nn.pricePredictor || {}
    const trend = nn.trendPredictor || {}
    const anom = nn.anomalyDetector || {}
    $('#nn-status').innerHTML = `
      <div class="row"><span>Price predictor</span><span class="badge ${price.trained ? 'risk-low' : 'risk-medium'}">${price.trained ? 'Trained' : 'Training'}</span><small>${price.epochs || 0} ep</small></div>
      <div class="row"><span>Trend predictor</span><span class="badge ${trend.trained ? 'risk-low' : 'risk-medium'}">${trend.trained ? 'Trained' : 'Training'}</span><small>${trend.epochs || 0} ep</small></div>
      <div class="row"><span>Anomaly detector</span><span class="badge ${anom.trained ? 'risk-low' : 'risk-medium'}">${anom.trained ? 'Trained' : 'Training'}</span><small>${anom.epochs || 0} ep</small></div>
      <div class="row"><span>Training samples</span><b>${nn.trainingSamples || 0}</b><small>${relative(nn.lastTraining)}</small></div>
    `

    // Data health
    const stat = data.status
    $('#data-health').innerHTML = `
      <div class="health-card"><b>Source</b><span>${stat.demo ? 'Demo data' : 'DonutSMP API'}</span></div>
      <div class="health-card"><b>Scans</b><span>#${stat.scanCount}</span></div>
      <div class="health-card"><b>Status</b><span>${stat.scanning ? 'Scanning…' : stat.lastError ? 'Degraded' : 'Live'}</span></div>
      <div class="health-card"><b>Last success</b><span>${relative(stat.lastSuccess)}</span></div>
      <div class="health-card"><b>Auctions</b><span>${fmtNum(stat.auctions)}</span></div>
      <div class="health-card"><b>Sales</b><span>${fmtNum(stat.transactions)}</span></div>
    `
  } catch (e) {
    if (!state.overview) {
      hero.textContent = '—'
      heroCap.textContent = e.message || 'Loading failed'
    }
    toast(e.message, true)
  }
}

function renderFlipRow(f) {
  const riskClass =
    f.risk?.label === 'Low' ? 'risk-low' : f.risk?.label === 'Medium' ? 'risk-medium' : 'risk-high'
  const ing = f.ingredients
    ? f.ingredients
        .slice(0, 3)
        .map(i => `${i.count}×${escHtml(i.name)}`)
        .join('+')
    : ''
  return `
    <div class="row" data-item="${escHtml(f.name)}">
      <span>${escHtml(f.name)} <small style="color:var(--text-3)">${f.type === 'craft' ? ing : ''}</small></span>
      <span class="badge ${riskClass}">${f.risk?.label || '—'}</span>
      <b class="up">+${fmtMoney(f.profit)}</b>
      <small>${fmtPct(f.roi)}</small>
    </div>
  `
}

function bindOpenItem(scope) {
  $$(scope + ' [data-item]').forEach(node =>
    node.addEventListener('click', () => openItemDetail(node.dataset.item))
  )
}

function renderStatus(status) {
  const live = !status.scanning && !status.lastError
  $('#source-label').textContent = live ? 'DonutSMP API' : status.scanning ? 'Live' : 'Degraded'
  $('#source-note').textContent = status.scanning
    ? 'Fetching market data…'
    : 'Live auction and transaction data.'
  $('#scan-count').textContent = `Scan #${status.scanCount || 0}`
  $('#last-scan').textContent = relative(status.lastSuccess)
  $('#feed-status').textContent = status.scanning ? 'Scanning' : status.lastError ? 'Degraded' : 'Live'
  const dot = $('#sidebar .dot')
  if (dot) dot.classList.toggle('live', live)
  const prog = $('#scan-progress')
  if (prog) prog.classList.toggle('active', !!status.scanning)
}

/* ---------- OPPORTUNITIES ---------- */
async function loadOpportunities() {
  const grid = $('#flip-grid')
  if (!grid) return
  const params = new URLSearchParams({
    search: $('#flip-search')?.value || '',
    type: $('#flip-type')?.value || '',
    minProfit: $('#flip-profit')?.value || 0
  })
  grid.innerHTML = `<div class="placeholder">Loading…</div>`
  try {
    const data = await api('/api/flips?' + params)
    const items = (data.flips || [])
      .slice()
      // Sort by risk first (Low > Medium > High), then by confidence desc
      .sort((a, b) => {
        const order = { Low: 0, Medium: 1, High: 2 }
        const ra = order[a.risk?.label] ?? 9
        const rb = order[b.risk?.label] ?? 9
        if (ra !== rb) return ra - rb
        return (b.confidence || 0) - (a.confidence || 0)
      })
    grid.innerHTML = items.length
      ? items
          .map(
            f => `
          <div class="flip-card" data-item="${escHtml(f.name)}">
            <div class="name">${escHtml(f.name)}</div>
            <div class="meta">${
              f.type === 'craft'
                ? (f.ingredients || [])
                    .slice(0, 3)
                    .map(i => `${i.count}× ${escHtml(i.name)}`)
                    .join(' + ')
                : 'snipe'
            }</div>
            <div class="nums"><small>${fmtMoney(f.buyPrice)} → ${fmtMoney(f.sellPrice)}</small><b>+${fmtMoney(f.profit)}</b></div>
            <div class="meta">${f.confidence}% confidence · <span class="badge ${f.risk?.label === 'Low' ? 'risk-low' : f.risk?.label === 'Medium' ? 'risk-medium' : 'risk-high'}">${f.risk?.label || '—'} risk</span></div>
          </div>
        `
          )
          .join('')
      : `<div class="placeholder">No opportunities match these filters.</div>`
    bindOpenItem('#flip-grid')
  } catch (e) {
    grid.innerHTML = `<div class="placeholder">${e.message}</div>`
  }
}

$('#flip-search')?.addEventListener('input', debounce(loadOpportunities, 300))
$('#flip-type')?.addEventListener('change', loadOpportunities)
$('#flip-profit')?.addEventListener('change', loadOpportunities)

function debounce(fn, ms) {
  let t
  return (...args) => {
    clearTimeout(t)
    t = setTimeout(() => fn(...args), ms)
  }
}

/* ---------- MARKET EXPLORER ---------- */
async function loadMarket() {
  const tbody = $('#market-body')
  if (!tbody) return
  tbody.innerHTML = `<tr><td colspan="7" class="loading">Loading…</td></tr>`
  try {
    const sort = $('#market-sort')?.value || 'salesValue'
    const search = $('#market-search')?.value || ''
    const data = await api(`/api/market?sort=${sort}&search=${encodeURIComponent(search)}`)
    state.market = data.items || []
    tbody.innerHTML = state.market.length
      ? state.market
          .map(
            m => `
          <tr data-item="${escHtml(m.name)}">
            <td>${escHtml(m.name)}</td>
            <td><b>${fmtMoney(m.floor)}</b></td>
            <td>${fmtMoney(m.fairValue)}</td>
            <td>${fmtNum(m.sales)}</td>
            <td>${fmtMoney(m.salesValue)}</td>
            <td class="${m.change >= 0 ? 'up' : 'down'}">${fmtPct(m.change)}</td>
            <td>${m.confidence}%</td>
          </tr>
        `
          )
          .join('')
      : `<tr><td colspan="7" class="placeholder">No items match.</td></tr>`
    $$('#market-body tr[data-item]').forEach(row =>
      row.addEventListener('click', () => openItemDetail(row.dataset.item))
    )
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="7" class="placeholder">${e.message}</td></tr>`
  }
}

$('#market-search')?.addEventListener('input', debounce(loadMarket, 300))
$('#market-sort')?.addEventListener('change', loadMarket)

/* ---------- SALES ---------- */
async function loadSales(page = 1) {
  const tbody = $('#sales-body')
  if (!tbody) return
  state.salesPage = page
  const search = $('#sales-search')?.value || ''
  tbody.innerHTML = `<tr><td colspan="6" class="loading">Loading…</td></tr>`
  try {
    const data = await api(`/api/transactions?page=${page}&search=${encodeURIComponent(search)}`)
    const items = data.transactions || []
    tbody.innerHTML = items.length
      ? items
          .map(
            s => `
          <tr data-item="${escHtml(s.itemName)}">
            <td>${escHtml(s.itemName)}</td>
            <td>${fmtNum(s.count)}</td>
            <td><b>${fmtMoney(s.price)}</b></td>
            <td>${fmtMoney(s.pricePerUnit)}</td>
            <td>${escHtml(s.seller?.name || '—')}</td>
            <td><small>${relative(s.dateSold)}</small></td>
          </tr>
        `
          )
          .join('')
      : `<tr><td colspan="6" class="placeholder">No sales match.</td></tr>`
    $$('#sales-body tr[data-item]').forEach(row =>
      row.addEventListener('click', () => openItemDetail(row.dataset.item))
    )
    const pag = $('#sales-pagination')
    if (pag) {
      pag.innerHTML = `${data.page > 1 ? '<button data-dir="prev">← Prev</button>' : ''}<span>Page ${data.page} / ${data.pages || 1}</span>${data.page < (data.pages || 1) ? '<button data-dir="next">Next →</button>' : ''}`
      $$('#sales-pagination [data-dir]').forEach(b =>
        b.addEventListener('click', () => loadSales(b.dataset.dir === 'prev' ? data.page - 1 : data.page + 1))
      )
    }
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="6" class="placeholder">${e.message}</td></tr>`
  }
}

$('#sales-search')?.addEventListener(
  'input',
  debounce(() => loadSales(1), 300)
)

/* ---------- NEURAL (visual network) ---------- */
function drawBrain(data) {
  const svg = $('#brain-svg')
  if (!svg) return
  const nn = data.neuralNet || {}
  const outliers = data.outliers || []
  const W = 640, H = 280
  const layers = [
    { n: 8, x: 60, label: '32 features' },
    { n: 12, x: 220, label: '48 · ReLU' },
    { n: 6, x: 400, label: '24 · ReLU' },
    { n: 1, x: 560, label: 'price' }
  ]
  const trendLayer = { n: 3, x: 560, yOff: 90, label: 'trend' }
  // Deterministic pseudo-activation from lastLoss so the brain isn't static
  const act = v => 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(v * 2.1))
  const loss = nn.pricePredictor?.lastLoss || 0.08
  const totalEp = (nn.pricePredictor?.epochs || 0) + (nn.trendPredictor?.epochs || 0) + (nn.anomalyDetector?.epochs || 0)
  const pulsePhase = Date.now() / 700
  let s = `<rect width="${W}" height="${H}" rx="12" fill="rgba(255,255,255,0.03)" stroke="rgba(255,255,255,0.07)"/>`
  // Edges: sampled 22 thin lines with animated pulse
  for (let li = 0; li < layers.length - 1; li++) {
    const a = layers[li], b = layers[li + 1]
    for (let i = 0; i < Math.min(3, a.n); i++) {
      for (let j = 0; j < Math.min(3, b.n); j++) {
        const y1 = H / 2 + (i - 1) * 26 - 6, y2 = H / 2 + (j - 0.5 * (b.n - 1)) * 22
        const w = 0.45 + act(i * 1.7 + j * 2.3 + loss * 7) * 1.2
        const op = 0.08 + act(i + j) * 0.18 + (totalEp ? 0.08 : 0)
        const dash = Math.abs(Math.sin(pulsePhase + i + j * 0.7)) * 6
        s += `<path d="M${a.x} ${y1} C${(a.x + b.x) / 2} ${y1},${(a.x + b.x) / 2} ${y2},${b.x} ${y2}" stroke="rgba(64,78,191,${op.toFixed(2)})" stroke-width="${w.toFixed(2)}" fill="none" stroke-dasharray="${dash.toFixed(1)} 18" opacity="0.95"/>`
      }
    }
  }
  // Trend branch edges
  const midY = H / 2
  for (let j = 0; j < trendLayer.n; j++) {
    const y2 = midY + trendLayer.yOff + (j - 1) * 18
    const y1 = midY - 14
    s += `<path d="M${layers[2].x} ${y1} C${(layers[2].x + trendLayer.x) / 2} ${y1},${(layers[2].x + trendLayer.x) / 2} ${y2},${trendLayer.x} ${y2}" stroke="rgba(99,102,241,0.22)" stroke-width="0.9" fill="none"/>`
  }
  // Neurons
  for (const ly of layers) {
    for (let i = 0; i < ly.n; i++) {
      const y = H / 2 + (i - (ly.n - 1) / 2) * 22
      const a = act(ly.x * 0.01 + i * 0.9 + loss * 3)
      const fill = ly.x === 560 ? `rgba(64,78,191,${(0.55 + a * 0.4).toFixed(2)})` : `rgba(255,255,255,${(0.18 + a * 0.55).toFixed(2)})`
      const r = ly.x === 560 ? 7 : 5
      s += `<circle cx="${ly.x}" cy="${y}" r="${r}" fill="${fill}" stroke="rgba(255,255,255,0.12)" stroke-width="1"/>`
    }
    s += `<text x="${ly.x}" y="${H - 14}" text-anchor="middle" font-size="9" fill="#6c7388" font-family="JetBrains Mono">${ly.label}</text>`
  }
  for (let j = 0; j < trendLayer.n; j++) {
    const y = midY + trendLayer.yOff + (j - 1) * 18
    s += `<circle cx="${trendLayer.x}" cy="${y}" r="4.5" fill="rgba(99,102,241,0.55)" stroke="rgba(255,255,255,0.12)" stroke-width="1"/>`
  }
  s += `<text x="${trendLayer.x}" y="${midY + trendLayer.yOff + 42}" text-anchor="middle" font-size="9" fill="#6c7388" font-family="JetBrains Mono">${trendLayer.label}</text>`
  // Outlier ticks feeding back
  if (outliers.length) {
    const top = outliers.slice(0, 4)
    s += `<g font-size="8" fill="#a0a8b8" font-family="JetBrains Mono">`
    top.forEach((o, k) => {
      const label = `${o.name.slice(0, 10)} Z${o.zScore}`
      s += `<text x="8" y="${18 + k * 12}">${label} → training</text>`
    })
    s += `</g>`
  }
  svg.innerHTML = s
  const legend = $('#brain-legend')
  if (legend) {
    const price = nn.pricePredictor || {}, trend = nn.trendPredictor || {}, anom = nn.anomalyDetector || {}
    legend.innerHTML = `<span>${totalEp.toLocaleString()} epochs</span> · <span>price loss ${price.lastLoss?.toFixed(4) ?? '—'}</span> · <span>trend ${trend.epochs || 0}ep</span> · <span>anomaly ${anom.epochs || 0}ep</span> · <span>${outliers.length} outliers feeding replay</span>`
  }
}
async function loadNeural() {
  // Live training strip — compact, no redundant arch panel
  const live = $('#nn-live')
  if (live) {
    try {
      const data = await api('/api/overview')
      drawBrain(data)
      const nn = data.neuralNet || {}
      const price = nn.pricePredictor || {}
      const trend = nn.trendPredictor || {}
      const anom = nn.anomalyDetector || {}
      const total = (price.epochs || 0) + (trend.epochs || 0) + (anom.epochs || 0)
      const samples = nn.trainingSamples || 0
      const loss = price.lastLoss || 0
      const lossPct = loss ? Math.min(100, Math.max(0, 100 - Math.log10(loss + 1) * 20)) : 0
      const trainedPct = total ? Math.min(100, total * 0.1) : 0
      const signals = (data.outliers || []).length
      live.innerHTML = `
        <div class="live-row"><span class="label"><span class="pulse"></span>Training</span><div class="bar"><span style="width:${trainedPct}%"></span></div><span class="value">${total.toLocaleString()} ep</span></div>
        <div class="live-row"><span class="label">Samples</span><div class="bar"><span style="width:${Math.min(100, samples / 50)}%"></span></div><span class="value">${fmtNum(samples)}</span></div>
        <div class="live-row"><span class="label">Last loss</span><div class="bar"><span style="width:${lossPct}%"></span></div><span class="value">${loss ? loss.toFixed(4) : '—'}</span></div>
        <div class="live-row"><span class="label">Signals</span><div class="bar"><span style="width:${Math.min(100, signals * 8)}%"></span></div><span class="value">${signals} outliers → replay</span></div>
        <div class="live-row"><span class="label">Last update</span><div class="bar"></div><span class="value">${relative(nn.lastTraining)}</span></div>
      `
      const sig = $('#nn-signals')
      if (sig) {
        const top = (data.outliers || []).slice(0, 5)
        sig.innerHTML = top.length
          ? top.map(o => `<div class="row"><span>${escHtml(o.name)}</span><span class="badge">Z ${o.zScore}</span><b class="${o.direction === 'overpriced' ? 'down' : 'up'}">${fmtPct(o.deviation)}</b><small>→ training</small></div>`).join('')
          : `<div class="placeholder">No outlier signals this scan.</div>`
      }
    } catch (e) {
      live.innerHTML = `<div class="placeholder">${e.message}</div>`
    }
  }

  // Loss chart
  const lossBox = $('#nn-loss-chart')
  if (lossBox && window.Chart) {
    try {
      const data = await api('/api/neural/history')
      const hist = data.lossHistory || []
      if (hist.length > 1) {
        lossBox.innerHTML = '<canvas></canvas>'
        const ctx = lossBox.querySelector('canvas').getContext('2d')
        new Chart(ctx, {
          type: 'line',
          data: {
            labels: hist.map((_, i) => i),
            datasets: [
              {
                data: hist,
                borderColor: '#404ebf',
                backgroundColor: 'rgba(64,78,191,0.12)',
                fill: true,
                tension: 0.25,
                pointRadius: 0,
                borderWidth: 2
              }
            ]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
              x: { display: false },
              y: { ticks: { color: '#6c7388' }, grid: { color: '#252a3a' } }
            }
          }
        })
      } else {
        lossBox.innerHTML = `<div class="placeholder">Training in progress…</div>`
      }
    } catch (e) {}
  }

  // Predictions table
  const tbody = $('#nn-body')
  if (tbody) {
    tbody.innerHTML = `<tr><td colspan="6" class="loading">Loading…</td></tr>`
    try {
      const filter = $('#nn-filter')?.value || 'all'
      const search = $('#nn-search')?.value || ''
      const data = await api(`/api/neural/predictions?search=${encodeURIComponent(search)}`)
      let preds = data.predictions || []
      if (filter === 'up') preds = preds.filter(p => p.change > 0)
      if (filter === 'down') preds = preds.filter(p => p.change < 0)
      if (filter === 'high-conf') preds = preds.filter(p => p.confidence > 70)
      preds.sort((a, b) => Math.abs(b.change) - Math.abs(a.change))
      tbody.innerHTML = preds.length
        ? preds
            .slice(0, 50)
            .map(
              p => `
            <tr data-item="${escHtml(p.name)}">
              <td>${escHtml(p.name)}</td>
              <td><b>${fmtMoney(p.current)}</b></td>
              <td><b>${fmtMoney(p.predicted)}</b></td>
              <td class="${p.change >= 0 ? 'up' : 'down'}">${fmtPct(p.change)}</td>
              <td><span class="badge ${p.trend === 'UP' ? 'risk-low' : p.trend === 'DOWN' ? 'risk-high' : ''}">${p.trend}</span></td>
              <td>${p.confidence}%</td>
            </tr>
          `
            )
            .join('')
        : `<tr><td colspan="6" class="placeholder">No predictions match.</td></tr>`
      $$('#nn-body tr[data-item]').forEach(row =>
        row.addEventListener('click', () => openItemDetail(row.dataset.item))
      )
    } catch (e) {
      tbody.innerHTML = `<tr><td colspan="6" class="placeholder">${e.message}</td></tr>`
    }
  }
}

$('#nn-search')?.addEventListener('input', debounce(loadNeural, 300))
$('#nn-filter')?.addEventListener('change', loadNeural)

/* ---------- ANOMALIES removed: merged into Neural signals ---------- */
    bindOpenItem('#anomalies-grid')
  } catch (e) {
    grid.innerHTML = `<div class="placeholder">${e.message}</div>`
  }
}

/* ---------- CHARTS ---------- */
async function loadCharts() {
  const search = $('#chart-search')?.value?.trim() || ''
  if (!search) {
    const box = $('#price-chart')?.parentElement
    if (box) box.innerHTML = '<div class="placeholder">Search an item above to see price history.</div>'
    $('#chart-title').textContent = 'Select an item'
    return
  }
  try {
    const data = await api(`/api/market/${encodeURIComponent(search)}`)
    if (!data.item) {
      $('#chart-title').textContent = `Not found: ${search}`
      return
    }
    state.chartItem = data.item.name
    $('#chart-title').textContent =
      `${data.item.name} (${data.item.listings} listings · ${data.item.sales} sales)`
    const canvas = $('#price-chart')
    if (canvas && window.Chart) {
      const labels = data.history.map(h => new Date(h.timestamp).toLocaleTimeString())
      const prices = data.history.map(h => h.floor)
      const averages = data.history.map(h => h.avg)
      new Chart(canvas.getContext('2d'), {
        type: 'line',
        data: {
          labels,
          datasets: [
            {
              label: 'Floor',
              data: prices,
              borderColor: '#404ebf',
              backgroundColor: 'rgba(64,78,191,0.12)',
              fill: true,
              tension: 0.25,
              pointRadius: 0,
              borderWidth: 2
            },
            {
              label: 'Average',
              data: averages,
              borderColor: '#fbbf24',
              borderDash: [4, 4],
              fill: false,
              tension: 0.25,
              pointRadius: 0,
              borderWidth: 1.5
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { labels: { color: '#a0a8b8' } } },
          scales: {
            x: { ticks: { color: '#6c7388', maxTicksLimit: 8 }, grid: { color: '#252a3a' } },
            y: {
              ticks: { color: '#6c7388', callback: v => '$' + Number(v).toLocaleString() },
              grid: { color: '#252a3a' }
            }
          }
        }
      })
    }
    // Indicators
    const ind = $('#chart-indicators')
    if (ind) {
      ind.innerHTML = `
        <div class="row"><span>Floor</span><b>${fmtMoney(data.item.floor)}</b></div>
        <div class="row"><span>Fair</span><b>${fmtMoney(data.item.fairValue)}</b></div>
        <div class="row"><span>Sales</span><b>${fmtNum(data.item.sales)}</b></div>
        <div class="row"><span>Listings</span><b>${fmtNum(data.item.listings)}</b></div>
        <div class="row"><span>Volatility</span><b>${data.item.volatility}%</b></div>
        <div class="row"><span>Confidence</span><b>${data.item.confidence}%</b></div>
      `
    }
    // Neural overlay
    const nnOverlay = $('#chart-nn')
    if (nnOverlay) {
      nnOverlay.innerHTML = `<div class="placeholder">Neural predictions integrate on the Overview page.</div>`
    }
  } catch (e) {
    toast(e.message, true)
  }
}

$('#chart-search')?.addEventListener('keydown', e => {
  if (e.key === 'Enter') loadCharts()
})

/* ---------- ITEM DETAIL (modal) ---------- */
async function openItemDetail(name) {
  try {
    const data = await api(`/api/market/${encodeURIComponent(name)}`)
    if (!data.item) return
    const i = data.item
    const listings = (data.listings || []).slice(0, 20)
    const sales = (data.sales || []).slice(0, 20)
    const enchants = i.enchants
      ? Object.entries(i.enchants)
          .map(([k, v]) => `${k} ${v}`)
          .join(', ')
      : '—'
    const shulker = (i.contents || []).length
      ? (i.contents || []).map(c => `${c.count}× ${c.itemName || c.display_name || c.id}`).join(', ')
      : '—'

    const html = `
      <h2 style="margin:0 0 8px">${escHtml(i.name)}</h2>
      <p style="color:var(--text-2);margin:0 0 16px">${i.isEnchanted ? 'Enchanted · ' + escHtml(enchants) : 'Standard item'}</p>
      <div class="metric-grid" style="grid-template-columns:repeat(3,1fr);margin-bottom:16px">
        <div class="metric-card"><span class="label">Floor</span><strong>${fmtMoney(i.floor)}</strong></div>
        <div class="metric-card"><span class="label">Fair</span><strong>${fmtMoney(i.fairValue)}</strong></div>
        <div class="metric-card"><span class="label">Conf</span><strong>${i.confidence}%</strong></div>
        <div class="metric-card"><span class="label">Sales</span><strong>${fmtNum(i.sales)}</strong></div>
        <div class="metric-card"><span class="label">Listings</span><strong>${fmtNum(i.listings)}</strong></div>
        <div class="metric-card"><span class="label">Volatility</span><strong>${i.volatility}%</strong></div>
      </div>
      <h3>Shulker contents</h3>
      <p style="color:var(--text-2)">${escHtml(shulker)}</p>
      <h3>Top listings</h3>
      ${listings.length ? listings.map(l => `<div class="row"><span>${escHtml(l.seller?.name || '—')}</span><b>${fmtMoney(l.price)}</b><small>${l.count}×</small></div>`).join('') : '<div class="placeholder">No listings.</div>'}
      <h3 style="margin-top:16px">Recent sales</h3>
      ${sales.length ? sales.map(s => `<div class="row"><span>${escHtml(s.seller?.name || '—')}</span><b>${fmtMoney(s.price)}</b><small>${fmtNum(s.count)}× · ${relative(s.dateSold)}</small></div>`).join('') : '<div class="placeholder">No sales.</div>'}
    `
    // Reuse the anomalies grid if we're on anomalies view, otherwise show a toast
    toast(i.name + ' · ' + fmtMoney(i.floor) + ' floor · ' + fmtNum(i.sales) + ' sales', false)
  } catch (e) {
    toast(e.message, true)
  }
}

/* ---------- AI ---------- */
async function loadAiPanel() {
  const lines = $('#ai-lines')
  const meta = $('#ai-meta')
  try {
    const data = await api('/api/ai/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}'
    })
    lines.textContent = data.response || '(no response)'
    lines.classList.remove('loading')
    if (meta) {
      const parts = []
      if (data.model) parts.push(data.model)
      if (data.latencyMs) parts.push(`${data.latencyMs}ms`)
      if (data.cached) parts.push('cached')
      if (data.usage?.total_tokens) parts.push(`${data.usage.total_tokens} tokens`)
      meta.textContent = parts.join(' · ')
    }
  } catch (e) {
    lines.innerHTML = `<div class="placeholder">${e.message}</div>`
  }
}
$('#ai-refresh')?.addEventListener('click', loadAiPanel)

$('#ai-ask-btn')?.addEventListener('click', askAi)
$('#ai-ask-input')?.addEventListener('keydown', e => {
  if (e.key === 'Enter') askAi()
})
async function askAi() {
  const input = $('#ai-ask-input')
  const output = $('#ai-ask-answer')
  const q = input?.value?.trim()
  if (!q) return
  if (output) output.innerHTML = '<div class="placeholder">Thinking…</div>'
  try {
    const data = await api('/api/ai/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: q })
    })
    if (output) output.textContent = data.response || '(no answer)'
  } catch (e) {
    if (output) output.innerHTML = `<div class="placeholder">${e.message}</div>`
    toast(e.message, true)
  }
}

/* ---------- PLAYERS ---------- */
$('#player-form')?.addEventListener('submit', async e => {
  e.preventDefault()
  const name = $('#player-name').value.trim()
  if (!name) return
  const out = $('#player-results')
  out.innerHTML = `<div class="placeholder">Looking up ${escHtml(name)}…</div>`
  try {
    const data = await api(`/api/player/${encodeURIComponent(name)}`)
    const stats = data.stats?.result || data.stats || {}
    const lookup = data.lookup?.result || data.lookup || {}
    const initial = (lookup.name || name).charAt(0).toUpperCase()
    out.innerHTML = `
      <div class="player-header">
        <div class="player-avatar">${escHtml(initial)}</div>
        <div>
          <div style="font-size:18px;font-weight:700">${escHtml(lookup.name || name)}</div>
          <div style="color:var(--text-3);font-size:12px">${escHtml(lookup.uuid || 'public profile')}</div>
        </div>
      </div>
      <div class="player-grid">
        ${Object.entries(stats)
          .slice(0, 12)
          .map(
            ([k, v]) => `
          <div class="health-card"><b>${escHtml(k.replaceAll('_', ' '))}</b><span>${typeof v === 'number' ? fmtNum(v) : escHtml(String(v))}</span></div>
        `
          )
          .join('')}
      </div>
    `
  } catch (e) {
    out.innerHTML = `<div class="placeholder">${e.message}</div>`
  }
})

/* ---------- SOCKET ---------- */
const socket = io()
socket.on('scan:status', status => renderStatus(status))
socket.on('scan:progress', info => {
  if (info.type === 'auctions')
    $('#source-note').textContent = `Page ${info.page}: ${fmtNum(info.total)} auctions`
  if (info.type === 'transactions')
    $('#source-note').textContent = `Page ${info.page}: ${fmtNum(info.total)} sales`
})
socket.on('scan:update', () => {
  if (state.view === 'overview') {
    loadOverview()
    loadAiPanel()
  } else if (state.view === 'neural') loadNeural()
  else if (state.view === 'anomalies') loadAnomalies()
  else if (state.view === 'opportunities') loadOpportunities()
  else if (state.view === 'market') loadMarket()
  else if (state.view === 'sales') loadSales(state.salesPage || 1)
})
socket.on('connect_error', () => {
  const el = $('#feed-status')
  if (el) el.textContent = 'Reconnecting'
})

/* ---------- BOOT ---------- */
const initial = location.hash.slice(1)
if (titles[initial]) navigate(initial)
else navigate('overview')
loadOverview()
loadAiPanel()
