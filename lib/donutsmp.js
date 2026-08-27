const { resolveName } = require('./items');
const DONUT_API = 'https://api.donutsmp.net';
const API_KEY = process.env.DONUTSMP_API_KEY || '4555c4b255644eb798b1e3ad93210e67';

async function apiFetch(path, opts = {}) {
  const url = `${DONUT_API}${path}`;
  const res = await fetch(url, {
    ...opts,
    headers: { 'Authorization': `Bearer ${API_KEY}`, 'Content-Type': 'application/json', ...opts.headers }
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
  return res.json();
}

async function auctionList(page = 1, search = '', sort = '') {
  const body = {};
  if (search) body.search = search;
  if (sort) body.sort = sort;
  const opts = Object.keys(body).length ? { method: 'POST', body: JSON.stringify(body) } : {};
  return apiFetch(`/v1/auction/list/${page}`, opts);
}

// Fetch ALL auction pages and normalize items
async function fetchAllAuctions(search = '') {
  const allAuctions = [];
  let page = 1;
  let hasMore = true;

  while (hasMore && page <= 20) {
    try {
      const data = await auctionList(page, search);
      const items = data.result || [];
      if (items.length === 0) { hasMore = false; break; }

      for (const a of items) {
        const item = a.item || {};
        const count = item.count || 1;
        const name = item.display_name || resolveName(item);
        allAuctions.push({
          seller: a.seller,
          price: a.price,
          pricePerUnit: Math.round(a.price / count),
          count,
          itemName: name,
          itemId: item.id,
          timeLeft: a.time_left,
          item,
          enchants: item.enchants,
          contents: item.contents,
        });
      }

      if (items.length < 50) hasMore = false;
      page++;
      await new Promise(r => setTimeout(r, 200));
    } catch (e) {
      console.error(`[API] Page ${page} error:`, e.message);
      hasMore = false;
    }
  }

  return allAuctions;
}

// Fetch transaction history
async function fetchTransactions(pages = 5) {
  const allTx = [];
  for (let page = 1; page <= pages; page++) {
    try {
      const data = await apiFetch(`/v1/auction/transactions/${page}`);
      const items = data.result || [];
      for (const t of items) {
        const item = t.item || {};
        const count = item.count || 1;
        allTx.push({
          seller: t.seller,
          price: t.price,
          pricePerUnit: Math.round(t.price / count),
          count,
          itemName: item.display_name || resolveName(item),
          itemId: item.id,
          dateSold: t.unixMillisDateSold,
          item,
        });
      }
      await new Promise(r => setTimeout(r, 200));
    } catch (e) {
      console.error(`[API] Transactions page ${page} error:`, e.message);
    }
  }
  return allTx;
}

// Leaderboard
async function leaderboard(type, page = 1) {
  const validTypes = ['brokenblocks','deaths','kills','mobskilled','money','placedblocks','playtime','sell','shards','shop'];
  if (!validTypes.includes(type)) throw new Error(`Invalid leaderboard: ${type}`);
  return apiFetch(`/v1/leaderboards/${type}/${page}`);
}

// Player lookup
async function playerLookup(user) {
  return apiFetch(`/v1/lookup/${encodeURIComponent(user)}`);
}

async function playerStats(user) {
  return apiFetch(`/v1/stats/${encodeURIComponent(user)}`);
}

module.exports = {
  auctionList, fetchAllAuctions, fetchTransactions,
  leaderboard, playerLookup, playerStats,
};
