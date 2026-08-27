const { resolveName } = require('./items');
const { demoAuctions, demoTransactions, demoLeaderboard } = require('./demo-data');

const BASE_URL = process.env.DONUTSMP_API_URL || 'https://api.donutsmp.net';
const API_KEY = process.env.DONUTSMP_API_KEY;
const TIMEOUT_MS = Number(process.env.API_TIMEOUT_MS || 12000);
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
    await sleep(350 * (attempt + 1));
  }
  throw error;
}

function normalizeAuction(row, sold = false) {
  const item = row.item || {};
  const count = Math.max(1, Number(item.count || row.count || 1));
  const price = Number(row.price || 0);
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
    item
  };
}

async function auctionList(page = 1, search = '', sort = '') {
  const body = {};
  if (search) body.search = search;
  if (sort) body.sort = sort;
  // The upstream accepts POST for its documented optional request body; GET bodies are rejected by fetch.
  return apiFetch(`/v1/auction/list/${page}`, Object.keys(body).length ? { method: 'POST', body: JSON.stringify(body) } : {});
}

async function fetchAllAuctions(maxPages = Number(process.env.AUCTION_PAGES || 20)) {
  if (!API_KEY) return demoAuctions();
  const rows = [];
  for (let page = 1; page <= Math.min(20, maxPages); page++) {
    const data = await auctionList(page);
    const pageRows = data.result || [];
    rows.push(...pageRows.map(row => normalizeAuction(row)));
    if (pageRows.length < 100) break;
    await sleep(100);
  }
  return rows;
}

async function fetchTransactions(pages = Number(process.env.TRANSACTION_PAGES || 5)) {
  if (!API_KEY) return demoTransactions();
  const rows = [];
  for (let page = 1; page <= Math.min(10, pages); page++) {
    const data = await apiFetch(`/v1/auction/transactions/${page}`);
    const pageRows = data.result || [];
    rows.push(...pageRows.map(row => normalizeAuction(row, true)));
    if (!pageRows.length) break;
    await sleep(100);
  }
  return rows.sort((a, b) => b.dateSold - a.dateSold);
}

async function leaderboard(type, page = 1) {
  const valid = ['brokenblocks', 'deaths', 'kills', 'mobskilled', 'money', 'placedblocks', 'playtime', 'sell', 'shards', 'shop'];
  if (!valid.includes(type)) throw new Error('Invalid leaderboard type');
  if (!API_KEY) return demoLeaderboard(type, page);
  return apiFetch(`/v1/leaderboards/${type}/${page}`);
}

async function playerLookup(user) {
  if (!API_KEY) return { result: { name: user, uuid: 'demo-profile', demo: true } };
  return apiFetch(`/v1/lookup/${encodeURIComponent(user)}`);
}

async function playerStats(user) {
  if (!API_KEY) return { result: { money: 128450000, shards: 2840, kills: 418, deaths: 73, playtime: 582140, broken_blocks: 1843200, demo: true } };
  return apiFetch(`/v1/stats/${encodeURIComponent(user)}`);
}

async function fetchOrders() {
  const url = process.env.DONUTSMP_ORDERS_API_URL;
  if (!url) return [];
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal, headers: process.env.DONUTSMP_ORDERS_API_KEY ? { Authorization: `Bearer ${process.env.DONUTSMP_ORDERS_API_KEY}` } : {} });
    if (!response.ok) throw new UpstreamError(`Orders provider returned ${response.status}`);
    const payload = await response.json();
    const rows = Array.isArray(payload) ? payload : payload.result || payload.orders || [];
    return rows.map((row, index) => ({ id: row.id || `order-${index}`, itemName: row.itemName || row.item_name || row.name, pricePerUnit: Number(row.pricePerUnit || row.price_per_unit || row.unitPrice || row.price), quantity: Number(row.quantity || row.amount || 1), buyer: row.buyer || null })).filter(row => row.itemName && row.pricePerUnit > 0);
  } finally { clearTimeout(timer); }
}

module.exports = { apiFetch, auctionList, fetchAllAuctions, fetchTransactions, fetchOrders, leaderboard, playerLookup, playerStats, normalizeAuction, hasApiKey: Boolean(API_KEY), ordersConfigured: Boolean(process.env.DONUTSMP_ORDERS_API_URL) };
