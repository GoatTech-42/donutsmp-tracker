# DonutSMP Tracker

DonutSMP auction tracker with AI market analyst powered by Groq.

## Features

- Live auction house scanning (items, prices, sellers, time left)
- Transaction history tracking
- 10 leaderboards (money, shards, kills, playtime, etc.)
- Player lookup with full stats
- Cross-market arbitrage detection (/orders vs /ah)
- AI market analysis with Groq (auto-runs every 5 minutes)
- AI chat for custom market questions
- Shield config/metrics/stats viewer
- Compact number formatting (1k, 1M, etc.)
- Markdown-rendered AI output with tables, lists, and code blocks

## Setup

```bash
npm install
DONUTSMP_API_KEY=your_key GROQ_API_KEY=your_key node server.js
```

Dashboard runs on port 3001.

## Docker

```bash
docker build -t donutsmp-tracker .
docker run -d -p 3001:3001 \
  -e DONUTSMP_API_KEY=your_key \
  -e GROQ_API_KEY=your_key \
  donutsmp-tracker
```

## API

| Endpoint | Description |
|---|---|
| `GET /api/health` | Health check |
| `GET /api/auction/list?page=&search=&sort=` | Auction house listings |
| `GET /api/auction/transactions?page=` | Transaction history |
| `GET /api/leaderboard/:type?page=` | Leaderboard data |
| `GET /api/player/lookup/:user` | Player lookup |
| `GET /api/player/stats/:user` | Player stats |
| `GET /api/market/overview` | Market overview |
| `GET /api/market/trends` | Price trends |
| `POST /api/ai/analyze` | Trigger AI analysis |
| `POST /api/ai/ask` | Ask AI a question |

## Stack

- Node.js + Express + Socket.IO
- DonutSMP API (`api.donutsmp.net`)
- Groq AI (`openai/gpt-oss-120b`)
- Marked.js (markdown rendering)
- Vanilla HTML/CSS/JS frontend
