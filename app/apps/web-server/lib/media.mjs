// Media helpers (WS-only HA commands): browse media, Sonos favorites, Spotify status.
import { haWs, haRest } from "./ha.mjs";
import { readBody, sendJson } from "./util.mjs";
const ok = /^media_player\.[a-z0-9_]+$/;
export async function mediaApi(req, res, sub, trusted) {
  if (!trusted(req)) return sendJson(res, 403, { error: "Tailscale only" });
  try {
    if (sub === "browse" && req.method === "POST") {
      const b = await readBody(req);
      if (!ok.test(b.entity_id)) return sendJson(res, 400, { error: "entity" });
      const msg = { type: "media_player/browse_media", entity_id: b.entity_id };
      if (b.media_content_id || b.media_content_type) { msg.media_content_id = b.media_content_id ?? ""; msg.media_content_type = b.media_content_type; }
      return sendJson(res, 200, await haWs(msg));
    }
    if (sub === "search" && req.method === "POST") {
      const b = await readBody(req);
      if (!ok.test(b.entity_id)) return sendJson(res, 400, { error: "entity" });
      return sendJson(res, 200, await haWs({ type: "media_player/search_media", entity_id: b.entity_id, search_query: String(b.query ?? "").slice(0, 100), media_content_type: b.media_content_type }));
    }
    if (sub === "spotify") {
      const entries = await haRest("/config/config_entries/entry?domain=spotify").catch(() => []);
      return sendJson(res, 200, { configured: Array.isArray(entries) && entries.length > 0, entries: (entries || []).map((e) => ({ title: e.title, state: e.state })) });
    }
    return sendJson(res, 404, { error: "not found" });
  } catch (e) { return sendJson(res, 502, { error: e.message }); }
}
