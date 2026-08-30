# v7 Plan — Both Dashboards Cosmos-Similar, Amazing (Aug 30)

> Pulse and DonutFlayer feel like the same studio — Cosmos `glass` on `#141414`, blue `#404ebf` accent, hand-crafted icons. No AI tells.

## Why this v7 replaces v6

- v6 covered tracker anomalies→neural integration + visual network, but Flayer was only "font parity". User now wants **full Flayer overhaul to match tracker** and **icons redesigned last** when everything works.
- Server is still down (storage.js missing after bad scp, build context 603B ghost, VOLUME not persisting) — v6 Phase 1 fixes must stay first.

## Shared Design Language (both apps)

- **Canvas:** `#141414` + `radial-gradient(ellipse at 20% 0%, rgba(64,78,191,.08))` wash, `glass: rgba(255,255,255,.06)` + `blur(12px)` cards, `border: rgba(255,255,255,.08)`, `--accent: #404ebf`, `--accent-glow: rgba(64,78,191,.25)`.
- **Motion:** `fadeSlideUp 0.3s`, `glowPulse`, `pulse` on live dot, `active` nav = blue + `box-shadow: glow`.
- **Nav:** 8 tracker views after trim (Overview, Opportunities, Explorer, Sales, Neural, Charts, Item, Players) — **drop Anomalies** as standalone; Flayer 3 views (Overview, Bots, Playground) mirrored sidebar, same brand SVG language.
- **Type:** Space Grotesk numbers/titles, DM Sans body, JetBrains Mono money.

## Phases — one commit each, Playwright green before next, push before deploy

### Phase 1 — Unblock deploy (server is down)

1. Fix `storage.js` missing: `scp` whole `lib/` as tar, verify `lsattr -e` cleared, `docker build --no-cache` includes `lib/`.
2. Fix Dockerfile: `VOLUME ["/app/data"]` + `chown -R node:node /app/data` + `USER node` after.
3. Fix env: run with `-v pulse-data:/app/data` and explicit `-e DONUTSMP_API_KEY... -e GROQ_API_KEY... -e GROQ_MODEL=qwen/qwen3.8-27b` (no `.env` file on host).
4. Keep `PAGE_DELAY 900ms` + 8-batch rate-limit cutoff — don't regress.

**Prove:** `curl /api/health` → `status:ok`, `curl /api/transactions` → paginates, `docker logs --tail` no `MODULE_NOT_FOUND` nor `SQLITE_CANTOPEN`.

### Phase 2 — Tracker streamlining (keep only useful)

- Keep: Overview · Opportunities · Explorer · Sales · Neural · Charts · Item · Players
- Remove: **Anomalies** tab/view/route/CSS. Data (Z>2/IQR + model `anomalyScore`) moves into Neural as "signals" strip — not a dead page.
- Keep 301 fallback: `navigate('anomalies')` → `navigate('neural')`.

### Phase 3 — Tracker Neural visual (the big one)

- **Top:** SVG brain — sampled 8 input dots → 12 → 6 → 1 (price) + 3 (trend) branches, animated edge glow on `scan:update`, weight thickness = abs(weight), neuron fill = activation for strongest prediction.
- **Middle:** Live strip — epoch counter, lastLoss sparkline (Chart.js canvas), `trainingSamples` + `lastTraining` relative, `mae/dirAccuracy` from `MarketPredictor.lastEval`.
- **Bottom:** Predictions table trimmed to `Item | Current | Predicted | Change | Trend | Conf` (no redundant `Signal` dup).
- Anomalies feed: up-sample Z>2 windows into next `train()` so outliers train the detector faster; show "N outliers → +M replay" in the strip.

### Phase 4 — Tracker correctness deep fix

1. Enchantment-aware: already `variantKey()` + `isEnchanted` — surface `+12%` badge in Explorer / Item detail / Overview `topFlips`.
2. Low-risk first: Opportunities sort `Low→Medium→High` then `confidence` (already), Overview "Best flips (low risk first)" header explicit.
3. Smooth/unstyled: `viewFade`, `board-refresh` without shimmer, health-grid styled, empty-states with dashed border — already `82933b9` but carry to Neural SVG.

### Phase 5 — Flayer full overhaul (match tracker)

- Mirror tracker's shell: `app-shell` grid 240px sidebar + `view.active` routing, same `panel`/`metric-card`/`flip-card`玻璃, same topbar (`pill` + `Export`/`Refresh`).
- Keep mineflayer fixes already shipped: `pathfinder` plugin loaded, `bot.dig(block)` fix, cached `require` at module level, `AUTH_FOLDER` env, reconnects start at 0, interval leak guards, `endsWith('_ore'/_log')`, `AUTH_FOLDER` + `minecraft-data` dep.
- Fix remaining: `bot.nerestEntity` mount race, `health/food` live via `bot.on('health')`, chat `slice(0,256)`, `findBlock` count per tick capped, `Movements` created once not per mine tick.
- Add live board: bot cards show mode/health/pos with pulse dot + `scan:progress` style bar for pathfinder.

### Phase 6 — Icons (when EVERYTHING works)

- Hand-crafted SVG, `sharp` render 512/64 PNG — **not** Pollinations.
- Pulse: heartbeat spike `M4 18 H11 L13 10 L15 26 L18 5 L21 23 L23 15 H32` on `rx=10` `linearGradient #5563d1→#404ebf` square.
- Flayer: geometric T-pickaxe `17×3` head + 22px handle, 1px grip gaps, same gradient.
- Ship as `/favicon.png` + `/pulse-logo.png` + `og:image` in both. Last commit so cache-bust `?v=6` lands together.

### Phase 7 — Playwright + monitor + efficiency

- `tests/e2e.spec.js`: Overview renders 12 flips, Explorer search, Neural SVG + loss canvas present, no `addEventListener(null)` console errors, no `429` after 900ms fix, Flayer bot create/stop/mount.
- Deploy via direct `scp lib/ → /opt/donutsmp-tracker/lib/` + `docker build --no-cache` (verified `ls -la /app/lib` non-empty before `docker run`).
- Monitor 10 min: `docker stats` tracker < 410 MiB, flayer < 120 MiB, `scanCount` ticks, `/api/health` stays `live`.

## Execution order

1 → 2 → 3 → 4 → 5 → 6 → 7. Each pushes `origin/main`, then `scp → /opt/... → build → run -p 4201:3001 / 4202:3000 → curl /api/health → playwright` before next. `deploy-tracker.sh` / `deploy-flayer.sh` committed at the end.

## Risks

- Removing anomalies breaks `#anomalies` links → fallback keeps them valid.
- SVG sampling 8/12/6 keeps DOM cheap; full 32→48→24 trains underneath unseen.
- `pulse-data` and `flayer-auth` volumes must exist (`docker volume create` already did).
