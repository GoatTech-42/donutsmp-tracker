const RECIPES = require('./recipes');

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

class AuctionAnalyzer {
  constructor() {
    this.snapshots = [];
    this.priceHistory = new Map();
    this.maxSnapshots = 288;
  }

  addSnapshot(auctions) {
    const timestamp = Date.now();
    const grouped = this.group(auctions);
    const compact = {};
    for (const [name, listings] of grouped) {
      const prices = listings.map(row => row.pricePerUnit || row.price / row.count).filter(Number.isFinite);
      if (!prices.length) continue;
      compact[name] = { floor: round(Math.min(...prices)), median: round(percentile(prices, .5)), listings: prices.length };
      const history = this.priceHistory.get(name) || [];
      history.push({ timestamp, ...compact[name] });
      this.priceHistory.set(name, history.slice(-this.maxSnapshots));
    }
    this.snapshots.push({ timestamp, itemCount: auctions.length, items: compact });
    this.snapshots = this.snapshots.slice(-this.maxSnapshots);
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
      market.push({
        name, floor: round(floor), q1: round(q1), median: round(median), fairValue: round(reference),
        listings: active.length, sales: sold.length, volume: sold.reduce((sum, x) => sum + (x.count || 1), 0),
        salesValue: round(sold.reduce((sum, x) => sum + x.price, 0)), change: Math.round(change * 10) / 10,
        volatility: Math.round(volatility * 10) / 10, confidence: Math.min(100, sold.length * 5 + active.length * 3 + history.length * 2)
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
    score = Math.max(8, Math.min(95, round(score)));
    return { score, label: score < 34 ? 'Low' : score > 67 ? 'High' : 'Medium' };
  }

  detectFlips(auctions, transactions = [], orders = []) {
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

    for (const order of orders || []) {
      const item = byName.get(normalize(order.itemName));
      if (!item?.floor || !order.pricePerUnit) continue;
      const profit = order.pricePerUnit - item.floor;
      const roi = profit / item.floor * 100;
      if (profit > 750 && roi >= 5) flips.push({ ...this.flip('order', item, item.floor, order.pricePerUnit, profit, roi), order });
    }

    return flips.sort((a, b) => b.score - a.score).slice(0, 250);
  }

  flip(type, item, buyPrice, sellPrice, profit, roi) {
    const risk = this.riskFor(item);
    const score = round(Math.max(0, profit) * Math.max(0, roi) * (100 - risk.score) / 100);
    return { type, name: item.name, buyPrice: round(buyPrice), totalCost: round(buyPrice), sellPrice: round(sellPrice), afterTax: round(sellPrice * (type === 'order' ? 1 : 1 - TAX_RATE)), profit: round(profit), roi: Math.round(roi * 10) / 10, risk, score, volume: item.sales, listings: item.listings, confidence: item.confidence, timestamp: Date.now() };
  }

  getIntelligence(auctions, transactions = [], orders = []) {
    const market = this.buildMarket(auctions, transactions);
    const flips = this.detectFlips(auctions, transactions, orders);
    const marketValue = auctions.reduce((sum, row) => sum + row.price, 0);
    const salesValue = transactions.reduce((sum, row) => sum + row.price, 0);
    return {
      summary: { totalAuctions: auctions.length, uniqueItems: market.length, marketValue: round(marketValue), salesValue: round(salesValue), recordedSales: transactions.length, opportunities: flips.length, orderListings: orders.length },
      topFlips: flips.slice(0, 8),
      movers: market.filter(x => Math.abs(x.change) >= 1).sort((a, b) => Math.abs(b.change) - Math.abs(a.change)).slice(0, 10),
      active: [...market].sort((a, b) => b.sales - a.sales).slice(0, 10),
      market: market.slice(0, 100),
      generatedAt: new Date().toISOString()
    };
  }

  calculatePortfolio(budget, auctions, transactions = [], orders = [], riskTolerance = 55) {
    const candidates = this.detectFlips(auctions, transactions, orders).filter(x => x.totalCost <= budget && x.risk.score <= riskTolerance);
    let remaining = budget;
    const allocation = [];
    for (const flip of candidates) {
      if (allocation.length >= 8) break;
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

  getHistory(name, limit = 50) { return (this.priceHistory.get(name) || []).slice(-limit); }
}

module.exports = AuctionAnalyzer;
module.exports.normalize = normalize;
module.exports.percentile = percentile;
