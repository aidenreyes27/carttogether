# CartTogether — Shared Grocery List

A simple household grocery list you can share with a code.

## What it does

- Create a list and get a 6-character share code
- Roommate joins with the code
- Add items with quantity + category
- Check items off while shopping
- Clear bought items when you’re done

## Run

```bash
# backend (port 8000)
cd backend && uv sync && uv run uvicorn app.main:app --reload --port 8000

# frontend (port 5173)
export PATH="$HOME/.local/node/bin:$PATH"
cd frontend && npm install && npm run dev
```

Open http://localhost:5173
