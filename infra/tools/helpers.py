from ha import *
import json
existing = {}
calls=[]
for d in ("input_boolean","input_select","input_number","schedule"):
    calls.append((f"{d}/list",{}))
res = wsmany(calls)
have = {d: {x["id"] for x in r} for d, r in zip(("input_boolean","input_select","input_number","schedule"), res)}
H = [
 ("input_select", dict(name="Home mode", icon="mdi:home-switch", options=["Home","Away","Night","Vacation","Guest"], initial="Home"), "home_mode"),
 ("input_boolean", dict(name="Guest mode", icon="mdi:account-multiple"), "guest_mode"),
 ("input_boolean", dict(name="Movie mode", icon="mdi:movie-open"), "movie_mode"),
 ("input_boolean", dict(name="Adaptive lighting", icon="mdi:theme-light-dark", initial=True), "adaptive_lighting"),
 ("input_boolean", dict(name="Heating schedule", icon="mdi:radiator", initial=True), "heating_schedule"),
 ("input_boolean", dict(name="Fan humidity boost active", icon="mdi:fan-plus"), "fan_humidity_boost_active"),
 ("input_select", dict(name="Heating state", icon="mdi:thermostat", options=["comfort","night","away","vacation"], initial="comfort"), "heating_state"),
 ("input_number", dict(name="Comfort Stue Kjøkken", min=7, max=35, step=0.5, unit_of_measurement="°C", mode="box", icon="mdi:thermometer", initial=30), "comfort_stue_kjokken"),
 ("input_number", dict(name="Comfort Kjøkken", min=7, max=35, step=0.5, unit_of_measurement="°C", mode="box", icon="mdi:thermometer", initial=25), "comfort_kjokken"),
 ("input_number", dict(name="Comfort Basement", min=7, max=35, step=0.5, unit_of_measurement="°C", mode="box", icon="mdi:thermometer", initial=18), "comfort_basement"),
 ("input_number", dict(name="Heating night offset", min=0, max=8, step=0.5, unit_of_measurement="°C", mode="slider", icon="mdi:weather-night", initial=2), "heating_night_offset"),
 ("input_number", dict(name="Heating away offset", min=0, max=10, step=0.5, unit_of_measurement="°C", mode="slider", icon="mdi:home-export-outline", initial=4), "heating_away_offset"),
 ("input_number", dict(name="Heating vacation offset", min=0, max=15, step=0.5, unit_of_measurement="°C", mode="slider", icon="mdi:airplane", initial=7), "heating_vacation_offset"),
 ("schedule", dict(name="Quiet hours", icon="mdi:sleep",
     monday=[{"from":"00:00:00","to":"07:00:00"},{"from":"22:30:00","to":"23:59:59"}],
     tuesday=[{"from":"00:00:00","to":"07:00:00"},{"from":"22:30:00","to":"23:59:59"}],
     wednesday=[{"from":"00:00:00","to":"07:00:00"},{"from":"22:30:00","to":"23:59:59"}],
     thursday=[{"from":"00:00:00","to":"07:00:00"},{"from":"22:30:00","to":"23:59:59"}],
     friday=[{"from":"00:00:00","to":"07:00:00"},{"from":"23:30:00","to":"23:59:59"}],
     saturday=[{"from":"00:00:00","to":"08:30:00"},{"from":"23:30:00","to":"23:59:59"}],
     sunday=[{"from":"00:00:00","to":"08:30:00"},{"from":"22:30:00","to":"23:59:59"}]), "quiet_hours"),
]
for dom, kw, oid in H:
    if oid in have[dom]:
        print("exists", dom, oid); continue
    r = ws(f"{dom}/create", **kw)
    print(dom, oid, "->", r.get("id") if isinstance(r, dict) else r, r.get("_error") if isinstance(r,dict) else "")
