# Pulse — DonutSMP Market Intelligence

Pulse is a working market research dashboard for DonutSMP. It combines active auctions with completed sales to estimate fair value, rank risk-adjusted flips, monitor liquidity, and allocate a trading budget.

## What changed in 2.0

- Sale-backed fair values instead of using the highest active listing as a resale target
- Correct stack, crafting-output, auction-tax, ROI, and risk calculations
- Opportunity scanner for snipes, crafting spreads, and optional order arbitrage
- Market explorer, completed-sales ledger, portfolio lab, and player lookup
- Resilient upstream client with timeout, retry, pagination, validation, and no embedded secrets
- Fully functional zero-config demo mode; add a DonutSMP key to switch to live data
- Responsive, accessible product interface with real-time scan status
- Built-in API and analytics tests

## Run

```bash
npm ci
npm start
# http://localhost:3001
```

Copy `.env.example` to `.env` or export values in your runtime. Create the official API key in-game with `/api`.

```bash
DONUTSMP_API_KEY=your_key npm start
```

Without a key, Pulse intentionally starts with deterministic sample data so every workflow remains usable.

## Orders data

Research against the official Swagger specification at `https://api.donutsmp.net/doc.json` confirmed that the official public API exposes auction listings and transactions but **does not expose `/orders`**. Donut.Auction also states that its former order-listing API was retired. Pulse therefore does not scrape or misrepresent order data.

A provider-neutral connector is included for a future authorized source:

```bash
DONUTSMP_ORDERS_API_URL=https://provider.example/orders
DONUTSMP_ORDERS_API_KEY=optional_token
```

Accepted response shapes are an array, `{ "orders": [] }`, or `{ "result": [] }`. Rows may use `itemName`, `item_name`, or `name`, with `pricePerUnit`, `price_per_unit`, `unitPrice`, or `price`.

## API

| Endpoint | Purpose |
|---|---|
| `GET /api/health` | Feed and scanner health |
| `GET /api/overview` | Summary, signals, movers, data provenance |
| `GET /api/flips` | Filtered opportunity ranking |
| `GET /api/market` | Searchable market aggregates |
| `GET /api/market/:name` | Item listings, sales, and price history |
| `GET /api/transactions` | Paginated completed sales |
| `GET /api/orders` | Connector status and normalized orders |
| `GET /api/portfolio` | Risk-capped allocation model |
| `GET /api/leaderboards/:type` | Official leaderboard proxy |
| `GET /api/player/:name` | Public player lookup and stats |
| `POST /api/scan` | Trigger a refresh |
| `POST /api/ai/analyze` | Optional Groq-backed research brief |

## Quality checks

```bash
npm test
npm run check
```

## Data and risk disclaimer

Pulse is an independent analytics tool and is not affiliated with DonutSMP. Prices can move before execution. Opportunity estimates are research signals, not guarantees; verify listings in-game before trading.
