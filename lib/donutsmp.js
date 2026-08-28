const { resolveName } = require('./items');

const BASE_URL = process.env.DONUTSMP_API_URL || 'https://api.donutsmp.net';
const API_KEY = process.env.DONUTSMP_API_KEY;
const TIMEOUT_MS = Number(process.env.API_TIMEOUT_MS || 15000);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const PAGE_DELAY = Number(process.env.API_PAGE_DELAY || 280);
const BATCH_SIZE = Number(process.env.API_BATCH_SIZE || 1);

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

async function fetchAllAuctions(maxPages = Number(process.env.AUCTION_PAGES || 9999), onProgress, onPartial) {
  if (!API_KEY) throw new UpstreamError('DONUTSMP_API_KEY is not configured', 503);
  const rows = [];
  let page = 1;
  let consecutiveEmpty = 0;
  let rateLimitDelay = 0;
  
  while (page <= maxPages) {
    if (rateLimitDelay > 0) {
      console.log(`[API] Rate-limited, backing off ${rateLimitDelay}ms`);
      await sleep(rateLimitDelay);
      rateLimitDelay = 0;
    }
    const batchEnd = Math.min(page + BATCH_SIZE - 1, maxPages);
    const batchPromises = [];
    for (let p = page; p <= batchEnd; p++) {
      batchPromises.push(auctionList(p).then(data => ({ page: p, rows: (data.result || []).map(r => normalizeAuction(r)) })).catch(e => ({ page: p, rows: [], error: e.message, isRateLimit: /429|rate limit/i.test(e.message) })));
    }
    const results = await Promise.all(batchPromises);
    results.sort((a, b) => a.page - b.page);
    
    for (const result of results) {
      if (result.error) {
        if (result.isRateLimit) {
          console.warn(`[API] Auction page ${result.page} rate-limited`);
          rateLimitDelay = 2000;
          consecutiveEmpty = 0;
          continue;
        }
        console.error(`[API] Auction page ${result.page} failed:`, result.error);
        consecutiveEmpty++;
        if (consecutiveEmpty >= 3) break;
        continue;
      }
      if (result.rows.length === 0) {
        consecutiveEmpty++;
        if (consecutiveEmpty >= 6) break;
      } else {
        consecutiveEmpty = 0;
      }
      rows.push(...result.rows);
      if (onProgress) onProgress({ type: 'auctions', page: result.page, total: rows.length });
    }
    
    if (onPartial && rows.length >= 500 && rows.length % 880 < 44) onPartial(rows);
    console.log(`[API] Auction batch ${page}-${batchEnd}: ${rows.length} total`);
    if (consecutiveEmpty >= 6) break;
    page = batchEnd + 1;
    await sleep(rateLimitDelay ? rateLimitDelay : PAGE_DELAY);
  }
  
  console.log(`[API] Total auctions: ${rows.length}`);
  return rows;
}

async function fetchTransactions(maxPages = Number(process.env.TRANSACTION_PAGES || 9999), onProgress) {
  if (!API_KEY) throw new UpstreamError('DONUTSMP_API_KEY is not configured', 503);
  const rows = [];
  let page = 1;
  let consecutiveEmpty = 0;
  
  while (page <= maxPages) {
    const batchEnd = Math.min(page + BATCH_SIZE - 1, maxPages);
    const batchPromises = [];
    for (let p = page; p <= batchEnd; p++) {
      batchPromises.push(apiFetch(`/v1/auction/transactions/${p}`).then(data => ({ page: p, rows: (data.result || []).map(r => normalizeAuction(r, true)) })).catch(e => ({ page: p, rows: [], error: e.message })));
    }
    const results = await Promise.all(batchPromises);
    results.sort((a, b) => a.page - b.page);
    
    for (const result of results) {
      if (result.error) {
        console.error(`[API] Transaction page ${result.page} failed:`, result.error);
        consecutiveEmpty++;
        if (consecutiveEmpty >= 3) break;
        continue;
      }
      if (result.rows.length === 0) {
        consecutiveEmpty++;
        if (consecutiveEmpty >= 6) break;
      } else {
        consecutiveEmpty = 0;
      }
      rows.push(...result.rows);
      if (onProgress) onProgress({ type: 'transactions', page: result.page, total: rows.length });
    }
    
    console.log(`[API] Transaction batch ${page}-${batchEnd}: ${rows.length} total`);
    if (consecutiveEmpty >= 6) break;
    page = batchEnd + 1;
    await sleep(PAGE_DELAY);
  }
  
  console.log(`[API] Total transactions: ${rows.length}`);
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