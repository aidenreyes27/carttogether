from __future__ import annotations

import json
import sqlite3
import string
import random
import uuid
from datetime import datetime, timezone
from pathlib import Path
from threading import Lock

import os

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

DATA_DIR = Path(os.environ.get("DATA_DIR", Path(__file__).resolve().parent.parent / "data"))
DB_PATH = DATA_DIR / "grocery.db"
FRONTEND_DIST = Path(__file__).resolve().parent.parent.parent / "frontend" / "dist"
_lock = Lock()

app = FastAPI(title="Shared Grocery List")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


class CreateListRequest(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    created_by: str = Field(default="You", min_length=1, max_length=40)


class JoinResponse(BaseModel):
    id: str
    name: str
    share_code: str


class AddItemRequest(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    quantity: str = Field(default="1", max_length=40)
    category: str = Field(default="Other", max_length=40)
    added_by: str = Field(default="You", max_length=40)
    urgent: bool = False


class ItemCostUpdate(BaseModel):
    price: float = Field(ge=0, default=0)
    paid_by: str = Field(default="", max_length=40)
    split_among: list[str] = Field(default_factory=list)


class MemberRequest(BaseModel):
    name: str = Field(min_length=1, max_length=40)


class Item(BaseModel):
    id: str
    name: str
    quantity: str
    category: str
    added_by: str
    bought: bool
    urgent: bool = False
    price: float = 0
    paid_by: str = ""
    split_among: list[str] = Field(default_factory=list)
    created_at: str


class PersonBalance(BaseModel):
    name: str
    paid: float
    owes: float
    net: float


class SettleUp(BaseModel):
    total: float
    priced_items: int
    balances: list[PersonBalance]
    transfers: list[dict]


class GroceryList(BaseModel):
    id: str
    name: str
    share_code: str
    members: list[str] = Field(default_factory=list)
    items: list[Item]
    updated_at: str = ""
    settle: SettleUp | None = None


def _connect() -> sqlite3.Connection:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def _ensure_column(conn: sqlite3.Connection, table: str, column: str, ddl: str) -> None:
    cols = {r["name"] for r in conn.execute(f"PRAGMA table_info({table})").fetchall()}
    if column not in cols:
        conn.execute(f"ALTER TABLE {table} ADD COLUMN {ddl}")


def init_db() -> None:
    with _lock:
        conn = _connect()
        try:
            conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS lists (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    share_code TEXT NOT NULL UNIQUE,
                    created_by TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL DEFAULT '',
                    members_json TEXT NOT NULL DEFAULT '[]'
                );
                CREATE TABLE IF NOT EXISTS items (
                    id TEXT PRIMARY KEY,
                    list_id TEXT NOT NULL,
                    name TEXT NOT NULL,
                    quantity TEXT NOT NULL,
                    category TEXT NOT NULL,
                    added_by TEXT NOT NULL,
                    bought INTEGER NOT NULL DEFAULT 0,
                    urgent INTEGER NOT NULL DEFAULT 0,
                    price REAL NOT NULL DEFAULT 0,
                    paid_by TEXT NOT NULL DEFAULT '',
                    split_among_json TEXT NOT NULL DEFAULT '[]',
                    created_at TEXT NOT NULL,
                    FOREIGN KEY(list_id) REFERENCES lists(id)
                );
                """
            )
            _ensure_column(conn, "items", "urgent", "urgent INTEGER NOT NULL DEFAULT 0")
            _ensure_column(conn, "items", "price", "price REAL NOT NULL DEFAULT 0")
            _ensure_column(conn, "items", "paid_by", "paid_by TEXT NOT NULL DEFAULT ''")
            _ensure_column(conn, "items", "split_among_json", "split_among_json TEXT NOT NULL DEFAULT '[]'")
            _ensure_column(conn, "lists", "updated_at", "updated_at TEXT NOT NULL DEFAULT ''")
            _ensure_column(conn, "lists", "members_json", "members_json TEXT NOT NULL DEFAULT '[]'")
            conn.commit()
        finally:
            conn.close()


def _code() -> str:
    alphabet = string.ascii_uppercase + string.digits
    return "".join(random.choice(alphabet) for _ in range(6))


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _touch_list(conn: sqlite3.Connection, list_id: str) -> None:
    conn.execute("UPDATE lists SET updated_at = ? WHERE id = ?", (_now(), list_id))


def _parse_json_list(raw: str | None) -> list[str]:
    if not raw:
        return []
    try:
        data = json.loads(raw)
        if isinstance(data, list):
            return [str(x).strip() for x in data if str(x).strip()]
    except json.JSONDecodeError:
        return []
    return []


def _get_list_row(conn: sqlite3.Connection, list_id: str | None = None, code: str | None = None):
    if list_id:
        return conn.execute("SELECT * FROM lists WHERE id = ?", (list_id,)).fetchone()
    return conn.execute("SELECT * FROM lists WHERE share_code = ?", (code.upper(),)).fetchone()


def _item_from_row(r: sqlite3.Row) -> Item:
    keys = r.keys()
    return Item(
        id=r["id"],
        name=r["name"],
        quantity=r["quantity"],
        category=r["category"],
        added_by=r["added_by"],
        bought=bool(r["bought"]),
        urgent=bool(r["urgent"]) if "urgent" in keys else False,
        price=float(r["price"]) if "price" in keys and r["price"] is not None else 0.0,
        paid_by=r["paid_by"] if "paid_by" in keys and r["paid_by"] else "",
        split_among=_parse_json_list(r["split_among_json"] if "split_among_json" in keys else "[]"),
        created_at=r["created_at"],
    )


def _items_for(conn: sqlite3.Connection, list_id: str) -> list[Item]:
    rows = conn.execute(
        """
        SELECT * FROM items WHERE list_id = ?
        ORDER BY bought ASC, urgent DESC, category ASC, created_at ASC
        """,
        (list_id,),
    ).fetchall()
    return [_item_from_row(r) for r in rows]


def _list_members(row: sqlite3.Row, items: list[Item]) -> list[str]:
    keys = row.keys()
    members = _parse_json_list(row["members_json"] if "members_json" in keys else "[]")
    names = set(members)
    if row["created_by"]:
        names.add(row["created_by"])
    for item in items:
        if item.added_by:
            names.add(item.added_by)
        if item.paid_by:
            names.add(item.paid_by)
        names.update(item.split_among)
    return sorted(names, key=lambda n: n.lower())


def _settle(items: list[Item]) -> SettleUp:
    paid: dict[str, float] = {}
    owes: dict[str, float] = {}
    total = 0.0
    priced = 0

    for item in items:
        price = round(float(item.price or 0), 2)
        if price <= 0:
            continue
        priced += 1
        total += price
        payer = (item.paid_by or "").strip()
        if payer:
            paid[payer] = round(paid.get(payer, 0) + price, 2)

        share_with = [n.strip() for n in item.split_among if n.strip()]
        if not share_with and payer:
            share_with = [payer]
        if not share_with:
            continue
        share = round(price / len(share_with), 2)
        # fix rounding remainder on last person
        running = 0.0
        for i, name in enumerate(share_with):
            part = share if i < len(share_with) - 1 else round(price - running, 2)
            running = round(running + part, 2)
            owes[name] = round(owes.get(name, 0) + part, 2)

    names = sorted(set(paid) | set(owes), key=lambda n: n.lower())
    balances = []
    nets: dict[str, float] = {}
    for name in names:
        p = paid.get(name, 0.0)
        o = owes.get(name, 0.0)
        net = round(p - o, 2)
        nets[name] = net
        balances.append(PersonBalance(name=name, paid=p, owes=o, net=net))

    # greedy settle transfers: debtors pay creditors
    debtors = sorted([(n, -net) for n, net in nets.items() if net < -0.009], key=lambda x: -x[1])
    creditors = sorted([(n, net) for n, net in nets.items() if net > 0.009], key=lambda x: -x[1])
    transfers: list[dict] = []
    i = j = 0
    while i < len(debtors) and j < len(creditors):
        d_name, d_amt = debtors[i]
        c_name, c_amt = creditors[j]
        pay = round(min(d_amt, c_amt), 2)
        if pay > 0:
            transfers.append({"from": d_name, "to": c_name, "amount": pay})
        d_amt = round(d_amt - pay, 2)
        c_amt = round(c_amt - pay, 2)
        debtors[i] = (d_name, d_amt)
        creditors[j] = (c_name, c_amt)
        if d_amt <= 0.009:
            i += 1
        if c_amt <= 0.009:
            j += 1

    return SettleUp(
        total=round(total, 2),
        priced_items=priced,
        balances=balances,
        transfers=transfers,
    )


@app.on_event("startup")
def startup() -> None:
    init_db()


@app.get("/api/health")
def health():
    return {"status": "ok"}


@app.post("/api/lists", response_model=JoinResponse)
def create_list(payload: CreateListRequest):
    list_id = str(uuid.uuid4())
    now = _now()
    creator = payload.created_by.strip() or "You"
    with _lock:
        conn = _connect()
        try:
            code = _code()
            for _ in range(5):
                exists = conn.execute(
                    "SELECT 1 FROM lists WHERE share_code = ?", (code,)
                ).fetchone()
                if not exists:
                    break
                code = _code()
            conn.execute(
                """
                INSERT INTO lists (id, name, share_code, created_by, created_at, updated_at, members_json)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    list_id,
                    payload.name.strip(),
                    code,
                    creator,
                    now,
                    now,
                    json.dumps([creator]),
                ),
            )
            conn.commit()
        finally:
            conn.close()
    return JoinResponse(id=list_id, name=payload.name.strip(), share_code=code)


@app.get("/api/lists/join/{share_code}", response_model=JoinResponse)
def join_list(share_code: str):
    with _lock:
        conn = _connect()
        try:
            row = _get_list_row(conn, code=share_code.strip())
        finally:
            conn.close()
    if not row:
        raise HTTPException(status_code=404, detail="List not found")
    return JoinResponse(id=row["id"], name=row["name"], share_code=row["share_code"])


@app.get("/api/lists/{list_id}", response_model=GroceryList)
def get_list(list_id: str):
    with _lock:
        conn = _connect()
        try:
            row = _get_list_row(conn, list_id=list_id)
            if not row:
                raise HTTPException(status_code=404, detail="List not found")
            items = _items_for(conn, list_id)
            updated = row["updated_at"] if "updated_at" in row.keys() and row["updated_at"] else row["created_at"]
            members = _list_members(row, items)
        finally:
            conn.close()
    return GroceryList(
        id=row["id"],
        name=row["name"],
        share_code=row["share_code"],
        members=members,
        items=items,
        updated_at=updated,
        settle=_settle(items),
    )


@app.post("/api/lists/{list_id}/members")
def add_member(list_id: str, payload: MemberRequest):
    name = payload.name.strip()
    with _lock:
        conn = _connect()
        try:
            row = _get_list_row(conn, list_id=list_id)
            if not row:
                raise HTTPException(status_code=404, detail="List not found")
            keys = row.keys()
            members = _parse_json_list(row["members_json"] if "members_json" in keys else "[]")
            if name not in members:
                members.append(name)
            conn.execute(
                "UPDATE lists SET members_json = ? WHERE id = ?",
                (json.dumps(members), list_id),
            )
            _touch_list(conn, list_id)
            conn.commit()
        finally:
            conn.close()
    return {"ok": True, "members": members}


@app.post("/api/lists/{list_id}/items", response_model=Item)
def add_item(list_id: str, payload: AddItemRequest):
    item_id = str(uuid.uuid4())
    created = _now()
    with _lock:
        conn = _connect()
        try:
            row = _get_list_row(conn, list_id=list_id)
            if not row:
                raise HTTPException(status_code=404, detail="List not found")
            conn.execute(
                """
                INSERT INTO items (
                    id, list_id, name, quantity, category, added_by, bought, urgent,
                    price, paid_by, split_among_json, created_at
                )
                VALUES (?, ?, ?, ?, ?, ?, 0, ?, 0, '', '[]', ?)
                """,
                (
                    item_id,
                    list_id,
                    payload.name.strip(),
                    payload.quantity.strip() or "1",
                    payload.category.strip() or "Other",
                    payload.added_by.strip() or "You",
                    1 if payload.urgent else 0,
                    created,
                ),
            )
            _touch_list(conn, list_id)
            conn.commit()
        finally:
            conn.close()
    return Item(
        id=item_id,
        name=payload.name.strip(),
        quantity=payload.quantity.strip() or "1",
        category=payload.category.strip() or "Other",
        added_by=payload.added_by.strip() or "You",
        bought=False,
        urgent=payload.urgent,
        price=0,
        paid_by="",
        split_among=[],
        created_at=created,
    )


@app.patch("/api/items/{item_id}/cost", response_model=Item)
def update_item_cost(item_id: str, payload: ItemCostUpdate):
    with _lock:
        conn = _connect()
        try:
            row = conn.execute("SELECT * FROM items WHERE id = ?", (item_id,)).fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Item not found")
            split = [n.strip() for n in payload.split_among if n.strip()]
            paid_by = payload.paid_by.strip()
            conn.execute(
                """
                UPDATE items
                SET price = ?, paid_by = ?, split_among_json = ?
                WHERE id = ?
                """,
                (round(float(payload.price), 2), paid_by, json.dumps(split), item_id),
            )
            _touch_list(conn, row["list_id"])
            conn.commit()
            row = conn.execute("SELECT * FROM items WHERE id = ?", (item_id,)).fetchone()
        finally:
            conn.close()
    return _item_from_row(row)


@app.post("/api/lists/{list_id}/split-even")
def split_even(list_id: str):
    """Assign all priced items evenly across list members (keeps existing paid_by)."""
    with _lock:
        conn = _connect()
        try:
            row = _get_list_row(conn, list_id=list_id)
            if not row:
                raise HTTPException(status_code=404, detail="List not found")
            items = _items_for(conn, list_id)
            members = _list_members(row, items)
            if len(members) < 1:
                raise HTTPException(status_code=400, detail="Add members first")
            for item in items:
                if item.price <= 0:
                    continue
                paid_by = item.paid_by or members[0]
                conn.execute(
                    """
                    UPDATE items
                    SET paid_by = ?, split_among_json = ?
                    WHERE id = ?
                    """,
                    (paid_by, json.dumps(members), item.id),
                )
            _touch_list(conn, list_id)
            conn.commit()
        finally:
            conn.close()
    return {"ok": True}


@app.post("/api/items/{item_id}/toggle", response_model=Item)
def toggle_item(item_id: str):
    with _lock:
        conn = _connect()
        try:
            row = conn.execute("SELECT * FROM items WHERE id = ?", (item_id,)).fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Item not found")
            new_val = 0 if row["bought"] else 1
            conn.execute("UPDATE items SET bought = ? WHERE id = ?", (new_val, item_id))
            _touch_list(conn, row["list_id"])
            conn.commit()
            row = conn.execute("SELECT * FROM items WHERE id = ?", (item_id,)).fetchone()
        finally:
            conn.close()
    return _item_from_row(row)


@app.post("/api/items/{item_id}/urgent", response_model=Item)
def toggle_urgent(item_id: str):
    with _lock:
        conn = _connect()
        try:
            row = conn.execute("SELECT * FROM items WHERE id = ?", (item_id,)).fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Item not found")
            keys = row.keys()
            current = bool(row["urgent"]) if "urgent" in keys else False
            conn.execute("UPDATE items SET urgent = ? WHERE id = ?", (0 if current else 1, item_id))
            _touch_list(conn, row["list_id"])
            conn.commit()
            row = conn.execute("SELECT * FROM items WHERE id = ?", (item_id,)).fetchone()
        finally:
            conn.close()
    return _item_from_row(row)


@app.delete("/api/items/{item_id}")
def delete_item(item_id: str):
    with _lock:
        conn = _connect()
        try:
            row = conn.execute("SELECT list_id FROM items WHERE id = ?", (item_id,)).fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Item not found")
            conn.execute("DELETE FROM items WHERE id = ?", (item_id,))
            _touch_list(conn, row["list_id"])
            conn.commit()
        finally:
            conn.close()
    return {"ok": True}


@app.delete("/api/lists/{list_id}/bought")
def clear_bought(list_id: str):
    with _lock:
        conn = _connect()
        try:
            row = _get_list_row(conn, list_id=list_id)
            if not row:
                raise HTTPException(status_code=404, detail="List not found")
            conn.execute("DELETE FROM items WHERE list_id = ? AND bought = 1", (list_id,))
            _touch_list(conn, list_id)
            conn.commit()
        finally:
            conn.close()
    return {"ok": True}


if FRONTEND_DIST.exists():
    app.mount("/assets", StaticFiles(directory=FRONTEND_DIST / "assets"), name="assets")

    @app.get("/")
    def spa_index():
        return FileResponse(FRONTEND_DIST / "index.html")

    @app.get("/{full_path:path}")
    def spa_fallback(full_path: str):
        if full_path.startswith("api/"):
            raise HTTPException(status_code=404, detail="Not found")
        candidate = FRONTEND_DIST / full_path
        if candidate.is_file():
            return FileResponse(candidate)
        return FileResponse(FRONTEND_DIST / "index.html")
