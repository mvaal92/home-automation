# Home automation stack (omarchy)

Home Assistant Container (`ghcr.io/home-assistant/home-assistant:stable`), host networking, TZ Europe/Oslo.

## Start / stop
```sh
cd ~/home-automation
docker compose up -d        # start
docker compose stop         # stop
docker compose restart      # restart after config changes
docker compose logs -f      # follow logs
docker compose pull && docker compose up -d   # update to latest stable
```

## Where things live
- Compose file: `~/home-automation/docker-compose.yml`
- HA config: `~/home-automation/ha-config/` (`configuration.yaml`, `secrets.yaml`, DB `home-assistant_v2.db`)
  - Files are owned by root (written by the container). Edit with `sudo`, or `docker exec -it homeassistant vi /config/configuration.yaml`.
- Recorder keeps 14 days of history (`purge_keep_days: 14`) to keep the DB small.

## URLs
- Local: http://127.0.0.1:8123
- Tailscale: http://100.64.0.1:8123 (allowed: ufw accepts everything on tailscale0)
- LAN: http://192.0.2.11:8123 — **blocked for other LAN devices by ufw** until you add:
  `sudo ufw allow from 192.168.1.0/24 to any port 8123 proto tcp comment 'home-assistant-lan'`

## Next steps
1. Open http://127.0.0.1:8123 (or the Tailscale URL) and complete onboarding: create your owner account, set home location (Oslo), units, analytics choice.
2. Settings > Devices & services > Add integration > **SmartThings** — sign in with your Samsung account (OAuth) and pick the location.
3. Then: build the dashboard (Overview > edit), add areas/rooms, automations.
