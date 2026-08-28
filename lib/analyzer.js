const RECIPES = require('./recipes');
const { MarketPredictor } = require('./neural-network');
const storage = require('./storage');

const TAX_RATE = Number(process.env.AUCTION_TAX_RATE || 0.05);
const normalize = value => String(value || '').toLowerCase().replace(/§[0-9a-fk-or]/gi, '').replace(/[^a-z0-9]/g, '');
const round = value => Math.round(Number(value) || 0);
const percentile = (values, p) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = (sorted.length - 1) * p;
  const lower = Math.floor(index);
  return sorted[lower] + (sorted[Math.ceil(index)] - sorted[lower]) * (index - lower);
};

const ENCHANT_MULTIPLIERS = {
  protection: { 1: 1.05, 2: 1.12, 3: 1.2, 4: 1.3 },
  fire_protection: { 1: 1.03, 2: 1.08, 3: 1.15, 4: 1.25 },
  feather_falling: { 1: 1.02, 2: 1.05, 3: 1.1, 4: 1.18 },
  blast_protection: { 1: 1.03, 2: 1.08, 3: 1.15, 4: 1.25 },
  projectile_protection: { 1: 1.03, 2: 1.08, 3: 1.15, 4: 1.25 },
  sharpness: { 1: 1.08, 2: 1.18, 3: 1.3, 4: 1.45, 5: 1.65 },
  smite: { 1: 1.05, 2: 1.12, 3: 1.2, 4: 1.3, 5: 1.45 },
  bane_of_arthropods: { 1: 1.03, 2: 1.08, 3: 1.12, 4: 1.18, 5: 1.25 },
  knockback: { 1: 1.02, 2: 1.06 },
  fire_aspect: { 1: 1.05, 2: 1.12 },
  looting: { 1: 1.08, 2: 1.18, 3: 1.3 },
  efficiency: { 1: 1.05, 2: 1.12, 3: 1.2, 4: 1.3, 5: 1.45 },
  silk_touch: { 1: 1.15 },
  unbreaking: { 1: 1.08, 2: 1.18, 3: 1.3 },
  fortune: { 1: 1.1, 2: 1.22, 3: 1.4 },
  power: { 1: 1.08, 2: 1.18, 3: 1.3, 4: 1.45, 5: 1.6 },
  punch: { 1: 1.03, 2: 1.08 },
  flame: { 1: 1.1 },
  infinity: { 1: 1.15 },
  luck_of_the_sea: { 1: 1.05, 2: 1.12, 3: 1.2 },
  lure: { 1: 1.03, 2: 1.08, 3: 1.12 },
  mending: { 1: 1.25 },
  binding_curse: { 1: 0.95 },
  vanishing_curse: { 1: 0.95 },
  thorns: { 1: 1.05, 2: 1.12, 3: 1.2 },
  depth_strider: { 1: 1.03, 2: 1.08, 3: 1.12 },
  frost_walker: { 1: 1.03, 2: 1.08 },
  soul_speed: { 1: 1.03, 2: 1.08, 3: 1.12 },
  swift_sneak: { 1: 1.08, 2: 1.15, 3: 1.25 }
};

class AuctionAnalyzer {
  constructor() {
    this.snapshots = [];
    this.priceHistory = new Map();
    this.maxSnapshots = 288;
    this.predictor = new MarketPredictor();
    this.lastFlipDetection = null;
    this.craftCache = new Map();
    this.loadPersistedData();
  }

  loadPersistedData() {
    try {
      const histories = storage.loadAllPriceHistories();
      for (const [name, history] of Object.entries(histories)) {
        this.priceHistory.set(name, history);
      }
      const modelData = storage.loadNeuralModel('marketPredictor');
      if (modelData) {
        this.predictor.load(modelData);
      }
      console.log(`[Analyzer] Loaded ${this.priceHistory.size} item histories from storage`);
    } catch (e) {
      console.warn('[Analyzer] Failed to load persisted data:', e.message);
    }
  }

  savePersistedData() {
    try {
      const snapshot = {
        timestamp: Date.now(),
        items: {},
        auctions: this.lastAuctions || [],
        transactions: this.lastTransactions || [],
        opportunities: this.lastFlipDetection?.flips?.length || 0
      };
      for (const [name, history] of this.priceHistory) {
        const latest = history[history.length - 1];
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
          };
        }
      }
      storage.saveSnapshot(snapshot);
      storage.saveNeuralModel('marketPredictor', this.predictor.save());
      storage.cleanup(30);
    } catch (e) {
      console.warn('[Analyzer] Failed to save persisted data:', e.message);
    }
  }

  addSnapshot(auctions, transactions = []) {
    const timestamp = Date.now();
    const grouped = this.group(auctions);
    const compact = {};
    for (const [name, listings] of grouped) {
      const prices = listings.map(row => row.pricePerUnit || row.price / row.count).filter(Number.isFinite);
      if (!prices.length) continue;
      compact[name] = { floor: round(Math.min(...prices)), median: round(percentile(prices, .5)), listings: prices.length, avg: round(prices.reduce((a,b)=>a+b,0)/prices.length) };
      const history = this.priceHistory.get(name) || [];
      history.push({ timestamp, ...compact[name] });
      this.priceHistory.set(name, history.slice(-this.maxSnapshots));
    }
    this.snapshots.push({ timestamp, itemCount: auctions.length, items: compact });
    this.snapshots = this.snapshots.slice(-this.maxSnapshots);
    
    // Continuous training - train on every scan with new data
    this.trainPredictor(auctions);
    
    this.lastAuctions = auctions;
    this.lastTransactions = transactions;
    this.savePersistedData();
    
    if (transactions.length > 0) {
      const snapshot = { timestamp, items: compact, transactions };
      try {
        storage.saveEnchantmentStats(snapshot);
      } catch (e) {
        console.warn('[Analyzer] Enchantment stats save failed:', e.message);
      }
    }
  }

  group(rows) {
    const groups = new Map();
    for (const row of rows || []) {
      const name = row.itemName || row.item?.display_name || row.itemId || row.item?.id;
      if (!name) continue;
      if (!groups.has(name)) groups.set(name, []);
      groups.get(name).push(row);
    }
    return groups;
  }

  trainPredictor(auctions) {
    const result = this.predictor.train(this.priceHistory, auctions);
    return result;
  }

  getEnchantedValue(basePrice, enchants) {
    if (!enchants || Object.keys(enchants).length === 0) return basePrice;
    let multiplier = 1.0;
    for (const [ench, level] of Object.entries(enchants)) {
      const enchMultiplier = ENCHANT_MULTIPLIERS[ench]?.[level] || 1.0;
      multiplier += (enchMultiplier - 1) * 0.7;
    }
    return Math.round(basePrice * multiplier);
  }

  getShulkerValue(contents, priceHistory) {
    if (!contents || contents.length === 0) return 0;
    let total = 0;
    for (const item of contents) {
      const name = item.itemName || item.display_name || item.id?.replace('minecraft:', '');
      const history = this.priceHistory.get(name);
      const price = history && history.length > 0 ? history[history.length - 1].floor : (item.pricePerUnit || 0);
      total += price * (item.count || 1);
    }
    return total;
  }

  buildMarket(auctions, transactions = []) {
    const listings = this.group(auctions);
    const sales = this.group(transactions);
    const names = new Set([...listings.keys(), ...sales.keys()]);
    const market = [];
    
    for (const name of names) {
      const active = listings.get(name) || [];
      const sold = sales.get(name) || [];
      const asks = active.map(x => x.pricePerUnit || x.price / x.count).filter(x => x > 0);
      const salePrices = sold.map(x => x.pricePerUnit || x.price / x.count).filter(x => x > 0);
      const reference = salePrices.length >= 3 ? percentile(salePrices, .5) : percentile(asks, .35);
      const floor = asks.length ? Math.min(...asks) : 0;
      const q1 = percentile(asks, .25);
      const median = percentile(asks, .5);
      const history = this.priceHistory.get(name) || [];
      const recent = history.slice(-3).map(x => x.floor);
      const older = history.slice(-8, -3).map(x => x.floor);
      const recentAvg = recent.length ? recent.reduce((a, b) => a + b, 0) / recent.length : floor;
      const olderAvg = older.length ? older.reduce((a, b) => a + b, 0) / older.length : recentAvg;
      const change = olderAvg ? (recentAvg - olderAvg) / olderAvg * 100 : 0;
      const deviations = salePrices.length > 2 ? salePrices : asks;
      const avg = deviations.length ? deviations.reduce((a, b) => a + b, 0) / deviations.length : 0;
      const volatility = avg ? Math.sqrt(deviations.reduce((sum, x) => sum + (x - avg) ** 2, 0) / deviations.length) / avg * 100 : 0;
      
      const prediction = this.predictor.predict(name, history, active);
      
      market.push({
        name, floor: round(floor), q1: round(q1), median: round(median), fairValue: round(reference),
        listings: active.length, sales: sold.length, volume: sold.reduce((sum, x) => sum + (x.count || 1), 0),
        salesValue: round(sold.reduce((sum, x) => sum + x.price, 0)), change: Math.round(change * 10) / 10,
        volatility: Math.round(volatility * 10) / 10, confidence: Math.min(100, sold.length * 5 + active.length * 3 + history.length * 2),
        prediction,
        avgListingPrice: active.length > 0 ? round(active.reduce((s, a) => s + (a.pricePerUnit || a.price / a.count), 0) / active.length) : 0
      });
    }
    return market.sort((a, b) => b.salesValue - a.salesValue);
  }

  riskFor(item) {
    let score = 55;
    score += Math.min(25, item.volatility * .7);
    score -= Math.min(25, item.sales * 1.5);
    score -= Math.min(12, item.listings);
    score += item.confidence < 35 ? 18 : 0;
    if (item.prediction && item.prediction.confidence > 70) score -= 10;
    score = Math.max(8, Math.min(95, round(score)));
    return { score, label: score < 34 ? 'Low' : score > 67 ? 'High' : 'Medium' };
  }

  detectFlips(auctions, transactions = []) {
    const market = this.buildMarket(auctions, transactions);
    const byName = new Map(market.map(item => [normalize(item.name), item]));
    const grouped = this.group(auctions);
    const flips = [];

    for (const item of market) {
      if (!item.floor || item.listings < 2 || item.fairValue <= item.floor) continue;
      const target = Math.max(item.floor, Math.min(item.fairValue, item.q1 || item.fairValue));
      const profit = target * (1 - TAX_RATE) - item.floor;
      const roi = profit / item.floor * 100;
      if (profit > 750 && roi >= 7) flips.push(this.flip('snipe', item, item.floor, target, profit, roi));
    }

    for (const recipe of RECIPES) {
      if (!recipe.result) continue;
      const result = byName.get(normalize(recipe.result));
      if (!result?.floor) continue;
      let cost = 0;
      const ingredients = [];
      for (const ingredient of recipe.ingredients) {
        const source = byName.get(normalize(ingredient.item));
        if (!source?.floor) { cost = 0; break; }
        const subtotal = source.floor * ingredient.count;
        cost += subtotal;
        ingredients.push({ name: ingredient.item, count: ingredient.count, unitPrice: source.floor, totalCost: round(subtotal) });
      }
      if (!cost) continue;
      const output = recipe.resultCount || 1;
      const revenue = result.floor * output * (1 - TAX_RATE);
      const profit = revenue - cost;
      const roi = profit / cost * 100;
      if (profit > 750 && roi >= 6) flips.push({ ...this.flip('craft', result, cost, result.floor * output, profit, roi), ingredients, resultCount: output, category: recipe.category });
    }

    // Enchantment flips: buy base item + books → enchanted → sell premium
    const enchantFlips = this.detectEnchantFlips(market, auctions);
    flips.push(...enchantFlips);

    return flips.sort((a, b) => b.score - a.score).slice(0, 250);
  }

  detectEnchantFlips(market, auctions) {
    const flips = [];
    const byName = new Map(market.map(item => [normalize(item.name), item]));
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
    };
    const COMMON_ENCHANTS = ['sharpness', 'efficiency', 'protection', 'fortune', 'silk_touch', 'unbreaking', 'mending', 'power', 'looting'];
    const BASE_ITEMS = ['diamond_sword', 'diamond_pickaxe', 'diamond_axe', 'diamond_helmet', 'diamond_chestplate', 'diamond_leggings', 'diamond_boots', 'netherite_sword', 'netherite_pickaxe', 'netherite_axe'];

    for (const baseName of BASE_ITEMS) {
      const base = byName.get(baseName);
      if (!base || !base.floor) continue;
      const basePrice = base.floor;

      for (const enchName of COMMON_ENCHANTS) {
        const bookPrices = ENCHANT_BOOKS[enchName];
        if (!bookPrices) continue;
        for (const [level, bookPrice] of Object.entries(bookPrices)) {
          const enchLevel = Number(level);
          const enchMultiplier = ENCHANT_MULTIPLIERS[enchName]?.[enchLevel] || 1;
          const enchantedValue = basePrice * enchMultiplier * (1 - TAX_RATE);
          const totalCost = basePrice + bookPrice;
          const profit = enchantedValue - totalCost;
          const roi = profit / totalCost * 100;

          if (profit > 1000 && roi >= 10) {
            const resultItem = byName.get(normalize(baseName));
            flips.push({
              ...this.flip('enchant', resultItem || { name: baseName, floor: basePrice, sales: 0, listings: 1, volatility: 0, confidence: 20 }, totalCost, enchantedValue, profit, roi),
              enchantment: `${enchName} ${enchLevel}`,
              bookCost: bookPrice,
              baseCost: basePrice,
              ingredients: [
                { name: baseName, count: 1, unitPrice: basePrice, totalCost: basePrice },
                { name: `${enchName} book`, count: 1, unitPrice: bookPrice, totalCost: bookPrice }
              ]
            });
          }
        }
      }
    }

    return flips;
  }

  flip(type, item, buyPrice, sellPrice, profit, roi) {
    const risk = this.riskFor(item);
    const score = round(Math.max(0, profit) * Math.max(0, roi) * (100 - risk.score) / 100);
    return { type, name: item.name, buyPrice: round(buyPrice), totalCost: round(buyPrice), sellPrice: round(sellPrice), afterTax: round(sellPrice * (1 - TAX_RATE)), profit: round(profit), roi: Math.round(roi * 10) / 10, risk, score, volume: item.sales, listings: item.listings, confidence: item.confidence, timestamp: Date.now() };
  }

  getIntelligence(auctions, transactions = []) {
    const market = this.buildMarket(auctions, transactions);
    const flips = this.detectFlips(auctions, transactions);
    const marketValue = auctions.reduce((sum, row) => sum + row.price, 0);
    const salesValue = transactions.reduce((sum, row) => sum + row.price, 0);
    const anomalies = this.predictor.detectAnomalies(this.priceHistory, auctions);
    const statisticalOutliers = this.predictor.detectStatisticalOutliers(this.priceHistory, auctions);
    const modelStats = this.predictor.getModelStats();
    
    // Enchantment premiums from storage
    const enchantPremiums = [];
    try {
      const topEnchants = storage.getTopEnchants(10);
      for (const e of topEnchants) {
        enchantPremiums.push({
          enchantName: e.enchant_name,
          level: e.enchant_level,
          baseItem: 'various',
          valueMultiplier: e.avg_multiplier,
          premiumOverBase: e.avg_premium,
          totalSales: e.total_sales
        });
      }
    } catch (e) {}
    
    this.lastFlipDetection = { flips, timestamp: Date.now() };
    
    return {
      summary: { totalAuctions: auctions.length, uniqueItems: market.length, marketValue: round(marketValue), salesValue: round(salesValue), recordedSales: transactions.length, opportunities: flips.length },
      topFlips: flips.slice(0, 12),
      movers: market.filter(x => Math.abs(x.change) >= 1).sort((a, b) => Math.abs(b.change) - Math.abs(a.change)).slice(0, 15),
      active: [...market].sort((a, b) => b.sales - a.sales).slice(0, 15),
      anomalies: anomalies.slice(0, 10),
      outliers: statisticalOutliers.slice(0, 20),
      predictions: market.filter(x => x.prediction).slice(0, 20).map(x => ({ name: x.name, current: x.floor, predicted: x.prediction.predictedPrice, change: x.prediction.expectedChangePct, trend: x.prediction.trend, confidence: x.prediction.confidence })),
      neuralNet: modelStats,
      enchantPremiums,
      market: market.slice(0, 150),
      generatedAt: new Date().toISOString()
    };
  }

  calculatePortfolio(budget, auctions, transactions = [], riskTolerance = 55) {
    const candidates = this.detectFlips(auctions, transactions).filter(x => x.totalCost <= budget && x.risk.score <= riskTolerance);
    let remaining = budget;
    const allocation = [];
    for (const flip of candidates) {
      if (allocation.length >= 10) break;
      const cap = budget * .25;
      const copies = Math.max(0, Math.min(flip.listings || 1, 5, Math.floor(Math.min(remaining, cap) / flip.totalCost)));
      if (!copies) continue;
      allocation.push({ flip, copies, totalCost: flip.totalCost * copies, expectedProfit: flip.profit * copies });
      remaining -= flip.totalCost * copies;
    }
    const totalCost = allocation.reduce((sum, x) => sum + x.totalCost, 0);
    const totalProfit = allocation.reduce((sum, x) => sum + x.expectedProfit, 0);
    return { budget, riskTolerance, allocation, totalCost, totalProfit, totalROI: totalCost ? Math.round(totalProfit / totalCost * 1000) / 10 : 0, remaining, flipCount: allocation.length };
  }

  getHistory(name, limit = 100) { return (this.priceHistory.get(name) || []).slice(-limit); }
  
  getPriceHistory() { return this.priceHistory; }
  
  get priceHistoryMap() { return this.priceHistory; }
}

module.exports = AuctionAnalyzer;
module.exports.normalize = normalize;
module.exports.percentile = percentile;
module.exports.ENCHANT_MULTIPLIERS = ENCHANT_MULTIPLIERS;