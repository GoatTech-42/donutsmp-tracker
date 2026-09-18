const { test, before, after } = require('node:test')
const assert = require('node:assert')
const os = require('os')
const path = require('path')
const fs = require('fs')

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-key-')), 'pulse.db')
process.env.MC_REVIVE_TOKEN = 'test-token-123'
process.env.DONUTSMP_API_KEY = 'dead-key'
process.env.API_PAGE_DELAY = '0'

let server, base, api, state
before(async () => {
  const mod = require('../server.js')
  api = require('../lib/donutsmp.js')
  server = mod.server
  state = mod.state
  await new Promise(r => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${server.address().port}`
})
after(() => server.close())

const postKey = (key, token) =>
  fetch(base + '/api/key', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: JSON.stringify({ key })
  })

test('rejects missing auth', async () => {
  const r = await postKey('a'.repeat(32))
  assert.strictEqual(r.status, 401)
})

test('rejects wrong token', async () => {
  const r = await postKey('a'.repeat(32), 'wrong-token')
  assert.strictEqual(r.status, 401)
})

test('rejects malformed key', async () => {
  const r = await postKey('nope', 'test-token-123')
  assert.strictEqual(r.status, 400)
})

test('accepts valid key, persists it, and hot-swaps the scanner key', async () => {
  state.scanning = true // keep the endpoint from kicking a live network scan
  const key = 'b'.repeat(32)
  const r = await postKey(key, 'test-token-123')
  assert.strictEqual(r.status, 200)
  assert.deepStrictEqual(await r.json(), { ok: true })
  assert.strictEqual(api.hasApiKey(), true)
  const kf = path.join(path.dirname(process.env.DB_PATH), 'donutsmp.key')
  assert.strictEqual(fs.readFileSync(kf, 'utf8').trim(), key)
  assert.strictEqual(state.authDead, false)
})
