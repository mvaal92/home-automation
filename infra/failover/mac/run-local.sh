#!/bin/bash
# launchd wrapper: $1 = web|mcp
S=$HOME/home-standby; UP=$(cat $S/state/ha_upstream 2>/dev/null || echo http://100.64.0.1:8123)
NODE=$HOME/.local/bin/node
if [ "$1" = web ]; then
  cd $S/app/apps/web-server
  HOME_PORT=18124 HOME_BIND=127.0.0.1 HOME_PROXY_TRUSTED_LOCAL=127.0.0.1 HOME_HA_UPSTREAM=$UP \
  HOME_HA_TOKEN_FILE=$S/secrets/ha_token HOME_DATA_DIR=$S/data HOME_STATIC_DIR=$S/app/packages/ui/dist exec $NODE server.mjs
else
  cd $S/app/packages/mcp
  HOME_MCP_PORT=18125 HOME_MCP_BIND=127.0.0.1 HOME_HA_URL=$UP HOME_HA_TOKEN_FILE=$S/secrets/ha_token \
  HOME_MCP_TOKEN_FILE=$S/secrets/mcp_token exec $NODE dist/home-mcp.mjs
fi
