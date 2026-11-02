#!/usr/bin/env python3
"""Apply rename_plan.json (display names only) or undo via: rename.py --undo"""
import asyncio,json,sys,websockets,os
D=os.path.dirname(os.path.abspath(__file__)); UNDO=os.path.join(D,'rename.undo.json')
T=open('/home/owner/home-automation/secrets/ha_token').read().strip()
VOICE=('light.','switch.','climate.','scene.','media_player.','fan.','script.')
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
      for d in u['devices']: await call(type="config/device_registry/update",device_id=d['id'],name_by_user=d['old'])
      for e in u['entities']: await call(type="config/entity_registry/update",entity_id=e['entity_id'],name=e['old_name'],aliases=e['old_aliases'])
      print("undone"); return
    plan=json.load(open(os.path.join(D,'rename_plan.json')))
    devs=await call(type="config/device_registry/list"); ents=await call(type="config/entity_registry/list")
    st={s['entity_id']:s['attributes'].get('friendly_name') for s in await call(type="get_states")}
    undo={'devices':[],'entities':[]}; touched={}
    for pre,new in plan['devices'].items():
      d=[x for x in devs if x['id'].startswith(pre)][0]
      undo['devices'].append({'id':d['id'],'name':d['name'],'old':d.get('name_by_user'),'new':new})
      await call(type="config/device_registry/update",device_id=d['id'],name_by_user=new)
      for e in ents:
        if e['device_id']==d['id']: touched[e['entity_id']]=e
    for eid,new in plan['entities'].items():
      touched[eid]=next(e for e in ents if e['entity_id']==eid)
    for eid,e in touched.items():
      old=st.get(eid); upd={}
      if eid in plan['entities']: upd['name']=plan['entities'][eid]
      al=list(e.get('aliases') or [])
      if eid.startswith(VOICE) and old and old not in al: al.append(old); upd['aliases']=al
      if not upd: continue
      undo['entities'].append({'entity_id':eid,'old_friendly':old,'old_name':e.get('name'),'old_aliases':e.get('aliases') or []})
      await call(type="config/entity_registry/update",entity_id=eid,**upd)
    json.dump(undo,open(UNDO,'w'),ensure_ascii=False,indent=1)
    await asyncio.sleep(2)
    st2={s['entity_id']:s['attributes'].get('friendly_name') for s in await call(type="get_states")}
    for eid in sorted(touched):
      if st.get(eid)!=st2.get(eid): print(f"{eid}: {st.get(eid)} -> {st2.get(eid)}")
asyncio.run(main())
