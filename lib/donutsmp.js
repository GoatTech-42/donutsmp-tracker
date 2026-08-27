const DONUT_API = 'https://api.donutsmp.net';
const API_KEY = process.env.DONUTSMP_API_KEY;
if (!API_KEY) console.warn('[Tracker] DONUTSMP_API_KEY not set');

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

async function auctionTransactions(page = 1) {
  return apiFetch(`/v1/auction/transactions/${page}`);
}

async function playerLookup(user) {
  return apiFetch(`/v1/lookup/${encodeURIComponent(user)}`);
}

async function playerStats(user) {
  return apiFetch(`/v1/stats/${encodeURIComponent(user)}`);
}

async function leaderboard(type, page = 1) {
  const validTypes = ['brokenblocks','deaths','kills','mobskilled','money','placedblocks','playtime','sell','shards','shop'];
  if (!validTypes.includes(type)) throw new Error(`Invalid leaderboard: ${type}`);
  return apiFetch(`/v1/leaderboards/${type}/${page}`);
}

async function allLeaderboards(page = 1) {
  const types = ['brokenblocks','deaths','kills','mobskilled','money','placedblocks','playtime','sell','shards','shop'];
  const results = {};
  await Promise.allSettled(types.map(async t => { results[t] = await leaderboard(t, page); }));
  return results;
}

async function shieldConfig(service, platform = 'java') {
  return apiFetch(`/v1/shield/${platform}/config/${encodeURIComponent(service)}`);
}

async function shieldUpdateConfig(service, data, platform = 'java') {
  return apiFetch(`/v1/shield/${platform}/config/${encodeURIComponent(service)}`, {
    method: 'PUT', body: JSON.stringify(data)
  });
}

async function shieldMetrics(service) {
  return apiFetch(`/v1/shield/metrics/${encodeURIComponent(service)}`);
}

async function shieldStats(service) {
  return apiFetch(`/v1/shield/stats/${encodeURIComponent(service)}`);
}

async function shieldConfigV2(service, platform = 'bedrock') {
  return apiFetch(`/v2/shield/${platform}/config/${encodeURIComponent(service)}`);
}

async function shieldUpdateConfigV2(service, data, platform = 'bedrock') {
  return apiFetch(`/v2/shield/${platform}/config/${encodeURIComponent(service)}`, {
    method: 'PUT', body: JSON.stringify(data)
  });
}

module.exports = {
  auctionList, auctionTransactions, playerLookup, playerStats,
  leaderboard, allLeaderboards, shieldConfig, shieldUpdateConfig,
  shieldMetrics, shieldStats, shieldConfigV2, shieldUpdateConfigV2
};
