const state = {
  overview: null,
  flips: [],
  market: [],
  salesPage: 1,
  view: 'overview',
  nnPredictions: [],
  anomalies: [],
  itemName: null
}
const $ = selector => document.querySelector(selector)
const $$ = selector => [...document.querySelectorAll(selector)]
const escapeHtml = value =>
  String(value ?? '').replace(
    /[&<>'"]/g,
    char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]
  )
const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 })
const number = new Intl.NumberFormat('en-US')
const money = value => `$${compact.format(Number(value) || 0)}`
const relative = value => {
  if (!value) return '—'
  const seconds = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 1000))
  if (seconds < 60) return `${seconds}s ago`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`
  return `${Math.floor(seconds / 86400)}d ago`
}
function debounce(fn, delay = 250) {
  let timer
  return (...args) => {
    clearTimeout(timer)
    timer = setTimeout(() => fn(...args), delay)
  }
}
function skeletons(count = 3, lines = 3) {
  return Array.from(
    { length: count },
    () => `<div class="skeleton" style="height:${lines * 18}px;margin:8px 0;border-radius:6px"></div>`
  ).join('')
}

async function request(url, options) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 30000)
  try {
    const response = await fetch(url, { ...options, signal: controller.signal })
    const payload = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(payload.error || `Request failed (${response.status})`)
    return payload
  } finally {
    clearTimeout(timer)
  }
}
function toast(message, error = false) {
  const node = document.createElement('div')
  node.className = `toast${error ? ' error' : ''}`
  node.textContent = message
  $('#toast-region').append(node)
  setTimeout(() => node.remove(), 3800)
}
function empty(message) {
  return `<div class="empty-message">${escapeHtml(message)}</div>`
}

function sparkline(values, color = '#404ebf', w = 60, h = 20) {
  if (!values || values.length < 2) return ''
  const min = Math.min(...values),
    max = Math.max(...values),
    range = max - min || 1
  const points = values
    .map((v, i) => `${(i / (values.length - 1)) * w},${h - ((v - min) / range) * h}`)
    .join(' ')
  return `<svg width="${w}" height="${h}" style="vertical-align:middle"><polyline points="${points}" fill="none" stroke="${color}" stroke-width="1.5"/></svg>`
}

const titles = {
  overview: ['Pulse', 'Overview'],
  opportunities: ['Filtered', 'Opportunities'],
  market: ['Fair value', 'Explorer'],
  sales: ['Proof of price', 'Sales'],
  neural: ['Forecast', 'Neural'],
  anomalies: ['Anomaly', 'Anomalies'],
  charts: ['History', 'Charts'],
  item: ['Item', 'Item detail'],
  players: ['Public', 'Players']
}
function navigate(view) {
  state.view = view
  $$('.view').forEach(node => node.classList.toggle('active', node.id === `view-${view}`))
  $$('.nav-link').forEach(node => node.classList.toggle('active', node.dataset.view === view))
  $('#page-eyebrow').textContent = titles[view][0]
  $('#page-title').textContent = titles[view][1]
  $('#sidebar').classList.remove('open')
  history.replaceState(null, '', `#${view}`)
  if (view === 'opportunities') loadFlips()
  if (view === 'market') loadMarket()
  if (view === 'sales') loadSales()
  if (view === 'neural') loadPredictions()
  if (view === 'anomalies') loadAnomalies()
  if (view === 'charts') loadChartState()
  if (view === 'item') loadItemDetail()
  if (view === 'players') {
  }
}
$$('.nav-link').forEach(node => node.addEventListener('click', () => navigate(node.dataset.view)))
$$('[data-go]').forEach(node => node.addEventListener('click', () => navigate(node.dataset.go)))
$('#menu-button').addEventListener('click', () => $('#sidebar').classList.toggle('open'))

function renderStatus(status) {
  $('#source-label').textContent = 'Official API'
  $('#source-note').textContent = status.scanning
    ? 'Fetching market data…'
    : 'Live auction and transaction data.'
  $('#scan-count').textContent = `Scan #${status.scanCount}`
  $('#last-scan').textContent = relative(status.lastSuccess)
  $('#feed-status').textContent = status.scanning ? 'Scanning' : status.lastError ? 'Degraded' : 'Live'
  const progress = $('#scan-progress')
  if (progress) {
    if (status.scanning) {
      progress.style.display = 'block'
      progress.querySelector('.bar').style.animation = 'none'
      void progress.querySelector('.bar').offsetWidth
      progress.querySelector('.bar').style.animation = ''
    } else {
      progress.style.display = 'none'
    }
  }
}

let overviewFirstLoad = true
async function loadOverview() {
  const isLiveRefresh = !overviewFirstLoad
  try {
    const data = await request('/api/overview')
    state.overview = data
    state.nnPredictions = data.predictions || []
    renderStatus(data.status)
    const s = data.summary
    $('#hero-score').textContent = s.opportunities
    $('#hero-caption').textContent =
      `${s.recordedSales} completed sales · ${data.anomalies?.length || 0} anomalies · ${data.outliers?.length || 0} outliers`
    $('#nav-opportunities').textContent = s.opportunities
    $('#metric-grid').innerHTML = [
      ['Market value', money(s.marketValue), `${number.format(s.totalAuctions)} live listings`],
      ['Recorded turnover', money(s.salesValue), `${number.format(s.recordedSales)} completed sales`],
      ['Unique assets', number.format(s.uniqueItems), 'Normalized item markets'],
      [
        'Neural epochs',
        number.format(data.neuralNet?.pricePredictor?.epochs || 0),
        `Loss: ${data.neuralNet?.pricePredictor?.lastLoss?.toFixed(4) || 'N/A'}`
      ]
    ]
      .map(
        x =>
          `<div class="metric-card"><span class="label">${x[0]}</span><strong>${x[1]}</strong><small>${x[2]}</small></div>`
      )
      .join('')

    const midScanNoSales = data.summary.recordedSales === 0
    if (midScanNoSales) {
      $('#top-flips').classList.remove('loading-block')
      $('#top-flips').innerHTML =
        `<div class="empty-message" style="opacity:.8">Scan in progress — ${number.format(data.summary.totalAuctions || 0)} auctions so far, waiting on sales to anchor prices. Board updates automatically.</div>`
    } else {
      $('#top-flips').classList.remove('loading-block')
      $('#top-flips').innerHTML = data.topFlips.length
        ? data.topFlips
            .map(f => {
              const ingHtml = f.ingredients
                ? f.ingredients
                    .slice(0, 4)
                    .map(i => `${i.count}×${escapeHtml(i.name)}`)
                    .join('+')
                : ''
              return `<button class="opportunity-row text-button" data-open-flips="${escapeHtml(f.name)}" data-open-item="${escapeHtml(f.name)}"><div><div class="asset-name">${escapeHtml(f.name)}</div><span class="strategy">${f.type}${ingHtml ? ' · ' + ingHtml : ''} · ${f.risk.label} risk</span></div><div><div class="profit">+${money(f.profit)}</div><div class="roi">${f.roi}% ROI</div></div></button>`
            })
            .join('')
        : empty('No qualified opportunities yet.')
      $$('[data-open-flips]').forEach(node =>
        node.addEventListener('click', () => {
          navigate('opportunities')
          $('#flip-search').value = node.dataset.openFlips
          loadFlips()
        })
      )
      $$('[data-open-item]').forEach(node =>
        node.addEventListener('click', e => {
          e.stopPropagation()
          openItemDetail(node.dataset.openItem)
        })
      )
    }

    $('#active-market').classList.remove('loading-block')
    $('#active-market').innerHTML =
      data.active
        .slice(0, 7)
        .map(x => {
          const hist = (data.predictions || []).find(p => p.name === x.name)
          const spark = x._sparkline || []
          return `<div class="compact-row" style="cursor:pointer" data-open-item="${escapeHtml(x.name)}"><span>${escapeHtml(x.name)}</span><b>${x.sales} sales</b><small>${money(x.floor)} floor</small></div>`
        })
        .join('') || empty('Waiting for sales data.')
    $$('[data-open-item]', $('#active-market')).forEach(n =>
      n.addEventListener('click', () => openItemDetail(n.dataset.openItem))
    )

    $('#movers').classList.remove('loading-block')
    $('#movers').innerHTML =
      data.movers
        .slice(0, 7)
        .map(
          x =>
            `<div class="compact-row" style="cursor:pointer" data-open-item="${escapeHtml(x.name)}"><span>${escapeHtml(x.name)}</span><b class="${x.change >= 0 ? 'up' : 'down'}">${x.change > 0 ? '+' : ''}${x.change}%</b><small>${money(x.floor)} floor</small><small>${x.confidence}% conf</small></div>`
        )
        .join('') || empty('More scans are needed for momentum.')
    $$('[data-open-item]', $('#movers')).forEach(n =>
      n.addEventListener('click', () => openItemDetail(n.dataset.openItem))
    )

    if (midScanNoSales) {
      $('#data-health').innerHTML =
        `<div class="health-item"><b>Scanning auctions</b><span>${number.format(data.summary.totalAuctions || 0)} auctions so far · sales still loading</span></div><div class="health-item"><b>Neural net</b><span>${data.neuralNet?.pricePredictor?.trained ? `${data.neuralNet.pricePredictor.epochs} epochs` : 'Waiting for sales to train'}</span></div><div class="health-item"><b>${data.status.scanning ? 'Live scan in progress' : relative(data.status.lastSuccess)}</b><span>Prices anchor once sales arrive</span></div>`
    } else {
      $('#data-health').innerHTML =
        `<div class="health-item"><b>Official DonutSMP API</b><span>Authenticated live market feed</span></div><div class="health-item"><b>Neural net</b><span>${data.neuralNet?.pricePredictor?.trained ? `${data.neuralNet.pricePredictor.epochs} epochs` : 'Training…'}</span></div><div class="health-item"><b>${relative(data.status.lastSuccess)}</b><span>Last snapshot</span></div>`
    }

    $('#predictions').classList.remove('loading-block')
    $('#predictions').innerHTML =
      data.predictions
        ?.slice(0, 8)
        .map(
          p =>
            `<div class="compact-row" style="cursor:pointer" data-open-item="${escapeHtml(p.name)}"><span>${escapeHtml(p.name)}</span><b>${money(p.current)}</b><b class="${p.change >= 0 ? 'up' : 'down'}">${p.change > 0 ? '+' : ''}${p.change}%</b><span class="${p.trend === 'UP' ? 'up' : p.trend === 'DOWN' ? 'down' : ''}">${p.trend}</span><small>${p.confidence}%</small></div>`
        )
        .join('') || empty('Predictions need more training data.')
    $$('[data-open-item]', $('#predictions')).forEach(n =>
      n.addEventListener('click', () => openItemDetail(n.dataset.openItem))
    )

    $('#nn-status').classList.remove('loading-block')
    const nn = data.neuralNet
    $('#nn-status').innerHTML = `
      <div class="compact-row"><span>Price predictor</span><b>${nn?.pricePredictor?.trained ? 'Trained' : 'Training'}</b><small>${nn?.pricePredictor?.epochs || 0} epochs</small><small>${nn?.pricePredictor?.lastLoss ? 'Loss: ' + nn.pricePredictor.lastLoss.toFixed(4) : ''}</small></div>
      <div class="compact-row"><span>Trend predictor</span><b>${nn?.trendPredictor?.trained ? 'Trained' : 'Training'}</b><small>${nn?.trendPredictor?.epochs || 0} epochs</small></div>
      <div class="compact-row"><span>Anomaly detector</span><b>${nn?.anomalyDetector?.trained ? 'Trained' : 'Training'}</b><small>${nn?.anomalyDetector?.epochs || 0} epochs</small></div>
      <div class="compact-row"><span>Training samples</span><b>${nn?.trainingSamples || 0}</b><small>${relative(nn?.lastTraining)}</small></div>
    `
    renderTrainingChart(nn?.pricePredictor?.lossHistory || [])

    const outliersList = $('#outliers-list')
    if (outliersList) {
      if (!isLiveRefresh) outliersList.classList.remove('loading-block')
      const outliers = data.outliers || []
      outliersList.innerHTML = outliers.length
        ? outliers
            .slice(0, 10)
            .map(
              o =>
                `<div class="compact-row" style="cursor:pointer" data-open-item="${escapeHtml(o.name)}"><span>${escapeHtml(o.name)}</span><b class="${o.deviation >= 0 ? 'up' : 'down'}">${o.deviation > 0 ? '+' : ''}${o.deviation}%</b><small>Z: ${o.zScore}</small><small>${o.iqrOutlier ? 'IQR' : ''}</small><small>${o.direction}</small></div>`
            )
            .join('')
        : empty('No statistical outliers detected.')
      $$('[data-open-item]', outliersList).forEach(n =>
        n.addEventListener('click', () => openItemDetail(n.dataset.openItem))
      )
    }
    overviewFirstLoad = false
  } catch (error) {
    toast(error.message, true)
  }
}

function renderTrainingChart(lossHistory) {
  const container = $('#training-chart')
  if (!container) return
  const canvas = document.createElement('canvas')
  canvas.width = 400
  canvas.height = 100
  const ctx = canvas.getContext('2d')
  const data = lossHistory.slice(-100)
  if (data.length < 2) {
    container.innerHTML = '<span class="empty-message">No training data yet</span>'
    return
  }
  const min = Math.min(...data),
    max = Math.max(...data),
    range = max - min || 1
  ctx.strokeStyle = '#404ebf'
  ctx.lineWidth = 2
  ctx.beginPath()
  data.forEach((loss, i) => {
    const x = (i / (data.length - 1)) * 380 + 10
    const y = 90 - ((loss - min) / range) * 80
    if (i === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  })
  ctx.stroke()
  ctx.fillStyle = 'rgba(64,78,191,0.1)'
  ctx.lineTo(390, 95)
  ctx.lineTo(10, 95)
  ctx.closePath()
  ctx.fill()
  container.innerHTML = ''
  container.appendChild(canvas)
}

async function loadFlips() {
  const params = new URLSearchParams({
    search: $('#flip-search').value,
    type: $('#flip-type').value,
    minProfit: $('#flip-profit').value
  })
  try {
    const data = await request(`/api/flips?${params}`)
    state.flips = data.flips
    $('#flip-grid').innerHTML = data.flips.length
      ? data.flips
          .map(f => {
            const ingHtml = f.ingredients
              ? `<div class="flip-ingredients">${f.ingredients.map(i => `<span class="badge">${i.count}× ${escapeHtml(i.name)} @ ${money(i.unitPrice)}</span>`).join(' ')}</div>`
              : ''
            const enchBadge = f.enchantment
              ? ` <span class="badge" style="background:#1a1040;color:#a78bfa">${escapeHtml(f.enchantment)}</span>`
              : ''
            return `<article class="flip-card" data-open-item="${escapeHtml(f.name)}" style="cursor:pointer"><div class="flip-top"><div><h3>${escapeHtml(f.name)}</h3><div style="margin-top:7px"><span class="badge">${f.type}</span> <span class="badge risk-${f.risk.label.toLowerCase()}">${f.risk.label} risk</span>${f.resultCount > 1 ? ` <span class="badge">×${f.resultCount}</span>` : ''}${enchBadge}</div></div><div><div class="flip-profit">+${money(f.profit)}</div><div class="roi">${f.roi}% ROI</div></div></div>${ingHtml}<div class="flip-route"><div><small>Acquire</small><b>${money(f.buyPrice)}</b></div><i>→</i><div><small>After tax</small><b>${money(f.afterTax)}</b></div></div><div class="flip-meta"><span>${f.volume} sales</span><span>${f.confidence}% conf</span><span>Score ${compact.format(f.score)}</span></div></article>`
          })
          .join('')
      : empty('No opportunities match these filters.')
    $$('#flip-grid [data-open-item]').forEach(node =>
      node.addEventListener('click', e => {
        e.stopPropagation()
        openItemDetail(node.dataset.openItem)
      })
    )
  } catch (error) {
    toast(error.message, true)
  }
}

async function loadMarket() {
  const params = new URLSearchParams({
    search: $('#market-search').value,
    sort: $('#market-sort').value,
    limit: 100
  })
  try {
    const data = await request(`/api/market?${params}`)
    state.market = data.items
    $('#market-body').innerHTML =
      data.items
        .map(x => {
          const hist = x.prediction
            ? [x.floor, x.fairValue, x.prediction.predictedPrice]
            : [x.floor, x.fairValue]
          return `<tr style="cursor:pointer" data-open-item="${escapeHtml(x.name)}"><td class="asset">${escapeHtml(x.name)}</td><td class="mono">${money(x.floor)}</td><td class="mono">${money(x.fairValue)}</td><td>${x.sales}</td><td class="mono">${money(x.salesValue)}</td><td class="${x.change >= 0 ? 'up' : 'down'}">${x.change > 0 ? '+' : ''}${x.change}%</td><td><div class="confidence" title="${x.confidence}% confidence"><i style="width:${x.confidence}%"></i></div></td></tr>`
        })
        .join('') || `<tr><td colspan="7">No matching assets.</td></tr>`
    $$('#market-body tr').forEach(row =>
      row.addEventListener('click', () => {
        const name = row.dataset.openItem
        if (name) openItemDetail(name)
      })
    )
  } catch (error) {
    toast(error.message, true)
  }
}

async function loadSales(page = 1) {
  state.salesPage = page
  const params = new URLSearchParams({ search: $('#sales-search').value, page, limit: 40 })
  try {
    const data = await request(`/api/transactions?${params}`)
    $('#sales-body').innerHTML =
      data.transactions
        .map(
          x =>
            `<tr style="cursor:pointer" data-open-item="${escapeHtml(x.itemName)}"><td class="asset">${escapeHtml(x.itemName)}</td><td>${number.format(x.count)}×</td><td class="mono">${money(x.price)}</td><td class="mono">${money(x.pricePerUnit)}</td><td>${escapeHtml(x.seller?.name || '—')}</td><td>${relative(x.dateSold)}</td></tr>`
        )
        .join('') || `<tr><td colspan="6">No completed sales found.</td></tr>`
    $$('#sales-body tr').forEach(row =>
      row.addEventListener('click', () => {
        const name = row.dataset.openItem
        if (name) openItemDetail(name)
      })
    )
    $('#sales-pagination').innerHTML =
      `${data.page > 1 ? '<button data-page="prev">← Prev</button>' : ''}<span>Page ${data.page} / ${data.pages}</span>${data.page < data.pages ? '<button data-page="next">Next →</button>' : ''}`
    $$('[data-page]').forEach(node =>
      node.addEventListener('click', () =>
        loadSales(node.dataset.page === 'prev' ? data.page - 1 : data.page + 1)
      )
    )
  } catch (error) {
    toast(error.message, true)
  }
}

async function loadPredictions() {
  try {
    const data = await request('/api/neural/predictions')
    state.nnPredictions = data.predictions
    const filter = $('#nn-filter').value
    let filtered = data.predictions
    if (filter === 'up') filtered = filtered.filter(p => p.trend === 'UP')
    if (filter === 'down') filtered = filtered.filter(p => p.trend === 'DOWN')
    if (filter === 'high-conf') filtered = filtered.filter(p => p.confidence > 70)
    $('#nn-body').innerHTML =
      filtered
        .map(
          p =>
            `<tr style="cursor:pointer" data-open-item="${escapeHtml(p.name)}"><td class="asset">${escapeHtml(p.name)}</td><td class="mono">${money(p.current)}</td><td class="mono">${money(p.predicted)}</td><td class="${p.change >= 0 ? 'up' : 'down'}">${p.change > 0 ? '+' : ''}${p.change}%</td><td><span class="badge">${p.trend}</span></td><td><div class="confidence" title="${p.confidence}% confidence"><i style="width:${p.confidence}%"></i></div></td><td>${p.change > 2 ? 'BUY' : p.change < -2 ? 'SELL' : 'HOLD'}</td></tr>`
        )
        .join('') || `<tr><td colspan="7">No predictions match the filter.</td></tr>`
    $$('#nn-body tr').forEach(row =>
      row.addEventListener('click', () => {
        const name = row.dataset.openItem
        if (name) openItemDetail(name)
      })
    )
    try {
      const history = await request('/api/neural/history')
      renderTrainingChart(history.lossHistory || [])
    } catch (_) {}
  } catch (error) {
    toast(error.message, true)
  }
}

async function loadAnomalies() {
  try {
    const data = await request('/api/overview')
    state.anomalies = data.anomalies || []
    const outliers = data.outliers || []
    const all = [
      ...state.anomalies.map(a => ({ ...a, source: 'neural' })),
      ...outliers.map(o => ({
        item: o.name,
        anomalyScore: Math.min(99, Math.abs(o.zScore) * 30),
        currentPrice: o.price,
        avgPrice: o.avg,
        deviation: o.deviation,
        type: o.direction,
        listings: o.sales,
        source: 'statistical',
        zScore: o.zScore,
        iqrOutlier: o.iqrOutlier
      }))
    ].sort((a, b) => (b.anomalyScore || 0) - (a.anomalyScore || 0))
    $('#anomalies-grid').innerHTML = all.length
      ? all
          .map(
            a =>
              `<article class="flip-card" style="cursor:pointer" data-open-item="${escapeHtml(a.item)}"><div class="flip-top"><div><h3>${escapeHtml(a.item)}</h3><div style="margin-top:7px"><span class="badge">${a.type}</span> <span class="badge risk-high">${Math.round(a.anomalyScore)}% signal</span> <span class="badge">${a.source}</span></div></div><div><div class="flip-profit ${a.deviation > 0 ? '' : 'negative'}">${a.deviation > 0 ? '+' : ''}${a.deviation}%</div></div></div><div class="flip-route"><div><small>Current</small><b>${money(a.currentPrice)}</b></div><i>→</i><div><small>Avg (10)</small><b>${money(a.avgPrice)}</b></div></div><div class="flip-meta"><span>${a.listings} listings</span>${a.zScore != null ? `<span>Z: ${a.zScore}</span>` : ''}${a.iqrOutlier ? '<span>IQR flag</span>' : ''}</div></article>`
          )
          .join('')
      : empty('No anomalies detected. Market is stable.')
    $$('#anomalies-grid [data-open-item]').forEach(n =>
      n.addEventListener('click', e => {
        e.stopPropagation()
        openItemDetail(n.dataset.openItem)
      })
    )
  } catch (error) {
    toast(error.message, true)
  }
}

async function lookupPlayer(event) {
  event.preventDefault()
  const name = $('#player-name').value.trim()
  if (!name) return
  $('#player-results').textContent = 'Loading player profile…'
  try {
    const data = await request(`/api/player/${encodeURIComponent(name)}`)
    const profile = data.lookup?.result || data.lookup || {}
    const stats = data.stats?.result || data.stats || {}
    const safeStats = Object.entries(stats).filter(([key, value]) =>
      ['string', 'number'].includes(typeof value)
    )
    $('#player-results').innerHTML =
      `<div class="player-header"><div class="player-avatar">${escapeHtml((profile.name || name).slice(0, 1).toUpperCase())}</div><div><h3>${escapeHtml(profile.name || name)}</h3><p>${escapeHtml(profile.uuid || 'Public DonutSMP profile')}</p></div></div><div class="player-stat-grid">${safeStats.map(([key, value]) => `<div class="player-stat"><small>${escapeHtml(key.replaceAll('_', ' '))}</small><b>${typeof value === 'number' ? compact.format(value) : escapeHtml(String(value))}</b></div>`).join('')}</div>`
  } catch (error) {
    $('#player-results').innerHTML = empty(error.message)
    toast(error.message, true)
  }
}

function formatEnchants(enchants) {
  if (!enchants || Object.keys(enchants).length === 0)
    return '<span class="empty-message">No enchantments</span>'
  return Object.entries(enchants)
    .map(([k, v]) => `<span class="badge">${escapeHtml(k.replace(/_/g, ' '))} ${v}</span>`)
    .join(' ')
}
function formatShulkerContents(contents) {
  if (!contents || contents.length === 0)
    return '<span class="empty-message">Empty or not a shulker box</span>'
  return contents
    .map(
      c =>
        `<div class="compact-row"><span>${escapeHtml(c.itemName || c.display_name || c.id?.replace('minecraft:', '') || 'Unknown')}</span><b>${c.count}×</b><small>${money(c.pricePerUnit || 0)}/ea</small></div>`
    )
    .join('')
}

let priceChart = null,
  itemChart = null

async function loadChartState() {
  const search = $('#chart-search').value.trim()
  if (!search) {
    $('#chart-title').textContent = 'Select an item'
    if (priceChart) {
      priceChart.destroy()
      priceChart = null
    }
    $('#chart-indicators').innerHTML = ''
    $('#chart-nn').innerHTML = ''
    return
  }
  try {
    const data = await request(`/api/market/${encodeURIComponent(search)}`)
    if (!data.item) throw new Error('Item not found')
    renderPriceChart(data)
    $('#chart-search').value = data.item.name
  } catch (error) {
    toast(error.message, true)
  }
}

function renderPriceChart(data) {
  const ctx = $('#price-chart').getContext('2d')
  const history = data.history || []
  if (history.length < 2) {
    $('#chart-title').textContent = `${escapeHtml(data.item.name)} — Insufficient history`
    return
  }
  $('#chart-title').textContent = `${escapeHtml(data.item.name)} — ${history.length} data points`
  const labels = history.map(h => new Date(h.timestamp).toLocaleTimeString())
  const prices = history.map(h => h.floor)
  const avgPrices = history.map(h => h.avg || h.floor)
  if (priceChart) priceChart.destroy()
  priceChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Floor',
          data: prices,
          borderColor: '#404ebf',
          fill: true,
          backgroundColor: 'rgba(64,78,191,0.08)',
          tension: 0.2,
          pointRadius: 0
        },
        {
          label: 'Avg',
          data: avgPrices,
          borderColor: '#22c55e',
          fill: false,
          tension: 0.2,
          pointRadius: 0,
          borderDash: [5, 5]
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { labels: { color: '#8e96a5' } } },
      scales: {
        x: { ticks: { color: '#697181', maxTicksLimit: 12 }, grid: { color: '#1c2030' } },
        y: { ticks: { color: '#697181', callback: v => money(v) }, grid: { color: '#1c2030' } }
      }
    }
  })
  const item = data.item
  $('#chart-indicators').innerHTML = `
    <div class="compact-row"><span>Floor</span><b>${money(item.floor)}</b><small>${item.listings} listings</small></div>
    <div class="compact-row"><span>Fair value</span><b>${money(item.fairValue)}</b><small>${item.avgListingPrice ? money(item.avgListingPrice) : '—'} avg</small></div>
    <div class="compact-row"><span>24h change</span><b class="${item.change >= 0 ? 'up' : 'down'}">${item.change > 0 ? '+' : ''}${item.change}%</b><small>${item.sales} sales</small></div>
    <div class="compact-row"><span>Volatility</span><b>${item.volatility}%</b><small>${item.confidence}% confidence</small></div>
    <div class="compact-row"><span>Volume</span><b>${compact.format(item.volume)}</b><small>${money(item.salesValue)} turnover</small></div>
  `
  if (state.nnPredictions) {
    const pred = state.nnPredictions.find(p => p.name.toLowerCase() === data.item.name.toLowerCase())
    $('#chart-nn').innerHTML = pred
      ? `
      <div class="compact-row"><span>Predicted (24h)</span><b>${money(pred.predicted)}</b><small>${pred.change > 0 ? '+' : ''}${pred.change}%</small></div>
      <div class="compact-row"><span>Trend</span><b><span class="badge">${pred.trend}</span></b><small>${pred.confidence}% confidence</small></div>
    `
      : '<div class="empty-message">No neural prediction for this item</div>'
  }
}

async function loadItemDetail() {
  const itemName = state.itemName
  if (!itemName) {
    $('#item-title').textContent = 'Item detail'
    $('#item-summary').innerHTML = empty('Click an item in Market explorer or Opportunities')
    return
  }
  try {
    const data = await request(`/api/market/${encodeURIComponent(itemName)}`)
    if (!data.item) throw new Error('Item not found')
    renderItemDetail(data)
  } catch (error) {
    $('#item-summary').innerHTML = empty(error.message)
  }
}

function renderItemDetail(data) {
  const item = data.item
  $('#item-title').textContent = escapeHtml(item.name)
  $('#item-summary').innerHTML = `
    <div class="compact-row"><span>Floor price</span><b>${money(item.floor)}</b><small>${item.listings} listings</small></div>
    <div class="compact-row"><span>Fair value</span><b>${money(item.fairValue)}</b><small>Median realized sales</small></div>
    <div class="compact-row"><span>24h momentum</span><b class="${item.change >= 0 ? 'up' : 'down'}">${item.change > 0 ? '+' : ''}${item.change}%</b><small>${item.volatility}% volatility</small></div>
    <div class="compact-row"><span>Confidence</span><b>${item.confidence}%</b><small>Based on ${item.sales} sales, ${item.listings} listings</small></div>
    <div class="compact-row"><span>Volume</span><b>${compact.format(item.volume)}</b><small>${money(item.salesValue)} turnover</small></div>
  `
  $('#item-listings').innerHTML = data.listings?.length
    ? data.listings
        .map(
          l =>
            `<div class="compact-row"><span>${escapeHtml(l.seller?.name || '—')}</span><b>${money(l.price)}</b><small>${money(l.pricePerUnit)}/unit</small><small>${l.count}×</small></div>`
        )
        .join('')
    : empty('No active listings')
  $('#item-sales').innerHTML = data.sales?.length
    ? data.sales
        .map(
          s =>
            `<div class="compact-row"><span>${escapeHtml(s.seller?.name || '—')}</span><b>${money(s.price)}</b><small>${money(s.pricePerUnit)}/unit</small><small>${relative(s.dateSold)}</small></div>`
        )
        .join('')
    : empty('No recent sales')
  const enchants = item.enchants || data.listings?.[0]?.enchants || data.sales?.[0]?.enchants || {}
  $('#item-enchants').innerHTML = formatEnchants(enchants)
  const contents = item.contents || data.listings?.[0]?.contents || data.sales?.[0]?.contents || []
  $('#item-shulker').innerHTML = formatShulkerContents(contents)
  const ctx = $('#item-chart').getContext('2d')
  const history = data.history || []
  if (history.length >= 2 && ctx) {
    const labels = history.map(h => new Date(h.timestamp).toLocaleTimeString())
    const prices = history.map(h => h.floor)
    const avgs = history.map(h => h.avg || h.floor)
    if (itemChart) itemChart.destroy()
    itemChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'Floor',
            data: prices,
            borderColor: '#404ebf',
            fill: true,
            backgroundColor: 'rgba(64,78,191,0.08)',
            tension: 0.2,
            pointRadius: 0
          },
          {
            label: 'Avg',
            data: avgs,
            borderColor: '#22c55e',
            fill: false,
            tension: 0.2,
            borderDash: [5, 5],
            pointRadius: 0
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { labels: { color: '#8e96a5' } } },
        scales: {
          x: { ticks: { color: '#697181', maxTicksLimit: 10 }, grid: { color: '#1c2030' } },
          y: { ticks: { color: '#697181', callback: v => money(v) }, grid: { color: '#1c2030' } }
        }
      }
    })
  }
}

function openItemDetail(name) {
  state.itemName = name
  navigate('item')
  setTimeout(() => loadItemDetail(), 50)
}

$('#flip-search').addEventListener('input', debounce(loadFlips))
$('#flip-type').addEventListener('change', loadFlips)
$('#flip-profit').addEventListener('change', loadFlips)
$('#market-search').addEventListener('input', debounce(loadMarket))
$('#market-sort').addEventListener('change', loadMarket)
$('#sales-search').addEventListener(
  'input',
  debounce(() => loadSales(1))
)
$('#nn-filter').addEventListener('change', loadPredictions)
$('#nn-search').addEventListener('input', debounce(loadPredictions))
$('#player-form').addEventListener('submit', lookupPlayer)
$('#chart-search').addEventListener('keydown', e => {
  if (e.key === 'Enter') loadChartState()
})
async function loadAiPanel(force = false) {
  const lines = document.getElementById('ai-lines')
  const meta = document.getElementById('ai-meta')
  if (!lines) return
  lines.textContent = 'Asking analyst…'
  if (meta) meta.textContent = ''
  try {
    const data = await request('/api/ai/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}'
    })
    lines.textContent = data.response || '(no response)'
    lines.classList.remove('loading-block')
    if (meta) {
      const parts = []
      if (data.model) parts.push(data.model)
      if (data.latencyMs != null) parts.push(`${data.latencyMs}ms`)
      if (data.cached) parts.push(`cached ${Math.round((data.cachedAgeMs || 0) / 1000)}s ago`)
      if (data.usage) parts.push(`${data.usage.total_tokens || ''} tokens`)
      meta.textContent = parts.filter(Boolean).join(' · ')
    }
  } catch (e) {
    lines.textContent = e.message.includes('503')
      ? 'AI not configured — set GROQ_API_KEY to enable analyst.'
      : `Analyst unavailable: ${e.message}`
    lines.classList.remove('loading-block')
  }
}
async function askAi() {
  const input = document.getElementById('ai-ask-input')
  const out = document.getElementById('ai-ask-answer')
  const q = input?.value?.trim()
  if (!q) return
  if (out) out.textContent = 'Thinking…'
  try {
    const data = await request('/api/ai/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: q })
    })
    if (out) out.textContent = data.response || '(no answer)'
  } catch (e) {
    if (out) out.textContent = `Error: ${e.message}`
    toast(e.message, true)
  }
}

$('#refresh-button').addEventListener('click', async () => {
  const btn = $('#refresh-button')
  btn.disabled = true
  btn.textContent = '⟳ Scanning…'
  try {
    await request('/api/refresh', { method: 'POST' })
    toast('Scan triggered — feed will update shortly')
  } catch (error) {
    toast(error.message, true)
  } finally {
    btn.disabled = false
    btn.textContent = '↻ Refresh feed'
  }
})
// AI panel wiring (Overview)
document.getElementById('ai-refresh')?.addEventListener('click', () => loadAiPanel(true))
document.getElementById('ai-ask-btn')?.addEventListener('click', askAi)
document.getElementById('ai-ask-input')?.addEventListener('keydown', e => {
  if (e.key === 'Enter') askAi()
})
$('#export-button').addEventListener('click', async () => {
  try {
    const data = await request('/api/export?format=json')
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `pulse-export-${Date.now()}.json`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    toast('Export downloaded')
  } catch (error) {
    toast(error.message, true)
  }
})

const socket = io()
socket.on('scan:status', renderStatus)
socket.on('scan:progress', info => {
  $('#feed-status').textContent = `Scanning ${info.type}…`
  if (info.type === 'auctions')
    $('#source-note').textContent = `Page ${info.page}: ${compact.format(info.total)} auctions`
  if (info.type === 'transactions')
    $('#source-note').textContent = `Page ${info.page}: ${compact.format(info.total)} sales`
})
socket.on('scan:update', status => {
  renderStatus(status)
  if (state.view === 'overview') {
    loadOverview()
    loadAiPanel()
  } else if (state.view === 'neural') loadPredictions()
  else if (state.view === 'anomalies') loadAnomalies()
})
socket.on('connect_error', () => {
  $('#feed-status').textContent = 'Reconnecting'
})

const initial = location.hash.slice(1)
if (titles[initial]) navigate(initial)
else navigate('overview')
loadOverview()
loadAiPanel()
