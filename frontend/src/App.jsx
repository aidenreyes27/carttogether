import { useEffect, useMemo, useRef, useState } from "react";

const CATEGORIES = [
  "Produce",
  "Dairy",
  "Meat",
  "Bakery",
  "Frozen",
  "Pantry",
  "Household",
  "Other",
];

const QUICK_ADDS = [
  { name: "Milk", category: "Dairy" },
  { name: "Eggs", category: "Dairy" },
  { name: "Bread", category: "Bakery" },
  { name: "Bananas", category: "Produce" },
  { name: "Chicken", category: "Meat" },
  { name: "Rice", category: "Pantry" },
  { name: "Coffee", category: "Pantry" },
  { name: "Paper towels", category: "Household" },
];

const STORAGE_KEY = "carttogether_list";

async function api(path, options) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(options?.headers || {}) },
    ...options,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || "Request failed");
  }
  if (res.status === 204) return null;
  return res.json();
}

function money(n) {
  return `$${Number(n || 0).toFixed(2)}`;
}

function ProgressRing({ value }) {
  const r = 28;
  const c = 2 * Math.PI * r;
  const offset = c - (value / 100) * c;
  return (
    <div className="ring" aria-label={`${value}% complete`}>
      <svg width="72" height="72" viewBox="0 0 72 72">
        <circle className="ring-bg" cx="36" cy="36" r={r} />
        <circle
          className="ring-fg"
          cx="36"
          cy="36"
          r={r}
          strokeDasharray={c}
          strokeDashoffset={offset}
        />
      </svg>
      <strong>{value}%</strong>
    </div>
  );
}

function ItemCostEditor({ item, members, defaultPayer, onSave }) {
  const [price, setPrice] = useState(item.price ? String(item.price) : "");
  const [paidBy, setPaidBy] = useState(item.paid_by || defaultPayer || members[0] || "");
  const [splitAmong, setSplitAmong] = useState(
    item.split_among?.length ? item.split_among : members.length ? [...members] : [],
  );
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setPrice(item.price ? String(item.price) : "");
    setPaidBy(item.paid_by || defaultPayer || members[0] || "");
    setSplitAmong(item.split_among?.length ? item.split_among : members.length ? [...members] : []);
  }, [item.id, item.price, item.paid_by, item.split_among, members, defaultPayer]);

  function togglePerson(name) {
    setSplitAmong((prev) =>
      prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name],
    );
  }

  async function save() {
    setSaving(true);
    try {
      await onSave({
        price: Number.parseFloat(price || "0") || 0,
        paid_by: paidBy,
        split_among: splitAmong,
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="cost-editor">
      <div className="cost-row">
        <label>
          Price
          <input
            type="number"
            min="0"
            step="0.01"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            placeholder="0.00"
          />
        </label>
        <label>
          Paid by
          <select value={paidBy} onChange={(e) => setPaidBy(e.target.value)}>
            <option value="">Select</option>
            {members.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="split-people">
        <span>Split with</span>
        <div className="people-chips">
          {members.map((m) => (
            <button
              key={m}
              type="button"
              className={`mini ${splitAmong.includes(m) ? "on" : ""}`}
              onClick={() => togglePerson(m)}
            >
              {m}
            </button>
          ))}
        </div>
      </div>
      <button type="button" className="save-cost" disabled={saving} onClick={save}>
        {saving ? "Saving…" : "Save split"}
      </button>
    </div>
  );
}

export default function App() {
  const [screen, setScreen] = useState("home");
  const [displayName, setDisplayName] = useState(
    () => localStorage.getItem("carttogether_name") || "",
  );
  const [listName, setListName] = useState("Apartment groceries");
  const [joinCode, setJoinCode] = useState("");
  const [list, setList] = useState(null);
  const [itemName, setItemName] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [category, setCategory] = useState("Produce");
  const [urgent, setUrgent] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState("");
  const [shopMode, setShopMode] = useState(false);
  const [splitMode, setSplitMode] = useState(false);
  const [groupByAisle, setGroupByAisle] = useState(true);
  const [filterCat, setFilterCat] = useState("all");
  const [live, setLive] = useState(true);
  const [memberName, setMemberName] = useState("");
  const [editingCostId, setEditingCostId] = useState(null);
  const listIdRef = useRef(null);
  const celebrateRef = useRef(false);

  const stats = useMemo(() => {
    if (!list) return { total: 0, done: 0, left: 0, pct: 0 };
    const total = list.items.length;
    const done = list.items.filter((i) => i.bought).length;
    const left = total - done;
    const pct = total ? Math.round((done / total) * 100) : 0;
    return { total, done, left, pct };
  }, [list]);

  const members = useMemo(() => {
    if (!list) return [];
    const set = new Set(list.members || []);
    if (displayName.trim()) set.add(displayName.trim());
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [list, displayName]);

  function showToast(msg) {
    setToast(msg);
    window.clearTimeout(showToast._t);
    showToast._t = window.setTimeout(() => setToast(""), 2200);
  }

  async function loadList(id, { quiet } = {}) {
    const data = await api(`/api/lists/${id}`);
    setList(data);
    listIdRef.current = data.id;
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ id: data.id, share_code: data.share_code }),
    );
    setScreen("list");
    if (!quiet) return;
  }

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return;
    try {
      const { id } = JSON.parse(saved);
      loadList(id).catch(() => localStorage.removeItem(STORAGE_KEY));
    } catch {
      localStorage.removeItem(STORAGE_KEY);
    }
  }, []);

  useEffect(() => {
    if (!live || !listIdRef.current || screen !== "list") return undefined;
    const id = window.setInterval(() => {
      loadList(listIdRef.current, { quiet: true }).catch(() => {});
    }, 3000);
    return () => window.clearInterval(id);
  }, [live, screen, list?.updated_at]);

  useEffect(() => {
    if (stats.total > 0 && stats.left === 0 && !celebrateRef.current) {
      celebrateRef.current = true;
      showToast("List complete — nice haul!");
    }
    if (stats.left > 0) celebrateRef.current = false;
  }, [stats.left, stats.total]);

  function saveName(name) {
    setDisplayName(name);
    localStorage.setItem("carttogether_name", name);
  }

  async function createList(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const who = displayName.trim() || "You";
      saveName(who);
      const created = await api("/api/lists", {
        method: "POST",
        body: JSON.stringify({ name: listName.trim(), created_by: who }),
      });
      await loadList(created.id);
      showToast("List created");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function joinList(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const who = displayName.trim() || "You";
      saveName(who);
      const joined = await api(`/api/lists/join/${joinCode.trim()}`);
      await loadList(joined.id);
      if (who) {
        await api(`/api/lists/${joined.id}/members`, {
          method: "POST",
          body: JSON.stringify({ name: who }),
        });
        await loadList(joined.id, { quiet: true });
      }
      showToast("Joined list");
    } catch {
      setError("Could not find that list. Check the code.");
    } finally {
      setBusy(false);
    }
  }

  async function addItem(e, preset) {
    if (e) e.preventDefault();
    const name = preset?.name || itemName.trim();
    const cat = preset?.category || category;
    if (!list || !name) return;
    setBusy(true);
    setError("");
    try {
      await api(`/api/lists/${list.id}/items`, {
        method: "POST",
        body: JSON.stringify({
          name,
          quantity: preset ? "1" : quantity.trim() || "1",
          category: cat,
          added_by: displayName.trim() || "You",
          urgent: preset ? false : urgent,
        }),
      });
      if (!preset) {
        setItemName("");
        setQuantity("1");
        setUrgent(false);
      }
      await loadList(list.id, { quiet: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function toggle(itemId) {
    await api(`/api/items/${itemId}/toggle`, { method: "POST" });
    await loadList(list.id, { quiet: true });
  }

  async function toggleUrgent(itemId) {
    await api(`/api/items/${itemId}/urgent`, { method: "POST" });
    await loadList(list.id, { quiet: true });
  }

  async function remove(itemId) {
    await api(`/api/items/${itemId}`, { method: "DELETE" });
    await loadList(list.id, { quiet: true });
  }

  async function clearBought() {
    await api(`/api/lists/${list.id}/bought`, { method: "DELETE" });
    await loadList(list.id, { quiet: true });
    showToast("Cleared bought items");
  }

  async function saveCost(itemId, payload) {
    await api(`/api/items/${itemId}/cost`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
    setEditingCostId(null);
    await loadList(list.id, { quiet: true });
    showToast("Split saved");
  }

  async function addMember(e) {
    e.preventDefault();
    if (!memberName.trim()) return;
    await api(`/api/lists/${list.id}/members`, {
      method: "POST",
      body: JSON.stringify({ name: memberName.trim() }),
    });
    setMemberName("");
    await loadList(list.id, { quiet: true });
    showToast("Roommate added");
  }

  async function splitEven() {
    await api(`/api/lists/${list.id}/split-even`, { method: "POST" });
    await loadList(list.id, { quiet: true });
    showToast("Split evenly across everyone");
  }

  function leaveList() {
    localStorage.removeItem(STORAGE_KEY);
    setList(null);
    listIdRef.current = null;
    setScreen("home");
    setShopMode(false);
    setSplitMode(false);
  }

  async function copyCode() {
    if (!list) return;
    await navigator.clipboard.writeText(list.share_code);
    showToast("Share code copied");
  }

  const todo = useMemo(() => {
    if (!list) return [];
    return list.items.filter((i) => {
      if (i.bought) return false;
      if (filterCat !== "all" && i.category !== filterCat) return false;
      return true;
    });
  }, [list, filterCat]);

  const done = useMemo(() => {
    if (!list) return [];
    return list.items.filter((i) => i.bought);
  }, [list]);

  const splitItems = useMemo(() => {
    if (!list) return [];
    // Prefer bought items, but allow pricing any item in split mode
    const bought = list.items.filter((i) => i.bought);
    return bought.length ? bought : list.items;
  }, [list]);

  const groupedTodo = useMemo(() => {
    if (!groupByAisle) return { All: todo };
    const map = {};
    for (const item of todo) {
      map[item.category] = map[item.category] || [];
      map[item.category].push(item);
    }
    return map;
  }, [todo, groupByAisle]);

  if (screen === "home" || !list) {
    return (
      <div className="shell">
        <div className="glow" aria-hidden="true" />
        <div className="page home">
          <header className="hero">
            <p className="eyebrow">Household shopping</p>
            <h1>CartTogether</h1>
            <p className="lede">
              One live grocery list for your place. Share a code, add items, then split the bill
              when you get home.
            </p>
          </header>

          <label className="field name-field">
            Your name on the list
            <input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Alex"
            />
          </label>

          <div className="home-grid">
            <form className="panel lift" onSubmit={createList}>
              <h2>Start a list</h2>
              <p className="panel-copy">Create a share code your roommates can join.</p>
              <label className="field">
                List name
                <input
                  value={listName}
                  onChange={(e) => setListName(e.target.value)}
                  required
                />
              </label>
              <button type="submit" disabled={busy}>
                Create list
              </button>
            </form>

            <form className="panel lift" onSubmit={joinList}>
              <h2>Join with code</h2>
              <p className="panel-copy">Already have a household list? Jump in.</p>
              <label className="field">
                Share code
                <input
                  value={joinCode}
                  onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                  placeholder="ABC123"
                  required
                />
              </label>
              <button type="submit" className="secondary" disabled={busy}>
                Join list
              </button>
            </form>
          </div>
          {error && <p className="error">{error}</p>}
        </div>
        {toast && <div className="toast">{toast}</div>}
      </div>
    );
  }

  const settle = list.settle;

  return (
    <div className={`shell ${shopMode ? "shop-mode" : ""}`}>
      <div className="glow" aria-hidden="true" />
      <div className="page">
        <header className="list-header">
          <div>
            <p className="eyebrow">Live list · {live ? "syncing" : "paused"}</p>
            <h1>{list.name}</h1>
            <div className="meta-row">
              <button type="button" className="code" onClick={copyCode}>
                {list.share_code}
              </button>
              <span>
                {stats.left} left
                {settle?.total ? ` · bill ${money(settle.total)}` : ""}
              </span>
            </div>
          </div>
          <ProgressRing value={stats.pct} />
        </header>

        <div className="toolbar">
          <button
            type="button"
            className={`chip-btn ${shopMode ? "on" : ""}`}
            onClick={() => {
              setShopMode((v) => !v);
              setSplitMode(false);
            }}
          >
            {shopMode ? "Exit shop mode" : "Shop mode"}
          </button>
          <button
            type="button"
            className={`chip-btn ${splitMode ? "on" : ""}`}
            onClick={() => {
              setSplitMode((v) => !v);
              setShopMode(false);
            }}
          >
            {splitMode ? "Exit split bill" : "Split bill"}
          </button>
          <button
            type="button"
            className={`chip-btn ${groupByAisle ? "on" : ""}`}
            onClick={() => setGroupByAisle((v) => !v)}
          >
            Group by aisle
          </button>
          <button
            type="button"
            className={`chip-btn ${live ? "on" : ""}`}
            onClick={() => setLive((v) => !v)}
          >
            Live sync
          </button>
          <button type="button" className="chip-btn ghost" onClick={leaveList}>
            Leave
          </button>
        </div>

        {splitMode && (
          <section className="split-panel">
            <div className="split-head">
              <div>
                <h2>Split the bill</h2>
                <p>
                  Add prices, pick who paid, and select who each item is for. We’ll calculate who
                  owes who.
                </p>
              </div>
              <button type="button" className="secondary" onClick={splitEven}>
                Split all evenly
              </button>
            </div>

            <form className="member-row" onSubmit={addMember}>
              <input
                value={memberName}
                onChange={(e) => setMemberName(e.target.value)}
                placeholder="Add roommate name"
              />
              <button type="submit">Add</button>
            </form>
            <div className="people-chips members-line">
              {members.map((m) => (
                <span key={m} className="member-pill">
                  {m}
                </span>
              ))}
            </div>

            {settle && settle.priced_items > 0 && (
              <div className="settle-card">
                <div className="settle-total">
                  <span>Trip total</span>
                  <strong>{money(settle.total)}</strong>
                </div>
                <div className="balance-grid">
                  {settle.balances.map((b) => (
                    <div key={b.name} className={`balance ${b.net >= 0 ? "pos" : "neg"}`}>
                      <strong>{b.name}</strong>
                      <span>paid {money(b.paid)}</span>
                      <span>share {money(b.owes)}</span>
                      <em>{b.net >= 0 ? `is owed ${money(b.net)}` : `owes ${money(Math.abs(b.net))}`}</em>
                    </div>
                  ))}
                </div>
                {settle.transfers.length > 0 && (
                  <div className="transfers">
                    <h3>Settle up</h3>
                    <ul>
                      {settle.transfers.map((t) => (
                        <li key={`${t.from}-${t.to}-${t.amount}`}>
                          <strong>{t.from}</strong> pays <strong>{t.to}</strong>{" "}
                          <em>{money(t.amount)}</em>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}

            <ul className="items split-items">
              {splitItems.length === 0 ? (
                <li className="empty-split">Check off items while shopping, then price them here.</li>
              ) : (
                splitItems.map((item) => (
                  <li key={item.id} className={item.price > 0 ? "priced" : ""}>
                    <div className="split-item-top">
                      <div>
                        <strong>
                          {item.name}
                          <span className="qty-tag">×{item.quantity}</span>
                        </strong>
                        <small>
                          {item.bought ? "Bought" : "Not checked off yet"}
                          {item.price > 0
                            ? ` · ${money(item.price)} · paid by ${item.paid_by || "—"}`
                            : " · no price yet"}
                        </small>
                        {item.split_among?.length > 0 && item.price > 0 && (
                          <small className="split-tag">
                            Split: {item.split_among.join(", ")}
                          </small>
                        )}
                      </div>
                      <button
                        type="button"
                        className="text-btn"
                        onClick={() =>
                          setEditingCostId((id) => (id === item.id ? null : item.id))
                        }
                      >
                        {editingCostId === item.id ? "Close" : "Set price / split"}
                      </button>
                    </div>
                    {editingCostId === item.id && (
                      <ItemCostEditor
                        item={item}
                        members={members}
                        defaultPayer={displayName.trim() || members[0] || ""}
                        onSave={(payload) => saveCost(item.id, payload)}
                      />
                    )}
                  </li>
                ))
              )}
            </ul>
          </section>
        )}

        {!shopMode && !splitMode && (
          <>
            <form className="add-card" onSubmit={addItem}>
              <div className="add-row">
                <input
                  value={itemName}
                  onChange={(e) => setItemName(e.target.value)}
                  placeholder="Add milk, eggs, anything…"
                  required
                />
                <input
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                  placeholder="Qty"
                  className="qty"
                />
                <select value={category} onChange={(e) => setCategory(e.target.value)}>
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
              <div className="add-actions">
                <label className="urgent-toggle">
                  <input
                    type="checkbox"
                    checked={urgent}
                    onChange={(e) => setUrgent(e.target.checked)}
                  />
                  Urgent
                </label>
                <button type="submit" disabled={busy}>
                  Add item
                </button>
              </div>
            </form>

            <div className="quick">
              <span>Quick add</span>
              <div className="quick-row">
                {QUICK_ADDS.map((q) => (
                  <button
                    key={q.name}
                    type="button"
                    className="quick-chip"
                    onClick={() => addItem(null, q)}
                  >
                    + {q.name}
                  </button>
                ))}
              </div>
            </div>
          </>
        )}

        {!splitMode && (
          <>
            <div className="filter-row">
              <button
                type="button"
                className={`mini ${filterCat === "all" ? "on" : ""}`}
                onClick={() => setFilterCat("all")}
              >
                All
              </button>
              {CATEGORIES.map((c) => (
                <button
                  key={c}
                  type="button"
                  className={`mini ${filterCat === c ? "on" : ""}`}
                  onClick={() => setFilterCat(c)}
                >
                  {c}
                </button>
              ))}
            </div>

            {error && <p className="error">{error}</p>}

            <section className="section">
              <div className="section-head">
                <h2>To get</h2>
                {stats.left === 0 && stats.total > 0 && (
                  <span className="complete-badge">Complete</span>
                )}
              </div>

              {todo.length === 0 ? (
                <div className="empty">
                  <strong>{stats.total ? "Cart’s clear." : "List is empty."}</strong>
                  <p>
                    {stats.total
                      ? "Open Split bill to price items, or clear bought ones."
                      : "Add a few staples to get going."}
                  </p>
                </div>
              ) : (
                Object.entries(groupedTodo).map(([cat, items]) => (
                  <div key={cat} className="aisle">
                    {groupByAisle && <h3>{cat}</h3>}
                    <ul className="items">
                      {items.map((item) => (
                        <li key={item.id} className={item.urgent ? "urgent" : ""}>
                          <button
                            type="button"
                            className="check"
                            onClick={() => toggle(item.id)}
                            aria-label={`Mark ${item.name} bought`}
                          >
                            <span />
                          </button>
                          <div className="item-body">
                            <strong>
                              {item.name}
                              <span className="qty-tag">×{item.quantity}</span>
                              {item.urgent && <em className="urgent-tag">urgent</em>}
                            </strong>
                            <small>
                              {item.category} · {item.added_by}
                            </small>
                          </div>
                          {!shopMode && (
                            <div className="item-actions">
                              <button
                                type="button"
                                className="text-btn"
                                onClick={() => toggleUrgent(item.id)}
                              >
                                {item.urgent ? "Unmark" : "Urgent"}
                              </button>
                              <button
                                type="button"
                                className="text-btn danger"
                                onClick={() => remove(item.id)}
                              >
                                Remove
                              </button>
                            </div>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))
              )}
            </section>

            {!shopMode && (
              <section className="section">
                <div className="section-head">
                  <h2>Bought ({done.length})</h2>
                  {done.length > 0 && (
                    <button type="button" className="text-btn" onClick={clearBought}>
                      Clear bought
                    </button>
                  )}
                </div>
                {done.length === 0 ? (
                  <p className="muted">Checked-off items land here.</p>
                ) : (
                  <ul className="items done">
                    {done.map((item) => (
                      <li key={item.id}>
                        <button
                          type="button"
                          className="check on"
                          onClick={() => toggle(item.id)}
                          aria-label={`Unmark ${item.name}`}
                        >
                          <span />
                        </button>
                        <div className="item-body">
                          <strong>
                            {item.name}
                            {item.price > 0 && (
                              <span className="qty-tag">{money(item.price)}</span>
                            )}
                          </strong>
                          <small>
                            {item.category} · {item.added_by}
                            {item.paid_by ? ` · paid by ${item.paid_by}` : ""}
                          </small>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            )}
          </>
        )}
      </div>
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
