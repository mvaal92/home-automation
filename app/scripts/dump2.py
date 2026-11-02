import asyncio,json,websockets
T=open('/home/owner/home-automation/secrets/ha_token').read().strip()
async def main():
  async with websockets.connect('ws://localhost:8123/api/websocket',max_size=None) as w:
    await w.recv(); await w.send(json.dumps({"type":"auth","access_token":T})); await w.recv()
    out={}
    for i,t in enumerate(["config/area_registry/list","config/device_registry/list","config/entity_registry/list","get_states"],1):
      await w.send(json.dumps({"id":i,"type":t}))
      while True:
        r=json.loads(await w.recv())
        if r.get('id')==i: out[t]=r['result'];break
    json.dump(out,open('/tmp/hadump.json','w'))
    for a in out["config/area_registry/list"]: print("AREA",a['area_id'],'|',a['name'])
    for d in out["config/device_registry/list"]:
      if d.get('disabled_by'): continue
      print("DEV",d['id'][:8],'|',d.get('name_by_user') or d.get('name'))
    for s in out["get_states"]:
      print("ST",s['entity_id'],'|',s['attributes'].get('friendly_name'))
asyncio.run(main())
