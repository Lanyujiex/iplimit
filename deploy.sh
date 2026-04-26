#!/bin/bash
# Deploy luci-app-iplimit to OpenWrt router (without SDK build)
# Usage: ./deploy.sh <router_ip>

ROUTER_IP="${1:-10.168.1.22}"
BASE_DIR="$(cd "$(dirname "$0")" && pwd)"
LUCI_DIR="$BASE_DIR/luci-app-iplimit"
ROOT_DIR="$LUCI_DIR/root"
PO_DIR="$LUCI_DIR/po"

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

# i18n: compile .po to .lmo and deploy
PO2LMO="$BASE_DIR/.tools/po2lmo"
if [ ! -x "$PO2LMO" ]; then
    echo "Building po2lmo ..."
    LUCI_REPO="$BASE_DIR/.tools/luci"
    if [ ! -d "$LUCI_REPO" ]; then
        git clone --depth 1 --filter=blob:none --sparse https://github.com/openwrt/luci.git "$LUCI_REPO"
        git -C "$LUCI_REPO" sparse-checkout set modules/luci-base/src
    fi
    LUCI_SRC="$LUCI_REPO/modules/luci-base/src"
    # Build lemon parser generator
    cc -std=gnu17 -o "$LUCI_SRC/contrib/lemon" "$LUCI_SRC/contrib/lemon.c" \
        || { echo "Failed to build lemon"; exit 1; }
    # Generate plural_formula.c from .y grammar
    (cd "$LUCI_SRC" && ./contrib/lemon -q lib/plural_formula.y) \
        || { echo "Failed to generate plural_formula.c"; exit 1; }
    # Build po2lmo
    cc -o "$PO2LMO" \
        "$LUCI_SRC/po2lmo.c" \
        "$LUCI_SRC/lib/lmo.c" \
        "$LUCI_SRC/lib/plural_formula.c" \
        -I"$LUCI_SRC" -I"$LUCI_SRC/lib" \
    || { echo "Failed to build po2lmo"; exit 1; }
    echo "po2lmo built."
fi

LMO_DIR="$BASE_DIR/.tools/lmo"
mkdir -p "$LMO_DIR"
LMO_DEPLOYED=0

for lang_dir in "$PO_DIR"/*/; do
    lang=$(basename "$lang_dir")
    [ "$lang" = "templates" ] && continue
    po_file="$lang_dir/iplimit.po"
    [ -f "$po_file" ] || continue

    # zh_Hans -> zh-cn, zh_Hant -> zh-tw, others: underscore to hyphen + lowercase
    case "$lang" in
        zh_Hans) lmo_lang="zh-cn" ;;
        zh_Hant) lmo_lang="zh-tw" ;;
        *)       lmo_lang=$(echo "$lang" | tr '_' '-' | tr 'A-Z' 'a-z') ;;
    esac

    lmo_file="$LMO_DIR/iplimit.${lmo_lang}.lmo"
    echo "Compiling $po_file -> iplimit.${lmo_lang}.lmo"
    "$PO2LMO" "$po_file" "$lmo_file" || { echo "Failed to compile $po_file"; continue; }
    scp "$lmo_file" root@$ROUTER_IP:/usr/lib/lua/luci/i18n/
    LMO_DEPLOYED=$((LMO_DEPLOYED + 1))
done

[ $LMO_DEPLOYED -gt 0 ] && echo "Deployed $LMO_DEPLOYED translation(s)."

# Clear LuCI cache and restart services
ssh root@$ROUTER_IP "rm -f /tmp/luci-indexcache* /tmp/luci-modulecache* && /etc/init.d/rpcd restart && /etc/init.d/iplimit enable && /etc/init.d/iplimit restart"

echo "Done! Open http://$ROUTER_IP -> Network -> IP Limit"
