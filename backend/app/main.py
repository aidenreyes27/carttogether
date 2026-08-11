from __future__ import annotations

import sqlite3
import string
import random
import uuid
from datetime import datetime, timezone
from pathlib import Path
from threading import Lock

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

DB_PATH = Path(__file__).resolve().parent.parent / "data" / "grocery.db"
_lock = Lock()

app = FastAPI(title="Shared Grocery List")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
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


class Item(BaseModel):
    id: str
    name: str
    quantity: str
    category: str
    added_by: str
    bought: bool
    created_at: str


class GroceryList(BaseModel):
    id: str
    name: str
    share_code: str
    items: list[Item]


def _connect() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


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
                    created_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS items (
                    id TEXT PRIMARY KEY,
                    list_id TEXT NOT NULL,
                    name TEXT NOT NULL,
                    quantity TEXT NOT NULL,
                    category TEXT NOT NULL,
                    added_by TEXT NOT NULL,
                    bought INTEGER NOT NULL DEFAULT 0,
                    created_at TEXT NOT NULL,
                    FOREIGN KEY(list_id) REFERENCES lists(id)
                );
                """
            )
            conn.commit()
        finally:
            conn.close()


def _code() -> str:
    alphabet = string.ascii_uppercase + string.digits
    return "".join(random.choice(alphabet) for _ in range(6))


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _get_list_row(conn: sqlite3.Connection, list_id: str | None = None, code: str | None = None):
    if list_id:
        return conn.execute("SELECT * FROM lists WHERE id = ?", (list_id,)).fetchone()
    return conn.execute("SELECT * FROM lists WHERE share_code = ?", (code.upper(),)).fetchone()


def _items_for(conn: sqlite3.Connection, list_id: str) -> list[Item]:
    rows = conn.execute(
        """
        SELECT * FROM items WHERE list_id = ?
        ORDER BY bought ASC, category ASC, created_at ASC
        """,
        (list_id,),
    ).fetchall()
    return [
        Item(
            id=r["id"],
            name=r["name"],
            quantity=r["quantity"],
            category=r["category"],
            added_by=r["added_by"],
            bought=bool(r["bought"]),
            created_at=r["created_at"],
        )
        for r in rows
    ]


@app.on_event("startup")
def startup() -> None:
    init_db()


@app.get("/api/health")
def health():
    return {"status": "ok"}


@app.post("/api/lists", response_model=JoinResponse)
def create_list(payload: CreateListRequest):
    list_id = str(uuid.uuid4())
    with _lock:
        conn = _connect()
        try:
            code = _code()
            # extremely unlikely collisions; retry a few times
            for _ in range(5):
                exists = conn.execute(
                    "SELECT 1 FROM lists WHERE share_code = ?", (code,)
                ).fetchone()
                if not exists:
                    break
                code = _code()
            conn.execute(
                """
                INSERT INTO lists (id, name, share_code, created_by, created_at)
                VALUES (?, ?, ?, ?, ?)
                """,
                (list_id, payload.name.strip(), code, payload.created_by.strip(), _now()),
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
        finally:
            conn.close()
    return GroceryList(
        id=row["id"],
        name=row["name"],
        share_code=row["share_code"],
        items=items,
    )


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
                INSERT INTO items (id, list_id, name, quantity, category, added_by, bought, created_at)
                VALUES (?, ?, ?, ?, ?, ?, 0, ?)
                """,
                (
                    item_id,
                    list_id,
                    payload.name.strip(),
                    payload.quantity.strip() or "1",
                    payload.category.strip() or "Other",
                    payload.added_by.strip() or "You",
                    created,
                ),
            )
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
        created_at=created,
    )


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
            conn.commit()
            row = conn.execute("SELECT * FROM items WHERE id = ?", (item_id,)).fetchone()
        finally:
            conn.close()
    return Item(
        id=row["id"],
        name=row["name"],
        quantity=row["quantity"],
        category=row["category"],
        added_by=row["added_by"],
        bought=bool(row["bought"]),
        created_at=row["created_at"],
    )


@app.delete("/api/items/{item_id}")
def delete_item(item_id: str):
    with _lock:
        conn = _connect()
        try:
            cur = conn.execute("DELETE FROM items WHERE id = ?", (item_id,))
            conn.commit()
            if cur.rowcount == 0:
                raise HTTPException(status_code=404, detail="Item not found")
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
            conn.commit()
        finally:
            conn.close()
    return {"ok": True}
