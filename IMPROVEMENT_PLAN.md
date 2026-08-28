# DonutSMP Tracker — Improvement Plan

## What We Just Did (v2.1)
- Removed Portfolio view (orders API doesn't exist)
- Fixed refresh feed button (was calling nonexistent `/api/scan`, now `/api/refresh`)
- Fixed ai.js triplicated functions (compact, request, buildMarketContext were copy-pasted 3x)
- Added Z-score + IQR statistical outlier detection to neural network
- Added `/api/outliers` endpoint
- Added outlier panel to Overview + merged with Anomalies view
- Fixed item detail navigation (was reading URL params that don't exist, now uses `state.itemName`)
- Added click-to-detail on flip cards and market rows
- Added training loss chart to Neural view
- Anomaly detector now trains continuously alongside price/trend predictors
- All changes use blue Cosmos theme (`#404ebf`)

## What We Just Did (v2.2)
- Experience replay buffer (500 samples) for neural network training stability
- Training interval lowered to 60s for continuous learning
- AI analyst: tighter one-liner format, better craft flip context
- `/api/export` endpoint (JSON + CSV download)
- Export button in topbar
- Enchantment flip detection: buy base + enchantment book → enchanted item → sell
- Enchantment badge on flip cards
- CSS: sparkline, skeleton loader, scan-progress, badge risk styles
- Scan progress bar in sidebar
- Sequential batched fetching (BATCH_SIZE=1, PAGE_DELAY=280ms) for 250 req/min limit
- Review cleanup (81 issues found, ~30 fixed)
- Hand-crafted SVG logos (pulse heartbeat + T pickaxe → sharp PNG via `sharp`)
- Accuracy probe: confirmed no `/worth` endpoint exists on DonutSMP API

## v3 Plan — Accuracy, AI, Dashboard, RAM, Logos (Aug 28)

### The Problem (diagnosed)
- **Accuracy is the #1 complaint.** `buildMarket()` feeds raw ask prices (including troll listings like `$1.2B shulker_box`) into `floor = Math.min(..asks)`, `median`, `avg`, and `fairValue`. One troll item can tank `floor` or inflate `fairValue`. Auctions are asking prices, not real value — completed transactions are the only proof of what people actually pay. We have no server `/worth` to fall back on (probed every plausible endpoint; all 404).
- **AI analyst one-liners are gone from the UI.** Backend `POST /api/ai/analyze` still works but no overview card calls it. Users see a dead panel.
- **Dashboard is siloed.** 8 separate tab views; none show "a little of everything." User wants a live, always-refreshing command center, not a tab crawler.
- **NN training is gated** behind `trainingInterval = 60s` and only fires inside `addSnapshot` — long gaps, missed signals.
- **RAM is high.** Full scans pull 30k+ auctions + 1k transactions into memory, hold snapshots, and never GC-aggressively.
- **Logos shipped as AI slop** (Pollinations PNGs). New minimalist SVGs are done locally but not yet the favicon.

### Phase A — Accuracy (do first; everything else depends on correct prices)
| # | Change | Detail |
|---|--------|--------|
| A1 | IQR-filter asks before any stat | In `buildMarket`, compute Q1/Q3, drop prices outside `[Q1-1.5*IQR, Q3+1.5*IQR]` before `floor/median/avg/q1`. If only 1–2 listings, keep raw (not enough to judge). |
| A2 | Transaction-anchored `fairValue` | If `salePrices.length >= 5`, `fairValue = median(salePrices)` (already does 3 — raise to 5 for confidence). If `< 5` sales, `fairValue = IQR-filtered median(asks)`, and mark `confidence` lower so flips don't pretend it's solid. |
| A3 | Trimmed `floor` | `floor = min(IQR-filtered asks)` — ignore single-coin troll dumps and $1B memes. Expose both `floorRaw` and `floorFiltered` for debugging. |
| A4 | Volatility from filtered data | Compute `volatility`/`avg` from the filtered set too. |
| A5 | `/api/market/:name` outlier flag | Return `isOutlierListing` per listing so UI can grey-out junk. |
| A6 | Flip confidence gate | Don't surface snipe flips where `sales < 2` and `confidence < 30` — they look profitable only because the market is noise. |
| | **Success:** Auctions with 1 outlier + 5 normal listings no longer show floor = 1. `/api/market?sort=confidence` actually correlates with real liquidity. |

### Phase B — AI + Neural (tight loop, no dead panels)
| # | Change | Detail |
|---|--------|--------|
| B1 | Restore AI one-liner panel on Overview | Card at top of Overview: `AI Analyst — 5 one-liners`, auto-fetches `POST /api/ai/analyze` on load + after every scan. Show model + latency. Gracefully hides if `GROQ_API_KEY` missing. |
| B2 | AI quick-ask stays (already on page) | Keep `POST /api/ai/ask` for ad-hoc "is X worth buying?" — surface as a small input under the panel. |
| B3 | Continuous NN training | Remove the 60s gate. On every `addSnapshot`, if `history.length >= 15` for ≥5 items, do one short training pass (15–20 epochs) async so scans don't block. Keep `pricePredictor`, `trendPredictor`, `anomalyDetector` + experience replay. |
| B4 | Live training indicator | Tiny sparkline + "trained 3s ago · loss 0.041" in the Overview's `nn-status` card, updates via socket. |
| | **Success:** Visiting Overview shows fresh AI picks within 2s of scan completion; NN loss visibly ticks down across scans. |

### Phase C — Dashboard "a little of everything, constantly"
| # | Change | Detail |
|---|--------|--------|
| C1 | Overview becomes the real dashboard | Keep tab views but make Overview dense: (1) AI one-liners, (2) top 5 flips, (3) active market pulse (7), (4) movers (7), (5) NN predictions (8), (6) NN status + training chart, (7) outliers (8), (8) data health, (9) live event ticker (last 10 auction/transaction events via socket). No scrolling through tabs to "see what's happening." |
| C2 | Socket fanout for everything | `scan:progress` already exists; add `market:tick` after each scan with `{ summary, topFlips, movers, predictions }` so Overview refreshes without full reload. Other tabs still lazy-load. |
| C3 | Auto-refresh Overview on `scan:update` | Already wired; keep it, but make it swap content without the loading shimmer so it feels live, not janky. |
| | **Success:** One screen answers "what should I flip right now, is it safe, and what does the AI think?" without clicking a tab. |

### Phase D — Lower RAM
| # | Change | Detail |
|---|--------|--------|
| D1 | Node GC + heap cap | `Dockerfile` `CMD` → `node --max-old-space-size=768 --expose-gc server.js`. In `server.js`, call `global.gc()` after each scan if exposed. Document env override `NODE_OPTIONS`. |
| D2 | Don't hold raw 30k auctions in `analyzer.snapshots` | `snapshots[].items` already stores compact per-item stats; stop storing `lastAuctions` as a full 30k array — keep only the grouped/market summary. Provide `state.auctionCount` instead of `state.auctions.length` where needed. |
| D3 | SQLite: cap + WAL | Already `WAL + cache_size -32768`; add `PRAGMA temp_store = MEMORY` and keep `cleanup(30)` aggressive. |
| D4 | Batch delay slightly higher if RAM-constrained | Keep `BATCH_SIZE=1, PAGE_DELAY=280` but allow env `API_PAGE_DELAY` so low-RAM VPS can go 400ms without code change. |
| | **Success:** `docker stats` shows tracker under ~700 MB RSS during scans; no OOM on 1 GB VPS. |

### Phase E — Logos (final)
| # | Change | Detail |
|---|--------|--------|
| E1 | Replace Pollinations PNGs with the new minimalist SVGs | `logos/pulse-logo.svg` (heartbeat line) + `logos/donutflayer-logo.svg` (T pickaxe), both blue `#404ebf→#5563d1`. Use `sharp` to render 512 + 64 PNG. Set as `/favicon.png` and `/public/*-logo.png`. Also update the inline brand-mark SVGs to match. |
| E2 | Ship OG image | Use the 512 PNG as `og:image` via `<meta property="og:image" content="/pulse-logo.png">`. |
| | **Success:** Favicon + brand icon are the same clean shape at every size; no fuzzy AI artifact. |

### Execution Order
1. Phase A (accuracy) — blocks meaningful testing of everything else
2. Phase B (AI + continuous training)
3. Phase C (dashboard density)
4. Phase D (RAM)
5. Phase E (logos)

Estimated: A+B ~2 commits, C+D+E ~1 commit each. All pushed locally first, then `scp` + `docker build --no-cache` + `docker run` to `192.168.0.240`.

### Risks
- IQR filtering too aggressive on thin markets (1–3 listings) — mitigated by falling back to raw when `asks.length < 4`.
- No `/worth` means we can never be "authoritative" — we explicitly show `confidence` and `sales` so users know when a price is thin.

## What's Next

### Phase 1: Data Coverage (immediate)
- [ ] Add smelting/furnace/campfire/smoker/blast furnace recipes (PrismarineJS doesn't differentiate these)
- [ ] Add stonecutter, smithing table, loom, cartography recipes
- [ ] Map all PrismarineJS item IDs to DonutSMP display names
- [ ] Track all 1255 vanilla items + DonutSMP custom items

### Phase 2: Neural Network (this week)
- [x] Experience replay buffer for training stability
- [ ] Add LSTM/GRU temporal layers for better sequence prediction
- [ ] Multi-horizon predictions (1h, 6h, 24h, 7d)
- [ ] Uncertainty quantification (prediction intervals)
- [ ] Adversarial validation for distribution shift detection
- [ ] Model checkpointing + rollback on degradation

### Phase 3: Intelligence (this week)
- [x] Enchantment flip calculation (buy base + books → enchant → sell)
- [ ] Cross-market arbitrage detection
- [ ] Multi-step craft chain optimization (recursive)
- [ ] Shulker box arbitrage (buy contents → box → sell)
- [ ] Whale tracking (large buyer/seller patterns)
- [ ] Time-of-day pricing patterns
- [ ] Kelly Criterion position sizing per flip

### Phase 4: Visualization (next week)
- [ ] Real-time WebSocket charts (live price updates)
- [ ] Volume bars on price charts
- [ ] Technical indicator overlays (RSI, MACD, Bollinger Bands)
- [ ] Neural prediction confidence bands
- [ ] Anomaly timeline view
- [ ] Enchantment premium heatmap
- [ ] Training loss curve (real-time)

### Phase 5: Reliability (next week)
- [ ] Health checks with diagnostics
- [ ] Graceful degradation (demo mode if API down)
- [ ] Groq key rotation + failover
- [ ] Database backup + point-in-time recovery
- [ ] Structured logging
- [ ] API documentation (OpenAPI)

### Phase 6: AI (month 2)
- [ ] Structured JSON output from AI analyst
- [ ] Chain-of-thought for complex multi-step flips
- [ ] Self-consistency (run multiple times, vote)
- [ ] Feedback loop (user confirms/rejects flips → trains reward model)
- [ ] RAG: embed historical market reports for context

### Phase 7: Advanced (month 2+)
- [ ] Auto-buy/auto-sell via bot integration
- [ ] Smart relisting based on competition
- [ ] Demand forecasting for farmable items
- [ ] Update/patch impact prediction
- [ ] Public flip leaderboard
- [ ] Strategy sharing (anonymized)

## Success Metrics
| Metric | Target |
|--------|--------|
| Scan coverage | 100% of active auctions + transactions |
| Recipe coverage | 100% vanilla + DonutSMP custom |
| Enchantment tracking | 100% vanilla enchants + combos |
| Neural training | Continuous (every scan) |
| Model accuracy (24h) | >70% directional accuracy |
| Flip detection | >95% of profitable flips found |
| AI quality | >90% actionable, <5% hallucination |
| Uptime | 99.9% |
| API latency (p95) | <500ms |
