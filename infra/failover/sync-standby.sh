#!/usr/bin/env bash
# Mirror runtime bits to the Mac standby (frequent; called by timer every 5 min and by home-backup.sh)
set -euo pipefail
ROOT=/home/owner/home-automation; H=${HOME_BACKUP_HOST:-standby}
ssh $H 'mkdir -p home-standby/{app,data,secrets,failover} && chmod 700 home-standby home-standby/data home-standby/secrets'
# If the Mac is in failover (it owns writes), do NOT overwrite its db
if ssh $H 'test -f home-standby/state/WEB_FAILOVER'; then echo "mac in failover: skipping data push"; exit 0; fi
rsync -a --delete --exclude node_modules --exclude .git --exclude screenshots \
  --include 'apps/***' --include 'packages/' --include 'packages/ui/' --include 'packages/ui/dist/***' --include 'packages/mcp/' --include 'packages/mcp/dist/***' --exclude '*' \
  "$ROOT/app/" $H:home-standby/app/
rsync -a "$ROOT/app/apps/web-server/node_modules/ws/" $H:home-standby/app/apps/web-server/node_modules/ws/
T=$(mktemp -d); sqlite3 "$ROOT/data/home.db" ".backup '$T/home.db'"
rsync -a --exclude 'home.db*' "$ROOT/data/" $H:home-standby/data/
rsync -a "$T/home.db" $H:home-standby/data/home.db.replica; rm -rf "$T"
rsync -a --chmod=D700,F600 "$ROOT/secrets/" $H:home-standby/secrets/
rsync -a "$ROOT/failover/mac/" $H:home-standby/failover/
