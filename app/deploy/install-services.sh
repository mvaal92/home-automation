#!/usr/bin/env bash
# Install/refresh the systemd --user services (idempotent). Linger is already on for owner.
set -euo pipefail
cd "$(dirname "$0")"
# The MCP service runs the bundled build
(cd ../packages/mcp && PATH=/home/owner/.local/share/vite-plus/bin:$PATH pnpm build >/dev/null)
mkdir -p ~/.config/systemd/user
for u in *.service; do install -m644 "$u" ~/.config/systemd/user/"$u"; done
systemctl --user daemon-reload
for u in *.service; do systemctl --user enable --now "$u"; systemctl --user restart "$u"; done
systemctl --user --no-pager --lines=0 status *.service | grep -E "●|Active"
