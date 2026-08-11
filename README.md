# CartTogether

Shared household grocery list with live sync and bill splitting.

- **GitHub:** https://github.com/aidenreyes27/carttogether
- **Deploy to Render (free):** https://render.com/deploy?repo=https://github.com/aidenreyes27/carttogether

## Features

- Shared lists via share code
- Live sync, shop mode, aisle grouping
- Split bill: prices, who paid, who shares, settle-up math

## Local development

```bash
# backend
cd backend && uv sync && uv run uvicorn app.main:app --reload --port 8000

# frontend
cd frontend && npm install && npm run dev
```

Open http://localhost:5173

## Production (single server)

```bash
cd frontend && npm ci && npm run build
cd ../backend && uv sync && DATA_DIR=./data uv run uvicorn app.main:app --host 0.0.0.0 --port 8000
```
