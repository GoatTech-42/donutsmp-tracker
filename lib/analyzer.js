class AuctionAnalyzer {
  constructor() {
    this.priceHistory = new Map();
    this.snapshots = [];
    this.maxSnapshots = 500;
    this.trends = new Map();
  }

  recordSnapshot(auctions) {
    const now = Date.now();
    const itemMap = new Map();
    for (const a of auctions) {
      const key = a.item?.display_name || a.item?.id || 'unknown';
      if (!itemMap.has(key)) itemMap.set(key, []);
      itemMap.get(key).push({ price: a.price, seller: a.seller?.name, timeLeft: a.time_left, count: a.item?.count || 1 });
    }

    const snapshot = { time: now, items: {} };
    for (const [name, listings] of itemMap) {
      const prices = listings.map(l => l.price / l.count);
      const avg = prices.reduce((a, b) => a + b, 0) / prices.length;
      const min = Math.min(...prices);
      const max = Math.max(...prices);
      snapshot.items[name] = { count: listings.length, avg: Math.round(avg), min: Math.round(min), max: Math.round(max), listings };

      if (!this.priceHistory.has(name)) this.priceHistory.set(name, []);
      const hist = this.priceHistory.get(name);
      hist.push({ time: now, avg, min, max, count: listings.length });
      if (hist.length > 200) hist.shift();
    }

    this.snapshots.push(snapshot);
    if (this.snapshots.length > this.maxSnapshots) this.snapshots.shift();
    this._updateTrends();
    return snapshot;
  }

  _updateTrends() {
    this.trends.clear();
    for (const [name, history] of this.priceHistory) {
      if (history.length < 2) continue;
      const recent = history.slice(-10);
      const older = history.slice(-20, -10);
      if (older.length === 0) continue;

      const recentAvg = recent.reduce((s, h) => s + h.avg, 0) / recent.length;
      const olderAvg = older.reduce((s, h) => s + h.avg, 0) / older.length;
      const pctChange = ((recentAvg - olderAvg) / olderAvg) * 100;

      const recentCount = recent[recent.length - 1].count;
      const olderCount = older[older.length - 1].count;
      const supplyChange = ((recentCount - olderCount) / Math.max(olderCount, 1)) * 100;

      let signal = 'hold';
      if (pctChange > 5 && supplyChange < -10) signal = 'buy';
      else if (pctChange < -5 && supplyChange > 10) signal = 'sell';
      else if (pctChange > 10) signal = 'potential_bubble';
      else if (pctChange < -10) signal = 'potential_crash';

      this.trends.set(name, {
        name, signal,
        priceChange: Math.round(pctChange * 100) / 100,
        supplyChange: Math.round(supplyChange * 100) / 100,
        currentAvg: Math.round(recentAvg),
        currentMin: Math.round(Math.min(...recent.map(r => r.min))),
        historyLen: history.length,
        sampleCount: recentCount
      });
    }
  }

  getSnapshotSummary() {
    const latest = this.snapshots[this.snapshots.length - 1];
    if (!latest) return { items: 0, totalListings: 0 };
    let totalListings = 0;
    for (const v of Object.values(latest.items)) totalListings += v.count;
    return { items: Object.keys(latest.items).length, totalListings, time: latest.time };
  }

  getItemHistory(name) {
    return this.priceHistory.get(name) || [];
  }

  getTrends() {
    return Array.from(this.trends.values()).sort((a, b) => Math.abs(b.priceChange) - Math.abs(a.priceChange));
  }

  getTrendingBuys() {
    return this.getTrends().filter(t => t.signal === 'buy');
  }

  getTrendingSells() {
    return this.getTrends().filter(t => t.signal === 'sell');
  }

  getMarketOverview() {
    const trends = this.getTrends();
    return {
      totalItems: trends.length,
      buys: trends.filter(t => t.signal === 'buy').length,
      sells: trends.filter(t => t.signal === 'sell').length,
      holds: trends.filter(t => t.signal === 'hold').length,
      bubbles: trends.filter(t => t.signal === 'potential_bubble').length,
      crashes: trends.filter(t => t.signal === 'potential_crash').length,
      topGainers: trends.filter(t => t.priceChange > 0).slice(0, 5),
      topLosers: trends.filter(t => t.priceChange < 0).sort((a, b) => a.priceChange - b.priceChange).slice(0, 5),
      mostListed: trends.sort((a, b) => b.sampleCount - a.sampleCount).slice(0, 5)
    };
  }

  getChatContext() {
    const trends = this.getTrends();
    const snapshot = this.snapshots[this.snapshots.length - 1];
    if (!snapshot) return 'No data yet.';

    let ctx = `=== DonutSMP Market Snapshot ===\n`;
    ctx += `Total unique items: ${Object.keys(snapshot.items).length}\n`;
    ctx += `Total listings: ${Object.values(snapshot.items).reduce((s, i) => s + i.count, 0)}\n\n`;

    ctx += `=== Top Price Movements ===\n`;
    for (const t of trends.slice(0, 15)) {
      ctx += `${t.name}: ${t.currentMin} coins (avg ${t.currentAvg}), ${t.priceChange > 0 ? '+' : ''}${t.priceChange}%, supply ${t.supplyChange > 0 ? '+' : ''}${t.supplyChange}%, signal: ${t.signal}\n`;
    }

    ctx += `\n=== Signal Summary ===\n`;
    ctx += `Buy signals: ${trends.filter(t => t.signal === 'buy').length}\n`;
    ctx += `Sell signals: ${trends.filter(t => t.signal === 'sell').length}\n`;
    ctx += `Potential bubbles: ${trends.filter(t => t.signal === 'potential_bubble').length}\n`;
    ctx += `Potential crashes: ${trends.filter(t => t.signal === 'potential_crash').length}\n`;

    const buyTargets = trends.filter(t => t.signal === 'buy');
    if (buyTargets.length) {
      ctx += `\n=== Top Buy Targets ===\n`;
      for (const t of buyTargets.slice(0, 5)) {
        ctx += `${t.name}: ${t.currentMin} coins (lowest), avg ${t.currentAvg}, price ${t.priceChange}%\n`;
      }
    }

    return ctx;
  }
}

module.exports = AuctionAnalyzer;
