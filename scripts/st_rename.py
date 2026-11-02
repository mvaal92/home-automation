import json,urllib.request,sys,datetime
T=open('secrets/smartthings_pat').read().strip()
B='https://api.smartthings.com/v1'
def req(m,p,d=None):
    r=urllib.request.Request(B+p,method=m,data=json.dumps(d).encode() if d is not None else None,headers={'Authorization':'Bearer '+T,'Content-Type':'application/json'})
    with urllib.request.urlopen(r) as f: return json.load(f)
plan=json.load(open('smartthings-rename.plan.json'))
plan['devices']['8b67cd6a-f8ac-4418-8b0b-b892c81dc882'][1]='Gulvlampe stue (Kid1)'
dry='--apply' not in sys.argv
undo={'devices':{},'rooms':{}};log=[]
for did,(old,new) in plan['devices'].items():
    d=req('GET',f'/devices/{did}'); cur=d.get('label')
    if cur==new: log.append(f'skip(already) dev {new}');continue
    if cur!=old: log.append(f'MISMATCH dev {did} cur={cur!r} expected={old!r}');continue
    if not dry: req('PUT',f'/devices/{did}',{'label':new})
    undo['devices'][did]=cur; log.append(f'dev {cur!r} -> {new!r}')
for loc in req('GET','/locations')['items']:
    lid=loc['locationId']
    for rm in req('GET',f'/locations/{lid}/rooms')['items']:
        n=rm['name']
        if n in plan['rooms']:
            new=plan['rooms'][n]
            if not dry: req('PUT',f'/locations/{lid}/rooms/{rm["roomId"]}',{'name':new})
            undo['rooms'][rm['roomId']]={'locationId':lid,'name':n}; log.append(f'room {n!r} -> {new!r}')
        else: log.append(f'room keep {n!r}')
    try:
        for s in req('GET',f'/scenes?locationId={lid}').get('items',[]): log.append(f'scene {s.get("sceneName")!r}')
    except Exception as e: log.append(f'scenes err {e}')
    try:
        for r in req('GET',f'/rules?locationId={lid}').get('items',[]): log.append(f'rule {r.get("name")!r} {r["id"]}')
    except Exception as e: log.append(f'rules err {e}')
print('\n'.join(log)); print('DRY' if dry else 'APPLIED', len(undo['devices']), len(undo['rooms']))
if not dry:
    json.dump(undo,open('smartthings-rename.undo.json','w'),ensure_ascii=False,indent=1)
