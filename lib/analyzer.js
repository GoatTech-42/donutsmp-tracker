const RECIPES = require('./recipes')
const { MarketPredictor } = require('./neural-network')
const storage = require('./storage')
const { TAX_RATE, normalize, percentile, iqrFilter, madFilter, ENCHANT_MULTIPLIERS } = require('./stats')

const round = value => Math.round(Number(value) || 0)

class AuctionAnalyzer {
  constructor() {
    this.snapshots = []
    this.priceHistory = new Map()
    this.maxSnapshots = 96
    this.predictor = new MarketPredictor()
    this.lastFlipDetection = null
    this.craftCache = new Map()
    this.loadPersistedData()
  }

  loadPersistedData() {
    try {
      const histories = storage.loadAllPriceHistories()
      for (const [name, history] of Object.entries(histories)) {
        this.priceHistory.set(name, history)
      }
      const modelData = storage.loadNeuralModel('marketPredictor')
      if (modelData) {
        this.predictor.load(modelData)
      }
      console.log(`[Analyzer] Loaded ${this.priceHistory.size} item histories from storage`)
    } catch (e) {
      console.warn('[Analyzer] Failed to load persisted data:', e.message)
    }
  }

  savePersistedData() {
    try {
      // RAM fix: don't serialize the full 30K auction rows into every snapshot.
      // `items` (per-name compact stats) is what we actually read back; raw rows
      // stay in server.js `state.auctions` for live API serving.
      const snapshot = {
        timestamp: Date.now(),
        items: {},
        auctions: [],
        transactions: [],
        opportunities: this.lastFlipDetection?.flips?.length || 0
      }
      for (const [name, history] of this.priceHistory) {
        const latest = history[history.length - 1]
        if (latest) {
          snapshot.items[name] = {
            floor: latest.floor,
            median: latest.median,
            avg: latest.avg,
            listings: latest.listings,
            sales: latest.sales,
            volume: latest.volume,
            salesValue: latest.salesValue,
            change: latest.change,
            volatility: latest.volatility,
            confidence: latest.confidence
          }
        }
      }
      storage.saveSnapshot(snapshot)
      storage.saveNeuralModel('marketPredictor', this.predictor.save())
      storage.cleanup(30)
    } catch (e) {
      console.warn('[Analyzer] Failed to save persisted data:', e.message)
    }
  }

  // Partial auctions arrive mid-scan (~every 20 pages) before transactions do.
  // Store them as priceHistory so trainPredictor can start bootstrapping even though
  // the full scan (auctions+transactions) hasn't landed yet. Rate-limited to one commit per ~20 pages.
  _lastPartialAt = 0
  storePartialAuctions(auctions) {
    if (Date.now() - this._lastPartialAt < 8000) return
    this._lastPartialAt = Date.now()
    const compact = this.snapshotFilteredStats(auctions)
    const ts = Date.now()
    for (const [name, s] of Object.entries(compact)) {
      const h = this.priceHistory.get(name) || []
      h.push({
        timestamp: ts,
        floor: s.floor,
        median: s.median,
        avg: s.avg,
        listings: s.listings,
        filteredListings: s.filteredListings,
        outliersDropped: s.outliersDropped
      })
      this.priceHistory.set(name, h.slice(-this.maxSnapshots))
    }
    // Best-effort training — uses whatever depth we have (need=1 on first pass, then 5)
    this.trainPredictor(auctions).catch?.(() => {})
    // Persist so a restart doesn't nuke the warmup window
    try {
      this.savePersistedData()
    } catch (_) {}
  }

  // Filtered snapshot: used for NN + intelligence; raw counts kept for UX.
  snapshotFilteredStats(auctions) {
    const grouped = this.group(auctions)
    const compact = {}
    for (const [name, listings] of grouped) {
      const raw = listings
        .map(row => row.pricePerUnit || row.price / row.count)
        .filter(v => Number.isFinite(v) && v > 0)
      if (!raw.length) continue
      const filtered = iqrFilter(raw)
      const med = percentile(
        [...filtered].sort((a, b) => a - b),
        0.5
      )
      compact[name] = {
        floor: round(Math.min(...filtered)),
        floorRaw: round(Math.min(...raw)),
        median: round(med),
        avg: round(filtered.reduce((a, b) => a + b, 0) / filtered.length),
        avgRaw: round(raw.reduce((a, b) => a + b, 0) / raw.length),
        listings: raw.length,
        filteredListings: filtered.length,
        outliersDropped: raw.length - filtered.length
      }
    }
    return compact
  }

  addSnapshot(auctions, transactions = []) {
    const timestamp = Date.now()
    const compact = this.snapshotFilteredStats(auctions)
    for (const [name, s] of Object.entries(compact)) {
      const history = this.priceHistory.get(name) || []
      // History always stores filtered floor/median/avg — that's the signal.
      history.push({
        timestamp,
        floor: s.floor,
        median: s.median,
        avg: s.avg,
        listings: s.listings,
        filteredListings: s.filteredListings,
        outliersDropped: s.outliersDropped
      })
      this.priceHistory.set(name, history.slice(-this.maxSnapshots))
    }
    this.snapshots.push({ timestamp, itemCount: auctions.length, items: compact })
    this.snapshots = this.snapshots.slice(-this.maxSnapshots)

    // Continuous training — async so the scan can finish and emit progress without blocking.
    this.trainPredictor(auctions).catch?.(() => {})

    this.lastAuctions = auctions
    this.lastTransactions = transactions
    this.savePersistedData()

    if (transactions.length > 0) {
      const snapshot = { timestamp, items: compact, transactions }
      try {
        storage.saveEnchantmentStats(snapshot)
      } catch (e) {
        console.warn('[Analyzer] Enchantment stats save failed:', e.message)
      }
    }
  }

  group(rows) {
    const groups = new Map()
    for (const row of rows || []) {
      const name = row.itemName || row.item?.display_name || row.itemId || row.item?.id
      if (!name || name === 'undefined') continue
      if (!groups.has(name)) groups.set(name, [])
      groups.get(name).push(row)
    }
    return groups
  }

  _training = false
  trainPredictor(auctions) {
    if (this._training) return { skipped: true, reason: 'already_training' }
    // Progressive thresholds: the very first scan has 0 history — bootstrap off the
    // live auction snapshot alone. After that, require a little depth, then the full
    // 15-long window once we've been running a while. This way the net starts
    // learning on boot and gets smarter every scan instead of sitting at 0 epochs forever.
    const total = this.priceHistory.size
    let need = 15
    if (total === 0) need = 1
    else if (this.predictor.pricePredictor.epochs === 0) need = 5
    let ready = 0
    for (const h of this.priceHistory.values()) if (h.length >= need) ready++
    const minReady = total === 0 ? 1 : this.predictor.pricePredictor.epochs === 0 ? 3 : 5
    if (ready < minReady) return { skipped: true, reason: 'not_enough_history', ready, need, minReady }
    this._training = true
    // Yield to the scan's I/O before crunching epochs so we don't stall progress emits.
    return new Promise(resolve => {
      setImmediate(() => {
        try {
          resolve(this.predictor.train(this.priceHistory, auctions))
        } finally {
          this._training = false
        }
      })
    })
  }

  getEnchantedValue(basePrice, enchants) {
    if (!enchants || Object.keys(enchants).length === 0) return basePrice
    let multiplier = 1.0
    for (const [ench, level] of Object.entries(enchants)) {
      const enchMultiplier = ENCHANT_MULTIPLIERS[ench]?.[level] || 1.0
      multiplier += (enchMultiplier - 1) * 0.7
    }
    return Math.round(basePrice * multiplier)
  }

  getShulkerValue(contents, priceHistory) {
    if (!contents || contents.length === 0) return 0
    let total = 0
    for (const item of contents) {
      const name = item.itemName || item.display_name || item.id?.replace('minecraft:', '')
      const history = this.priceHistory.get(name)
      const price = history && history.length > 0 ? history[history.length - 1].floor : item.pricePerUnit || 0
      total += price * (item.count || 1)
    }
    return total
  }

  // Enchantment-aware variant key: "Diamond Sword" + {sharpness:5, unbreaking:3}
  // -> "Diamond Sword [sharpness 5, unbreaking 3]"
  variantKey(name, enchants) {
    if (!enchants || Object.keys(enchants).length === 0) return name
    const sig = Object.entries(enchants)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k} ${v}`)
      .join(', ')
    return `${name} [${sig}]`
  }

  // Shulker enrichment: shulker_box listings often carry their contents payload.
  // We keep a separate name for those so plain shulkers don't pollute box-with-diamonds pricing.
  shulkerKey(row) {
    if (!row || !row.item) return row?.itemName || row?.itemId
    const contents = row.item.contents || row.contents
    if (!contents || !contents.length) return row.itemName || row.itemId
    return `${row.itemName || row.itemId} {${contents.length} items}`
  }

  // Enchantment-aware market: listings that share a name but differ in enchants
  // live under variant keys (e.g. "Diamond Sword [sharpness 5]") so a plain
  // $10K sword and a maxed one at $600K don't poison each other's median.
  // For non-enchanted items this is identical to before (variantKey == name).
  groupVariants(rows) {
    const out = new Map()
    for (const row of rows || []) {
      const name = row.itemName || row.item?.display_name || row.itemId || row.item?.id
      if (!name || name === 'undefined') continue
      const ench = row.enchants || row.item?.enchants || row.item?.enchantments || {}
      const enchObj = typeof ench === 'object' && !Array.isArray(ench) ? ench : {}
      // Normalize to {sharpness:5, ...} shape (API sometimes nests as {levels:{sharpness:5}})
      const flat = enchObj.levels || enchObj
      const key = this.variantKey(name, flat)
      if (!out.has(key)) out.set(key, [])
      out.get(key).push(row)
    }
    return out
  }

  // Filtered market: IQR-trimmed asks so one $1B shulker_box listing doesn't nuke stats.
  // fairValue is transaction-anchored when we have enough sales; otherwise trimmed ask median.
  buildMarket(auctions, transactions = []) {
    const listings = this.groupVariants(auctions)
    const sales = this.groupVariants(transactions)
    const names = new Set([...listings.keys(), ...sales.keys()])
    const market = []

    for (const name of names) {
      const active = listings.get(name) || []
      const sold = sales.get(name) || []
      const rawAsks = active.map(x => x.pricePerUnit || x.price / x.count).filter(x => x > 0)
      const salePrices = sold.map(x => x.pricePerUnit || x.price / x.count).filter(x => x > 0)
      const asks = iqrFilter(rawAsks)
      const filteredCount = rawAsks.length - asks.length

      // Transaction-anchored fairValue: need 5+ sales to trust it, otherwise use trimmed ask median.
      let fairValue, fairValueSource
      if (salePrices.length >= 5) {
        fairValue = percentile(
          [...salePrices].sort((a, b) => a - b),
          0.5
        )
        fairValueSource = 'sales_median'
      } else {
        fairValue = asks.length
          ? percentile(
              [...asks].sort((a, b) => a - b),
              0.5
            )
          : 0
        fairValueSource = 'asks_median_filtered'
      }

      const floor = asks.length ? Math.min(...asks) : 0
      const floorRaw = rawAsks.length ? Math.min(...rawAsks) : 0
      const q1 = asks.length
        ? percentile(
            [...asks].sort((a, b) => a - b),
            0.25
          )
        : 0
      const median = asks.length
        ? percentile(
            [...asks].sort((a, b) => a - b),
            0.5
          )
        : 0
      const avgFiltered = asks.length ? asks.reduce((a, b) => a + b, 0) / asks.length : 0
      const avgRaw = rawAsks.length ? rawAsks.reduce((a, b) => a + b, 0) / rawAsks.length : 0

      const history = this.priceHistory.get(name) || []
      const recent = history.slice(-3).map(x => x.floor)
      const older = history.slice(-8, -3).map(x => x.floor)
      const recentAvg = recent.length ? recent.reduce((a, b) => a + b, 0) / recent.length : floor
      const olderAvg = older.length ? older.reduce((a, b) => a + b, 0) / older.length : recentAvg
      const change = olderAvg > 0 ? ((recentAvg - olderAvg) / olderAvg) * 100 : 0

      // Volatility from filtered set (sales if enough, otherwise filtered asks).
      const deviations = salePrices.length >= 5 ? salePrices : asks
      const devAvg = deviations.length ? deviations.reduce((a, b) => a + b, 0) / deviations.length : 0
      const volatility = devAvg
        ? (Math.sqrt(deviations.reduce((sum, x) => sum + (x - devAvg) ** 2, 0) / deviations.length) /
            devAvg) *
          100
        : 0

      const prediction = this.predictor.predict(name, history, active)
      // Confidence is transaction-anchored: sales are the only proof of real price.
      // Without them, listings/history alone must NOT read as "100% certain" — that's
      // how troll asks (Smooth Stone @ 1.6B) leaked onto the board as confident flips.
      const confidence = Math.min(
        100,
        sold.length * 12 + asks.length * 1.5 + Math.min(20, history.length)
      )
      // Hard cap when no completed sales: even with 5000 listings and deep history,
      // an unanchored item tops out at 40% confidence.
      if (sold.length === 0 && confidence > 40) confidence = 40
      // Enchantment-aware summary: if this variant key carries enchants, surface a label
      // and the price premium over the base item's floor (when we know it).
      const bracketIdx = name.indexOf(' [')
      const baseName = bracketIdx > 0 ? name.slice(0, bracketIdx) : name
      const variantLabel = bracketIdx > 0 ? name.slice(bracketIdx + 2, -1) : null
      const isEnchanted = variantLabel !== null

      market.push({
        name,
        baseName,
        variantLabel,
        isEnchanted,
        floor: round(floor),
        floorRaw: round(floorRaw),
        q1: round(q1),
        median: round(median),
        fairValue: round(fairValue),
        fairValueSource,
        listings: rawAsks.length,
        filteredListings: asks.length,
        outliersDropped: filteredCount,
        sales: sold.length,
        volume: sold.reduce((sum, x) => sum + (x.count || 1), 0),
        salesValue: round(sold.reduce((sum, x) => sum + x.price, 0)),
        change: Math.round(change * 10) / 10,
        volatility: Math.round(volatility * 10) / 10,
        confidence,
        prediction,
        avgListingPrice: round(avgFiltered),
        avgListingPriceRaw: round(avgRaw)
      })
    }
    return market.sort((a, b) => b.salesValue - a.salesValue)
  }

  riskFor(item) {
    let score = 55
    score += Math.min(25, item.volatility * 0.7)
    score -= Math.min(25, item.sales * 1.5)
    score -= Math.min(12, item.listings)
    score += item.confidence < 35 ? 18 : 0
    if (item.prediction && item.prediction.confidence > 70) score -= 10
    score = Math.max(8, Math.min(95, round(score)))
    return { score, label: score < 34 ? 'Low' : score > 67 ? 'High' : 'Medium' }
  }

  detectFlips(auctions, transactions = []) {
    const market = this.buildMarket(auctions, transactions)
    const byName = new Map(market.map(item => [normalize(item.name), item]))
    const grouped = this.group(auctions)
    const flips = []

    for (const item of market) {
      if (!item.floor || item.listings < 2 || item.fairValue <= item.floor) continue
      // Confidence gate: thin markets with no sales proof look profitable only because the
      // ask spread is noise. Drop them so the board isn't full of $1 dirt flips.
      if (item.sales < 2 && item.confidence < 30) continue
      // No completed sales → unanchored. Never surface a snipe with zero transaction
      // proof regardless of how many listings exist (the 850% "flips" are troll asks).
      if (item.sales === 0) continue
      // Cheap-item troll gate: Dirt/Stone/Cobble at 150K is always a shulker or
      // enchanted outlier that IQR couldn't catch (too few listings of that name).
      // Cap snipe fairValue so generic cheap blocks can't claim 60K% ROI.
      // Also catch expensive-but-still-troll gaps like Chiseled Copper 9688→500M (51Kx).
      let snipeFair = item.fairValue
      if (item.sales < 3) {
        if (item.floor < 1000 && item.fairValue > 10000) snipeFair = Math.min(item.fairValue, item.floor * 10)
        if (item.fairValue > item.floor * 100) snipeFair = Math.min(item.fairValue, item.floor * 10)
      }
      if (snipeFair <= item.floor) continue
      const target = Math.max(item.floor, Math.min(snipeFair, item.q1 || snipeFair))
      const profit = target * (1 - TAX_RATE) - item.floor
      const roi = (profit / item.floor) * 100
      // Sanity cap: no legit snipe is >12x. With sales on the books a cluster of
      // troll asks (Smooth Stone @ 1.6B) still skews q1/fairValue — hard-skip those.
      if (roi > 1200) continue
      if (profit > 750 && roi >= 7) flips.push(this.flip('snipe', item, item.floor, target, profit, roi))
    }

    for (const recipe of RECIPES) {
      if (!recipe.result) continue
      const result = byName.get(normalize(recipe.result))
      if (!result?.floor) continue
      // Craft sell must be grounded in a completed sale: a single troll listing
      // (Mud Brick Stairs @ 804M) with 0 transactions makes every craft look infinite.
      if (result.sales === 0) continue
      if (result.sales < 3 && result.confidence < 30 && result.filteredListings < 5) continue
      let cost = 0
      const ingredients = []
      for (const ingredient of recipe.ingredients) {
        const source = byName.get(normalize(ingredient.item))
        if (!source?.floor) {
          cost = 0
          break
        }
        // Ingredient price must also be trusted
        if (source.sales < 1 && source.listings < 2) {
          cost = 0
          break
        }
        const subtotal = source.floor * ingredient.count
        cost += subtotal
        ingredients.push({
          name: ingredient.item,
          count: ingredient.count,
          unitPrice: source.floor,
          totalCost: round(subtotal)
        })
      }
      if (!cost) continue
      const output = recipe.resultCount || 1
      // Sell at the *fair* value (transaction-anchored when possible), not the raw floor/meme listing.
      const sellUnit = result.fairValue || result.floor
      // Hard troll cap mid-scan: when transactions haven't arrived yet, a single
      // troll listing (Stick @ 400K when planks cost 938) makes every craft
      // look infinite. Gate on ROI so 67Kx markups don't pollute the board.
      if (transactions.length === 0 && result.sales === 0) {
        const impliedRoi = cost > 0 ? ((sellUnit * output * (1 - TAX_RATE) - cost) / cost) * 100 : 0
        if (impliedRoi > 500) continue
        if (sellUnit > Math.max(cost * 50, 500000)) continue
      }
      const revenue = sellUnit * output * (1 - TAX_RATE)
      const profit = revenue - cost
      const roi = (profit / cost) * 100
      if (profit > 750 && roi >= 6)
        flips.push({
          ...this.flip('craft', result, cost, sellUnit * output, profit, roi),
          ingredients,
          resultCount: output,
          category: recipe.category
        })
    }

    // Enchantment flips: buy base item + books → enchanted → sell premium
    const enchantFlips = this.detectEnchantFlips(market, auctions)
    flips.push(...enchantFlips)

    return flips.sort((a, b) => b.score - a.score).slice(0, 250)
  }

  detectEnchantFlips(market, auctions) {
    const flips = []
    const byName = new Map(market.map(item => [normalize(item.name), item]))
    const ENCHANT_BOOKS = {
      sharpness: { 5: 28000, 4: 18000, 3: 10000 },
      efficiency: { 5: 22000, 4: 14000, 3: 8000 },
      protection: { 4: 16000, 3: 9000 },
      fortune: { 3: 20000, 2: 12000 },
      silk_touch: { 1: 15000 },
      unbreaking: { 3: 12000, 2: 7000 },
      mending: { 1: 18000 },
      power: { 5: 20000, 4: 13000 },
      looting: { 3: 14000 },
      fire_aspect: { 2: 10000 },
      smite: { 5: 18000 }
    }
    const COMMON_ENCHANTS = [
      'sharpness',
      'efficiency',
      'protection',
      'fortune',
      'silk_touch',
      'unbreaking',
      'mending',
      'power',
      'looting'
    ]
    const BASE_ITEMS = [
      'diamond_sword',
      'diamond_pickaxe',
      'diamond_axe',
      'diamond_helmet',
      'diamond_chestplate',
      'diamond_leggings',
      'diamond_boots',
      'netherite_sword',
      'netherite_pickaxe',
      'netherite_axe'
    ]

    for (const baseName of BASE_ITEMS) {
      const base = byName.get(baseName)
      if (!base || !base.floor) continue
      const basePrice = base.floor

      for (const enchName of COMMON_ENCHANTS) {
        const bookPrices = ENCHANT_BOOKS[enchName]
        if (!bookPrices) continue
        for (const [level, bookPrice] of Object.entries(bookPrices)) {
          const enchLevel = Number(level)
          const enchMultiplier = ENCHANT_MULTIPLIERS[enchName]?.[enchLevel] || 1
          const enchantedValue = basePrice * enchMultiplier * (1 - TAX_RATE)
          const totalCost = basePrice + bookPrice
          const profit = enchantedValue - totalCost
          const roi = (profit / totalCost) * 100

          if (profit > 1000 && roi >= 10) {
            const resultItem = byName.get(normalize(baseName))
            flips.push({
              ...this.flip(
                'enchant',
                resultItem || {
                  name: baseName,
                  floor: basePrice,
                  sales: 0,
                  listings: 1,
                  volatility: 0,
                  confidence: 20
                },
                totalCost,
                enchantedValue,
                profit,
                roi
              ),
              enchantment: `${enchName} ${enchLevel}`,
              bookCost: bookPrice,
              baseCost: basePrice,
              ingredients: [
                { name: baseName, count: 1, unitPrice: basePrice, totalCost: basePrice },
                { name: `${enchName} book`, count: 1, unitPrice: bookPrice, totalCost: bookPrice }
              ]
            })
          }
        }
      }
    }

    return flips
  }

  flip(type, item, buyPrice, sellPrice, profit, roi) {
    const risk = this.riskFor(item)
    const score = round((Math.max(0, profit) * Math.max(0, roi) * (100 - risk.score)) / 100)
    return {
      type,
      name: item.name,
      buyPrice: round(buyPrice),
      totalCost: round(buyPrice),
      sellPrice: round(sellPrice),
      afterTax: round(sellPrice * (1 - TAX_RATE)),
      profit: round(profit),
      roi: Math.round(roi * 10) / 10,
      risk,
      score,
      volume: item.sales,
      listings: item.listings,
      confidence: item.confidence,
      timestamp: Date.now()
    }
  }

  getIntelligence(auctions, transactions = []) {
    const market = this.buildMarket(auctions, transactions)
    const flips = this.detectFlips(auctions, transactions)
    const marketValue = auctions.reduce((sum, row) => sum + row.price, 0)
    const salesValue = transactions.reduce((sum, row) => sum + row.price, 0)
    const anomalies = this.predictor.detectAnomalies(this.priceHistory, auctions)
    const statisticalOutliers = this.predictor.detectStatisticalOutliers(this.priceHistory, auctions)
    const modelStats = this.predictor.getModelStats()

    // Enchantment premiums from storage
    const enchantPremiums = []
    try {
      const topEnchants = storage.getTopEnchants(10)
      for (const e of topEnchants) {
        enchantPremiums.push({
          enchantName: e.enchant_name,
          level: e.enchant_level,
          baseItem: 'various',
          valueMultiplier: e.avg_multiplier,
          premiumOverBase: e.avg_premium,
          totalSales: e.total_sales
        })
      }
    } catch (e) {}

    this.lastFlipDetection = { flips, timestamp: Date.now() }

    return {
      summary: {
        totalAuctions: auctions.length,
        uniqueItems: market.length,
        marketValue: round(marketValue),
        salesValue: round(salesValue),
        recordedSales: transactions.length,
        opportunities: flips.length
      },
      topFlips: flips.slice(0, 12),
      movers: market
        .filter(x => Math.abs(x.change) >= 1)
        .sort((a, b) => Math.abs(b.change) - Math.abs(a.change))
        .slice(0, 15),
      active: [...market].sort((a, b) => b.sales - a.sales).slice(0, 15),
      anomalies: anomalies.slice(0, 10),
      outliers: statisticalOutliers.slice(0, 20),
      predictions: market
        .filter(x => x.prediction)
        .slice(0, 20)
        .map(x => ({
          name: x.name,
          current: x.floor,
          predicted: x.prediction.predictedPrice,
          change: x.prediction.expectedChangePct,
          trend: x.prediction.trend,
          confidence: x.prediction.confidence
        })),
      neuralNet: modelStats,
      enchantPremiums,
      market: market.slice(0, 150),
      generatedAt: new Date().toISOString()
    }
  }

  calculatePortfolio(budget, auctions, transactions = [], riskTolerance = 55) {
    const candidates = this.detectFlips(auctions, transactions).filter(
      x => x.totalCost <= budget && x.risk.score <= riskTolerance
    )
    let remaining = budget
    const allocation = []
    for (const flip of candidates) {
      if (allocation.length >= 10) break
      const cap = budget * 0.25
      const copies = Math.max(
        0,
        Math.min(flip.listings || 1, 5, Math.floor(Math.min(remaining, cap) / flip.totalCost))
      )
      if (!copies) continue
      allocation.push({
        flip,
        copies,
        totalCost: flip.totalCost * copies,
        expectedProfit: flip.profit * copies
      })
      remaining -= flip.totalCost * copies
    }
    const totalCost = allocation.reduce((sum, x) => sum + x.totalCost, 0)
    const totalProfit = allocation.reduce((sum, x) => sum + x.expectedProfit, 0)
    return {
      budget,
      riskTolerance,
      allocation,
      totalCost,
      totalProfit,
      totalROI: totalCost ? Math.round((totalProfit / totalCost) * 1000) / 10 : 0,
      remaining,
      flipCount: allocation.length
    }
  }

  getHistory(name, limit = 100) {
    return (this.priceHistory.get(name) || []).slice(-limit)
  }

  getPriceHistory() {
    return this.priceHistory
  }

  get priceHistoryMap() {
    return this.priceHistory
  }
}

module.exports = AuctionAnalyzer
module.exports.normalize = normalize
module.exports.percentile = percentile
module.exports.iqrFilter = iqrFilter
module.exports.madFilter = madFilter
module.exports.ENCHANT_MULTIPLIERS = ENCHANT_MULTIPLIERS
