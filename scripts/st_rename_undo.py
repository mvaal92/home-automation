#!/usr/bin/env python3
# Restores SmartThings device labels and room names from smartthings-rename.undo.json
import json,urllib.request
T=open('secrets/smartthings_pat').read().strip()
def put(p,d):
    urllib.request.urlopen(urllib.request.Request('https://api.smartthings.com/v1'+p,method='PUT',data=json.dumps(d).encode(),headers={'Authorization':'Bearer '+T,'Content-Type':'application/json'}))
u=json.load(open('smartthings-rename.undo.json'))
for did,lab in u['devices'].items(): put(f'/devices/{did}',{'label':lab}); print('dev',lab)
for rid,r in u['rooms'].items(): put(f"/locations/{r['locationId']}/rooms/{rid}",{'name':r['name']}); print('room',r['name'])
