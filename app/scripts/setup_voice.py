#!/usr/bin/env python3
"""Register Wyoming Whisper (STT) + Piper (TTS) in Home Assistant and make an
Assist pipeline that uses them the preferred one. Idempotent.

Usage:  HA_TOKEN_FILE=~/home-automation/secrets/ha_token uv run --with websockets scripts/setup_voice.py
The token is read from the file at runtime and never printed.
"""
import asyncio, json, os, sys, urllib.request

import websockets

HA = os.environ.get("HA_URL", "http://127.0.0.1:8123").rstrip("/")
TOKEN = open(os.path.expanduser(os.environ.get("HA_TOKEN_FILE", "~/home-automation/secrets/ha_token"))).read().strip()
SERVICES = [("127.0.0.1", 10300), ("127.0.0.1", 10200)]
PIPELINE_NAME = "Home (Whisper + Piper)"


def rest(method, path, body=None):
    req = urllib.request.Request(f"{HA}{path}", method=method, data=json.dumps(body).encode() if body is not None else None,
                                 headers={"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read() or b"null")


def ensure_wyoming():
    entries = [e for e in rest("GET", "/api/config/config_entries/entry") if e["domain"] == "wyoming"]
    print("existing wyoming entries:", [e["title"] for e in entries])
    for host, port in SERVICES:
        flow = rest("POST", "/api/config/config_entries/flow", {"handler": "wyoming", "show_advanced_options": False})
        if flow.get("type") == "abort":
            print(f"  {host}:{port} -> abort ({flow.get('reason')})"); continue
        res = rest("POST", f"/api/config/config_entries/flow/{flow['flow_id']}", {"host": host, "port": port})
        print(f"  {host}:{port} -> {res.get('type')} {res.get('title') or res.get('reason') or res.get('errors')}")


async def ws():
    async with websockets.connect(HA.replace("http", "ws", 1) + "/api/websocket", max_size=None) as s:
        await s.recv()
        await s.send(json.dumps({"type": "auth", "access_token": TOKEN}))
        if json.loads(await s.recv())["type"] != "auth_ok":
            sys.exit("auth failed")
        mid = 0

        async def call(msg):
            nonlocal mid
            mid += 1
            await s.send(json.dumps({"id": mid, **msg}))
            while True:
                r = json.loads(await s.recv())
                if r.get("id") == mid and r["type"] == "result":
                    if not r["success"]:
                        raise RuntimeError(r["error"])
                    return r["result"]

        states = await call({"type": "get_states"})
        stt = next((x["entity_id"] for x in states if x["entity_id"].startswith("stt.") and "whisper" in x["entity_id"]), None)
        tts = next((x["entity_id"] for x in states if x["entity_id"].startswith("tts.") and "piper" in x["entity_id"]), None)
        print("stt:", stt, "tts:", tts)
        if not stt or not tts:
            sys.exit("Wyoming entities not found yet")
        cfg = dict(name=PIPELINE_NAME, language="en", conversation_engine="conversation.home_assistant", conversation_language="en",
                   stt_engine=stt, stt_language="en", tts_engine=tts, tts_language="en_US", tts_voice="en_US-lessac-medium",
                   wake_word_entity=None, wake_word_id=None, prefer_local_intents=True)
        pl = await call({"type": "assist_pipeline/pipeline/list"})
        existing = next((p for p in pl["pipelines"] if p["name"] == PIPELINE_NAME), None)
        if existing:
            p = await call({"type": "assist_pipeline/pipeline/update", "pipeline_id": existing["id"], **cfg})
        else:
            p = await call({"type": "assist_pipeline/pipeline/create", **cfg})
        await call({"type": "assist_pipeline/pipeline/set_preferred", "pipeline_id": p["id"]})
        print("preferred pipeline:", p["id"], p["name"])


if __name__ == "__main__":
    ensure_wyoming()
    import time; time.sleep(3)
    asyncio.run(ws())
