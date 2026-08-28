const Database = require('better-sqlite3')
const path = require('path')
const fs = require('fs')

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'pulse.db')
const DATA_DIR = path.dirname(DB_PATH)

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true })
}

const db = new Database(DB_PATH)

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous = NORMAL;
  PRAGMA cache_size = -32768;
  
  CREATE TABLE IF NOT EXISTS snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp INTEGER NOT NULL,
    item_name TEXT NOT NULL,
    floor_price INTEGER,
    median_price INTEGER,
    avg_price INTEGER,
    listings INTEGER,
    sales INTEGER,
    volume INTEGER,
    sales_value INTEGER,
    change_pct REAL,
    volatility REAL,
    confidence INTEGER
  );
  
  CREATE INDEX IF NOT EXISTS idx_snapshots_item_time ON snapshots(item_name, timestamp);
  CREATE INDEX IF NOT EXISTS idx_snapshots_time ON snapshots(timestamp);
  
  CREATE TABLE IF NOT EXISTS auctions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    snapshot_id INTEGER NOT NULL,
    auction_id TEXT NOT NULL,
    seller_name TEXT,
    seller_uuid TEXT,
    price INTEGER NOT NULL,
    price_per_unit INTEGER NOT NULL,
    count INTEGER NOT NULL,
    item_name TEXT NOT NULL,
    item_id TEXT,
    time_left INTEGER,
    enchants TEXT,
    contents TEXT,
    shulker_value INTEGER,
    FOREIGN KEY(snapshot_id) REFERENCES snapshots(id)
  );
  
  CREATE INDEX IF NOT EXISTS idx_auctions_snapshot ON auctions(snapshot_id);
  CREATE INDEX IF NOT EXISTS idx_auctions_item ON auctions(item_name);
  
  CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    snapshot_id INTEGER NOT NULL,
    buyer_name TEXT,
    buyer_uuid TEXT,
    seller_name TEXT,
    seller_uuid TEXT,
    price INTEGER NOT NULL,
    price_per_unit INTEGER NOT NULL,
    count INTEGER NOT NULL,
    item_name TEXT NOT NULL,
    item_id TEXT,
    date_sold INTEGER,
    enchants TEXT,
    contents TEXT,
    FOREIGN KEY(snapshot_id) REFERENCES snapshots(id)
  );
  
  CREATE INDEX IF NOT EXISTS idx_transactions_snapshot ON transactions(snapshot_id);
  CREATE INDEX IF NOT EXISTS idx_transactions_item ON transactions(item_name);
  CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(date_sold);
  
  CREATE TABLE IF NOT EXISTS neural_models (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    model_name TEXT UNIQUE NOT NULL,
    model_data TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );
  
  CREATE TABLE IF NOT EXISTS flip_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp INTEGER NOT NULL,
    flip_type TEXT NOT NULL,
    item_name TEXT NOT NULL,
    buy_price INTEGER,
    sell_price INTEGER,
    profit INTEGER,
    roi REAL,
    risk_score INTEGER,
    risk_label TEXT,
    executed INTEGER DEFAULT 0,
    result_profit INTEGER
  );
  
  CREATE INDEX IF NOT EXISTS idx_flip_history_time ON flip_history(timestamp);
  CREATE INDEX IF NOT EXISTS idx_flip_history_item ON flip_history(item_name);
  
  CREATE TABLE IF NOT EXISTS market_stats (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp INTEGER NOT NULL,
    total_auctions INTEGER,
    unique_items INTEGER,
    market_value INTEGER,
    sales_value INTEGER,
    recorded_sales INTEGER,
    opportunities INTEGER
  );
  
  CREATE INDEX IF NOT EXISTS idx_market_stats_time ON market_stats(timestamp);
  
  CREATE TABLE IF NOT EXISTS enchantment_stats (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp INTEGER NOT NULL,
    base_item TEXT NOT NULL,
    enchant_name TEXT NOT NULL,
    enchant_level INTEGER NOT NULL,
    avg_price INTEGER,
    avg_price_per_unit INTEGER,
    sale_count INTEGER,
    volume INTEGER,
    value_multiplier REAL,
    premium_over_base REAL
  );
  
  CREATE INDEX IF NOT EXISTS idx_enchant_item_time ON enchantment_stats(base_item, enchant_name, timestamp);
  CREATE INDEX IF NOT EXISTS idx_enchant_time ON enchantment_stats(timestamp);
  
  CREATE TABLE IF NOT EXISTS enchantment_combos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp INTEGER NOT NULL,
    item_name TEXT NOT NULL,
    enchants_hash TEXT NOT NULL,
    enchant_list TEXT NOT NULL,
    avg_price INTEGER,
    sale_count INTEGER,
    value_multiplier REAL,
    base_estimate INTEGER
  );
  
  CREATE INDEX IF NOT EXISTS idx_combo_time ON enchantment_combos(timestamp);
  CREATE INDEX IF NOT EXISTS idx_combo_item ON enchantment_combos(item_name);
`)

const insertSnapshot = db.prepare(`
  INSERT INTO snapshots (timestamp, item_name, floor_price, median_price, avg_price, listings, sales, volume, sales_value, change_pct, volatility, confidence)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`)

const insertAuction = db.prepare(`
  INSERT INTO auctions (snapshot_id, auction_id, seller_name, seller_uuid, price, price_per_unit, count, item_name, item_id, time_left, enchants, contents, shulker_value)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`)

const insertTransaction = db.prepare(`
  INSERT INTO transactions (snapshot_id, buyer_name, buyer_uuid, seller_name, seller_uuid, price, price_per_unit, count, item_name, item_id, date_sold, enchants, contents)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`)

const insertMarketStats = db.prepare(`
  INSERT INTO market_stats (timestamp, total_auctions, unique_items, market_value, sales_value, recorded_sales, opportunities)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`)

const insertEnchantStat = db.prepare(`
  INSERT INTO enchantment_stats (timestamp, base_item, enchant_name, enchant_level, avg_price, avg_price_per_unit, sale_count, volume, value_multiplier, premium_over_base)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`)

const insertEnchantCombo = db.prepare(`
  INSERT INTO enchantment_combos (timestamp, item_name, enchants_hash, enchant_list, avg_price, sale_count, value_multiplier, base_estimate)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`)

const insertFlip = db.prepare(`
  INSERT INTO flip_history (timestamp, flip_type, item_name, buy_price, sell_price, profit, roi, risk_score, risk_label)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`)

const upsertNeuralModel = db.prepare(`
  INSERT INTO neural_models (model_name, model_data, updated_at)
  VALUES (?, ?, ?)
  ON CONFLICT(model_name) DO UPDATE SET model_data = excluded.model_data, updated_at = excluded.updated_at
`)

const getNeuralModel = db.prepare(`SELECT model_data FROM neural_models WHERE model_name = ?`)

const getRecentSnapshots = db.prepare(`
  SELECT * FROM snapshots WHERE item_name = ? ORDER BY timestamp DESC LIMIT ?
`)

const getSnapshotRange = db.prepare(`
  SELECT * FROM snapshots WHERE item_name = ? AND timestamp BETWEEN ? AND ? ORDER BY timestamp
`)

const getAuctionsForSnapshot = db.prepare(`SELECT * FROM auctions WHERE snapshot_id = ?`)
const getTransactionsForSnapshot = db.prepare(`SELECT * FROM transactions WHERE snapshot_id = ?`)

const getMarketStatsHistoryStmt = db.prepare(`SELECT * FROM market_stats ORDER BY timestamp DESC LIMIT ?`)
const getFlipHistoryStmt = db.prepare(`SELECT * FROM flip_history ORDER BY timestamp DESC LIMIT ?`)
const getFlipHistoryByItemStmt = db.prepare(
  `SELECT * FROM flip_history WHERE item_name = ? ORDER BY timestamp DESC LIMIT ?`
)

const cleanupOldData = db.prepare(`
  DELETE FROM snapshots WHERE timestamp < ?
`)

const cleanupOldAuctions = db.prepare(`
  DELETE FROM auctions WHERE snapshot_id IN (SELECT id FROM snapshots WHERE timestamp < ?)
`)

const cleanupOldTransactions = db.prepare(`
  DELETE FROM transactions WHERE snapshot_id IN (SELECT id FROM snapshots WHERE timestamp < ?)
`)

function saveSnapshot(snapshot) {
  const tx = db.transaction(() => {
    for (const [itemName, data] of Object.entries(snapshot.items)) {
      const info = insertSnapshot.run(
        snapshot.timestamp,
        itemName,
        data.floor,
        data.median,
        data.avg,
        data.listings,
        data.sales || 0,
        data.volume || 0,
        data.salesValue || 0,
        data.change || 0,
        data.volatility || 0,
        data.confidence || 0
      )
      const snapshotId = info.lastInsertRowid

      if (snapshot.auctions) {
        for (const auction of snapshot.auctions.filter(a => a.itemName === itemName)) {
          insertAuction.run(
            snapshotId,
            auction.id,
            auction.seller?.name,
            auction.seller?.uuid,
            auction.price,
            auction.pricePerUnit,
            auction.count,
            auction.itemName,
            auction.itemId,
            auction.timeLeft,
            JSON.stringify(auction.enchants || {}),
            JSON.stringify(auction.contents || []),
            auction.shulkerValue || 0
          )
        }
      }
      if (snapshot.transactions) {
        for (const tx of snapshot.transactions.filter(t => t.itemName === itemName)) {
          insertTransaction.run(
            snapshotId,
            tx.buyer?.name,
            tx.buyer?.uuid,
            tx.seller?.name,
            tx.seller?.uuid,
            tx.price,
            tx.pricePerUnit,
            tx.count,
            tx.itemName,
            tx.itemId,
            tx.dateSold,
            JSON.stringify(tx.enchants || {}),
            JSON.stringify(tx.contents || [])
          )
        }
      }
    }
    insertMarketStats.run(
      snapshot.timestamp,
      snapshot.auctions?.length || 0,
      Object.keys(snapshot.items).length,
      snapshot.auctions?.reduce((s, a) => s + a.price, 0) || 0,
      snapshot.transactions?.reduce((s, t) => s + t.price, 0) || 0,
      snapshot.transactions?.length || 0,
      snapshot.opportunities || 0
    )
  })
  tx(snapshot)
}

function loadPriceHistory(itemName, limit = 288) {
  const rows = getRecentSnapshots.all(itemName, limit).reverse()
  return rows.map(r => ({
    timestamp: r.timestamp,
    floor: r.floor_price,
    median: r.median_price,
    avg: r.avg_price,
    listings: r.listings,
    sales: r.sales,
    volume: r.volume,
    salesValue: r.sales_value,
    change: r.change_pct,
    volatility: r.volatility,
    confidence: r.confidence
  }))
}

function loadAllPriceHistories() {
  const itemNames = db
    .prepare(`SELECT DISTINCT item_name FROM snapshots`)
    .all()
    .map(r => r.item_name)
  const histories = {}
  for (const name of itemNames) {
    histories[name] = loadPriceHistory(name, 288)
  }
  return histories
}

function saveNeuralModel(name, modelData) {
  upsertNeuralModel.run(name, JSON.stringify(modelData), Date.now())
}

function loadNeuralModel(name) {
  const row = getNeuralModel.get(name)
  return row ? JSON.parse(row.model_data) : null
}

function saveFlip(flip) {
  insertFlip.run(
    Date.now(),
    flip.type,
    flip.name,
    flip.buyPrice,
    flip.sellPrice,
    flip.profit,
    flip.roi,
    flip.risk?.score,
    flip.risk?.label
  )
}

function getFlipHistory(limit = 100) {
  return getFlipHistoryStmt.all(limit)
}

function getFlipHistoryByItem(itemName, limit = 50) {
  return getFlipHistoryByItemStmt.all(itemName, limit)
}

function getMarketStatsHistory(limit = 100) {
  return getMarketStatsHistoryStmt.all(limit)
}

function saveEnchantmentStats(snapshot) {
  if (!snapshot.transactions) return

  const basePrices = new Map()
  for (const [name, data] of Object.entries(snapshot.items)) {
    basePrices.set(name, data.floor)
  }

  const enchantStats = new Map()
  const comboStats = new Map()

  for (const tx of snapshot.transactions) {
    const enchants = tx.enchants || {}
    const enchantEntries = Object.entries(enchants)
    if (enchantEntries.length === 0) continue

    const baseItem = tx.itemName
    const basePrice = basePrices.get(baseItem) || tx.pricePerUnit
    const salePrice = tx.pricePerUnit
    const multiplier = basePrice > 0 ? salePrice / basePrice : 1
    const premium = salePrice - basePrice

    const comboKey = `${tx.itemName}|${JSON.stringify(enchantEntries.sort())}`
    if (!comboStats.has(comboKey)) {
      comboStats.set(comboKey, {
        item: tx.itemName,
        enchants: enchantEntries,
        prices: [],
        baseEstimate: basePrice
      })
    }
    comboStats.get(comboKey).prices.push(salePrice)

    for (const [enchName, level] of enchantEntries) {
      const key = `${baseItem}|${enchName}|${level}`
      if (!enchantStats.has(key)) {
        enchantStats.set(key, { baseItem, enchantName: enchName, level, prices: [], basePrices: [] })
      }
      enchantStats.get(key).prices.push(salePrice)
      enchantStats.get(key).basePrices.push(basePrice)
    }
  }

  const tx = db.transaction(() => {
    for (const [key, data] of enchantStats) {
      const avgPrice = Math.round(data.prices.reduce((a, b) => a + b, 0) / data.prices.length)
      const avgBase = Math.round(data.basePrices.reduce((a, b) => a + b, 0) / data.basePrices.length)
      const multiplier = avgBase > 0 ? avgPrice / avgBase : 1
      const premium = avgPrice - avgBase
      insertEnchantStat.run(
        snapshot.timestamp,
        data.baseItem,
        data.enchantName,
        data.level,
        avgPrice,
        avgPrice,
        data.prices.length,
        data.prices.length,
        multiplier,
        premium
      )
    }

    for (const [key, data] of comboStats) {
      const avgPrice = Math.round(data.prices.reduce((a, b) => a + b, 0) / data.prices.length)
      const multiplier = data.baseEstimate > 0 ? avgPrice / data.baseEstimate : 1
      const enchantList = data.enchants.map(([n, l]) => `${n} ${l}`).join(', ')
      const hash = require('crypto').createHash('md5').update(key).digest('hex').slice(0, 16)
      insertEnchantCombo.run(
        snapshot.timestamp,
        data.item,
        hash,
        enchantList,
        avgPrice,
        data.prices.length,
        multiplier,
        data.baseEstimate
      )
    }
  })
  tx()
}

function getEnchantmentStats(baseItem, limit = 50) {
  return db
    .prepare(
      `
    SELECT * FROM enchantment_stats 
    WHERE base_item = ? 
    ORDER BY sale_count DESC, premium_over_base DESC 
    LIMIT ?
  `
    )
    .all(baseItem, limit)
}

function getEnchantmentCombos(itemName, limit = 20) {
  return db
    .prepare(
      `
    SELECT * FROM enchantment_combos 
    WHERE item_name = ? 
    ORDER BY sale_count DESC, value_multiplier DESC 
    LIMIT ?
  `
    )
    .all(itemName, limit)
}

function getTopEnchants(limit = 30) {
  return db
    .prepare(
      `
    SELECT enchant_name, enchant_level, AVG(value_multiplier) as avg_multiplier, SUM(sale_count) as total_sales, AVG(premium_over_base) as avg_premium
    FROM enchantment_stats 
    GROUP BY enchant_name, enchant_level 
    ORDER BY total_sales DESC, avg_multiplier DESC 
    LIMIT ?
  `
    )
    .all(limit)
}

function getEnchantmentTrends(enchantName, days = 7) {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000
  return db
    .prepare(
      `
    SELECT timestamp, AVG(value_multiplier) as avg_multiplier, AVG(premium_over_base) as avg_premium, SUM(sale_count) as sales
    FROM enchantment_stats 
    WHERE enchant_name = ? AND timestamp > ?
    GROUP BY DATE(timestamp/1000, 'unixepoch')
    ORDER BY timestamp
  `
    )
    .all(enchantName, cutoff)
}

function cleanup(olderThanDays = 30) {
  const cutoff = Date.now() - olderThanDays * 24 * 60 * 60 * 1000
  cleanupOldData.run(cutoff)
  cleanupOldAuctions.run(cutoff)
  cleanupOldTransactions.run(cutoff)
  db.prepare(`DELETE FROM enchantment_stats WHERE timestamp < ?`).run(cutoff)
  db.prepare(`DELETE FROM enchantment_combos WHERE timestamp < ?`).run(cutoff)
}

module.exports = {
  db,
  saveSnapshot,
  loadPriceHistory,
  loadAllPriceHistories,
  saveNeuralModel,
  loadNeuralModel,
  saveFlip,
  getFlipHistory,
  getFlipHistoryByItem,
  getMarketStatsHistory,
  cleanup,
  saveEnchantmentStats,
  getEnchantmentStats,
  getEnchantmentCombos,
  getTopEnchants,
  getEnchantmentTrends,
  close() {
    try {
      db.close()
    } catch (_) {}
  }
}
