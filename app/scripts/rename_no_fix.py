# pass 2b: entities on renamed devices; appends to rename_no.undo.json
import asyncio,json,websockets,importlib.util,os
spec=importlib.util.spec_from_file_location('r','rename_no.py'); src=open('rename_no.py').read().split('async def main')[0]; ns={'__file__':os.path.abspath('rename_no.py')}; exec(src,ns)
DEVS,SUF=ns['DEVS'],ns['SUF']; INV={v:k for k,v in DEVS.items()}; UNDO=ns['UNDO']; T=ns['T']
SUF['Power energi']='effekt energi'; SUF['Humidity rate']='fuktighetsendring'
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
    u=json.load(open(UNDO)); done={e['entity_id'] for e in u['entities']}
    st={s['entity_id']:s['attributes'].get('friendly_name') for s in await call(type="get_states")}
    c=0
    for eid,name in st.items():
      if not name: continue
      for nd,od in INV.items():
        if name.startswith(nd+' ') and name[len(nd)+1:] in SUF:
          sfx=name[len(nd)+1:]; new=nd+' '+SUF[sfx]; eng=od+' '+sfx.replace('energi','energy')
          full=await call(type="config/entity_registry/get",entity_id=eid); oal=full.get('aliases') or []
          al=list(oal)+([eng] if eng not in oal else [])
          if eid not in done: u['entities'].append({'entity_id':eid,'old_friendly':eng,'old_name':full.get('name'),'old_aliases':oal,'new':new})
          await call(type="config/entity_registry/update",entity_id=eid,name=new,aliases=al); c+=1; print(eid,':',name,'->',new); break
    json.dump(u,open(UNDO,'w'),ensure_ascii=False,indent=1); print("FIXED",c)
asyncio.run(main())
