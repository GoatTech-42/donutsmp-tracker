# Pulse — DonutSMP Market Intelligence

Live auction tracker with filtered pricing, enchantment-aware flips, neural forecasts, and Groq AI one-liners.

## Run

```bash
# env
export DONUTSMP_API_KEY=...        # required — DonutSMP API key
export GROQ_API_KEY=...            # optional — AI analyst
export GROQ_API_KEY_2=...          # optional — fallback key
export GROQ_MODEL=qwen/qwen3.8-27b

npm install
npm start          # http://localhost:3001
```

## Docker

```bash
docker build -t donutsmp-tracker-new .
docker run -d --name donutsmp-tracker --restart unless-stopped \
  -p 4201:3001 -v pulse-data:/app/data \
  -e DONUTSMP_API_KEY=... -e GROQ_API_KEY=... donutsmp-tracker-new
```

The `pulse-data` volume persists SQLite price history + neural weights across restarts.

## Test

```bash
npm test          # 9 unit tests: IQR filter, normalize, enchant multipliers, NN training/save-load
```

## Architecture

- `server.js` — Express + Socket.IO, scan loop, REST endpoints, intelligence cache
- `lib/donutsmp.js` — DonutSMP API client (batched, rate-limit aware)
- `lib/analyzer.js` — flip detection, market building, variant grouping, NN orchestration
- `lib/neural-network.js` — Adam MLP (price/trend/anomaly heads), experience replay
- `lib/stats.js` — pure math: IQR/MAD filters, percentile, normalize, enchant multipliers
- `lib/ai.js` — Groq one-liner analyst
- `lib/storage.js` — SQLite persistence

## Key behaviors

- Prices are IQR-filtered to drop troll asks (e.g. Smooth Stone @ $1.6B)
- `fairValue` is transaction-anchored when ≥5 sales exist, else trimmed ask median
- Flips require completed-sale proof (no `sales === 0` snipes/crafts)
- Confidence is capped at 40% until an item has real transaction history
- Neural net trains on every scan completion, persists via `pulse-data` volume
