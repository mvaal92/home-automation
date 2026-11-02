#!/usr/bin/env python3
"""Durable SmartThings auth: reuse the OAuth token that Home Assistant's own
SmartThings integration keeps refreshed (refresh_token, x:devices scope).
Copies it to secrets/smartthings_pat + HA secrets.yaml (smartthings_bearer)
when it changes, reloads rest/rest_command, and forces HA to refresh it if it
gets close to expiry. Never prints tokens. Writes status to data/auth/smartthings.json."""
import json, os, subprocess, sys, time, urllib.request
BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SEC = os.path.join(BASE, 'secrets'); STAT = os.path.join(BASE, 'data', 'auth')
os.makedirs(STAT, exist_ok=True)
def dx(code):
    return subprocess.run(['docker', 'exec', '-i', 'homeassistant', 'python3', '-c', code],
                          capture_output=True, text=True, timeout=60, check=True).stdout
READ = """import json
for e in json.load(open('/config/.storage/core.config_entries'))['data']['entries']:
  if e['domain']=='smartthings': print(json.dumps({'id':e['entry_id'],'t':e['data']['token']['access_token'],'exp':e['data']['token']['expires_at']}))"""
def ha(path, body):
    tok = open(os.path.join(SEC, 'ha_token')).read().strip()
    r = urllib.request.Request('http://localhost:8123' + path, data=json.dumps(body).encode(), method='POST',
        headers={'Authorization': 'Bearer ' + tok, 'Content-Type': 'application/json'})
    urllib.request.urlopen(r, timeout=60).read()
def read():
    return json.loads(dx(READ).strip().splitlines()[0])
d = read()
if d['exp'] - time.time() < 3 * 3600:   # make HA refresh via its OAuth session
    ha('/api/services/homeassistant/reload_config_entry', {'entry_id': d['id']}); time.sleep(20); d = read()
pat = os.path.join(SEC, 'smartthings_pat')
cur = open(pat).read().strip() if os.path.exists(pat) else ''
changed = cur != d['t']
if changed:
    fd = os.open(pat + '.tmp', os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    os.write(fd, d['t'].encode()); os.close(fd); os.replace(pat + '.tmp', pat)
    upd = """import re,sys,os
p='/config/secrets.yaml'; t=sys.stdin.read().strip(); s=open(p).read()
line='smartthings_bearer: "Bearer '+t+'"'
s=re.sub(r'(?m)^smartthings_bearer:.*$', lambda m: line, s) if re.search(r'(?m)^smartthings_bearer:', s) else s.rstrip()+'\\n'+line+'\\n'
open(p+'.tmp','w').write(s); os.chmod(p+'.tmp',0o600); os.replace(p+'.tmp',p)"""
    subprocess.run(['docker', 'exec', '-i', 'homeassistant', 'python3', '-c', upd], input=d['t'], text=True, timeout=60, check=True)
    for svc in ('rest/reload', 'rest_command/reload'):
        ha('/api/services/' + svc, {})
st = {'integration': 'smartthings', 'ok': True, 'source': 'Home Assistant OAuth (auto-refresh)',
      'expires_at': d['exp'], 'checked_at': time.time(), 'rotated': changed}
open(os.path.join(STAT, 'smartthings.json'), 'w').write(json.dumps(st))
print('ok rotated=%s expires_in_h=%.1f' % (changed, (d['exp'] - time.time()) / 3600))
