#!/usr/bin/env python3
"""Generate the HA package `ventilation_humidity.yaml` from zones.yaml (one block per zone).

  python3 ha-packages/ventilation/build.py            # write ha-packages/ventilation_humidity.yaml
  python3 ha-packages/ventilation/build.py --deploy   # + copy into HA (docker exec), check config, reload,
                                                      #   seed curve helpers of NEW zones from zones.yaml
  python3 ha-packages/ventilation/build.py --deploy --reset-curve   # also overwrite existing curve helpers

Per zone this creates (key = zone id, e.g. bad):
  sensor.ventilasjon_<key>               target fan speed % (state) + everything the app/MCP need (attributes,
                                         ventilation_zone: true marks it as a zone)
  sensor.ventilasjon_<key>_grunnlinje    rolling baseline humidity (statistics, 20th percentile over baseline_hours)
  sensor.ventilasjon_<key>_fukt_glattet  smoothed humidity (time-weighted mean, 5 min)
  input_number.ventilasjon_<key>_*       curve settings (editable in the app) + last written speed (_fart)
  input_boolean.ventilasjon_<key>_auto   automation on/off
  input_select/timer ..._overstyring     manual override (auto | boost | pause) for N minutes
  automation ventilasjon_<key>           rate-limited actuation (rise at once, fall after hold_minutes, re-assert /30 min)
"""
import json, os, re, subprocess, sys, time, urllib.request
import yaml

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "ventilation_humidity.yaml")
HA = os.environ.get("HOME_HA_URL", "http://127.0.0.1:8123")
TOKEN_FILE = os.path.expanduser(os.environ.get("HOME_HA_TOKEN_FILE", "~/home-automation/secrets/ha_token"))
CURVE = {  # key: (label, min, max, step, unit, icon)
    "min_humidity": ("startfukt", 30, 95, 1, "%", "mdi:water-percent"),
    "max_humidity": ("maksfukt", 40, 100, 1, "%", "mdi:water-percent-alert"),
    "min_speed": ("minste fart", 0, 100, 5, "%", "mdi:fan-speed-1"),
    "max_speed": ("største fart", 0, 100, 5, "%", "mdi:fan-speed-3"),
    "baseline_offset": ("over grunnlinje", 0, 25, 1, "%", "mdi:delta"),
    "night_cap": ("nattgrense", 0, 100, 5, "%", "mdi:weather-night"),
}

def slugify(s):
    s = s.lower().replace("æ", "ae").replace("ø", "o").replace("å", "a")
    return re.sub(r"[^a-z0-9]+", "_", s).strip("_")

class Lit(str): pass
yaml.add_representer(Lit, lambda d, s: d.represent_scalar("tag:yaml.org,2002:str", s, style="|"))
yaml.add_representer(str, lambda d, s: d.represent_scalar("tag:yaml.org,2002:str", s, style="|" if "\n" in s else None))

def zone_pkg(key, z):
    assert re.fullmatch(r"[a-z][a-z0-9_]*", key), f"zone key {key!r} must be a lowercase slug"
    name, c, fan = z["name"], z["curve"], z["fan"]
    P = f"ventilasjon_{key}"
    ent = {
        "status": f"sensor.{P}", "baseline": f"sensor.{P}_grunnlinje", "smooth": f"sensor.{P}_fukt_glattet",
        "auto": f"input_boolean.{P}_auto", "override": f"input_select.{P}_overstyring", "timer": f"timer.{P}_overstyring",
        "speed": f"input_number.{P}_fart", **{k: f"input_number.{P}_{k}" for k in CURVE},
        "humidity_sensor": z["humidity_sensor"], "rpm": fan.get("rpm_sensor"), "fan": fan.get("entity"),
        "automation": "automation." + slugify(f"Ventilasjon {name}: fuktstyrt viftefart"),
    }
    hold, ns, ne = int(z.get("hold_minutes", 5)), z.get("night_start", "23:00"), z.get("night_end", "07:00")
    step, boost = int(c.get("step", 5)), int(z.get("boost_speed", 90))
    meta = {"zone": key, "name": name, "driver": fan["driver"], "boost_minutes": int(z.get("boost_minutes", 30)),
            "pause_minutes": int(z.get("pause_minutes", 30)), "night_start": ns, "night_end": ne, "hold_minutes": hold,
            "baseline_hours": z.get("baseline_hours", 2), "boost_speed": boost, "step": step,
            "humidity_sensor_note": z.get("humidity_sensor_note", "")}
    pkg = {
        "input_boolean": {f"{P}_auto": {"name": f"{name}: automatisk ventilasjon", "icon": "mdi:fan-auto"}},
        "input_number": {
            **{f"{P}_{k}": {"name": f"{name}: {lab}", "min": lo, "max": hi, "step": st, "unit_of_measurement": u, "mode": "box", "icon": ic}
               for k, (lab, lo, hi, st, u, ic) in CURVE.items()},
            f"{P}_fart": {"name": f"{name}: satt viftefart", "min": 0, "max": 100, "step": 1, "unit_of_measurement": "%", "mode": "box", "icon": "mdi:fan"},
        },
        "input_select": {f"{P}_overstyring": {"name": f"{name}: overstyring", "options": ["auto", "boost", "pause"], "icon": "mdi:hand-back-right"}},
        "timer": {f"{P}_overstyring": {"name": f"{name}: overstyring nedtelling", "restore": True, "icon": "mdi:timer-outline"}},
        "sensor": [
            {"platform": "statistics", "name": f"Ventilasjon {key} grunnlinje", "unique_id": f"{P}_grunnlinje", "entity_id": z["humidity_sensor"],
             "state_characteristic": "percentile", "percentile": 20, "max_age": {"hours": z.get("baseline_hours", 2)}, "sampling_size": 2000, "precision": 1},
            {"platform": "statistics", "name": f"Ventilasjon {key} fukt glattet", "unique_id": f"{P}_fukt_glattet", "entity_id": z["humidity_sensor"],
             "state_characteristic": "average_step", "max_age": {"minutes": 5}, "keep_last_sample": True, "sampling_size": 200, "precision": 1},
        ],
    }
    watch = [z["humidity_sensor"], ent["smooth"], ent["baseline"], ent["auto"], ent["override"], ent["speed"], *[ent[k] for k in CURVE]]
    calc = Lit(f"""{{%- set raw = states('{z["humidity_sensor"]}') | float(none) -%}}
{{%- set sm = states('{ent["smooth"]}') | float(raw) -%}}
{{%- set h = sm if sm is not none else raw -%}}
{{%- set base = states('{ent["baseline"]}') | float(h) -%}}
{{%- set mnh = states('{ent["min_humidity"]}') | float({c["min_humidity"]}) -%}}
{{%- set mxh = states('{ent["max_humidity"]}') | float({c["max_humidity"]}) -%}}
{{%- set mns = states('{ent["min_speed"]}') | float({c["min_speed"]}) -%}}
{{%- set mxs = [states('{ent["max_speed"]}') | float({c["max_speed"]}), mns] | max -%}}
{{%- set off = states('{ent["baseline_offset"]}') | float({c["baseline_offset"]}) -%}}
{{%- set cap = states('{ent["night_cap"]}') | float({c["night_cap"]}) -%}}
{{%- set lo = [mnh, (base + off) if base is not none else mnh] | max -%}}
{{%- set hi = [mxh, lo + 5] | max -%}}
{{%- set t = now().strftime('%H:%M') -%}}
{{%- set night = (t >= '{ns}' or t < '{ne}') if '{ns}' > '{ne}' else ('{ns}' <= t < '{ne}') -%}}
{{%- set ov = states('{ent["override"]}') -%}}
{{%- set auto = is_state('{ent["auto"]}', 'on') -%}}
{{%- set last = states('{ent["speed"]}') | int(0) -%}}
{{%- if h is none -%}}{{%- set frac, sp, mode = 0, mns, 'sensorfeil' -%}}
{{%- else -%}}
  {{%- set frac = [[(h - lo) / (hi - lo), 0] | max, 1] | min -%}}
  {{%- set sp = mns + (mxs - mns) * frac -%}}
  {{%- set mode = 'grunn' if frac <= 0 else ('maks' if frac >= 1 else 'okt') -%}}
  {{%- if night and h < hi and sp > cap -%}}{{%- set sp, mode = [cap, mns] | max, 'natt' -%}}{{%- endif -%}}
{{%- endif -%}}
{{%- set sp = ((sp / {step}) | round(0) * {step}) | int -%}}
{{%- if ov == 'boost' -%}}{{%- set sp, mode = {boost}, 'boost' -%}}
{{%- elif ov == 'pause' -%}}{{%- set sp, mode = 0, 'pause' -%}}
{{%- elif not auto -%}}{{%- set sp, mode = ((mns / {step}) | round(0) * {step}) | int, 'fast' -%}}{{%- endif -%}}
{{{{ {{'speed': sp, 'mode': mode, 'humidity': raw, 'smoothed': sm, 'baseline': base, 'start': lo | round(1), 'full': hi | round(1),
   'fraction': frac | round(2), 'night': night}} }}}}""")
    pkg["template"] = [{
        "triggers": [{"trigger": "time_pattern", "minutes": "/1"}, {"trigger": "homeassistant", "event": "start"},
                     {"trigger": "state", "entity_id": watch}],
        "actions": [{"variables": {"v": calc}}],
        "sensor": [{
            "name": f"Ventilasjon {name}", "unique_id": P, "default_entity_id": f"sensor.{P}", "unit_of_measurement": "%", "icon": "mdi:fan",
            "state": "{{ v.speed }}",
            "attributes": {
                "ventilation_zone": "{{ true }}", **{k: Lit("{{ %s }}" % json.dumps(val, ensure_ascii=False)) for k, val in meta.items()},
                "mode": "{{ v.mode }}", "humidity": "{{ v.humidity }}", "humidity_smoothed": "{{ v.smoothed }}", "baseline": "{{ v.baseline }}",
                "start_humidity": "{{ v.start }}", "full_humidity": "{{ v.full }}", "fraction": "{{ v.fraction }}", "night": "{{ v.night }}",
                "override": f"{{{{ states('{ent['override']}') }}}}",
                "override_ends": f"{{{{ state_attr('{ent['timer']}', 'finishes_at') if is_state('{ent['timer']}', 'active') else none }}}}",
                "auto": f"{{{{ is_state('{ent['auto']}', 'on') }}}}",
                "last_set": f"{{{{ states('{ent['speed']}') | int(0) }}}}",
                "rpm": f"{{{{ states('{ent['rpm']}') | int(none) }}}}" if ent["rpm"] else "{{ none }}",
                "curve": Lit("{{ %s }}" % ("{" + ", ".join(f"'{k}': states('{ent[k]}') | float(none)" for k in CURVE) + "}")),
                "entities": Lit("{{ %s }}" % json.dumps({k: v for k, v in ent.items() if v})),
            },
        }],
    }]
    if fan["driver"] == "ecovent_manual":
        actuate = [{"action": "shell_command.ventilasjon_ecovent", "data": {"entry": fan["entry"], "speed": "{{ target }}"}, "response_variable": "res", "continue_on_error": True}]
    elif fan["driver"] == "fan":
        actuate = [{"if": [{"condition": "template", "value_template": "{{ target | int == 0 }}"}],
                    "then": [{"action": "fan.turn_off", "target": {"entity_id": fan["entity"]}}],
                    "else": [{"action": "fan.set_percentage", "target": {"entity_id": fan["entity"]}, "data": {"percentage": "{{ target }}"}}]}]
    else:
        raise SystemExit(f"unknown driver {fan['driver']}")
    pkg["automation"] = [
        {"id": P, "alias": f"Ventilasjon {name}: fuktstyrt viftefart", "description": f"Generert fra ha-packages/ventilation/zones.yaml (sone {key}). Proporsjonal fuktkurve, natt-tak, overstyring.",
         "mode": "queued", "max": 3, "max_exceeded": "silent",
         "triggers": [{"trigger": "time_pattern", "minutes": "/1", "id": "tick"},
                      {"trigger": "state", "entity_id": ent["status"], "id": "change"},
                      {"trigger": "state", "entity_id": ent["override"], "id": "override"},
                      {"trigger": "state", "entity_id": ent["auto"], "id": "override"},
                      {"trigger": "time_pattern", "minutes": "/30", "id": "reassert"},
                      {"trigger": "homeassistant", "event": "start", "id": "reassert"}],
         "variables": {
             "target": f"{{{{ states('{ent['status']}') | int(-1) }}}}",
             "mode": f"{{{{ state_attr('{ent['status']}', 'mode') }}}}",
             "last": f"{{{{ states('{ent['speed']}') | int(-1) }}}}",
             "age_min": f"{{{{ ((now() - states['{ent['speed']}'].last_changed).total_seconds() / 60) if states['{ent['speed']}'] is not none else 999 }}}}",
             "write": Lit(f"""{{%- if target < 0 or mode in [none, 'unknown'] -%}}false
{{%- elif trigger.id in ['reassert', 'override'] -%}}true
{{%- elif trigger.id == 'change' and trigger.from_state is not none and trigger.from_state.attributes.mode in ['boost', 'pause', 'fast'] and target != last -%}}true
{{%- elif target == last -%}}false
{{%- elif mode in ['boost', 'pause'] or target > last -%}}true
{{%- else -%}}{{{{ age_min >= {hold} }}}}{{%- endif -%}}"""),
         },
         "conditions": [{"condition": "template", "value_template": "{{ write }}"}],
         "actions": [*actuate,
                     {"action": "input_number.set_value", "target": {"entity_id": ent["speed"]}, "data": {"value": "{{ target }}"}},
                     {"action": "logbook.log", "data": {"name": f"Ventilasjon {name}", "entity_id": ent["status"],
                      "message": "{{ 'satt til ' ~ target ~ ' % (' ~ mode ~ ', ' ~ trigger.id ~ ')' ~ ((' – feil: ' ~ res.stdout) if res is defined and res.returncode != 0 else '') }}"}}]},
        {"id": f"{P}_overstyring_ferdig", "alias": f"Ventilasjon {name}: overstyring ferdig", "mode": "single",
         "triggers": [{"trigger": "event", "event_type": "timer.finished", "event_data": {"entity_id": ent["timer"]}}],
         "actions": [{"action": "input_select.select_option", "target": {"entity_id": ent["override"]}, "data": {"option": "auto"}}]},
    ]
    return pkg, ent, c

def build():
    cfg = yaml.safe_load(open(os.path.join(HERE, "zones.yaml")))
    merged, zones = {}, {}
    for key, z in cfg["zones"].items():
        pkg, ent, curve = zone_pkg(key, z)
        zones[key] = (ent, curve, z)
        for dom, val in pkg.items():
            if isinstance(val, list): merged.setdefault(dom, []).extend(val)
            else: merged.setdefault(dom, {}).update(val)
    merged["shell_command"] = {"ventilasjon_ecovent": "python3 /config/ventilation/ecovent_speed.py {{ entry | regex_replace('[^a-z0-9_]', '') }} {{ speed | int }}"}
    merged.setdefault("script", {})["ventilasjon_overstyr"] = {
        "alias": "Ventilasjon: overstyr sone", "icon": "mdi:fan-clock", "mode": "parallel",
        "description": "Boost eller pause en ventilasjonssone i N minutter, eller tilbake til auto.",
        "fields": {"zone": {"description": "sone-id, f.eks. bad", "required": True, "selector": {"text": None}},
                   "kind": {"description": "boost | pause | auto", "required": True, "selector": {"select": {"options": ["boost", "pause", "auto"]}}},
                   "minutes": {"description": "varighet i minutter (boost/pause)", "selector": {"number": {"min": 1, "max": 240}}}},
        "sequence": [
            {"variables": {"z": "{{ zone | regex_replace('[^a-z0-9_]', '') }}", "mins": "{{ (minutes | default(state_attr('sensor.ventilasjon_' ~ (zone | regex_replace('[^a-z0-9_]', '')), kind ~ '_minutes'), true) | default(30, true)) | int(30) }}"}},
            {"condition": "template", "value_template": "{{ states('input_select.ventilasjon_' ~ z ~ '_overstyring') not in ['unknown', 'unavailable'] }}"},
            {"if": [{"condition": "template", "value_template": "{{ kind == 'auto' }}"}],
             "then": [{"action": "timer.cancel", "target": {"entity_id": "timer.ventilasjon_{{ z }}_overstyring"}},
                      {"action": "input_boolean.turn_on", "target": {"entity_id": "input_boolean.ventilasjon_{{ z }}_auto"}}],
             "else": [{"action": "timer.start", "target": {"entity_id": "timer.ventilasjon_{{ z }}_overstyring"}, "data": {"duration": "{{ '%02d:%02d:00' % (mins // 60, mins % 60) }}"}}]},
            {"action": "input_select.select_option", "target": {"entity_id": "input_select.ventilasjon_{{ z }}_overstyring"}, "data": {"option": "{{ kind }}"}},
        ]}
    head = "# GENERERT av ha-packages/ventilation/build.py fra zones.yaml – ikke rediger for hånd.\n"
    text = head + yaml.dump(merged, sort_keys=False, allow_unicode=True, width=10000)
    open(OUT, "w").write(text)
    return zones

def ha(method, path, data=None):
    tok = open(TOKEN_FILE).read().strip()
    req = urllib.request.Request(HA + path, method=method, data=None if data is None else json.dumps(data).encode(),
                                 headers={"Authorization": "Bearer " + tok, "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=120) as r:
        b = r.read().decode(); return json.loads(b) if b else None

def deploy(zones, reset):
    before = {s["entity_id"] for s in ha("GET", "/api/states")}
    for src, dst in [(OUT, "/config/packages/ventilation_humidity.yaml"), (os.path.join(HERE, "ecovent_speed.py"), "/config/ventilation/ecovent_speed.py")]:
        subprocess.run(["docker", "exec", "homeassistant", "mkdir", "-p", os.path.dirname(dst)], check=True)
        subprocess.run(["docker", "cp", src, f"homeassistant:{dst}"], check=True)
        subprocess.run(["docker", "exec", "homeassistant", "chown", "root:root", dst], check=True)
    chk = ha("POST", "/api/config/core/check_config")
    if chk.get("result") != "valid": raise SystemExit(f"HA config check failed: {chk.get('errors')}")
    services = ha("GET", "/api/services"); have = {d["domain"]: d["services"] for d in services}
    if "ventilasjon_ecovent" not in have.get("shell_command", {}):
        print("shell_command is new -> restarting Home Assistant"); ha("POST", "/api/services/homeassistant/restart", {})
        time.sleep(20)
        for _ in range(60):
            try:
                if ha("GET", "/api/config").get("state") == "RUNNING": break
            except Exception: pass
            time.sleep(5)
    else:
        for dom in ["input_boolean", "input_number", "input_select", "timer", "template", "statistics", "script", "automation"]:
            if "reload" in have.get(dom, {}): ha("POST", f"/api/services/{dom}/reload", {})
    time.sleep(5)
    for key, (ent, curve, z) in zones.items():
        new = ent["auto"] not in before
        for k in CURVE:
            if (new or reset) and k in curve:
                ha("POST", "/api/services/input_number/set_value", {"entity_id": ent[k], "value": curve[k]})
        if new: ha("POST", "/api/services/input_boolean/turn_on", {"entity_id": ent["auto"]})
        print(key, "new" if new else "updated", ha("GET", f"/api/states/{ent['status']}").get("state"))

if __name__ == "__main__":
    zones = build(); print("wrote", os.path.relpath(OUT))
    if "--deploy" in sys.argv: deploy(zones, "--reset-curve" in sys.argv)
