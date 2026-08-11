import { useEffect, useMemo, useState } from "react";

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
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const openCount = useMemo(
    () => (list ? list.items.filter((i) => !i.bought).length : 0),
    [list],
  );

  async function loadList(id) {
    const data = await api(`/api/lists/${id}`);
    setList(data);
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ id: data.id, share_code: data.share_code }));
    setScreen("list");
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
    } catch (err) {
      setError("Could not find that list. Check the code.");
    } finally {
      setBusy(false);
    }
  }

  async function addItem(e) {
    e.preventDefault();
    if (!list || !itemName.trim()) return;
    setBusy(true);
    setError("");
    try {
      await api(`/api/lists/${list.id}/items`, {
        method: "POST",
        body: JSON.stringify({
          name: itemName.trim(),
          quantity: quantity.trim() || "1",
          category,
          added_by: displayName.trim() || "You",
        }),
      });
      setItemName("");
      setQuantity("1");
      await loadList(list.id);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function toggle(itemId) {
    await api(`/api/items/${itemId}/toggle`, { method: "POST" });
    await loadList(list.id);
  }

  async function remove(itemId) {
    await api(`/api/items/${itemId}`, { method: "DELETE" });
    await loadList(list.id);
  }

  async function clearBought() {
    await api(`/api/lists/${list.id}/bought`, { method: "DELETE" });
    await loadList(list.id);
  }

  function leaveList() {
    localStorage.removeItem(STORAGE_KEY);
    setList(null);
    setScreen("home");
  }

  async function copyCode() {
    if (!list) return;
    await navigator.clipboard.writeText(list.share_code);
  }

  if (screen === "home" || !list) {
    return (
      <div className="page">
        <header>
          <h1>CartTogether</h1>
          <p>One grocery list for your household. Share a code and shop from the same list.</p>
        </header>

        <label className="field">
          Your name
          <input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="Alex"
          />
        </label>

        <div className="home-grid">
          <form className="panel" onSubmit={createList}>
            <h2>Create a list</h2>
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

          <form className="panel" onSubmit={joinList}>
            <h2>Join a list</h2>
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
              Join
            </button>
          </form>
        </div>
        {error && <p className="error">{error}</p>}
      </div>
    );
  }

  const todo = list.items.filter((i) => !i.bought);
  const done = list.items.filter((i) => i.bought);

  return (
    <div className="page">
      <header className="list-header">
        <div>
          <h1>{list.name}</h1>
          <p>
            {openCount} left · Share code{" "}
            <button type="button" className="code" onClick={copyCode}>
              {list.share_code}
            </button>
          </p>
        </div>
        <button type="button" className="text-btn" onClick={leaveList}>
          Leave list
        </button>
      </header>

      <form className="add-row" onSubmit={addItem}>
        <input
          value={itemName}
          onChange={(e) => setItemName(e.target.value)}
          placeholder="Add an item"
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
        <button type="submit" disabled={busy}>
          Add
        </button>
      </form>
      {error && <p className="error">{error}</p>}

      <section className="section">
        <h2>To get</h2>
        {todo.length === 0 ? (
          <p className="muted">Nothing left — nice.</p>
        ) : (
          <ul className="items">
            {todo.map((item) => (
              <li key={item.id}>
                <button type="button" className="check" onClick={() => toggle(item.id)}>
                  ○
                </button>
                <div className="item-body">
                  <strong>
                    {item.name} <span className="qty-tag">×{item.quantity}</span>
                  </strong>
                  <small>
                    {item.category} · added by {item.added_by}
                  </small>
                </div>
                <button type="button" className="text-btn" onClick={() => remove(item.id)}>
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="section">
        <div className="section-head">
          <h2>Bought</h2>
          {done.length > 0 && (
            <button type="button" className="text-btn" onClick={clearBought}>
              Clear bought
            </button>
          )}
        </div>
        {done.length === 0 ? (
          <p className="muted">Checked-off items show up here.</p>
        ) : (
          <ul className="items done">
            {done.map((item) => (
              <li key={item.id}>
                <button type="button" className="check" onClick={() => toggle(item.id)}>
                  ✓
                </button>
                <div className="item-body">
                  <strong>{item.name}</strong>
                  <small>
                    {item.category} · {item.added_by}
                  </small>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
