const { test, beforeEach, afterEach } = require('node:test')
const assert = require('node:assert')

process.env.DONUTSMP_API_KEY = 'dead-key'
process.env.API_PAGE_DELAY = '0'

function stubFetch(status, body) {
  globalThis.fetch = async () => ({
    ok: false,
    status,
    text: async () => body
  })
}

let api
beforeEach(() => {
  delete require.cache[require.resolve('../lib/donutsmp.js')]
  api = require('../lib/donutsmp.js')
})
afterEach(() => {
  delete globalThis.fetch
})

test('auction pass surfaces upstream 401 instead of empty rows', async () => {
  stubFetch(401, '{"status":401,"reason":"Unauthorized","message":"Please generate an API Key in game with /api"}')
  await assert.rejects(() => api.fetchAllAuctions(1), /401|Unauthorized/)
})

test('transaction pass surfaces upstream 401 instead of empty rows', async () => {
  stubFetch(401, '{"status":401,"reason":"Unauthorized"}')
  await assert.rejects(() => api.fetchTransactions(1), /401|Unauthorized/)
})

test('empty market with no errors still returns zero rows', async () => {
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ result: [] }) })
  const rows = await api.fetchAllAuctions(1)
  assert.deepStrictEqual(rows, [])
})
