const { resolveName } = require('./items');

const BASE_URL = process.env.DONUTSMP_API_URL || 'https://api.donutsmp.net';
const API_KEY = process.env.DONUTSMP_API_KEY;
const TIMEOUT_MS = Number(process.env.API_TIMEOUT_MS || 15000);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

class UpstreamError extends Error {
  constructor(message, status = 502) { super(message); this.name = 'UpstreamError'; this.status = status; }
}

async function apiFetch(path, options = {}) {
  if (!API_KEY) throw new UpstreamError('DONUTSMP_API_KEY is not configured', 503);
  let error;
  for (let attempt = 0; attempt < 3; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await fetch(`${BASE_URL}${path}`, {
        ...options,
        signal: controller.signal,
        headers: { Authorization: `Bearer ${API_KEY}`, Accept: 'application/json', 'Content-Type': 'application/json', ...options.headers }
      });
      if (response.ok) return await response.json();
      const body = (await response.text()).slice(0, 240);
      error = new UpstreamError(`DonutSMP API returned ${response.status}${body ? `: ${body}` : ''}`, response.status === 429 ? 429 : 502);
      if (response.status < 500 && response.status !== 429) break;
    } catch (caught) {
      error = new UpstreamError(caught.name === 'AbortError' ? 'DonutSMP API timed out' : caught.message);
    } finally { clearTimeout(timer); }
    await sleep(500 * (attempt + 1));
  }
  throw error;
}

function normalizeAuction(row, sold = false) {
  const item = row.item || {};
  const count = Math.max(1, Number(item.count || row.count || 1));
  const price = Number(row.price || 0);
  const enchants = item.enchants?.enchantments?.levels || {};
  const contents = item.contents || [];
  const shulkerValue = contents.reduce((sum, c) => sum + (c.pricePerUnit || 0) * (c.count || 1), 0);
  return {
    id: row.id || row.auction_id || `${row.seller?.uuid || row.seller?.name || 'unknown'}-${price}-${item.id || ''}`,
    seller: row.seller || null,
    buyer: row.buyer || null,
    price,
    pricePerUnit: Math.round(price / count),
    count,
    itemName: item.display_name || resolveName(item),
    itemId: item.id || 'unknown',
    timeLeft: row.time_left || null,
    dateSold: sold ? (row.unixMillisDateSold || row.dateSold || null) : null,
    enchants,
    contents,
    shulkerValue,
    item
  };
}

async function auctionList(page = 1, search = '', sort = '') {
  const body = {};
  if (search) body.search = search;
  if (sort) body.sort = sort;
  return apiFetch(`/v1/auction/list/${page}`, Object.keys(body).length ? { method: 'POST', body: JSON.stringify(body) } : {});
}

async function fetchAllAuctions(maxPages = Number(process.env.AUCTION_PAGES || 9999)) {
  if (!API_KEY) throw new UpstreamError('DONUTSMP_API_KEY is not configured', 503);
  const rows = [];
  let page = 1;
  let consecutiveEmpty = 0;
  
  while (page <= maxPages) {
    try {
      const data = await auctionList(page);
      const pageRows = data.result || [];
      
      if (pageRows.length === 0) {
        consecutiveEmpty++;
        if (consecutiveEmpty >= 3) break;
      } else {
        consecutiveEmpty = 0;
      }
      
      rows.push(...pageRows.map(row => normalizeAuction(row)));
      console.log(`[API] Page ${page}: ${pageRows.length} auctions (total: ${rows.length})`);
      
      page++;
      await sleep(200);
    } catch (e) {
      console.error(`[API] Page ${page} failed:`, e.message);
      break;
    }
  }
  
  console.log(`[API] Total auctions fetched: ${rows.length} across ${page - 1} pages`);
  return rows;
}

async function fetchTransactions(pages = Number(process.env.TRANSACTION_PAGES || 9999)) {
  if (!API_KEY) throw new UpstreamError('DONUTSMP_API_KEY is not configured', 503);
  const rows = [];
  let page = 1;
  let consecutiveEmpty = 0;
  
  while (page <= pages) {
    try {
      const data = await apiFetch(`/v1/auction/transactions/${page}`);
      const pageRows = data.result || [];
      
      if (pageRows.length === 0) {
        consecutiveEmpty++;
        if (consecutiveEmpty >= 3) break;
      } else {
        consecutiveEmpty = 0;
      }
      
      rows.push(...pageRows.map(row => normalizeAuction(row, true)));
      console.log(`[API] Transactions page ${page}: ${pageRows.length} sales (total: ${rows.length})`);
      
      page++;
      await sleep(200);
    } catch (e) {
      console.error(`[API] Transactions page ${page} failed:`, e.message);
      break;
    }
  }
  
  console.log(`[API] Total transactions fetched: ${rows.length} across ${page - 1} pages`);
  return rows.sort((a, b) => b.dateSold - a.dateSold);
}

async function leaderboard(type, page = 1) {
  const valid = ['brokenblocks', 'deaths', 'kills', 'mobskilled', 'money', 'placedblocks', 'playtime', 'sell', 'shards', 'shop'];
  if (!valid.includes(type)) throw new Error('Invalid leaderboard type');
  if (!API_KEY) throw new UpstreamError('DONUTSMP_API_KEY is not configured', 503);
  return apiFetch(`/v1/leaderboards/${type}/${page}`);
}

async function playerLookup(user) {
  if (!API_KEY) throw new UpstreamError('DONUTSMP_API_KEY is not configured', 503);
  return apiFetch(`/v1/lookup/${encodeURIComponent(user)}`);
}

async function playerStats(user) {
  if (!API_KEY) throw new UpstreamError('DONUTSMP_API_KEY is not configured', 503);
  return apiFetch(`/v1/stats/${encodeURIComponent(user)}`);
}

module.exports = { apiFetch, auctionList, fetchAllAuctions, fetchTransactions, leaderboard, playerLookup, playerStats, normalizeAuction, hasApiKey: Boolean(API_KEY) };