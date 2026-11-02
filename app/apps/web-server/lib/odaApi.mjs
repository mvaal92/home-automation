import * as oda from "./oda.mjs";
import { readBody, sendJson } from "./util.mjs";
export async function odaApi(req, res, sub, trusted) {
  if (!trusted(req)) return sendJson(res, 403, { error: "Tailscale only" });
  try {
    const url = new URL(req.url, "http://x");
    if (sub === "status") return sendJson(res, 200, oda.status());
    if (sub === "search") return sendJson(res, 200, { products: await oda.search(url.searchParams.get("q") ?? "", 30) });
    if (sub === "cart" && req.method === "GET") return sendJson(res, 200, await oda.cart());
    if (sub === "cart/items" && req.method === "POST") { const b = await readBody(req); return sendJson(res, 200, await oda.addToCart(b.productId, b.quantity ?? 1)); }
    if (sub === "slots") return sendJson(res, 200, { slots: await oda.deliverySlots() });
    if (sub === "orders") return sendJson(res, 200, { orders: await oda.orders() });
    if (sub === "lists") return sendJson(res, 200, { lists: await oda.shoppingLists() });
    // Checkout is deliberately NOT done server-side. The UI opens oda.com/no/checkout/ after the owner confirms.
    return sendJson(res, 404, { error: "not found" });
  } catch (e) { return sendJson(res, e.status === 401 ? 401 : 502, { error: e.message, loginRequired: e.status === 401 }); }
}
