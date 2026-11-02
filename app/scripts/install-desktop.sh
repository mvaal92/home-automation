#!/usr/bin/env bash
# Install the packaged Linux build into ~/.local/opt/home and register a launcher
# ("Home") in ~/.local/share/applications. Run after `pnpm desktop:build`.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/apps/desktop/release/linux-unpacked"
DEST="$HOME/.local/opt/home"
TOKEN_FILE="${HOME_HA_TOKEN_FILE:-$HOME/home-automation/secrets/ha_token}"
[ -x "$SRC/home" ] || { echo "Build first: pnpm desktop:build" >&2; exit 1; }
mkdir -p "$(dirname "$DEST")"
rm -rf "$DEST.new"
cp -r "$SRC" "$DEST.new"
rm -rf "$DEST"
mv "$DEST.new" "$DEST"
install -Dm644 "$ROOT/apps/desktop/build/icon.png" "$HOME/.local/share/icons/hicolor/512x512/apps/home-automation.png"
mkdir -p "$HOME/.local/share/applications"
cat > "$HOME/.local/share/applications/home.desktop" <<DESK
[Desktop Entry]
Type=Application
Name=Home
GenericName=Smart Home
Comment=Control lights, climate, media and more (Home Assistant)
Exec=env HOME_HA_TOKEN_FILE=$TOKEN_FILE $DEST/home %U
Icon=home-automation
Terminal=false
Categories=Utility;
Keywords=home;smart;lights;assistant;hass;
StartupWMClass=home
StartupNotify=true
DESK
update-desktop-database "$HOME/.local/share/applications" 2>/dev/null || true
echo "Installed: $DEST/home  (launcher: Home)"
