import type { EntityMap, EntityState, Registries } from "./types";

/** A realistic Norwegian apartment (Oslo) for demo/mock mode. */
const now = new Date().toISOString();
const st = (entity_id: string, state: string, attributes: Record<string, unknown> = {}): EntityState => ({
  entity_id, state, attributes, last_changed: now, last_updated: now,
});

const dimCt = { supported_color_modes: ["color_temp"], min_color_temp_kelvin: 2200, max_color_temp_kelvin: 6500 };
const dim = { supported_color_modes: ["brightness"] };
const light = (id: string, name: string, on: boolean, pct: number, kelvin?: number, caps: Record<string, unknown> = dimCt) =>
  st(id, on ? "on" : "off", {
    friendly_name: name, ...caps,
    brightness: on ? Math.round((pct / 100) * 255) : null,
    color_mode: on ? (kelvin ? "color_temp" : "brightness") : null,
    color_temp_kelvin: on && kelvin ? kelvin : null,
  });
const sensor = (id: string, name: string, value: string | number, unit: string, device_class: string, extra: Record<string, unknown> = {}) =>
  st(id, String(value), { friendly_name: name, unit_of_measurement: unit, device_class, state_class: "measurement", ...extra });
const bin = (id: string, name: string, on: boolean, device_class: string) => st(id, on ? "on" : "off", { friendly_name: name, device_class });

export function mockStates(): EntityMap {
  const list: EntityState[] = [
    // Stue (living room)
    light("light.stue_tak", "Ceiling", true, 70, 2700),
    light("light.stue_gulvlampe", "Floor lamp", true, 45, 2400),
    light("light.stue_hylle", "Shelf strip", false, 0, undefined, dim),
    st("climate.stue_varmepumpe", "heat", {
      friendly_name: "Heat pump", hvac_modes: ["off", "heat", "cool", "auto", "fan_only"], current_temperature: 21.4,
      temperature: 22, min_temp: 16, max_temp: 30, target_temp_step: 0.5, hvac_action: "heating", supported_features: 1,
    }),
    st("media_player.stue_tv", "playing", {
      friendly_name: "Samsung TV", source: "Netflix", source_list: ["TV", "HDMI 1", "Netflix", "YouTube", "NRK TV"],
      media_title: "Exit", media_series_title: "Exit", media_artist: "NRK", volume_level: 0.28, is_volume_muted: false,
      device_class: "tv", supported_features: 152463,
    }),
    sensor("sensor.stue_temperatur", "Temperature", 21.4, "°C", "temperature"),
    sensor("sensor.stue_luftfuktighet", "Humidity", 38, "%", "humidity"),
    bin("binary_sensor.stue_bevegelse", "Motion", true, "motion"),
    // Kjøkken
    light("light.kjokken_tak", "Ceiling", false, 0, undefined),
    light("light.kjokken_benk", "Counter lights", true, 100, 4000),
    st("switch.kaffemaskin", "on", { friendly_name: "Coffee machine" }),
    sensor("sensor.kaffemaskin_effekt", "Coffee machine power", 1180, "W", "power"),
    st("media_player.kjokken_sonos", "paused", {
      friendly_name: "Sonos One", media_title: "Kveldssol", media_artist: "Karpe", volume_level: 0.18, is_volume_muted: false,
      device_class: "speaker", supported_features: 64063,
    }),
    sensor("sensor.kjokken_temperatur", "Temperature", 22.1, "°C", "temperature"),
    bin("binary_sensor.kjoleskap_dor", "Fridge door", false, "door"),
    // Soverom
    light("light.soverom_tak", "Ceiling", false, 0),
    light("light.soverom_nattbord", "Bedside", false, 0),
    sensor("sensor.soverom_temperatur", "Temperature", 18.6, "°C", "temperature"),
    sensor("sensor.soverom_luftfuktighet", "Humidity", 44, "%", "humidity"),
    sensor("sensor.soverom_sensor_batteri", "Climate sensor battery", 12, "%", "battery"),
    bin("binary_sensor.soverom_vindu", "Window", false, "window"),
    // Bad
    light("light.bad_speil", "Mirror", false, 0, undefined, dim),
    st("climate.bad_gulvvarme", "heat", {
      friendly_name: "Floor heating", hvac_modes: ["off", "heat"], current_temperature: 24.5, temperature: 25,
      min_temp: 5, max_temp: 35, target_temp_step: 0.5, hvac_action: "idle", supported_features: 1,
    }),
    sensor("sensor.bad_luftfuktighet", "Humidity", 63, "%", "humidity"),
    sensor("sensor.bad_temperatur", "Temperature", 24.3, "°C", "temperature"),
    // Gang (hallway)
    light("light.gang_tak", "Ceiling", true, 30, 2700),
    st("lock.inngangsdor", "locked", { friendly_name: "Front door", battery_level: 64 }),
    bin("binary_sensor.inngangsdor", "Front door", false, "door"),
    bin("binary_sensor.gang_bevegelse", "Motion", false, "motion"),
    st("vacuum.roborock", "docked", {
      friendly_name: "Roborock S8", battery_level: 100, fan_speed: "balanced", fan_speed_list: ["quiet", "balanced", "turbo", "max"],
      status: "Charging", supported_features: 13436,
    }),
    // Kontor (office)
    light("light.kontor_skrivebord", "Desk lamp", true, 85, 5000),
    st("switch.kontor_skjerm", "on", { friendly_name: "Monitor plug" }),
    sensor("sensor.kontor_skjerm_effekt", "Monitor power", 64.2, "W", "power"),
    sensor("sensor.kontor_temperatur", "Temperature", 21.9, "°C", "temperature"),
    sensor("sensor.kontor_co2", "CO₂", 812, "ppm", "carbon_dioxide"),
    // Balkong
    sensor("sensor.balkong_temperatur", "Temperature", 7.8, "°C", "temperature"),
    st("switch.balkong_lysslynge", "off", { friendly_name: "String lights" }),
    st("sensor.balkong_luftfuktighet", "unavailable", { friendly_name: "Balcony humidity", device_class: "humidity", unit_of_measurement: "%" }),
    // Energy (home-wide)
    sensor("sensor.stromforbruk", "Power now", 2140, "W", "power", { friendly_name: "Total power" }),
    sensor("sensor.energi_i_dag", "Energy today", 14.6, "kWh", "energy", { state_class: "total_increasing" }),
    sensor("sensor.strompris", "Spot price", 1.24, "NOK/kWh", "monetary"),
    // Scenes
    st("scene.morgen", "2026-10-11T07:00:00+02:00", { friendly_name: "Morning", icon: "mdi:weather-sunset-up" }),
    st("scene.film", "2026-10-10T21:00:00+02:00", { friendly_name: "Movie night", icon: "mdi:movie-open" }),
    st("scene.kveld", "2026-10-10T19:00:00+02:00", { friendly_name: "Evening", icon: "mdi:weather-night" }),
    st("scene.god_natt", "2026-10-10T23:30:00+02:00", { friendly_name: "Good night", icon: "mdi:bed" }),
    st("scene.borte", "2026-10-09T08:10:00+02:00", { friendly_name: "Away", icon: "mdi:home-export-outline" }),
    st("scene.middag", "2026-10-10T18:00:00+02:00", { friendly_name: "Dinner", icon: "mdi:silverware-fork-knife" }),
    st("script.leave_home", "off", { friendly_name: "Home · Leave home" }),
    st("script.arrive_home", "off", { friendly_name: "Home · Arrive home" }),
    st("script.bedtime", "off", { friendly_name: "Home · Bedtime" }),
    st("script.heating_apply", "off", { friendly_name: "Heating · Apply level" }),
    st("script.flexit_filter_replaced", "off", { friendly_name: "Flexit · Filter replaced" }),
    // Helpers
    st("input_select.home_mode", "Home", { friendly_name: "Home mode", options: ["Home", "Away", "Night", "Vacation", "Guest"] }),
    st("input_boolean.guest_mode", "off", { friendly_name: "Guest mode" }),
    st("input_boolean.movie_mode", "off", { friendly_name: "Movie mode" }),
    st("input_boolean.adaptive_lighting", "on", { friendly_name: "Adaptive lighting" }),
    st("input_boolean.heating_schedule", "on", { friendly_name: "Heating schedule" }),
    st("input_boolean.fan_humidity_boost_active", "off", { friendly_name: "Fan humidity boost active" }),
    st("schedule.quiet_hours", "off", { friendly_name: "Quiet hours" }),
    // Laundry: Samsung washer (SmartThings-style entities)
    st("sensor.vaskerom_washer_machine_state", "run", { friendly_name: "Washer Machine state", device_class: "enum", options: ["pause", "run", "stop"] }),
    st("sensor.vaskerom_washer_job_state", "rinse", { friendly_name: "Washer Job state", device_class: "enum" }),
    st("sensor.vaskerom_washer_completion_time", new Date(Date.now() + 38 * 60_000).toISOString(), { friendly_name: "Washer Completion time", device_class: "timestamp" }),
    sensor("sensor.vaskerom_washer_power", "Washer Power", 412, "W", "power"),
    sensor("sensor.vaskerom_washer_energy", "Washer Energy", 1705.3, "kWh", "energy", { state_class: "total_increasing" }),
    st("select.vaskerom_washer", "run", { friendly_name: "Washer", options: ["stop", "run", "pause"] }),
    sensor("sensor.vaskerom_temperatur", "Temperature", 19.2, "°C", "temperature"),
    // Cameras: Aqara G4 doorbell at the front door + living-room camera
    st("camera.gang_doorbell", "idle", { friendly_name: "Front door", entity_picture: "mock/doorbell.svg", brand: "Aqara", model_name: "Doorbell G4" }),
    st("event.gang_doorbell_ring", new Date(Date.now() - 6 * 60_000).toISOString(), { friendly_name: "Doorbell", device_class: "doorbell", event_types: ["ring"] }),
    st("camera.stue_kamera", "streaming", { friendly_name: "Living room", entity_picture: "mock/living.svg", brand: "TP-Link", model_name: "Tapo C210" }),
    st("weather.forecast_home", "cloudy", { friendly_name: "Oslo", temperature: 8, humidity: 81, wind_speed: 4.2 }),
  ];
  return Object.fromEntries(list.map((e) => [e.entity_id, e]));
}

const AREA_OF: Record<string, string> = {
  stue: "stue", kjokken: "kjokken", kaffemaskin: "kjokken", kjoleskap: "kjokken", soverom: "soverom", bad: "bad",
  gang: "gang", inngangsdor: "gang", roborock: "gang", kontor: "kontor", balkong: "balkong", vaskerom: "vaskerom",
};

export function mockRegistries(states: EntityMap = mockStates()): Registries {
  const areas = [
    { area_id: "stue", name: "Living room", icon: "mdi:sofa" },
    { area_id: "kjokken", name: "Kitchen", icon: "mdi:stove" },
    { area_id: "soverom", name: "Bedroom", icon: "mdi:bed" },
    { area_id: "bad", name: "Bathroom", icon: "mdi:shower" },
    { area_id: "gang", name: "Hallway", icon: "mdi:door" },
    { area_id: "kontor", name: "Office", icon: "mdi:desk" },
    { area_id: "vaskerom", name: "Laundry", icon: "mdi:washing-machine" },
    { area_id: "balkong", name: "Balcony", icon: "mdi:balcony" },
  ];
  const entities = Object.keys(states).map((entity_id) => {
    const obj = entity_id.split(".")[1] ?? "";
    const key = Object.keys(AREA_OF).find((k) => obj.startsWith(k));
    return { entity_id, device_id: null, area_id: key ? AREA_OF[key] ?? null : null, platform: "demo" };
  });
  return { areas, devices: [], entities };
}

/** Effects of mock scenes. */
export const MOCK_SCENES: Record<string, Array<{ id: string; state: string; pct?: number; kelvin?: number }>> = {
  "scene.morgen": [
    { id: "light.kjokken_tak", state: "on", pct: 100, kelvin: 4500 }, { id: "light.kjokken_benk", state: "on", pct: 100, kelvin: 4500 },
    { id: "light.gang_tak", state: "on", pct: 60, kelvin: 4000 }, { id: "switch.kaffemaskin", state: "on" },
  ],
  "scene.film": [
    { id: "light.stue_tak", state: "off" }, { id: "light.stue_gulvlampe", state: "on", pct: 15, kelvin: 2200 },
    { id: "light.stue_hylle", state: "on", pct: 25 }, { id: "light.kjokken_tak", state: "off" }, { id: "light.kjokken_benk", state: "off" },
  ],
  "scene.kveld": [
    { id: "light.stue_tak", state: "on", pct: 50, kelvin: 2700 }, { id: "light.stue_gulvlampe", state: "on", pct: 60, kelvin: 2400 },
    { id: "light.kjokken_benk", state: "on", pct: 60, kelvin: 2700 },
  ],
  "scene.god_natt": [
    { id: "light.stue_tak", state: "off" }, { id: "light.stue_gulvlampe", state: "off" }, { id: "light.stue_hylle", state: "off" },
    { id: "light.kjokken_tak", state: "off" }, { id: "light.kjokken_benk", state: "off" }, { id: "light.gang_tak", state: "off" },
    { id: "light.kontor_skrivebord", state: "off" }, { id: "light.soverom_nattbord", state: "on", pct: 10, kelvin: 2200 },
    { id: "lock.inngangsdor", state: "locked" },
  ],
  "scene.borte": [
    { id: "light.stue_tak", state: "off" }, { id: "light.stue_gulvlampe", state: "off" }, { id: "light.kjokken_benk", state: "off" },
    { id: "light.gang_tak", state: "off" }, { id: "light.kontor_skrivebord", state: "off" }, { id: "switch.kaffemaskin", state: "off" },
    { id: "lock.inngangsdor", state: "locked" }, { id: "vacuum.roborock", state: "cleaning" },
  ],
};
