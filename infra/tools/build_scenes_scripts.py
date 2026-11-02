from ha import *
def b(p): return round(p*255/100)
def L(pct, k=None):
    d={"state":"on","brightness":b(pct)}
    if k: d["color_temp_kelvin"]=k
    return d
OFF={"state":"off"}
K="light.kjokken_"; S="light.spisestue_"
KITCHEN=[K+"taklamper_kjokken_1",K+"lys_under_overkap",K+"lys_kaffestasjon",K+"lys_skap_kjokken",K+"bordlampe"]
DINING=[S+"taklampe_spisebord",S+"bordlampe_hoy",S+"gulvlampe_stue"]
TV=["light.tv_stue_tv_lys"]
ENTRY=["light.wiz_dimmable_white_d7a578","light.wiz_dimmable_white_d71508"]  # local WiZ = ST Inngangsparti / Ingangsparti 2
BASEMENT=["light.wiz_dimmable_white_be230e","light.wiz_dimmable_white_57a6b2","light.wiz_dimmable_white_be20c0","light.wiz_dimmable_white_be271c"]  # local WiZ = ST basement ceilings
COMMON=KITCHEN+DINING+TV+ENTRY
scenes = {
 "morning": ("Morning", "mdi:weather-sunset-up", {
   K+"taklamper_kjokken_1":L(70), K+"lys_under_overkap":L(80,3500), K+"lys_kaffestasjon":L(80,3500), K+"lys_skap_kjokken":L(60,3500), K+"bordlampe":L(50),
   S+"taklampe_spisebord":L(60), S+"bordlampe_hoy":L(40), ENTRY[0]:L(60), ENTRY[1]:L(60)}),
 "evening": ("Evening", "mdi:weather-sunset-down", {
   K+"taklamper_kjokken_1":L(35), K+"lys_under_overkap":L(50,2700), K+"lys_kaffestasjon":L(40,2700), K+"lys_skap_kjokken":L(35,2700), K+"bordlampe":L(60),
   S+"taklampe_spisebord":L(40), S+"bordlampe_hoy":L(60), "light.tv_stue_tv_lys":L(50,2700),
   ENTRY[0]:L(40), ENTRY[1]:L(40)}),
 "movie_night": ("Movie night", "mdi:movie-open", {
   K+"taklamper_kjokken_1":OFF, K+"lys_under_overkap":L(10,2200), K+"lys_kaffestasjon":OFF, K+"lys_skap_kjokken":OFF, K+"bordlampe":OFF,
   S+"taklampe_spisebord":OFF, S+"bordlampe_hoy":L(15), "light.tv_stue_tv_lys":L(15,2200)}),
 "dinner": ("Dinner", "mdi:silverware-fork-knife", {
   S+"taklampe_spisebord":L(55), S+"bordlampe_hoy":L(45),
   K+"taklamper_kjokken_1":L(20), K+"lys_under_overkap":L(40,2700), K+"lys_kaffestasjon":L(25,2700), K+"lys_skap_kjokken":OFF, K+"bordlampe":L(40),
   "light.tv_stue_tv_lys":L(20,2400)}),
 "good_night": ("Good night", "mdi:weather-night", {e:OFF for e in [x for x in COMMON if x!=S+"gulvlampe_stue"]+BASEMENT}),
 "away": ("Away", "mdi:home-export-outline", {e:OFF for e in [x for x in COMMON if x!=S+"gulvlampe_stue"]+BASEMENT+["light.gjesterom_taklys_gjesterom","light.wiz_tunable_white_362476","light.kid1_zigbee_dimmer_1"]}),
}
if __name__ == "__main__":
 for sid,(name,icon,ents) in scenes.items():
    r=rest("POST",f"/api/config/scene/config/{sid}",{"id":sid,"name":name,"icon":icon,"entities":ents})
    print("scene",sid,r)

TVS=["media_player.tv_stue_samsung_tv","media_player.bedroom_1_55_the_frame"]
SONOS=["media_player.kjokken_kjokken","media_player.tv_room_tv_room"]
NONESSENTIAL_SWITCHES=["switch.spisestue_juletre"]
CLIMATE=[("climate.spisestue_termostat_stue_kjokken","input_number.comfort_stue_kjokken"),
         ("climate.kjokken_elko_one_thermostat","input_number.comfort_kjokken"),
         ("climate.basement_beta_elko_smart_zb_termostat","input_number.comfort_basement")]
def coe(a): a["continue_on_error"]=True; return a
pause_sonos={"repeat":{"for_each":SONOS,"sequence":[{"if":[{"condition":"template","value_template":"{{ is_state(repeat.item,'playing') }}"}],"then":[coe({"action":"media_player.media_pause","target":{"entity_id":"{{ repeat.item }}"}})]}]}}
tvs_off={"repeat":{"for_each":TVS,"sequence":[{"if":[{"condition":"template","value_template":"{{ is_state(repeat.item,'on') }}"}],"then":[coe({"action":"media_player.turn_off","target":{"entity_id":"{{ repeat.item }}"}})]}]}}
def set_mode(m, also_ok=()):
    ok=[m,*also_ok]
    return {"if":[{"condition":"template","value_template":"{{ states('input_select.home_mode') not in %r }}"%ok}],
            "then":[{"action":"input_select.select_option","target":{"entity_id":"input_select.home_mode"},"data":{"option":m}}]}
def heating(state):
    return {"action":"script.heating_apply","data":{"state":state}}

scripts = {
 "heating_apply": dict(alias="Heating · Apply level", icon="mdi:thermostat-auto", mode="queued",
   description="Sets all three ELKO thermostats to a level relative to their stored comfort setpoints: comfort = stored value, night = comfort − night offset, away = comfort − away offset, vacation = comfort − vacation offset (never below 7 °C). Only touches thermostats that are available and in heat mode. Never changes the HVAC mode.",
   fields={"state":{"name":"Level","required":True,"default":"comfort","selector":{"select":{"options":["comfort","night","away","vacation"]}}}},
   sequence=[
     {"variables":{"offset":"{% set m={'comfort':0,'night':states('input_number.heating_night_offset')|float(2),'away':states('input_number.heating_away_offset')|float(4),'vacation':states('input_number.heating_vacation_offset')|float(7)} %}{{ m.get(state,0) }}"}},
     {"action":"input_select.select_option","target":{"entity_id":"input_select.heating_state"},"data":{"option":"{{ state }}"}},
     *[{"if":[{"condition":"state","entity_id":c,"state":"heat"}],
        "then":[coe({"action":"climate.set_temperature","target":{"entity_id":c},
                 "data":{"temperature":"{{ [7, (states('%s')|float(20) - offset|float(0))] | max | round(1) }}"%n}})]} for c,n in CLIMATE]]),
 "leave_home": dict(alias="Home · Leave home", icon="mdi:home-export-outline", mode="single",
   description="Run when everyone leaves (or set Home mode to Away/Vacation). Turns off lights in common rooms, basement and kids/guest rooms (guest room is skipped when Guest mode is on), turns off TVs, pauses Sonos, turns off the Juletre plug and lowers heating to the away level (vacation level if Home mode is Vacation). Never touches the fridge, router, water heater, ventilation or unknown plugs.",
   sequence=[set_mode("Away",("Vacation",)),
     {"action":"input_boolean.turn_off","target":{"entity_id":"input_boolean.movie_mode"}},
     {"if":[{"condition":"state","entity_id":"input_boolean.guest_mode","state":"on"}],
      "then":[coe({"action":"light.turn_off","target":{"entity_id":[x for x in COMMON+BASEMENT+["light.wiz_tunable_white_362476","light.kid1_zigbee_dimmer_1"]]}})],
      "else":[coe({"action":"scene.turn_on","target":{"entity_id":"scene.away"}}), coe({"action":"light.turn_off","target":{"entity_id":"light.spisestue_gulvlampe_stue"}})]},
     tvs_off, pause_sonos,
     coe({"action":"switch.turn_off","target":{"entity_id":NONESSENTIAL_SWITCHES}}),
     {"if":[{"condition":"state","entity_id":"input_boolean.heating_schedule","state":"on"},{"condition":"state","entity_id":"input_boolean.guest_mode","state":"off"}],
      "then":[heating("{{ 'vacation' if is_state('input_select.home_mode','Vacation') else 'away' }}")]}]),
 "arrive_home": dict(alias="Home · Arrive home", icon="mdi:home-import-outline", mode="single",
   description="Run when you come home (or set Home mode back to Home). Restores comfort heating, and if it is dark: the Evening scene before quiet hours, or just the entrance lights at 30 % during quiet hours.",
   sequence=[set_mode("Home",("Guest",)),
     {"if":[{"condition":"state","entity_id":"input_select.heating_state","state":["away","vacation"]},{"condition":"state","entity_id":"input_boolean.heating_schedule","state":"on"}],
      "then":[heating("{{ 'night' if is_state('schedule.quiet_hours','on') else 'comfort' }}")]},
     {"if":[{"condition":"state","entity_id":"sun.sun","state":"below_horizon"}],
      "then":[{"if":[{"condition":"state","entity_id":"schedule.quiet_hours","state":"off"}],
               "then":[coe({"action":"scene.turn_on","target":{"entity_id":"scene.evening"},"data":{"transition":2}})],
               "else":[coe({"action":"light.turn_on","target":{"entity_id":ENTRY},"data":{"brightness_pct":30}})]}]}]),
 "bedtime": dict(alias="Home · Bedtime", icon="mdi:bed", mode="single",
   description="Good night routine. Sets Home mode to Night, turns off movie mode, turns off lights in kitchen, dining, TV stue, entrance and basement (Good night scene), the guest room unless Guest mode is on, turns off the TVs, pauses Sonos, turns off the Juletre plug and lowers heating to the night level. Bedroom 1, Kid1' room and the (unassigned) WiZ bulbs are left alone so nobody is plunged into darkness.",
   sequence=[set_mode("Night"),
     {"action":"input_boolean.turn_off","target":{"entity_id":"input_boolean.movie_mode"}},
     coe({"action":"scene.turn_on","target":{"entity_id":"scene.good_night"},"data":{"transition":3}}),
     coe({"action":"light.turn_off","target":{"entity_id":"light.spisestue_gulvlampe_stue"}}),
     {"if":[{"condition":"state","entity_id":"input_boolean.guest_mode","state":"off"}],"then":[coe({"action":"light.turn_off","target":{"entity_id":"light.gjesterom_taklys_gjesterom"}})]},
     tvs_off, pause_sonos,
     coe({"action":"switch.turn_off","target":{"entity_id":NONESSENTIAL_SWITCHES}}),
     {"if":[{"condition":"state","entity_id":"input_boolean.heating_schedule","state":"on"},{"condition":"state","entity_id":"input_select.heating_state","state":"comfort"}],"then":[heating("night")]}]),
 "movie_mode": dict(alias="TV stue · Movie mode", icon="mdi:movie-open", mode="single",
   description="Remembers the current kitchen/dining/TV stue lights, then applies the Movie night scene (TV Lys and one dining lamp low and warm, ceilings off). Turning Movie mode off (or the TV switching off) restores the remembered lights — unless it is quiet hours, then lights are left as they are.",
   sequence=[{"if":[{"condition":"state","entity_id":"input_boolean.movie_mode","state":"off"}],
               "then":[{"action":"scene.create","data":{"scene_id":"before_movie","snapshot_entities":[x for x in COMMON if x!=S+"gulvlampe_stue"]}},
                       {"action":"input_boolean.turn_on","target":{"entity_id":"input_boolean.movie_mode"}}]},
             coe({"action":"scene.turn_on","target":{"entity_id":"scene.movie_night"},"data":{"transition":4}})]),
 "all_off": dict(alias="Home · All off", icon="mdi:power", mode="single",
   description="Turns off every light (including the WiZ bulbs and bedrooms), the TVs and the Juletre plug, and pauses Sonos. Deliberately does NOT touch thermostats, the Flexit ventilation, the water heater, the router/network, the washer or unknown plugs (Kid1 Zigbee Switch 1/2, Utelys Inngang).",
   sequence=[{"action":"input_boolean.turn_off","target":{"entity_id":"input_boolean.movie_mode"}},
     coe({"action":"light.turn_off","target":{"entity_id":"all"}}), tvs_off, pause_sonos,
     coe({"action":"switch.turn_off","target":{"entity_id":NONESSENTIAL_SWITCHES}})]),
 "flexit_filter_replaced": dict(alias="Flexit · Filter replaced", icon="mdi:air-filter", mode="single",
   description="Run after you have physically changed the Flexit fan filter: resets the fan's filter timer so the reminder stops.",
   sequence=[{"action":"ecovent_v2.filter_timer_reset","target":{"entity_id":"fan.flexit_fan"}},
             {"action":"persistent_notification.dismiss","data":{"notification_id":"flexit_filter"}}]),
}
if __name__ == "__main__":
 for sid,cfg in scripts.items():
    r=rest("POST",f"/api/config/script/config/{sid}",cfg)
    print("script",sid,r)
