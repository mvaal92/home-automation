import * as fabel from "./fabel.mjs";
import { haRest } from "./ha.mjs";
import { readBody, sendJson } from "./util.mjs";
const MP = /^media_player\.[a-z0-9_]+$/;
export async function fabelApi(req, res, sub, trusted) {
  if (!trusted(req)) return sendJson(res, 403, { error: "Tailscale only" });
  try {
    const url = new URL(req.url, "http://x");
    if (sub === "status") return sendJson(res, 200, fabel.status());
    if (sub === "kids") return sendJson(res, 200, await fabel.kids());
    if (sub === "recent") return sendJson(res, 200, fabel.recent());
    if (sub === "search") return sendJson(res, 200, await fabel.search(url.searchParams.get("q") ?? "", Math.min(48, Number(url.searchParams.get("n")) || 24)));
    if (sub.startsWith("book/")) return sendJson(res, 200, await fabel.details(sub.slice(5).replace(/\D/g, "")));
    if (sub === "cast" && req.method === "POST") { // public sample only
      const b = await readBody(req); if (!MP.test(b.entity_id ?? "")) return sendJson(res, 400, { error: "entity" });
      const bk = await fabel.details(String(b.isbn ?? "").replace(/\D/g, ""));
      await haRest("/services/media_player/play_media", { entity_id: b.entity_id, media_content_id: bk.sample, media_content_type: "music", extra: { title: `${bk.title} (utdrag)`, thumb: bk.cover } });
      return sendJson(res, 200, { ok: true });
    }
    return sendJson(res, 404, { error: "not found" });
  } catch (e) { return sendJson(res, e.status ?? 502, { error: e.message }); }
}
