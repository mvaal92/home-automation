// Top bar weather: picks the best HA weather entity (met.no "forecast_home" first), plus hourly/daily forecast
// via weather.get_forecasts (read-only service with return_response). Cached 10 min. Tailscale-only: GET /api/home/weather
import { haRest } from "../ha.mjs";
import { sendJson } from "../util.mjs";
let cache = { at: 0, data: null };
async function pick() {
  const st = await haRest("/states"); const w = st.filter((e) => e.entity_id.startsWith("weather.") && e.state !== "unavailable");
  const best = w.find((e) => /forecast_home$|_home$/.test(e.entity_id)) ?? w[0] ?? null;
  const outdoor = st.find((e) => e.entity_id.startsWith("sensor.") && e.attributes.device_class === "temperature" && /(outdoor|outside|ute|utendørs|balkong)/i.test(e.entity_id + " " + (e.attributes.friendly_name ?? "")) && !isNaN(Number(e.state)));
  return { best, outdoor };
}
export async function weather() {
  if (cache.data && Date.now() - cache.at < 10 * 60e3) return cache.data;
  const { best, outdoor } = await pick(); if (!best) return null;
  const fc = async (type) => { try { const r = await haRest("/services/weather/get_forecasts?return_response", { entity_id: best.entity_id, type }); return r?.service_response?.[best.entity_id]?.forecast ?? []; } catch { return []; } };
  const [hourly, daily] = await Promise.all([fc("hourly"), fc("daily")]);
  const todayKey = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Oslo" });
  const todays = hourly.filter((h) => new Date(h.datetime).toLocaleDateString("sv-SE", { timeZone: "Europe/Oslo" }) === todayKey).map((h) => h.temperature);
  const d0 = daily.find((d) => new Date(d.datetime).toLocaleDateString("sv-SE", { timeZone: "Europe/Oslo" }) === todayKey) ?? daily[0];
  const cur = Number(outdoor?.state ?? best.attributes.temperature);
  const next = hourly.slice(0, 12).map((h) => ({ t: h.datetime, temp: h.temperature, cond: h.condition, precip: h.precipitation ?? 0, prob: h.precipitation_probability ?? null }));
  const rainSoon = next.slice(0, 6).find((h) => h.precip >= 0.2);
  const data = { entity: best.entity_id, source: outdoor ? outdoor.entity_id : best.entity_id, condition: best.state, temp: isNaN(cur) ? null : cur,
    high: todays.length ? Math.max(...todays, cur) : d0?.temperature ?? null, low: todays.length ? Math.min(...todays, cur, d0?.templow ?? Infinity) : d0?.templow ?? null,
    humidity: best.attributes.humidity ?? null, wind: best.attributes.wind_speed ?? null, windUnit: best.attributes.wind_speed_unit ?? "km/h",
    precipNext6h: Math.round(next.slice(0, 6).reduce((a, h) => a + (h.precip || 0), 0) * 10) / 10, rainAt: rainSoon?.t ?? null, hourly: next,
    tomorrow: daily[1] ? { cond: daily[1].condition, high: daily[1].temperature, low: daily[1].templow ?? null } : null };
  cache = { at: Date.now(), data }; return data;
}
export async function weatherRoute(req, res, trusted) {
  if (!trusted(req)) return sendJson(res, 403, { error: "Tailscale only" });
  try { return sendJson(res, 200, (await weather()) ?? { error: "ingen værdata" }); } catch (e) { return sendJson(res, 502, { error: String(e.message).slice(0, 120) }); }
}
