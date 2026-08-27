const RECIPES = require('./recipes');
const { resolveName } = require('./items');
const AH_TAX = 0.05;

class AuctionAnalyzer {
  constructor() {
    this.priceHistory = {};
    this.snapshots = [];
    this.maxSnapshots = 200;
    this.flipCache = null;
    this.flipCacheTime = 0;
  }

  addSnapshot(auctions) {
    const now = Date.now();
    const snapshot = { timestamp: now, auctions: auctions || [], itemCount: (auctions || []).length };
    this.snapshots.push(snapshot);
    if (this.snapshots.length > this.maxSnapshots) this.snapshots.shift();
    this.updatePriceHistory(snapshot);
    return snapshot;
  }

  updatePriceHistory(snapshot) {
    for (const auction of snapshot.auctions) {
      const name = this.getItemName(auction.item);
      if (!name) continue;
      if (!this.priceHistory[name]) this.priceHistory[name] = [];
      this.priceHistory[name].push({ price: auction.price, timestamp: snapshot.timestamp, count: auction.item?.count || 1 });
      if (this.priceHistory[name].length > 200) this.priceHistory[name].shift();
    }
  }

  getItemName(item) {
    if (!item) return null;
    if (item.display_name) return item.display_name;
    return resolveName(item);
  }

  // Find all auctions for a given item name (fuzzy match)
  findAuctions(itemName, auctions) {
    const normalized = itemName.toLowerCase().replace(/[^a-z0-9]/g, '');
    return auctions.filter(a => {
      const name = this.getItemName(a.item);
      if (!name) return false;
      return name.toLowerCase().replace(/[^a-z0-9]/g, '') === normalized ||
             name.toLowerCase().includes(itemName.toLowerCase());
    });
  }

  // Find cheapest auction for an item
  findCheapest(itemName, auctions) {
    const matches = this.findAuctions(itemName, auctions);
    if (matches.length === 0) return null;
    return Math.min(...matches.map(a => a.price / (a.item?.count || 1)));
  }

  // Find most expensive auction (what buyers pay)
  findMostExpensive(itemName, auctions) {
    const matches = this.findAuctions(itemName, auctions);
    if (matches.length === 0) return null;
    return Math.max(...matches.map(a => a.price / (a.item?.count || 1)));
  }

  // Get median auction price
  getMedianPrice(itemName, auctions) {
    const matches = this.findAuctions(itemName, auctions);
    if (matches.length === 0) return null;
    const prices = matches.map(a => a.price / (a.item?.count || 1)).sort((a, b) => a - b);
    return prices[Math.floor(prices.length / 2)];
  }

  // Get listing count for an item
  getListingCount(itemName, auctions) {
    return this.findAuctions(itemName, auctions).length;
  }

  getItemStats(itemName) {
    const history = this.priceHistory[itemName] || [];
    if (history.length === 0) return null;
    const prices = history.map(h => h.price / (h.count || 1));
    const latest = prices[prices.length - 1];
    const avg = prices.reduce((a, b) => a + b, 0) / prices.length;
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    const sorted = [...prices].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    const prev = prices.length >= 2 ? prices[prices.length - 2] : latest;
    const velocity = prev > 0 ? ((latest - prev) / prev) * 100 : 0;
    const range = max > 0 ? ((max - min) / max) * 100 : 0;
    return { name: itemName, latest: Math.round(latest), avg: Math.round(avg), min: Math.round(min), max: Math.round(max), median: Math.round(median), velocity: Math.round(velocity * 100) / 100, range: Math.round(range * 100) / 100, dataPoints: prices.length };
  }

  // === CORE: Detect all profitable flips ===
  detectFlips(auctions) {
    const flips = [];
    const now = Date.now();

    // 1. CRAFT FLIPS — buy ingredients, craft result, sell for profit
    for (const recipe of RECIPES) {
      let totalCost = 0;
      let canCraft = true;
      const ingredientDetails = [];

      for (const ing of recipe.ingredients) {
        const price = this.findCheapest(ing.item, auctions);
        if (price === null) { canCraft = false; break; }
        const cost = price * ing.count;
        totalCost += cost;
        ingredientDetails.push({ name: ing.item, count: ing.count, unitPrice: Math.round(price), totalCost: Math.round(cost) });
      }
      if (!canCraft) continue;

      const sellPrice = this.findCheapest(recipe.result, auctions);
      if (sellPrice === null) continue;

      const afterTax = sellPrice * (1 - AH_TAX);
      const profit = afterTax - totalCost;
      const roi = totalCost > 0 ? (profit / totalCost) * 100 : 0;
      const volume = this.getListingCount(recipe.result, auctions);

      if (profit > 0 || roi > 5) {
        flips.push({
          type: 'craft',
          name: recipe.result,
          resultCount: recipe.resultCount || 1,
          ingredients: ingredientDetails,
          totalCost: Math.round(totalCost),
          sellPrice: Math.round(sellPrice),
          afterTax: Math.round(afterTax),
          profit: Math.round(profit),
          roi: Math.round(roi * 100) / 100,
          risk: this.calculateRisk(recipe.result, 'craft'),
          category: recipe.category,
          volume,
          timestamp: now,
        });
      }
    }

    // 2. MARKET FLIPS — buy low on AH, sell high on AH
    const itemGroups = {};
    for (const auction of auctions) {
      const name = this.getItemName(auction.item);
      if (!name) continue;
      if (!itemGroups[name]) itemGroups[name] = [];
      itemGroups[name].push(auction);
    }

    for (const [itemName, listings] of Object.entries(itemGroups)) {
      if (listings.length < 2) continue;
      const prices = listings.map(a => a.price / (a.item?.count || 1)).sort((a, b) => a - b);
      const cheapest = prices[0];
      const mostExpensive = prices[prices.length - 1];
      const spread = mostExpensive - cheapest;
      const spreadPct = cheapest > 0 ? (spread / cheapest) * 100 : 0;

      if (spreadPct > 15 && spread > 1000) {
        flips.push({
          type: 'market',
          name: itemName,
          buyPrice: Math.round(cheapest),
          sellPrice: Math.round(mostExpensive),
          afterTax: Math.round(mostExpensive * (1 - AH_TAX)),
          profit: Math.round(mostExpensive * (1 - AH_TAX) - cheapest),
          roi: Math.round(spreadPct * 100) / 100,
          risk: this.calculateRisk(itemName, 'market'),
          category: 'market',
          volume: listings.length,
          spread: Math.round(spread),
          timestamp: now,
        });
      }
    }

    // 3. SNIPES — items listed way below market value
    for (const itemName of Object.keys(this.priceHistory)) {
      const history = this.priceHistory[itemName];
      if (history.length < 3) continue;
      const recentPrices = history.slice(-10).map(h => h.price / (h.count || 1));
      const avgRecent = recentPrices.reduce((a, b) => a + b, 0) / recentPrices.length;
      const currentCheapest = this.findCheapest(itemName, auctions);
      if (currentCheapest === null) continue;

      if (currentCheapest < avgRecent * 0.7) {
        const profit = avgRecent * (1 - AH_TAX) - currentCheapest;
        flips.push({
          type: 'snipe',
          name: itemName,
          buyPrice: Math.round(currentCheapest),
          sellPrice: Math.round(avgRecent),
          afterTax: Math.round(avgRecent * (1 - AH_TAX)),
          profit: Math.round(profit),
          roi: currentCheapest > 0 ? Math.round((profit / currentCheapest) * 100 * 100) / 100 : 0,
          risk: this.calculateRisk(itemName, 'snipe'),
          category: 'snipe',
          volume: this.getListingCount(itemName, auctions),
          timestamp: now,
        });
      }
    }

    // Deduplicate and sort
    const seen = new Set();
    const deduped = flips.filter(f => {
      const key = f.type + ':' + f.name + ':' + f.profit;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    deduped.sort((a, b) => b.profit - a.profit);
    this.flipCache = deduped;
    this.flipCacheTime = now;
    return deduped;
  }

  calculateRisk(itemName, flipType) {
    const history = this.priceHistory[itemName] || [];
    const dataPoints = history.length;
    const volatility = this.calculateVolatility(history);
    let score = 50;
    if (dataPoints < 5) score += 25;
    else if (dataPoints < 10) score += 10;
    else if (dataPoints > 20) score -= 15;
    if (volatility > 30) score += 20;
    else if (volatility > 15) score += 10;
    else if (volatility < 5) score -= 10;
    if (flipType === 'craft') score -= 5;
    else if (flipType === 'snipe') score += 15;
    score = Math.max(10, Math.min(95, score));
    let label = 'Medium';
    if (score < 30) label = 'Low';
    else if (score > 70) label = 'High';
    return { score, label, volatility: Math.round(volatility), dataPoints };
  }

  calculateVolatility(history) {
    if (history.length < 3) return 0;
    const prices = history.map(h => h.price / (h.count || 1));
    const avg = prices.reduce((a, b) => a + b, 0) / prices.length;
    if (avg === 0) return 0;
    const squaredDiffs = prices.map(p => Math.pow(p - avg, 2));
    const variance = squaredDiffs.reduce((a, b) => a + b, 0) / squaredDiffs.length;
    return (Math.sqrt(variance) / avg) * 100;
  }

  // === MARKET INTELLIGENCE ===
  getMarketIntelligence(auctions) {
    const now = Date.now();
    const flips = this.detectFlips(auctions);

    // Top items by listing count
    const listingCounts = {};
    const totalValue = {};
    for (const a of auctions) {
      const name = this.getItemName(a.item);
      if (!name) continue;
      listingCounts[name] = (listingCounts[name] || 0) + 1;
      totalValue[name] = (totalValue[name] || 0) + a.price;
    }
    const topListed = Object.entries(listingCounts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 15)
      .map(([item, count]) => ({
        item,
        count,
        totalValue: Math.round(totalValue[item] || 0),
        avgPrice: Math.round((totalValue[item] || 0) / count),
      }));

    // Top flips by profit
    const topFlips = flips.slice(0, 20);

    // Top flips by ROI
    const topROI = [...flips].sort((a, b) => b.roi - a.roi).slice(0, 20);

    // Price trends
    const trends = {};
    for (const [item, history] of Object.entries(this.priceHistory)) {
      if (history.length < 2) continue;
      const recent = history.slice(-5);
      const older = history.slice(-10, -5);
      if (older.length === 0) continue;
      const recentAvg = recent.reduce((s, h) => s + h.price / (h.count || 1), 0) / recent.length;
      const olderAvg = older.reduce((s, h) => s + h.price / (h.count || 1), 0) / older.length;
      const change = olderAvg > 0 ? ((recentAvg - olderAvg) / olderAvg) * 100 : 0;
      trends[item] = { recentAvg: Math.round(recentAvg), olderAvg: Math.round(olderAvg), change: Math.round(change * 100) / 100 };
    }
    const risingItems = Object.entries(trends)
      .filter(([, t]) => t.change > 10)
      .sort(([, a], [, b]) => b.change - a.change)
      .slice(0, 10)
      .map(([item, t]) => ({ item, ...t }));
    const fallingItems = Object.entries(trends)
      .filter(([, t]) => t.change < -10)
      .sort(([, a], [, b]) => a.change - b.change)
      .slice(0, 10)
      .map(([item, t]) => ({ item, ...t }));

    // Category breakdown
    const categories = {};
    for (const flip of flips) {
      const cat = flip.category || 'other';
      if (!categories[cat]) categories[cat] = { count: 0, totalProfit: 0, avgROI: 0 };
      categories[cat].count++;
      categories[cat].totalProfit += flip.profit;
      categories[cat].avgROI += flip.roi;
    }
    for (const cat of Object.keys(categories)) {
      categories[cat].avgROI = Math.round(categories[cat].avgROI / categories[cat].count * 100) / 100;
      categories[cat].totalProfit = Math.round(categories[cat].totalProfit);
    }

    // Summary stats
    const totalAuctionValue = auctions.reduce((s, a) => s + a.price, 0);
    const profitableFlips = flips.filter(f => f.profit > 0).length;
    const avgFlipProfit = flips.length > 0 ? Math.round(flips.reduce((s, f) => s + f.profit, 0) / flips.length) : 0;

    return {
      summary: {
        totalAuctions: auctions.length,
        totalAuctionValue: Math.round(totalAuctionValue),
        totalTrackedItems: Object.keys(this.priceHistory).length,
        snapshotCount: this.snapshots.length,
        profitableFlips,
        avgFlipProfit,
      },
      topListed,
      topFlips,
      topROI,
      risingItems,
      fallingItems,
      categories,
      trends,
    };
  }

  // === PORTFOLIO OPTIMIZER ===
  calculatePortfolio(investment, auctions) {
    const flips = this.detectFlips(auctions).filter(f => f.profit > 0);
    const sorted = [...flips].sort((a, b) => {
      const aScore = a.roi * Math.max(0, 100 - a.risk.score);
      const bScore = b.roi * Math.max(0, 100 - b.risk.score);
      return bScore - aScore;
    });
    const allocation = [];
    let remaining = investment;
    for (const flip of sorted) {
      if (remaining <= 0) break;
      const cost = flip.totalCost || flip.buyPrice;
      if (cost > remaining) continue;
      const copies = Math.min(Math.floor(remaining / cost), 10);
      if (copies <= 0) continue;
      allocation.push({ flip, copies, totalCost: Math.round(cost * copies), expectedProfit: Math.round(flip.profit * copies), expectedROI: flip.roi });
      remaining -= cost * copies;
    }
    const totalCost = allocation.reduce((s, a) => s + a.totalCost, 0);
    const totalProfit = allocation.reduce((s, a) => s + a.expectedProfit, 0);
    return {
      investment,
      allocation,
      totalCost,
      totalProfit,
      totalROI: totalCost > 0 ? Math.round((totalProfit / totalCost) * 100 * 100) / 100 : 0,
      remaining: Math.round(remaining),
      flipCount: allocation.length,
    };
  }

  getHistory(itemName, limit = 50) {
    return (this.priceHistory[itemName] || []).slice(-limit);
  }

  getTrackedItems() {
    return Object.keys(this.priceHistory).sort();
  }

  getSnapshots(limit = 50) {
    return this.snapshots.slice(-limit);
  }
}

module.exports = AuctionAnalyzer;
