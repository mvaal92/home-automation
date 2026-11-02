#!/usr/bin/env bash
# Nightly Home backup on omarchy -> Mac mini (Tailscale). See ../FAILOVER.md
set -euo pipefail
umask 077
ROOT=/home/owner/home-automation
DEST_HOST=${HOME_BACKUP_HOST:-standby}            # ~/.ssh/config alias (100.64.0.2)
DEST_DIR=${HOME_BACKUP_DIR:-home-standby/backups}  # relative to ~owner on the Mac
KEEP=${HOME_BACKUP_KEEP:-14}
STAMP=$(date +%Y%m%d-%H%M%S)
WORK=$(mktemp -d /tmp/home-backup.XXXXXX); trap 'rm -rf "$WORK"' EXIT
OUT="$WORK/home-$STAMP"; mkdir -p "$OUT"
log(){ echo "$(date '+%F %T') $*"; }

# 1. Home Assistant config (incl .storage, custom_components) - tar inside the container (files are root-owned)
log "HA config"
docker exec homeassistant tar czf - -C /config \
  --exclude=./deps --exclude=./tts --exclude='./home-assistant.log*' --exclude=./.ha_run.lock \
  --exclude='./home-assistant_v2.db*' --exclude='./backups' . > "$OUT/ha-config.tgz"
# recorder history: consistent sqlite copy (optional, best effort)
docker exec homeassistant python3 -c "import sqlite3;s=sqlite3.connect('/config/home-assistant_v2.db');d=sqlite3.connect('/tmp/ha_v2.bak');s.backup(d);d.close()" \
  && docker exec homeassistant gzip -c /tmp/ha_v2.bak > "$OUT/ha-recorder.db.gz" && docker exec homeassistant rm -f /tmp/ha_v2.bak || log "recorder copy skipped"

# 2. app database (prefs, notes, chats) - online consistent copy
log "home.db"
sqlite3 "$ROOT/data/home.db" ".backup '$OUT/home.db'"
# 3. other data/ files (photos etc), without the live db
tar czf "$OUT/data.tgz" -C "$ROOT" --exclude='data/home.db*' data
# 4. secrets: kept 0600 in a 0700 dir (the standby needs them in clear to serve); never world-readable
tar czf "$OUT/secrets.tgz" -C "$ROOT" secrets
# 5. app git repo (all branches) + top-level docs/compose
git -C "$ROOT/app" bundle create "$OUT/app.bundle" --all 2>/dev/null
tar czf "$OUT/top.tgz" -C "$ROOT" --exclude=app --exclude=app-robots --exclude=ha-config --exclude=data --exclude=secrets --exclude=voice-data .
( cd "$OUT" && sha256sum * > SHA256SUMS )

log "push to $DEST_HOST:$DEST_DIR"
ssh "$DEST_HOST" "mkdir -p $DEST_DIR && chmod 700 home-standby $DEST_DIR"
rsync -a "$OUT" "$DEST_HOST:$DEST_DIR/"
ssh "$DEST_HOST" "cd $DEST_DIR && ln -sfn home-$STAMP latest && ls -1d home-2* | sort -r | tail -n +$((KEEP+1)) | xargs rm -rf; ls -1d home-2* | wc -l | xargs echo kept"
# Mirror live app code + data for a warm standby (Mac web-server/MCP read from here)
"$ROOT/failover/sync-standby.sh"
log "done $STAMP ($(du -sh "$OUT" | cut -f1))"
