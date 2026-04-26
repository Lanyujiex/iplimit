#!/bin/bash
# Deploy luci-app-iplimit to OpenWrt router (without SDK build)
# Usage: ./deploy.sh <router_ip>

ROUTER_IP="${1:-10.168.1.22}"
BASE_DIR="$(cd "$(dirname "$0")" && pwd)"
LUCI_DIR="$BASE_DIR/luci-app-iplimit"
ROOT_DIR="$LUCI_DIR/root"

echo "Deploying to $ROUTER_IP ..."

# Config and init script
scp "$ROOT_DIR/etc/config/iplimit.conf" root@$ROUTER_IP:/etc/config/iplimit.conf
ssh root@$ROUTER_IP "ln -sf /etc/config/iplimit.conf /etc/config/iplimit"
scp "$ROOT_DIR/etc/init.d/iplimit" root@$ROUTER_IP:/etc/init.d/iplimit
ssh root@$ROUTER_IP "chmod +x /etc/init.d/iplimit"

# LuCI menu and ACL
scp "$ROOT_DIR/usr/share/luci/menu.d/luci-app-iplimit.json" root@$ROUTER_IP:/usr/share/luci/menu.d/
scp "$ROOT_DIR/usr/share/rpcd/acl.d/luci-app-iplimit.json" root@$ROUTER_IP:/usr/share/rpcd/acl.d/

# LuCI JS views
ssh root@$ROUTER_IP "mkdir -p /www/luci-static/resources/view/iplimit"
scp "$LUCI_DIR/htdocs/luci-static/resources/view/iplimit/settings.js" root@$ROUTER_IP:/www/luci-static/resources/view/iplimit/
scp "$LUCI_DIR/htdocs/luci-static/resources/view/iplimit/status.js" root@$ROUTER_IP:/www/luci-static/resources/view/iplimit/
ssh root@$ROUTER_IP "chmod 644 /www/luci-static/resources/view/iplimit/*.js"

# Clear LuCI cache and restart services
ssh root@$ROUTER_IP "rm -f /tmp/luci-indexcache* /tmp/luci-modulecache* && /etc/init.d/rpcd restart && /etc/init.d/iplimit enable && /etc/init.d/iplimit restart"

echo "Done! Open http://$ROUTER_IP -> Network -> IP Limit"
