"""Tiny HA client (REST + WS). Token read from secrets, never printed."""
import json, sys, urllib.request, asyncio, itertools
import websockets
BASE = "http://127.0.0.1:8123"
TOKEN = open("/home/owner/home-automation/secrets/ha_token").read().strip()

def rest(method, path, data=None):
    req = urllib.request.Request(BASE + path, method=method,
        headers={"Authorization": "Bearer " + TOKEN, "Content-Type": "application/json"},
        data=json.dumps(data).encode() if data is not None else None)
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            body = r.read().decode()
            try: return json.loads(body)
            except Exception: return body
    except urllib.error.HTTPError as e:
        return {"_error": e.code, "_body": e.read().decode()[:500]}

class WS:
    async def __aenter__(self):
        self.c = await websockets.connect(BASE.replace("http", "ws") + "/api/websocket", max_size=2**26)
        await self.c.recv()
        await self.c.send(json.dumps({"type": "auth", "access_token": TOKEN}))
        m = json.loads(await self.c.recv())
        assert m["type"] == "auth_ok", m
        self.i = itertools.count(1)
        return self
    async def __aexit__(self, *a):
        await self.c.close()
    async def call(self, type_, **kw):
        i = next(self.i)
        await self.c.send(json.dumps({"id": i, "type": type_, **kw}))
        while True:
            m = json.loads(await self.c.recv())
            if m.get("id") == i and m.get("type") == "result":
                if not m["success"]:
                    return {"_error": m.get("error")}
                return m["result"]

def ws(type_, **kw):
    async def f():
        async with WS() as w:
            return await w.call(type_, **kw)
    return asyncio.run(f())

def wsmany(calls):
    async def f():
        out = []
        async with WS() as w:
            for t, kw in calls:
                out.append(await w.call(t, **kw))
        return out
    return asyncio.run(f())

if __name__ == "__main__":
    # usage: ha.py rest GET /api/states | ha.py ws type '{"k":..}'
    if sys.argv[1] == "rest":
        d = json.loads(sys.argv[4]) if len(sys.argv) > 4 else None
        print(json.dumps(rest(sys.argv[2], sys.argv[3], d), indent=1, ensure_ascii=False))
    else:
        kw = json.loads(sys.argv[3]) if len(sys.argv) > 3 else {}
        print(json.dumps(ws(sys.argv[2], **kw), indent=1, ensure_ascii=False))
