from ha import *
from build_scenes_scripts import COMMON, KITCHEN, DINING, TV, ENTRY, BASEMENT, CLIMATE, coe  # re-runs scenes/scripts (idempotent)
WIZ=["light.wiz_dimmable_white_be271c","light.wiz_dimmable_white_57a6b2","light.wiz_tunable_white_362476","light.wiz_dimmable_white_d77688","light.wiz_dimmable_white_d71508","light.wiz_dimmable_white_d7a578","light.wiz_dimmable_white_d7164c","light.wiz_dimmable_white_be230e","light.wiz_dimmable_white_be20c0"]
OTHER=["light.wiz_tunable_white_362476","light.kid1_zigbee_dimmer_1","light.gjesterom_taklys_gjesterom","light.bedroom_1_gulvlampe_hovedsoverom"]
ADAPTIVE=COMMON+OTHER+BASEMENT  # WiZ d7164c/d77688 are the same bulbs as ST Bordlampe/Bordlampe Høy, so not listed twice
TUNABLE=["light.kjokken_lys_under_overkap","light.kjokken_lys_kaffestasjon","light.kjokken_lys_skap_kjokken","light.wiz_tunable_white_362476"]
def notify(title,msg,nid):
    return {"action":"persistent_notification.create","data":{"title":title,"message":msg,"notification_id":nid}}
PROFILE=("{% set h = now().hour + now().minute/60 %}"
 "{% if is_state('schedule.quiet_hours','on') %}{{ {'b':15,'k':2200} }}"
 "{% elif h < 9 %}{{ {'b':70,'k':3300} }}{% elif h < 16 %}{{ {'b':100,'k':4000} }}"
 "{% elif h < 19 %}{{ {'b':85,'k':3200} }}{% elif h < 21 %}{{ {'b':65,'k':2700} }}{% else %}{{ {'b':45,'k':2400} }}{% endif %}")
NO_RECENT_SCENE=("{{ states.scene | map(attribute='state') | select('match','^\\d{4}-') | map('as_datetime') "
 "| select('gt', now() - timedelta(seconds=15)) | list | count == 0 }}")
not_running=lambda s: {"condition":"template","value_template":"{{ not is_state('%s','on') }}"%s}
A = {}
A["home_mode_away"]=dict(alias="Home · Away / Vacation mode", mode="single",
 description="When Home mode is set to Away or Vacation (from the app, voice or dashboard), runs the Leave home script: lights, TVs, Sonos and Juletre off, heating to away/vacation level. Skipped if the script itself set the mode.",
 triggers=[{"trigger":"state","entity_id":"input_select.home_mode","to":["Away","Vacation"]}],
 conditions=[not_running("script.leave_home")],
 actions=[{"action":"script.turn_on","target":{"entity_id":"script.leave_home"}}])
A["home_mode_arrive"]=dict(alias="Home · Back home", mode="single",
 description="When Home mode goes from Away/Vacation back to Home or Guest, runs the Arrive home script (comfort heating, evening lights if dark).",
 triggers=[{"trigger":"state","entity_id":"input_select.home_mode","from":["Away","Vacation"],"to":["Home","Guest"]}],
 conditions=[not_running("script.arrive_home")],
 actions=[{"action":"script.turn_on","target":{"entity_id":"script.arrive_home"}}])
A["home_mode_night"]=dict(alias="Home · Good night when Night mode starts", mode="single",
 description="When Home mode becomes Night, runs the Bedtime script (common lights off, TVs off, Sonos paused, heating to night level).",
 triggers=[{"trigger":"state","entity_id":"input_select.home_mode","to":"Night"}],
 conditions=[not_running("script.bedtime")],
 actions=[{"action":"script.turn_on","target":{"entity_id":"script.bedtime"}}])
A["home_morning"]=dict(alias="Home · Good morning", mode="single",
 description="When quiet hours end: switches Home mode from Night back to Home, and on weekdays when it is still dark turns on the kitchen coffee-station and under-cabinet lights softly (50 %, warm). Does nothing in Away/Vacation.",
 triggers=[{"trigger":"state","entity_id":"schedule.quiet_hours","to":"off","for":"00:00:30"}],
 conditions=[{"condition":"state","entity_id":"input_select.home_mode","state":"Night"}],
 actions=[{"action":"input_select.select_option","target":{"entity_id":"input_select.home_mode"},"data":{"option":"{{ 'Guest' if is_state('input_boolean.guest_mode','on') else 'Home' }}"}},
   {"if":[{"condition":"time","weekday":["mon","tue","wed","thu","fri"]},{"condition":"numeric_state","entity_id":"sun.sun","attribute":"elevation","below":3}],
    "then":[coe({"action":"light.turn_on","target":{"entity_id":["light.kjokken_lys_kaffestasjon","light.kjokken_lys_under_overkap"]},"data":{"brightness_pct":50,"color_temp_kelvin":3000,"transition":30}})]}])
A["home_guest_sync"]=dict(alias="Home · Guest mode sync", mode="queued",
 description="Keeps the Guest mode toggle and the Guest option of Home mode in sync. Guest mode keeps the guest room lights and heating untouched by Away/Bedtime routines.",
 triggers=[{"trigger":"state","entity_id":"input_select.home_mode","to":"Guest","id":"mode_guest"},
           {"trigger":"state","entity_id":"input_boolean.guest_mode","to":"off","id":"guest_off"},
           {"trigger":"state","entity_id":"input_boolean.guest_mode","to":"on","id":"guest_on"}],
 actions=[{"choose":[
   {"conditions":[{"condition":"trigger","id":"mode_guest"}],"sequence":[{"action":"input_boolean.turn_on","target":{"entity_id":"input_boolean.guest_mode"}}]},
   {"conditions":[{"condition":"trigger","id":"guest_off"},{"condition":"state","entity_id":"input_select.home_mode","state":"Guest"}],"sequence":[{"action":"input_select.select_option","target":{"entity_id":"input_select.home_mode"},"data":{"option":"Home"}}]},
   {"conditions":[{"condition":"trigger","id":"guest_on"},{"condition":"state","entity_id":"input_select.home_mode","state":"Home"}],"sequence":[{"action":"input_select.select_option","target":{"entity_id":"input_select.home_mode"},"data":{"option":"Guest"}}]}]}])
A["evening_sunset"]=dict(alias="Home · Evening lights at sunset", mode="single",
 description="20 minutes before sunset, if someone seems to be home (Home/Guest mode and at least one light already on or a TV/Sonos playing), fades in the Evening scene. Never runs during quiet hours, movie mode or Away/Vacation/Night.",
 triggers=[{"trigger":"sun","event":"sunset","offset":"-00:20:00"}],
 conditions=[{"condition":"state","entity_id":"input_select.home_mode","state":["Home","Guest"]},
   {"condition":"state","entity_id":"schedule.quiet_hours","state":"off"},
   {"condition":"state","entity_id":"input_boolean.movie_mode","state":"off"},
   {"condition":"or","conditions":[{"condition":"state","entity_id":"input_boolean.guest_mode","state":"on"},
     {"condition":"template","value_template":"{{ (%r | select('is_state','on') | list | count) > 0 or (%r | select('is_state',['on','playing']) | list | count) > 0 }}"%(ADAPTIVE,["media_player.tv_stue_samsung_tv","media_player.kjokken_kjokken","media_player.tv_room_tv_room"])}]}],
 actions=[{"action":"scene.turn_on","target":{"entity_id":"scene.evening"},"data":{"transition":120}}])
A["entrance_outdoor"]=dict(alias="Front door · Outdoor light dusk to quiet hours", mode="restart",
 description="Turns the outdoor entrance light (Utelys Inngang) on at sunset and off when quiet hours begin, and off at sunrise as a safety net. Skipped in Vacation mode. Only switches it on in the evening, never in the middle of the night.",
 triggers=[{"trigger":"sun","event":"sunset","id":"on"},
   {"trigger":"state","entity_id":"schedule.quiet_hours","to":"on","for":"00:00:30","id":"off"},
   {"trigger":"sun","event":"sunrise","id":"off"}],
 conditions=[{"condition":"template","value_template":"{{ not is_state('input_select.home_mode','Vacation') or trigger.id == 'off' }}"}],
 actions=[{"choose":[{"conditions":[{"condition":"trigger","id":"on"},{"condition":"state","entity_id":"schedule.quiet_hours","state":"off"}],
     "sequence":[coe({"action":"switch.turn_on","target":{"entity_id":"switch.front_door_utelys_inngang"}})]},
   {"conditions":[{"condition":"trigger","id":"off"}],"sequence":[coe({"action":"switch.turn_off","target":{"entity_id":"switch.front_door_utelys_inngang"}})]}]}])
A["adaptive_on"]=dict(alias="Home · Adaptive lighting when a light turns on", mode="parallel", max=25,
 description="When any dimmer or WiZ bulb is switched on by hand (wall switch, app, voice), sets brightness and – for tunable lights – colour temperature for the time of day: morning 70 %/3300 K, day 100 %/4000 K, late afternoon 85 %/3200 K, evening 65 %/2700 K, late evening 45 %/2400 K, quiet hours 15 %/2200 K. Does not interfere when a scene or automation turned the light on, during movie mode, or when the 'Adaptive lighting' toggle is off.",
 triggers=[{"trigger":"state","entity_id":ADAPTIVE,"from":"off","to":"on"}],
 conditions=[{"condition":"state","entity_id":"input_boolean.adaptive_lighting","state":"on"},
   {"condition":"state","entity_id":"input_boolean.movie_mode","state":"off"},
   {"condition":"template","value_template":"{{ trigger.to_state.context.parent_id is none }}"},
   {"condition":"template","value_template":NO_RECENT_SCENE}],
 actions=[{"variables":{"p":PROFILE}},
   {"if":[{"condition":"template","value_template":"{{ 'color_temp' in (state_attr(trigger.entity_id,'supported_color_modes') or []) }}"}],
    "then":[coe({"action":"light.turn_on","target":{"entity_id":"{{ trigger.entity_id }}"},"data":{"brightness_pct":"{{ p.b }}","color_temp_kelvin":"{{ p.k }}","transition":1}})],
    "else":[coe({"action":"light.turn_on","target":{"entity_id":"{{ trigger.entity_id }}"},"data":{"brightness_pct":"{{ p.b }}","transition":1}})]}])
A["adaptive_ct"]=dict(alias="Home · Adaptive colour temperature drift", mode="single",
 description="Every 15 minutes, gently (60 s fade) moves tunable-white lights that are on and in white mode towards the colour temperature for the time of day. Brightness is never changed; lights changed in the last 10 minutes, or set outside the adaptive 2200–4000 K range (e.g. a cool 6000 K you picked yourself), are left alone, and nothing happens during movie mode or when Adaptive lighting is off.",
 triggers=[{"trigger":"time_pattern","minutes":"/15"}],
 conditions=[{"condition":"state","entity_id":"input_boolean.adaptive_lighting","state":"on"},{"condition":"state","entity_id":"input_boolean.movie_mode","state":"off"}],
 actions=[{"variables":{"p":PROFILE}},
   {"repeat":{"for_each":TUNABLE,"sequence":[{"if":[{"condition":"template","value_template":
     "{% set s = states[repeat.item] %}{{ s is not none and s.state == 'on' and s.attributes.color_mode == 'color_temp' and (now() - s.last_updated).total_seconds() > 600 and 2150 <= (s.attributes.color_temp_kelvin or 0) <= 4100 and ((s.attributes.color_temp_kelvin or 0) - p.k)|abs > 250 }}"}],
     "then":[coe({"action":"light.turn_on","target":{"entity_id":"{{ repeat.item }}"},"data":{"color_temp_kelvin":"{{ p.k }}","transition":60}})]}]}}])
A["tv_movie_on"]=dict(alias="TV stue · Movie mode when the TV turns on in the evening", mode="single",
 description="When the TV stue Samsung TV turns on after dark (between sunset and quiet hours), switches on Movie mode, which dims the kitchen/dining/TV stue lights. Not in Away/Vacation mode or when nobody has any lights on.",
 triggers=[{"trigger":"state","entity_id":"media_player.tv_stue_samsung_tv","from":"off","to":"on","for":"00:00:20"}],
 conditions=[{"condition":"state","entity_id":"sun.sun","state":"below_horizon"},
   {"condition":"time","after":"15:00:00"},
   {"condition":"state","entity_id":"schedule.quiet_hours","state":"off"},
   {"condition":"state","entity_id":"input_select.home_mode","state":["Home","Guest"]},
   {"condition":"state","entity_id":"input_boolean.movie_mode","state":"off"}],
 actions=[{"action":"script.movie_mode"}])
A["tv_movie_toggle"]=dict(alias="TV stue · Movie mode toggle", mode="restart",
 description="Movie mode toggle: switching it on (app/voice) dims the room via the Movie mode script; switching it off restores the lights that were on before (only outside quiet hours). Also turns Movie mode off when the TV has been off for 1 minute.",
 triggers=[{"trigger":"state","entity_id":"input_boolean.movie_mode","to":"on","id":"on"},
   {"trigger":"state","entity_id":"input_boolean.movie_mode","from":"on","to":"off","id":"off"},
   {"trigger":"state","entity_id":"media_player.tv_stue_samsung_tv","to":"off","for":"00:01:00","id":"tv_off"}],
 actions=[{"choose":[
   {"conditions":[{"condition":"trigger","id":"on"},not_running("script.movie_mode")],"sequence":[{"action":"script.movie_mode"}]},
   {"conditions":[{"condition":"trigger","id":"tv_off"}],"sequence":[{"action":"input_boolean.turn_off","target":{"entity_id":"input_boolean.movie_mode"}}]},
   {"conditions":[{"condition":"trigger","id":"off"},{"condition":"state","entity_id":"schedule.quiet_hours","state":"off"},
                  {"condition":"state","entity_id":"input_select.home_mode","state":["Home","Guest"]},
                  {"condition":"template","value_template":"{{ states.scene.before_movie is not none }}"}],
    "sequence":[coe({"action":"scene.turn_on","target":{"entity_id":"scene.before_movie"},"data":{"transition":4}})]}]}])
A["flexit_humidity_boost"]=dict(alias="Flexit · Humidity boost (shower)", mode="queued", max=3,
 description="Boosts the Flexit fan when humidity is above 70 % for a minute, or rises fast (>1 %/min while above 55 %). Remembers the previous fan mode and restores it when humidity has been below 60 % for 10 minutes (or after 90 minutes at the latest). During quiet hours it boosts to medium instead of high to keep it quiet.",
 triggers=[{"trigger":"numeric_state","entity_id":"sensor.flexit_fan_flexit_fan_humidity","above":70,"for":"00:01:00","id":"boost"},
   {"trigger":"numeric_state","entity_id":"sensor.flexit_fan_humidity_rate","above":1,"for":"00:01:00","id":"rise"},
   {"trigger":"numeric_state","entity_id":"sensor.flexit_fan_flexit_fan_humidity","below":60,"for":"00:10:00","id":"normal"},
   {"trigger":"state","entity_id":"input_boolean.fan_humidity_boost_active","to":"on","for":"01:30:00","id":"normal"}],
 actions=[{"choose":[
   {"conditions":[{"condition":"trigger","id":["boost","rise"]},{"condition":"state","entity_id":"input_boolean.fan_humidity_boost_active","state":"off"},
                  {"condition":"numeric_state","entity_id":"sensor.flexit_fan_flexit_fan_humidity","above":55},
                  {"condition":"template","value_template":"{{ states('fan.flexit_fan') not in ['unavailable','unknown'] }}"}],
    "sequence":[{"action":"input_text.set_value","target":{"entity_id":"input_text.fan_preset_before_boost"},"data":{"value":"{{ state_attr('fan.flexit_fan','preset_mode') or ('low' if is_state('fan.flexit_fan','on') else 'off') }}"}},
      {"action":"input_boolean.turn_on","target":{"entity_id":"input_boolean.fan_humidity_boost_active"}},
      {"action":"fan.set_preset_mode","target":{"entity_id":"fan.flexit_fan"},"data":{"preset_mode":"{{ 'medium' if is_state('schedule.quiet_hours','on') else 'high' }}"}}]},
   {"conditions":[{"condition":"trigger","id":"normal"},{"condition":"state","entity_id":"input_boolean.fan_humidity_boost_active","state":"on"}],
    "sequence":[{"variables":{"prev":"{{ states('input_text.fan_preset_before_boost') if states('input_text.fan_preset_before_boost') in ['off','low','medium','high','manual'] else 'low' }}"}},
      {"if":[{"condition":"template","value_template":"{{ prev == 'off' }}"}],
       "then":[coe({"action":"fan.turn_off","target":{"entity_id":"fan.flexit_fan"}})],
       "else":[coe({"action":"fan.set_preset_mode","target":{"entity_id":"fan.flexit_fan"},"data":{"preset_mode":"{{ prev }}"}})]},
      {"action":"input_boolean.turn_off","target":{"entity_id":"input_boolean.fan_humidity_boost_active"}}]}]}])
A["flexit_filter_reminder"]=dict(alias="Flexit · Filter replacement reminder", mode="single",
 description="Shows a notification when the Flexit fan reports that its filter needs replacing, repeats it every Sunday at 11:00 while the alarm is still on, and clears it when the alarm goes away. After changing the filter, run the 'Flexit · Filter replaced' script.",
 triggers=[{"trigger":"state","entity_id":"binary_sensor.flexit_fan_flexit_fan_filter_replacement_status","to":"on","id":"on"},
   {"trigger":"time","at":"11:00:00","id":"weekly"},
   {"trigger":"homeassistant","event":"start","id":"weekly"},
   {"trigger":"state","entity_id":"binary_sensor.flexit_fan_flexit_fan_filter_replacement_status","to":"off","id":"off"}],
 actions=[{"choose":[
   {"conditions":[{"condition":"trigger","id":"off"}],"sequence":[{"action":"persistent_notification.dismiss","data":{"notification_id":"flexit_filter"}}]},
   {"conditions":[{"condition":"state","entity_id":"binary_sensor.flexit_fan_flexit_fan_filter_replacement_status","state":"on"},
                  {"condition":"template","value_template":"{{ trigger.id == 'on' or trigger.platform == 'homeassistant' or now().weekday() == 6 }}"}],
    "sequence":[notify("🌀 Flexit fan: replace the filter","The Flexit fan (192.0.2.10) reports that its filter needs replacing. After changing it, run the script **Flexit · Filter replaced** to reset the timer.","flexit_filter")]}]}])
A["washer_done"]=dict(alias="Laundry room · Washer finished", mode="single",
 description="When the washing machine goes from running to stopped, shows a notification and – outside quiet hours and when someone is home – announces it on the Kjøkken Sonos with the local Piper voice at a gentle volume.",
 triggers=[{"trigger":"state","entity_id":"sensor.laundry_room_washer_machine_state","from":"run","to":"stop","for":"00:01:00"}],
 actions=[notify("🧺 Washer finished","The washing machine finished at {{ now().strftime('%H:%M') }}. Time to hang it up!","washer_done"),
   {"if":[{"condition":"state","entity_id":"schedule.quiet_hours","state":"off"},{"condition":"state","entity_id":"input_select.home_mode","state":["Home","Guest"]}],
    "then":[coe({"action":"tts.speak","target":{"entity_id":"tts.piper"},"data":{"media_player_entity_id":"media_player.kjokken_kjokken","message":"The washing machine is finished.","cache":True}})]}])
A["washer_dismiss"]=dict(alias="Laundry room · Clear washer notification on next run", mode="single",
 description="Clears the 'Washer finished' notification when a new wash starts.",
 triggers=[{"trigger":"state","entity_id":"sensor.laundry_room_washer_machine_state","to":"run"}],
 actions=[{"action":"persistent_notification.dismiss","data":{"notification_id":"washer_done"}}])
PLUGS=["sensor.kid1_zigbee_switch_1_power","sensor.spisestue_juletre_power"]
A["energy_watchdog"]=dict(alias="Home · Energy watchdog for plugs", mode="parallel", max=10,
 description="Notifies (never switches off) when a metered plug draws more than 1000 W for 30 minutes (iron/heater left on), or more than 15 W for 6 hours straight. Also nudges at the start of quiet hours if the Juletre plug is still on. Covers Kid1 Zigbee Switch 1 and Juletre; add more power sensors to the triggers as you add plugs.",
 triggers=[{"trigger":"numeric_state","entity_id":PLUGS,"above":1000,"for":"00:30:00","id":"high"},
   {"trigger":"numeric_state","entity_id":PLUGS,"above":15,"for":"06:00:00","id":"long"},
   {"trigger":"state","entity_id":"schedule.quiet_hours","to":"on","for":"00:00:30","id":"juletre"}],
 actions=[{"choose":[
   {"conditions":[{"condition":"trigger","id":"high"}],"sequence":[notify("⚡ High power draw","{{ state_attr(trigger.entity_id,'friendly_name') }} has drawn {{ states(trigger.entity_id) }} W for 30 minutes. Iron or heater left on?","energy_{{ trigger.entity_id | replace('.','_') }}")]},
   {"conditions":[{"condition":"trigger","id":"long"}],"sequence":[notify("⚡ Running for a long time","{{ state_attr(trigger.entity_id,'friendly_name') }} has been drawing power ({{ states(trigger.entity_id) }} W) for 6 hours.","energy_{{ trigger.entity_id | replace('.','_') }}")]},
   {"conditions":[{"condition":"trigger","id":"juletre"},{"condition":"state","entity_id":"switch.spisestue_juletre","state":"on"}],"sequence":[notify("🎄 Juletre still on","The Juletre plug is still on as quiet hours start. Turn it off in the app, or say 'turn off Juletre'.","energy_juletre")]}]}])
HEALTH=COMMON+OTHER+BASEMENT+[c for c,_ in CLIMATE]+["media_player.tv_stue_samsung_tv","media_player.bedroom_1_55_the_frame","media_player.kjokken_kjokken","media_player.tv_room_tv_room","fan.flexit_fan","switch.spisestue_juletre","switch.front_door_utelys_inngang","switch.kid1_zigbee_switch_1","switch.kid1_zigbee_switch_2","sensor.laundry_room_washer_machine_state","sensor.spisestue_aqara_temperature_and_humidity_sensor_t1_temperature","binary_sensor.archer_gx90_wan_status"]
A["device_health_unavailable"]=dict(alias="Home · Device offline alert", mode="parallel", max=50,
 description="Shows a notification when an important device (lights, thermostats, TVs, Sonos, Flexit fan, plugs, washer, Aqara sensor, internet) has been unavailable for 30 minutes, and clears it automatically when the device comes back.",
 triggers=[{"trigger":"state","entity_id":HEALTH,"to":"unavailable","for":"00:30:00","id":"down"},
           {"trigger":"state","entity_id":HEALTH,"from":"unavailable","id":"up"}],
 actions=[{"choose":[
   {"conditions":[{"condition":"trigger","id":"down"}],"sequence":[notify("📡 Device offline","**{{ state_attr(trigger.entity_id,'friendly_name') or trigger.entity_id }}** has been unavailable for 30 minutes (since {{ as_local(trigger.from_state.last_changed if trigger.from_state else now()).strftime('%H:%M') }}). Check power/Wi-Fi/Zigbee.","health_{{ trigger.entity_id | replace('.','_') }}")]},
   {"conditions":[{"condition":"trigger","id":"up"}],"sequence":[{"action":"persistent_notification.dismiss","data":{"notification_id":"health_{{ trigger.entity_id | replace('.','_') }}"}}]}]}])
A["device_health_battery"]=dict(alias="Home · Low battery check", mode="single",
 description="Every day at 18:00, lists any battery below 15 % (sensors with battery device class, plus battery-low binary sensors) in one notification; clears it when all are fine.",
 triggers=[{"trigger":"time","at":"18:00:00"}],
 actions=[{"variables":{"low":"{% set ns = namespace(l=[]) %}{% for s in states.sensor | selectattr('attributes.device_class','defined') | selectattr('attributes.device_class','eq','battery') %}{% if s.state | is_number and s.state|float < 15 %}{% set ns.l = ns.l + [s.name ~ ' (' ~ s.state ~ ' %)'] %}{% endif %}{% endfor %}{% for s in states.binary_sensor | selectattr('attributes.device_class','defined') | selectattr('attributes.device_class','eq','battery') | selectattr('state','eq','on') %}{% set ns.l = ns.l + [s.name] %}{% endfor %}{{ ns.l }}"}},
   {"if":[{"condition":"template","value_template":"{{ low | count > 0 }}"}],
    "then":[notify("🔋 Low batteries","{{ low | join(', ') }}","low_battery")],
    "else":[{"action":"persistent_notification.dismiss","data":{"notification_id":"low_battery"}}]}])
A["heating_schedule"]=dict(alias="Heating · Night eco and morning comfort", mode="single",
 description="When quiet hours start, lowers the three ELKO thermostats by the night offset (default 2 °C); when quiet hours end, restores comfort. Only in Home/Night/Guest mode and only while the 'Heating schedule' toggle is on. Never turns heating off.",
 triggers=[{"trigger":"state","entity_id":"schedule.quiet_hours","to":"on","for":"00:00:30","id":"night"},
           {"trigger":"state","entity_id":"schedule.quiet_hours","to":"off","for":"00:00:30","id":"comfort"}],
 conditions=[{"condition":"state","entity_id":"input_boolean.heating_schedule","state":"on"},
   {"condition":"state","entity_id":"input_select.home_mode","state":["Home","Night","Guest"]}],
 actions=[{"choose":[
   {"conditions":[{"condition":"trigger","id":"night"},{"condition":"state","entity_id":"input_select.heating_state","state":"comfort"}],"sequence":[{"action":"script.heating_apply","data":{"state":"night"}}]},
   {"conditions":[{"condition":"trigger","id":"comfort"},{"condition":"state","entity_id":"input_select.heating_state","state":"night"}],"sequence":[{"action":"script.heating_apply","data":{"state":"comfort"}}]}]}])
A["heating_learn"]=dict(alias="Heating · Learn comfort setpoint from manual changes", mode="queued",
 description="If you change a thermostat's setpoint yourself (SmartThings app, ELKO app, the wall unit) while heating is at the comfort level, the new value is remembered as that room's comfort setpoint after 2 minutes, so the schedule keeps your preference.",
 triggers=[{"trigger":"state","entity_id":[c for c,_ in CLIMATE],"attribute":"temperature","for":"00:02:00"}],
 conditions=[{"condition":"state","entity_id":"input_select.heating_state","state":"comfort"},
   not_running("script.heating_apply"),
   {"condition":"template","value_template":"{{ trigger.to_state.attributes.temperature is number }}"}],
 actions=[{"action":"input_number.set_value","target":{"entity_id":"{{ %r[trigger.entity_id] }}"%{c:n for c,n in CLIMATE}},"data":{"value":"{{ trigger.to_state.attributes.temperature }}"}}])
A["voice_shortcuts"]=dict(alias="Home · Voice shortcuts", mode="single",
 description="Extra Assist phrases (English and Norwegian) for the routines: good night / god natt, I'm leaving / jeg drar, I'm home / jeg er hjemme, movie time / filmkveld, dinner time / middag, good morning / god morgen, all off / alt av.",
 triggers=[{"trigger":"conversation","command":["good night","goodnight","god natt","bedtime","leggetid"],"id":"night"},
   {"trigger":"conversation","command":["I'm leaving","I am leaving","leaving home","jeg drar","jeg går"],"id":"leave"},
   {"trigger":"conversation","command":["I'm home","I am home","I'm back","jeg er hjemme"],"id":"home"},
   {"trigger":"conversation","command":["movie time","movie mode","start movie mode","filmkveld","filmmodus"],"id":"movie"},
   {"trigger":"conversation","command":["dinner time","dinner","middag"],"id":"dinner"},
   {"trigger":"conversation","command":["good morning","god morgen"],"id":"morning"},
   {"trigger":"conversation","command":["everything off","all off","turn everything off","alt av","slå av alt"],"id":"all_off"}],
 actions=[{"choose":[
   {"conditions":[{"condition":"trigger","id":"night"}],"sequence":[{"action":"script.turn_on","target":{"entity_id":"script.bedtime"}},{"set_conversation_response":"Good night. Turning things off."}]},
   {"conditions":[{"condition":"trigger","id":"leave"}],"sequence":[{"action":"script.turn_on","target":{"entity_id":"script.leave_home"}},{"set_conversation_response":"Bye! Switching the house to away."}]},
   {"conditions":[{"condition":"trigger","id":"home"}],"sequence":[{"action":"script.turn_on","target":{"entity_id":"script.arrive_home"}},{"set_conversation_response":"Welcome home."}]},
   {"conditions":[{"condition":"trigger","id":"movie"}],"sequence":[{"action":"input_boolean.turn_on","target":{"entity_id":"input_boolean.movie_mode"}},{"set_conversation_response":"Enjoy the movie."}]},
   {"conditions":[{"condition":"trigger","id":"dinner"}],"sequence":[{"action":"scene.turn_on","target":{"entity_id":"scene.dinner"},"data":{"transition":3}},{"set_conversation_response":"Dinner lights on."}]},
   {"conditions":[{"condition":"trigger","id":"morning"}],"sequence":[
      {"if":[{"condition":"state","entity_id":"input_select.home_mode","state":"Night"}],"then":[{"action":"input_select.select_option","target":{"entity_id":"input_select.home_mode"},"data":{"option":"{{ 'Guest' if is_state('input_boolean.guest_mode','on') else 'Home' }}"}}]},
      {"action":"scene.turn_on","target":{"entity_id":"scene.morning"},"data":{"transition":5}},{"set_conversation_response":"Good morning."}]},
   {"conditions":[{"condition":"trigger","id":"all_off"}],"sequence":[{"action":"script.turn_on","target":{"entity_id":"script.all_off"}},{"set_conversation_response":"Turning everything off."}]}]}])
if __name__ == "__main__":
  for aid,cfg in A.items():
      cfg.setdefault("conditions",[])
      r=rest("POST",f"/api/config/automation/config/{aid}",{"id":aid,**cfg})
      print("automation",aid,r)
