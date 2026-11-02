import { useEffect, useState } from "react";
import { CalendarClock, ExternalLink, Minus, Package, Plus, Search, ShoppingBasket, ShoppingCart } from "lucide-react";
import { api, type OdaCart, type OdaProduct, type OdaSlot } from "../lib/api";

const kr = (n: number) => `${n.toLocaleString("nb-NO", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kr`;
const time = (s: string) => new Date(s).toLocaleTimeString("nb-NO", { hour: "2-digit", minute: "2-digit" });
const day = (s: string) => new Date(s).toLocaleDateString("nb-NO", { weekday: "short", day: "numeric", month: "short" });

export function OdaPage() {
  const [tab, setTab] = useState<"handle" | "kurv" | "levering">("handle");
  const [cart, setCart] = useState<OdaCart | null>(null);
  const [q, setQ] = useState(""); const [items, setItems] = useState<OdaProduct[]>([]); const [busy, setBusy] = useState(false);
  const [slots, setSlots] = useState<OdaSlot[]>([]); const [orders, setOrders] = useState<Array<{ id: string; number: string; status: string; delivery: string | null; total: number }>>([]);
  const [err, setErr] = useState<string | null>(null); const [checkout, setCheckout] = useState(false);
  const refresh = () => api<OdaCart>("/api/oda/cart").then(setCart).catch((e) => setErr(e.message));
  useEffect(() => { void refresh(); api<{ orders: typeof orders }>("/api/oda/orders").then((r) => setOrders(r.orders)).catch(() => undefined); }, []);
  useEffect(() => { if (tab === "levering" && slots.length === 0) api<{ slots: OdaSlot[] }>("/api/oda/slots").then((r) => setSlots(r.slots)).catch((e) => setErr(e.message)); }, [tab]); // eslint-disable-line
  const search = async (term = q) => { if (!term.trim()) return; setBusy(true); try { setItems((await api<{ products: OdaProduct[] }>(`/api/oda/search?q=${encodeURIComponent(term)}`)).products); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); } };
  const add = async (id: number, d: number) => { try { setCart(await api<OdaCart>("/api/oda/cart/items", { json: { productId: id, quantity: d } })); } catch (e) { setErr((e as Error).message); } };
  const qty = (id: number) => cart?.items.find((i) => i.id === id)?.quantity ?? 0;
  const byDay = slots.reduce<Record<string, OdaSlot[]>>((m, s) => { (m[day(s.start)] ??= []).push(s); return m; }, {});
  return (
    <div className="page oda-page">
      <div className="page-head"><h1 className="page-title">Oda</h1>
        <button className="cart-pill" onClick={() => setTab("kurv")}><ShoppingCart size={16} /> {cart?.count ?? "–"} varer · {cart ? kr(cart.total) : "–"}</button></div>
      <div className="seg">{([["handle", "Handle"], ["kurv", "Handlekurv"], ["levering", "Levering"]] as const).map(([k, l]) => <button key={k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{l}</button>)}</div>
      {err && <div className="notice bad small" onClick={() => setErr(null)}>{err}</div>}
      {orders.length > 0 && <section className="card order-card"><h3><Package size={15} /> Bestillinger</h3>{orders.map((o) => <div key={o.id} className="kv"><span>#{o.number} · {o.status}</span><span className="muted">{o.delivery ? String(o.delivery) : ""} {kr(o.total)}</span></div>)}</section>}

      {tab === "handle" && <>
        <div className="search-bar big"><Search size={18} /><input autoFocus value={q} placeholder="Søk i Oda – melk, brød, kaffe…" onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void search()} />{busy && <span className="muted small">Søker…</span>}</div>
        {items.length === 0 && <div className="chat-suggest">{["Melk", "Brød", "Egg", "Bananer", "Kaffe", "Kyllingfilet", "Tacokrydder"].map((s) => <button key={s} className="chip" onClick={() => { setQ(s); void search(s); }}>{s}</button>)}</div>}
        <div className="product-grid">{items.map((p) => <ProductCard key={p.id} p={p} qty={qty(p.id)} add={add} />)}</div>
      </>}

      {tab === "kurv" && cart && <section className="card">
        <h3><ShoppingBasket size={15} /> Handlekurv <span className="count">{cart.count}</span></h3>
        {cart.items.length === 0 ? <p className="muted">Handlekurven er tom.</p> : cart.items.map((i) => (
          <div key={i.id} className="cart-row">
            <span className="cart-img" style={i.image ? { backgroundImage: `url(${i.image})` } : undefined} />
            <div className="grow"><div>{i.name}</div><div className="muted small">{i.extra} · {kr(i.price)}</div></div>
            <div className="stepper"><button onClick={() => void add(i.id, -1)} aria-label="Fjern én"><Minus size={14} /></button><span>{i.quantity}</span><button onClick={() => void add(i.id, 1)} aria-label="Legg til én"><Plus size={14} /></button></div>
            <span className="cart-total">{kr(i.total)}</span>
          </div>))}
        <div className="cart-sum"><span>Totalt</span><strong>{kr(cart.total)}</strong></div>
        {checkout ? (
          <div className="confirm-card"><div className="grow"><div className="confirm-title">Gå til kassen på oda.com?</div><div className="muted small">Ingenting bestilles automatisk. Du velger levering og betaler selv på oda.com.</div></div>
            <div className="confirm-btns"><button className="btn sm" onClick={() => setCheckout(false)}>Avbryt</button><a className="btn sm primary" href="https://oda.com/no/checkout/" target="_blank" rel="noreferrer" onClick={() => setCheckout(false)}>Åpne kassen <ExternalLink size={12} /></a></div></div>
        ) : <button className="btn primary" disabled={cart.items.length === 0} onClick={() => setCheckout(true)}>Til kassen…</button>}
      </section>}

      {tab === "levering" && <section className="card"><h3><CalendarClock size={15} /> Leveringstider</h3>
        {Object.entries(byDay).slice(0, 5).map(([d, ss]) => <div key={d} className="slot-day"><div className="slot-label">{d}</div><div className="slot-row">{ss.map((s) => (
          <span key={s.id} className={`slot ${s.full ? "full" : ""} ${s.selected ? "selected" : ""} ${s.cheapest ? "cheap" : ""}`}>{time(s.start)}–{time(s.end)}<em>{s.full ? "Full" : s.price}</em></span>))}</div></div>)}
        {slots.length === 0 && <p className="muted small">Henter…</p>}
        <p className="muted small">Leveringstid velges i kassen på oda.com.</p>
      </section>}
    </div>
  );
}

function ProductCard({ p, qty, add }: { p: OdaProduct; qty: number; add: (id: number, d: number) => void }) {
  return (
    <div className={`product ${p.available === false ? "unavailable" : ""}`}>
      <span className="product-img" style={p.image ? { backgroundImage: `url(${p.image})` } : undefined} />
      <div className="product-name">{p.name}</div>
      <div className="muted small">{p.extra}</div>
      <div className="product-foot"><div><strong>{p.price.toFixed(2)}</strong><span className="muted small"> kr</span>{p.unitPrice && <div className="muted tiny">{p.unitPrice}</div>}</div>
        {qty > 0 ? <div className="stepper"><button onClick={() => add(p.id, -1)}><Minus size={14} /></button><span>{qty}</span><button onClick={() => add(p.id, 1)}><Plus size={14} /></button></div>
          : <button className="add-btn" onClick={() => add(p.id, 1)} aria-label="Legg i kurv"><Plus size={16} /></button>}</div>
    </div>
  );
}
