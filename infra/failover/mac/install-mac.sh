#!/bin/bash
# Install launchd agents on the Mac mini (idempotent)
set -e; S=$HOME/home-standby; LA=$HOME/Library/LaunchAgents; D=gui/$(id -u); mkdir -p $S/state $S/logs; chmod 700 $S
ln -sfn $S/failover/home-failover $HOME/.local/bin/home-failover
mk(){ # label keepalive args...
  l=$1; ka=$2; shift 2; { echo '<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict>'
  echo "<key>Label</key><string>$l</string><key>ProgramArguments</key><array>"; for a in "$@"; do echo "<string>$a</string>"; done; echo "</array>"
  if [ "$ka" = interval ]; then echo "<key>StartInterval</key><integer>30</integer><key>RunAtLoad</key><true/>"; else echo "<key>KeepAlive</key><true/><key>RunAtLoad</key><true/>"; fi
  echo "<key>StandardOutPath</key><string>$S/logs/$l.log</string><key>StandardErrorPath</key><string>$S/logs/$l.log</string></dict></plist>"; } > $LA/$l.plist; }
mk com.home.front keep $HOME/.local/bin/node $S/failover/front.mjs
mk com.home.standby-web keep $S/failover/run-local.sh web
mk com.home.standby-mcp keep $S/failover/run-local.sh mcp
mk com.home.watchdog interval $S/failover/home-failover watchdog
for l in com.home.front com.home.watchdog; do launchctl bootout $D/$l 2>/dev/null || true; launchctl bootstrap $D $LA/$l.plist; done
echo installed
