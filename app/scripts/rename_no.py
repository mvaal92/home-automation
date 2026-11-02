#!/usr/bin/env python3
"""Pass 2: English -> Norwegian display names. Undo: rename_no.py --undo (then rename.py --undo for pass 1)."""
import asyncio,json,sys,websockets,os
D=os.path.dirname(os.path.abspath(__file__)); UNDO=os.path.join(D,'rename_no.undo.json')
T=open('/home/owner/home-automation/secrets/ha_token').read().strip()
AREAS={'Basement':'Kjeller','Bedroom 1':'Soverom 1','Media room':'Medierom','TV stue':'TV-stue','Laundry room':'Vaskerom','Front door':'Ytterdør'}
DEVS={'Sun':'Sol','Backup':'Sikkerhetskopi','Forecast':'Værmelding','WiZ Dimmable White D7164C':'WiZ dimbar hvit D7164C',
'WiZ Dimmable White D77688':'WiZ dimbar hvit D77688','Flexit Fan':'Flexit vifte','Ceiling':'Taklys kjeller','Washer':'Vaskemaskin',
'Light Sensor - 55" The Frame':'Lyssensor 55" The Frame','Sound Sensor - 55" The Frame':'Lydsensor 55" The Frame','Hub - 55" The Frame':'Hub 55" The Frame',
'Zigbee Switch 1':'Zigbee-bryter 1','Zigbee Switch 2':'Zigbee-bryter 2','Zigbee Dimmer 1':'Zigbee-dimmer 1','Zigbee Thing':'Zigbee-enhet',
'Taklampe Sikringskap':'Taklampe sikringsskap','Taklampe Tekniskrom':'Taklampe teknisk rom'}
SUF={'Effect speed':'effekthastighet','Power':'effekt','Bass':'bass','Balance':'balanse','Treble':'diskant','Audio input format':'lydinngangsformat',
'Microphone':'mikrofon','Crossfade':'krysstoning','Loudness':'loudness','TV autoplay':'TV-autoavspilling','Ungroup on autoplay':'avgrupper ved autoavspilling',
'Speech enhancement':'taleforbedring','Audio delay':'lydforsinkelse','Surround level':'surroundnivå','Music surround level':'surroundnivå musikk',
'Surround music full volume':'surround musikk full styrke','Night sound':'nattlyd','Surround enabled':'surround på','WAN status':'WAN-status',
'External IP':'ekstern IP','Download speed':'nedlastingshastighet','Upload speed':'opplastingshastighet','Humidity':'luftfuktighet',
'Speed fan':'hastighet vifte','Speed fan 1':'hastighet vifte 1','Airflow':'luftstrøm','Boost status':'booststatus','Alarm status':'alarmstatus',
'Weekly schedule speed':'ukeplan hastighet','Battery':'batteri','Filter change in':'filterbytte om','Filter remaining':'filter gjenstår',
'IP address':'IP-adresse','Weekly schedule summary':'ukeplan oppsummering','Filter replacement required':'filterbytte nødvendig',
'Device problem':'enhetsproblem','Boost humidity':'boost luftfuktighet','Boost relay sensor':'boost relésensor','Boost analog voltage':'boost analog spenning',
'Weekly schedule':'ukeplan','Speed manual':'hastighet manuell','Speed 1 supply low':'hastighet 1 tilluft lav','Speed 1 exhaust low':'hastighet 1 avtrekk lav',
'Speed 2 supply medium':'hastighet 2 tilluft middels','Speed 2 exhaust medium':'hastighet 2 avtrekk middels','Speed 3 supply high':'hastighet 3 tilluft høy',
'Speed 3 exhaust high':'hastighet 3 avtrekk høy','Boost humidity threshold':'boost fuktighetsgrense','Boost analog voltage threshold':'boost spenningsgrense',
'Boost time':'boosttid','Filter timer setpoint':'filtertimer settpunkt','Timer mode':'timermodus','Airflow (raw)':'luftstrøm (rå)','Child lock':'barnesikring',
'Remote control':'fjernstyring','Motion':'bevegelse','Rinse cycles':'skyllinger','Detergent dispense amount':'vaskemiddelmengde','Spin level':'sentrifugering',
'Water temperature':'vanntemperatur','Illuminance':'belysningsstyrke','Brightness intensity':'lysintensitet','Energy':'energi','energy':'energi',
'Energy difference':'energiforskjell','Power energy':'effekt energi','Energy saved':'energi spart','Machine state':'maskinstatus','Job state':'programstatus',
'Completion time':'ferdig kl.','TV channel':'TV-kanal','TV channel name':'TV-kanalnavn','Temperature':'temperatur','Bubble Soak':'bobleforvask',
'Sound detection':'lydregistrering','Firmware':'fastvare','Automatic backup':'automatisk','Backup Manager state':'status',
'Next scheduled automatic backup':'neste planlagte','Last successful automatic backup':'siste vellykkede','Last attempted automatic backup':'siste forsøk',
'Next dawn':'neste demring','Next dusk':'neste skumring','Next midnight':'neste midnatt','Next noon':'neste høyeste punkt','Next rising':'neste soloppgang',
'Next setting':'neste solnedgang','Home':'hjem'}
SPECIAL={'binary_sensor.laundry_room_washer_power':'Vaskemaskin på'}
FULL={'Basement Lighting Turn off':'Kjeller lys av','Lighting Turn on':'Lys på','Lighting Turn off':'Lys av','Morning':'Morgen','Evening':'Kveld',
'Movie night':'Filmkveld','Dinner':'Middag','Good night':'God natt','Away':'Borte','Shopping list':'Handleliste','Home mode':'Hjemmemodus',
'Guest mode':'Gjestemodus','Movie mode':'Filmmodus','Adaptive lighting':'Adaptiv belysning','Heating schedule':'Varmeplan',
'Fan humidity boost active':'Fuktboost vifte aktiv','Heating state':'Varmestatus','Comfort stue kjøkken':'Komfort stue kjøkken','Comfort kjøkken':'Komfort kjøkken',
'Comfort Basement':'Komfort kjeller','Heating night offset':'Varme nattsenking','Heating away offset':'Varme bortesenking','Heating vacation offset':'Varme feriesenking',
'Quiet hours':'Stilletid','Fan preset before boost':'Viftemodus før boost','Flexit Fan Humidity rate':'Flexit vifte fuktighetsendring',
'Heating · Apply level':'Varme · Bruk nivå','Home · Leave home':'Hjem · Dra hjemmefra','Home · Arrive home':'Hjem · Kom hjem','Home · Bedtime':'Hjem · Leggetid',
'TV stue · Movie mode':'TV-stue · Filmmodus','Home · All off':'Hjem · Alt av','Flexit · Filter replaced':'Flexit · Filter byttet',
'Home · Away / Vacation mode':'Hjem · Borte / feriemodus','Home · Back home':'Hjem · Tilbake hjemme','Home · Good night when Night mode starts':'Hjem · God natt når nattmodus starter',
'Home · Good morning':'Hjem · God morgen','Home · Guest mode sync':'Hjem · Synk gjestemodus','Home · Evening lights at sunset':'Hjem · Kveldslys ved solnedgang',
'Front door · Outdoor light dusk to quiet hours':'Ytterdør · Utelys fra skumring til stilletid','Home · Adaptive lighting when a light turns on':'Hjem · Adaptiv belysning når et lys slås på',
'Home · Adaptive colour temperature drift':'Hjem · Adaptiv fargetemperatur gjennom dagen','TV stue · Movie mode when the TV turns on in the evening':'TV-stue · Filmmodus når TV-en slås på om kvelden',
'TV stue · Movie mode toggle':'TV-stue · Veksle filmmodus','Flexit · Humidity boost (shower)':'Flexit · Fuktboost (dusj)','Flexit · Filter replacement reminder':'Flexit · Påminnelse om filterbytte',
'Laundry room · Washer finished':'Vaskerom · Vaskemaskin ferdig','Laundry room · Clear washer notification on next run':'Vaskerom · Fjern vaskevarsel ved neste vask',
'Home · Energy watchdog for plugs':'Hjem · Strømvakt for stikkontakter','Home · Device offline alert':'Hjem · Varsel om frakoblet enhet','Home · Low battery check':'Hjem · Sjekk lavt batteri',
'Heating · Night eco and morning comfort':'Varme · Nattsenking og morgenkomfort','Heating · Learn comfort setpoint from manual changes':'Varme · Lær komforttemperatur fra manuelle endringer',
'Home · Voice shortcuts':'Hjem · Stemmesnarveier'}
EXTRA_AL={'scene.morning':['god morgen','morgenen'],'scene.evening':['kveldslys'],'scene.movie_night':['filmkveld','kinokveld'],'scene.dinner':['middagslys','middagstid'],
'scene.good_night':['godnatt','natta'],'scene.away':['borte','bortemodus'],'scene.lighting_turn_on':['alle lys på'],'scene.lighting_turn_off':['alle lys av'],
'scene.basement_lighting_turn_off':['kjellerlys av'],'script.leave_home':['jeg drar','dra hjemmefra'],'script.arrive_home':['jeg er hjemme','kom hjem'],
'script.bedtime':['leggetid','sengetid'],'script.all_off':['slå av alt','alt av'],'script.movie_mode':['filmmodus','kinomodus'],'script.flexit_filter_replaced':['filter byttet']}
async def main():
  async with websockets.connect('ws://localhost:8123/api/websocket',max_size=None) as w:
    await w.recv(); await w.send(json.dumps({"type":"auth","access_token":T})); await w.recv()
    n=[0]
    async def call(**m):
      n[0]+=1; m['id']=n[0]; await w.send(json.dumps(m))
      while True:
        r=json.loads(await w.recv())
        if r.get('id')==n[0]:
          if not r.get('success'): raise SystemExit(f"fail {m}: {r}")
          return r['result']
    if '--undo' in sys.argv:
      u=json.load(open(UNDO))
      for a in u['areas']: await call(type="config/area_registry/update",area_id=a['id'],name=a['old'],aliases=a['old_aliases'])
      for d in u['devices']: await call(type="config/device_registry/update",device_id=d['id'],name_by_user=d['old'])
      for e in u['entities']: await call(type="config/entity_registry/update",entity_id=e['entity_id'],name=e['old_name'],aliases=e['old_aliases'])
      print("undone"); return
    undo={'areas':[],'devices':[],'entities':[]}
    for a in await call(type="config/area_registry/list"):
      if a['name'] in AREAS:
        new=AREAS[a['name']]; al=sorted(set(a.get('aliases') or [])|{a['name']})
        undo['areas'].append({'id':a['area_id'],'old':a['name'],'old_aliases':a.get('aliases') or [],'new':new})
        await call(type="config/area_registry/update",area_id=a['area_id'],name=new,aliases=al); print("AREA",a['name'],'->',new)
    devs=await call(type="config/device_registry/list"); dn={}
    for d in devs:
      cur=d.get('name_by_user') or d.get('name'); new=DEVS.get(cur,cur); dn[d['id']]=(cur,new)
      if new!=cur:
        undo['devices'].append({'id':d['id'],'old':d.get('name_by_user'),'new':new})
        await call(type="config/device_registry/update",device_id=d['id'],name_by_user=new); print("DEV",cur,'->',new)
    ents={e['entity_id']:e for e in await call(type="config/entity_registry/list")}
    st={s['entity_id']:s['attributes'].get('friendly_name') for s in await call(type="get_states")}
    for eid,old in st.items():
      e=ents.get(eid)
      if not e or not old: continue
      new=None
      if eid in SPECIAL: new=SPECIAL[eid]
      elif old in FULL: new=FULL[old]
      else:
        dc,dnw=dn.get(e.get('device_id'),(None,None))
        if dc and old.startswith(dc+' ') and old[len(dc)+1:] in SUF: new=dnw+' '+SUF[old[len(dc)+1:]]
        elif dc and old==dc and dnw!=dc: new=None  # follows device
        elif ' ' in old and old.rsplit(' ',1)[1] in ('energy','Firmware') : new=old.rsplit(' ',1)[0]+' '+SUF[old.rsplit(' ',1)[1]]
      ex=EXTRA_AL.get(eid,[])
      if not new and not ex: continue
      full=(await call(type="config/entity_registry/get",entity_id=eid)); oal=full.get('aliases') or []
      al=list(oal)
      for x in ([old] if new else [])+ex:
        if x not in al: al.append(x)
      upd={'aliases':al}
      if new: upd['name']=new
      undo['entities'].append({'entity_id':eid,'old_friendly':old,'old_name':full.get('name'),'old_aliases':oal,'new':new})
      await call(type="config/entity_registry/update",entity_id=eid,**upd)
    json.dump(undo,open(UNDO,'w'),ensure_ascii=False,indent=1)
    await asyncio.sleep(2)
    st2={s['entity_id']:s['attributes'].get('friendly_name') for s in await call(type="get_states")}
    ch=[k for k in st if st[k]!=st2.get(k)]
    for k in ch: print(f"{k}: {st[k]} -> {st2.get(k)}")
    print("ENTITIES CHANGED",len(ch))
asyncio.run(main())
