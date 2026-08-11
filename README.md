# CartTogether

Shared household grocery list with live sync and bill splitting.

- **Live site:** https://carttogether.onrender.com
- **GitHub:** https://github.com/aidenreyes27/carttogether

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
