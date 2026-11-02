from ha import *
import json
rest("POST","/api/services/input_boolean/turn_on",{"entity_id":"input_boolean.adaptive_lighting"})
areas, devs, ents = wsmany([("config/area_registry/list",{}),("config/device_registry/list",{}),("config/entity_registry/list",{})])
byname={ (d.get("name") or ""): d for d in devs}
calls=[]
# device -> (area, name_by_user)
DEV={"WiZ Dimmable White BE230E":("basement","Taklampe Bod liten (WiZ)"),
     "WiZ Dimmable White 57A6B2":("basement",None),"WiZ Dimmable White BE20C0":("basement",None),"WiZ Dimmable White BE271C":("basement",None),
     "WiZ Dimmable White D7A578":("inngangspart","Inngangsparti (WiZ)"),
     "WiZ Dimmable White D71508":("inngangspart","Ingangsparti 2 (WiZ)"),
     "WiZ Tunable White 362476":("kid1","Gulvlampe Kid1 (WiZ)"),
     "TV Room":("tv_stue",None)}
for n,(a,nb) in DEV.items():
    d=byname[n]; kw={"device_id":d["id"],"area_id":a}
    if nb: kw["name_by_user"]=nb
    calls.append(("config/device_registry/update",kw))
AREA_ALIASES={"kjokken":["Kitchen","Kjokken"],"spisestue":["Dining room","Spisestua"],"basement":["Kjeller","Cellar"],
 "bedroom_1":["Soverom","Hovedsoverom","Master bedroom","Bedroom"],"kid1":["Kid1' room","Kid1 rom","Kid1s rom"],
 "media_room":["Medierom","Media"],"tv_stue":["TV-stue","TV stua","Living room","Stue","Lounge"],"laundry_room":["Vaskerom","Laundry"],
 "inngangspart":["Inngangsparti","Entrance","Entry","Hallway","Gang","Entré"],"gjesterom":["Guest room","Gjesterommet"],
 "front_door":["Outside","Ute","Utgang","Porch"]}
for a,al in AREA_ALIASES.items(): calls.append(("config/area_registry/update",{"area_id":a,"aliases":al}))
EA={"light.kjokken_taklamper_kjokken_1":["Kitchen ceiling","Kitchen ceiling lights","Taklampe kjøkken"],
 "light.kjokken_lys_under_overkap":["Under-cabinet lights","Under cabinet lights","Benkebelysning"],
 "light.kjokken_lys_kaffestasjon":["Coffee station","Coffee light","Kaffestasjon"],
 "light.kjokken_lys_skap_kjokken":["Cabinet lights","Skaplys"],
 "light.kjokken_bordlampe":["Kitchen table lamp","Kitchen lamp"],
 "light.spisestue_taklampe_spisebord":["Dining table light","Dining ceiling","Spisebordlampe"],
 "light.spisestue_bordlampe_hoy":["Tall table lamp","Dining lamp","Høy bordlampe"],
 "light.spisestue_gulvlampe_stue":["Dining floor lamp"],
 "light.tv_stue_tv_lys":["TV light","TV lights","TV strip","TV-lys"],
 "light.wiz_dimmable_white_d7a578":["Entrance light","Inngangsparti","Entrance 1"],
 "light.wiz_dimmable_white_d71508":["Entrance light 2","Ingangsparti 2","Entrance 2"],
 "light.wiz_tunable_white_362476":["Kid1 floor lamp","Gulvlampe Kid1"],
 "light.kid1_zigbee_dimmer_1":["Kid1 dimmer","Kid1 light"],
 "light.gjesterom_taklys_gjesterom":["Guest room light","Guest room ceiling","Taklys gjesterom"],
 "light.bedroom_1_gulvlampe_hovedsoverom":["Bedroom floor lamp","Gulvlampe soverom"],
 "light.wiz_dimmable_white_be230e":["Storage room light","Bod liten","Taklampe bod"],
 "climate.spisestue_termostat_stue_kjokken":["Living room heating","Stue thermostat","Termostat stue"],
 "climate.kjokken_elko_one_thermostat":["Kitchen heating","Kitchen thermostat","Termostat kjøkken"],
 "climate.basement_beta_elko_smart_zb_termostat":["Basement heating","Basement thermostat","Termostat kjeller"],
 "media_player.tv_stue_samsung_tv":["TV","Living room TV","TV-en","Samsung TV"],
 "media_player.bedroom_1_55_the_frame":["Bedroom TV","The Frame","Frame TV"],
 "media_player.kjokken_kjokken":["Kitchen speaker","Kitchen Sonos","Sonos kjøkken"],
 "media_player.tv_room_tv_room":["Soundbar","Arc","TV speaker","Lydplanke"],
 "fan.flexit_fan":["Ventilation","Fan","Vifte","Flexit"],
 "switch.spisestue_juletre":["Christmas tree","Juletre"],
 "switch.front_door_utelys_inngang":["Outdoor light","Outside light","Utelys"],
 "input_select.home_mode":["Home mode","House mode","Modus"],
 "input_boolean.guest_mode":["Guest mode","Gjestemodus"],
 "input_boolean.movie_mode":["Movie mode","Filmmodus","Kino"],
 "input_boolean.adaptive_lighting":["Adaptive lighting"],
 "input_boolean.heating_schedule":["Heating schedule","Varmeplan"],
 "script.leave_home":["Leave home","Away mode","Bortemodus"],
 "script.arrive_home":["Arrive home","Welcome home","Hjemkomst"],
 "script.bedtime":["Bedtime","Good night","God natt"],
 "script.movie_mode":["Start movie night"],
 "script.all_off":["All off","Everything off","Alt av"],
 "scene.morning":["Morning","Morgen"],"scene.evening":["Evening","Kveld"],"scene.movie_night":["Movie night","Filmkveld"],
 "scene.dinner":["Dinner","Middag"],"scene.good_night":["Good night","Natt"],"scene.away":["Away","Borte"],
 "sensor.flexit_fan_flexit_fan_humidity":["Ventilation humidity","Bathroom humidity"],
 "sensor.spisestue_aqara_temperature_and_humidity_sensor_t1_temperature":["Dining room temperature","Temperatur stue"],
 "sensor.spisestue_aqara_temperature_and_humidity_sensor_t1_humidity":["Dining room humidity","Fuktighet stue"],
}
EXPOSE=list(EA)+["light.wiz_dimmable_white_57a6b2","light.wiz_dimmable_white_be20c0","light.wiz_dimmable_white_be271c",
 "weather.forecast_home","todo.shopping_list","sensor.laundry_room_washer_machine_state","sensor.laundry_room_washer_completion_time",
 "schedule.quiet_hours","climate.basement_beta_elko_smart_zb_termostat"]
# ST duplicates of local WiZ bulbs, and noisy config entities: not exposed to Assist
UNEXPOSE=["light.inngangspart_inngangsparti","light.inngangspart_ingangsparti_2","light.kid1_gulvlampe_stue","light.basement_ceiling",
 "light.basement_taklampe_bod_liten","light.basement_taklampe_sikringskap","light.basement_taklampe_tekniskrom",
 "media_player.kjokken_sonos_kjokken","media_player.kjokken_sonos_kjokken_2","media_player.tv_stue_lydplanke",
 "light.wiz_dimmable_white_d7164c","light.wiz_dimmable_white_d77688","input_boolean.fan_humidity_boost_active","input_text.fan_preset_before_boost","input_select.heating_state","script.heating_apply"]
for e in ents:
    eid=e["entity_id"]; dom=eid.split(".")[0]
    if dom in ("update","number","select","button","event") or (dom=="switch" and eid not in EA):
        UNEXPOSE.append(eid)
    if eid.startswith("input_number."): UNEXPOSE.append(eid)
eids={e["entity_id"] for e in ents}
for eid,al in EA.items():
    if eid in eids: calls.append(("config/entity_registry/update",{"entity_id":eid,"aliases":al}))
    else: print("no registry entry:",eid)
calls.append(("homeassistant/expose_entity",{"assistants":["conversation"],"entity_ids":[e for e in EXPOSE if e in eids or e.startswith("light.")],"should_expose":True}))
calls.append(("homeassistant/expose_entity",{"assistants":["conversation"],"entity_ids":sorted(set(e for e in UNEXPOSE if e in eids)),"should_expose":False}))
for (t,kw),r in zip(calls,wsmany(calls)):
    if isinstance(r,dict) and "_error" in r: print("ERR",t,kw.get("entity_id") or kw.get("device_id") or kw.get("area_id"),r)
print("applied",len(calls))
