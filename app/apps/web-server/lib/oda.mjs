// Server-side Oda (oda.com) client. Session cookies live in secrets/oda_session.json (0600).
// Never places orders: checkout is not implemented server-side; the UI deep-links to oda.com checkout
// only after an explicit confirm by the owner.
import { readFileSync, writeFileSync, existsSync, chmodSync } from "node:fs";
import { SECRETS } from "./util.mjs";
const BASE = "https://oda.com/api/v1";
const FILE = `${SECRETS}/oda_session.json`;
let jar = existsSync(FILE) ? JSON.parse(readFileSync(FILE, "utf8")) : {};
const save = () => { writeFileSync(FILE, JSON.stringify(jar), { mode: 0o600 }); chmodSync(FILE, 0o600); };
const cookieHeader = () => Object.entries(jar).filter(([k]) => !k.startsWith("_")).map(([k, v]) => `${k}=${v}`).join("; ");
function absorb(res) {
  for (const c of res.headers.getSetCookie?.() ?? []) {
    const [kv] = c.split(";"); const i = kv.indexOf("="); const k = kv.slice(0, i).trim(); const v = kv.slice(i + 1).trim();
    if (k === "csrftoken" || k === "sessionid") { if (v && v !== '""') jar[k] = v; else delete jar[k]; }
  }
  save();
}
export async function oda(path, { method = "GET", body } = {}) {
  if (!jar.csrftoken) { const r = await fetch("https://oda.com/no/", { headers: { cookie: cookieHeader() } }); absorb(r); }
  const r = await fetch(`${BASE}${path}`, {
    method, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(15000),
    headers: { "x-client-app": "tienda-web", "x-country": "no", "accept-language": "nb-NO", referer: "https://oda.com/no/", "content-type": "application/json", "x-csrftoken": jar.csrftoken ?? "", cookie: cookieHeader() },
  });
  absorb(r);
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch { /* html */ }
  if (!r.ok) { const e = new Error(json?.errors ? JSON.stringify(json.errors).slice(0, 200) : `Oda ${r.status}`); e.status = r.status; throw e; }
  return json;
}
export async function login(username, password) {
  jar = {}; await oda("/user/login/", { method: "POST", body: { username, password } });
  jar._user = username.replace(/(.).*(@.*)/, "$1…$2"); save();
  return status();
}
export async function logout() { try { await oda("/user/logout/", { method: "POST", body: {} }); } catch { /* */ } jar = {}; save(); }
export function status() { return { loggedIn: Boolean(jar.sessionid && jar._user), user: jar._user ?? null }; }

const product = (p) => { const a = p.attributes ?? p; return {
  id: a.id, name: a.full_name ?? a.name, brand: a.brand, extra: a.name_extra, price: Number(a.gross_price), unitPrice: a.gross_unit_price ? `${a.gross_unit_price} kr/${a.unit_price_quantity_abbreviation}` : null,
  image: a.images?.[0]?.thumbnail?.url ?? a.images?.[0]?.large?.url ?? null, available: a.availability?.is_available !== false, url: a.front_url,
}; };
export async function search(q, size = 24) {
  const d = await oda(`/search/mixed/?q=${encodeURIComponent(q)}&type=product&size=${size}`);
  return (d.items ?? []).filter((i) => i.type === "product").map(product);
}
export async function cart() {
  const d = await oda("/cart/");
  const items = (d.groups ?? []).flatMap((g) => g.items ?? []).map((i) => ({ ...product(i.product ?? i), quantity: i.quantity, total: Number(i.display_price_total ?? i.total_price ?? 0) }));
  return { count: d.product_quantity_count ?? items.length, total: Number(d.total_gross_amount ?? 0), items, label: d.label_text ?? null, deliveryNotice: d.delivery_info?.text ?? null };
}
/** quantity is a delta: +1 adds, -1 removes. */
export async function addToCart(productId, quantity = 1) { await oda("/cart/items/", { method: "POST", body: { items: [{ product_id: Number(productId), quantity: Number(quantity) }] } }); return cart(); }
export async function orders() {
  const d = await oda("/orders/");
  const list = d.results ?? d.items ?? d ?? [];
  return (Array.isArray(list) ? list : []).slice(0, 10).map((o) => ({ id: o.id ?? o.order_number, number: o.order_number ?? o.id, status: o.status?.text ?? o.status_display ?? o.status, delivery: o.delivery_time ?? o.delivery_slot ?? o.delivery?.time ?? null, total: Number(o.total_gross_amount ?? o.total ?? 0) }));
}
export async function deliverySlots() {
  const d = await oda("/slot-picker/slots/");
  return (d.delivery_slots ?? []).map((x) => ({ id: x.id, start: x.open_datetime, end: x.close_datetime, cutoff: x.cutoff_time, price: x.price, selected: x.is_selected, full: x.is_full || x.is_unavailable, cheapest: x.is_cheapest, group: x.route_group_str }));
}
export async function shoppingLists() {
  const d = await oda("/product-lists/");
  return (d.results ?? []).map((l) => ({ id: l.id, title: l.title ?? l.name, count: l.product_count ?? l.number_of_products ?? null }));
}
