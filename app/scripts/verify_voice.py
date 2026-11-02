#!/usr/bin/env python3
"""API-level check of the Assist pipeline: text->intent->tts, then a real
voice round trip (Piper speaks a phrase, we stream it as PCM into stt->intent->tts).

Usage: uv run --with websockets scripts/verify_voice.py
"""
import asyncio, json, os, subprocess, sys, urllib.request

import websockets

HA = os.environ.get("HA_URL", "http://127.0.0.1:8123").rstrip("/")
TOKEN = open(os.path.expanduser(os.environ.get("HA_TOKEN_FILE", "~/home-automation/secrets/ha_token"))).read().strip()


async def main():
    async with websockets.connect(HA.replace("http", "ws", 1) + "/api/websocket", max_size=None) as s:
        await s.recv()
        await s.send(json.dumps({"type": "auth", "access_token": TOKEN}))
        assert json.loads(await s.recv())["type"] == "auth_ok"
        mid = 0

        async def run(msg, audio=None):
            nonlocal mid
            mid += 1
            await s.send(json.dumps({"id": mid, "type": "assist_pipeline/run", **msg}))
            out = {}
            while True:
                r = json.loads(await s.recv())
                if r.get("id") != mid:
                    continue
                if r["type"] == "result":
                    if not r["success"]:
                        raise RuntimeError(r["error"])
                    continue
                ev = r["event"]
                t, d = ev["type"], ev.get("data") or {}
                if t == "run-start" and audio is not None:
                    h = d["runner_data"]["stt_binary_handler_id"]
                    for i in range(0, len(audio), 3200):
                        await s.send(bytes([h]) + audio[i:i + 3200])
                    await s.send(bytes([h]))
                if t == "stt-end": out["stt"] = d["stt_output"]["text"]
                if t == "intent-end": out["speech"] = d["intent_output"]["response"]["speech"]["plain"]["speech"]
                if t == "tts-end": out["tts_url"] = d["tts_output"]["url"]
                if t == "error": out["error"] = d
                if t in ("run-end", "error"):
                    return out

        text = await run({"start_stage": "intent", "end_stage": "tts", "input": {"text": "what time is it"}})
        print("TEXT  ->", {k: v for k, v in text.items() if k != "tts_url"}, "| tts audio:", bool(text.get("tts_url")))

        # Make a spoken sample with Piper, then decode to 16k mono PCM
        sample = await run({"start_stage": "tts", "end_stage": "tts", "input": {"text": "What is the weather like?"}})
        url = sample["tts_url"] if sample["tts_url"].startswith("http") else HA + sample["tts_url"]
        raw = urllib.request.urlopen(url, timeout=30).read()
        pcm = subprocess.run(["ffmpeg", "-loglevel", "error", "-i", "pipe:0", "-f", "s16le", "-ac", "1", "-ar", "16000", "pipe:1"],
                             input=raw, capture_output=True, check=True).stdout
        pcm += b"\x00" * 32000  # 1s trailing silence for VAD
        voice = await run({"start_stage": "stt", "end_stage": "tts", "input": {"sample_rate": 16000}}, audio=pcm)
        print("VOICE ->", {k: v for k, v in voice.items() if k != "tts_url"}, "| tts audio:", bool(voice.get("tts_url")))
        if "error" in text or "error" in voice:
            sys.exit(1)


asyncio.run(main())
