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
