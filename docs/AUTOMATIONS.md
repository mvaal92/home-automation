# Fagerhøyveien – routines & automations

Built 2026-10-11 (Home Assistant 2026.10.1). Everything below was created through HA's own APIs, so you can open,
edit, disable or delete it in **Settings → Automations & Scenes** (automations, scenes, scripts) and
**Settings → Devices & services → Helpers**. Rebuild scripts live in `tools/` (`build_scenes_scripts.py`,
`build_automations.py`, `registry.py`, `helpers.py`); re-running them overwrites the items with the same id,
so edit either in the UI *or* in the scripts, not both.

Notifications appear in the HA bell (persistent notifications) and in the Home app. There is no phone push yet –
install the HA Companion app on the iPhone to get push and presence (see “Ideas”).

## Important discovery: WiZ bulbs = SmartThings “VIPER” lamps
The 9 WiZ bulbs are the same physical bulbs SmartThings shows as WiZ cloud lamps (matched by model and firmware,
and confirmed by a live test for the entrance). Routines use the **local WiZ entity** (faster, works without
internet) and the SmartThings duplicate is hidden from voice.

| WiZ bulb | Is the same as | Area set |
|---|---|---|
| D7A578 | Inngangsparti | Inngangspart (verified) |
| D71508 | Ingangsparti 2 | Inngangspart (verified) |
| BE230E | Taklampe Bod liten | Basement (firmware match) |
| 57A6B2, BE20C0, BE271C | Basement Ceiling / Taklampe Sikringskap / Taklampe Tekniskrom (which is which unknown) | Basement |
| Tunable 362476 | Gulvlampe Stue in Kid1' room | Kid1 |
| D7164C, D77688 | Kjøkken *Bordlampe* and Spisestue *Bordlampe Høy* (which is which unknown) | **Unassigned** – routines use the SmartThings entities for these two |

To finish the last two: turn on Kjøkken Bordlampe in the SmartThings app and see which WiZ entity goes on, then
give that WiZ device the area Kjøkken (and the other Spisestue).

## Helpers
| Helper | What it does / how to tweak |
|---|---|
| `input_select.home_mode` – **Home mode** (Home/Away/Night/Vacation/Guest) | The heart of the setup. Changing it runs the matching routine (see automations). Set it from the app, dashboard or voice (“set home mode to away”). |
| `input_boolean.guest_mode` – **Guest mode** | Keeps the guest room lights and the heating untouched by Away/Bedtime routines. Synced with “Guest” in Home mode. |
| `input_boolean.movie_mode` – **Movie mode** | On = dims kitchen/dining/TV stue for a movie; off = restores the lights. |
| `schedule.quiet_hours` – **Quiet hours** | Sun–Thu nights 22:30–07:00, Fri/Sat nights 23:30–08:30. No announcements in quiet hours, lights adapt to 15 % warm, heating night level. Edit the blocks in Helpers → Quiet hours. |
| `input_boolean.adaptive_lighting` – **Adaptive lighting** | Master switch for the two adaptive-lighting automations. |
| `input_boolean.heating_schedule` – **Heating schedule** | Master switch for all automatic thermostat changes (night eco, away, vacation, arrive). Turn off and nothing touches the thermostats. |
| `input_number.comfort_stue_kjokken / comfort_kjokken / comfort_basement` | “Normal” setpoint per thermostat (started at the current 30 / 25 / 18 °C – the ELKO units look like floor sensors). Learned automatically when you change a thermostat yourself during comfort time. |
| `input_number.heating_night_offset` (2 °C), `heating_away_offset` (4 °C), `heating_vacation_offset` (7 °C) | How much lower than comfort each level is. Never below 7 °C. |
| `input_select.heating_state` | Internal: current heating level (comfort/night/away/vacation). |
| `input_boolean.fan_humidity_boost_active`, `input_text.fan_preset_before_boost` | Internal: used by the Flexit humidity boost to restore the previous fan mode. |
| `sensor.flexit_fan_humidity_rate` (Derivative helper) | How fast the Flexit fan's humidity rises (%/min over 5 min). |
| 5 × “… energy” (Integral helpers) | kWh from the WiZ bulbs' power readings, for the Energy dashboard. |

## Scenes
Scenes only touch lights; media is handled by the scripts.
| Scene | Lights |
|---|---|
| **Morning** | Kitchen bright and neutral (ceiling 70 %, under-cabinet/coffee 80 % 3500 K, cabinet 60 %, table lamp 50 %), dining table 60 %, tall lamp 40 %, entrance 60 %. |
| **Evening** | Warm and soft: kitchen ceiling 35 %, under-cabinet 50 %, coffee 40 %, cabinet 35 % (2700 K), table lamp 60 %, dining table 40 %, tall lamp 60 %, TV Lys 50 % 2700 K, entrance 40 %. |
| **Movie night** | Kitchen and dining ceilings off, under-cabinet 10 % 2200 K, dining tall lamp 15 %, TV Lys 15 % 2200 K. |
| **Dinner** | Dining table 55 %, tall lamp 45 %, kitchen ceiling 20 %, under-cabinet 40 %, coffee 25 %, kitchen table lamp 40 %, TV Lys 20 %. |
| **Good night** | Off: kitchen, dining, TV stue, entrance, basement. |
| **Away** | Off: everything in Good night + Kid1' room and the guest room. |
Tweak: open the scene, adjust the lights live, press Save. (The offline *Gulvlampe Stue* in Spisestue and the bedroom
floor lamp are not in scenes yet – add them once they are back online.)

## Scripts
| Script | What it does |
|---|---|
| **Home · Leave home** | Sets Home mode Away (keeps Vacation if chosen), movie off, Away scene (guest room spared in Guest mode), TVs off, Sonos paused, Juletre off, heating to away/vacation level (not in Guest mode). |
| **Home · Arrive home** | Sets Home, restores comfort heating (night level if quiet hours), and if dark: Evening scene, or only the entrance at 30 % during quiet hours. |
| **Home · Bedtime** | Sets Night, movie off, Good night scene, guest room off unless Guest mode, TVs off, Sonos paused, Juletre off, heating to night level. Bedroom 1 and Kid1' room are left alone. |
| **TV stue · Movie mode** | Remembers current lights, switches on Movie mode and applies Movie night. |
| **Home · All off** | All lights, TVs and Juletre off, Sonos paused. Never touches thermostats, ventilation, water heater, router/network, washer, or unknown plugs (Kid1 Zigbee Switch 1/2, Utelys). |
| **Heating · Apply level** | Internal helper used by the routines (comfort/night/away/vacation). Only sets setpoints, never turns heating off. |
| **Flexit · Filter replaced** | Run after you change the Flexit filter: resets the filter timer and clears the reminder. |

## Automations
All automations are prefixed with the room or “Home ·”.
| Automation | Behaviour | Tweak |
|---|---|---|
| **Home · Away / Vacation mode** | Home mode → Away/Vacation runs Leave home. | – |
| **Home · Back home** | Away/Vacation → Home/Guest runs Arrive home. | – |
| **Home · Good night when Night mode starts** | Home mode → Night runs Bedtime. | – |
| **Home · Good morning** | When quiet hours end and the house is in Night mode, sets Home; on weekdays while still dark, the coffee-station and under-cabinet lights come on at 50 %. | Change brightness or remove the light step. |
| **Home · Guest mode sync** | Keeps Guest mode and Home mode “Guest” in sync. | – |
| **Home · Evening lights at sunset** | 20 min before sunset, if someone seems home (any light on or TV/Sonos playing, or Guest mode) and it's Home/Guest mode, fades in the Evening scene over 2 min. | Change the offset; once the Companion app gives presence, replace the “someone seems home” check. |
| **Front door · Outdoor light dusk to quiet hours** | Utelys Inngang on at sunset, off when quiet hours start (and at sunrise as a safety net). Not in Vacation. | The plug is offline in SmartThings right now. |
| **Home · Adaptive lighting when a light turns on** | When you switch on a lamp by hand/app/voice, it gets the time-of-day level: 70 %/3300 K morning, 100 %/4000 K day, 85 %/3200 K from 16, 65 %/2700 K from 19, 45 %/2400 K from 21, 15 %/2200 K in quiet hours. Ignored when a scene or routine turned the light on, in movie mode, or with Adaptive lighting off. | Edit the levels in the `p` variable. |
| **Home · Adaptive colour temperature drift** | Every 15 min, slowly (60 s) shifts tunable lights that are on toward the time-of-day colour temperature. Never changes brightness; skips lights changed in the last 10 min or set outside 2200–4000 K by you. | – |
| **TV stue · Movie mode when the TV turns on in the evening** | Samsung TV in TV stue turns on after dark (after 15:00, before quiet hours, Home/Guest) → Movie mode. | **Disabled 2026-10-25** (`initial_state: false`; the owner chose manual). It dimmed the kitchen/dining lights whenever the TV came on. Start Movie mode manually via the app/voice. |
| **TV stue · Movie mode toggle** | Movie mode on → dim; off → restore the lights from before (not during quiet hours); TV off for 1 min → Movie mode off. | – |
| **Flexit · Humidity boost (shower)** | Humidity > 70 % for 1 min, or rising > 1 %/min (above 55 %) → fan to *high* (*medium* in quiet hours). Restores the previous mode when humidity has been < 60 % for 10 min, or after 90 min at most. | Thresholds in the triggers. The fan also has its own 70 % humidity function. |
| **Flexit · Filter replacement reminder** | Notification when the fan reports the filter is due (it does now), repeated Sundays 11:00 and after restarts, cleared when the alarm clears. | Run “Flexit · Filter replaced” after changing it. |
| **Laundry room · Washer finished** | Washer goes from running to stopped → notification; outside quiet hours and when home, “The washing machine is finished” on the Kjøkken Sonos (local Piper voice, as an announcement). | Change speaker/message in the action. |
| **Laundry room · Clear washer notification on next run** | Clears the washer notification when a new wash starts. | – |
| **Home · Energy watchdog for plugs** | Notifies (never switches off) if a metered plug draws > 1000 W for 30 min or > 15 W for 6 h, and if the Juletre is still on as quiet hours start. Covers Kid1 Zigbee Switch 1 and Juletre (both offline right now). | Add new plugs' power sensors to the triggers. |
| **Home · Device offline alert** | Notification when an important device has been unavailable for 30 min; cleared automatically when it returns. | Edit the entity list. |
| **Home · Low battery check** | Daily 18:00: one notification listing batteries < 15 %. | – |
| **Heating · Night eco and morning comfort** | Quiet hours start → thermostats 2 °C lower; quiet hours end → back to comfort. Home/Night/Guest only, only with Heating schedule on. First run: Monday 22:30. | Offsets in the helpers; times follow Quiet hours. |
| **Heating · Learn comfort setpoint from manual changes** | A setpoint you set yourself during comfort time (held 2 min) becomes the new comfort value for that room. | – |
| **Home · Voice shortcuts** | Extra phrases: “good night/god natt/bedtime”, “I'm leaving/jeg drar”, “I'm home/jeg er hjemme”, “movie time/filmkveld”, “dinner time/middag”, “good morning/god morgen”, “all off/alt av/slå av alt”. | Add phrases to the triggers. |

## Voice (Assist)
58 useful entities are exposed (lights, thermostats, TVs, Sonos, fan, Juletre, outdoor light, modes, scenes,
scripts, temperature/humidity, washer, weather, shopping list). Config entities (firmware updates, washer settings,
fan tuning numbers) and SmartThings duplicates of WiZ bulbs are hidden from voice.
Areas have Norwegian + English aliases: Kjøkken = Kitchen, Spisestue = Dining room, TV stue = Living room/Stue/TV-stue,
Inngangspart = Entrance/Hallway/Gang, Basement = Kjeller, Bedroom 1 = Soverom/Master bedroom, Kid1 = Kid1' room,
Gjesterom = Guest room, Laundry room = Vaskerom, Media room = Medierom, Front door = Outside/Ute.
Tested phrases: “turn off the lights in TV stue”, “turn on the lights in the kitchen”, “set the living room heating to
22 degrees”, “turn off the entrance light”, “what is the temperature in the dining room”, “turn off the Christmas tree”,
“pause the kitchen speaker”, “turn on movie mode”, “activate dinner”, “god natt”.
The Sonos Arc (“TV Room”) now sits in TV stue; the empty “TV Room” area that Sonos created can be deleted.

## Energy dashboard
Individual devices: Washer, The Frame TV, Basement floor heating (ELKO), Juletre (offline), and the 5 WiZ bulbs that
report power. No whole-house meter exists, so there is no grid consumption yet.

## Safety rules followed
No automation touches locks, alarms, garage, valves, camera privacy or the water heater. Nothing switches devices
on in the middle of the night (the only night-time actions turn things down or off). The washer is read-only.
Unknown plugs (Kid1 Zigbee Switch 1/2) are never switched. Heating is only ever adjusted, never turned off.

## Ideas that need hardware or input
- **Presence**: install the HA Companion app on the iPhone → automatic Away/Arrive, push notifications, and
  “someone home” for the sunset lights.
- **Electricity price (Nord Pool)**: needs the HACS *Nord Pool* integration (NO1 Oslo). Then: shift washer runs and
  heating to cheap hours, price-aware warnings.
- **Whole-house power**: a Tibber Pulse / HAN reader on the AMS meter would give real consumption, the capacity-tariff
  (“effekttrinn”) watchdog and a proper Energy dashboard.
- **Motion/door sensors** (Aqara via the hub E1, once moved to HA): motion lights in the basement/hall at night
  (10 % only), door-left-open alerts, doorbell → Sonos chime + snapshot on the app.
- **Bathroom**: the Bodø Supreme fan (pending PIN) can get the same humidity-boost automation.
- **Bedroom wake-up light**: the bedroom floor lamp is offline; when back, a gentle weekday sunrise is easy to add.
- **Vacation presence simulation**: random evening lights in Vacation mode.
- **Robot vacuum** (Dreame X50): run when Home mode becomes Away on weekdays – needs the Dreame integration.
- Christmas: Juletre on at sunset in December (plug currently offline).
