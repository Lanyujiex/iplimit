# luci-app-iplimit

English | [中文](README.zh-CN.md)

OpenWrt per-IP bandwidth control with LuCI web interface, based on tc HTB + ifb.

Designed for side routers with a single `br-lan` interface.

## Features

- Per-IP upload/download bandwidth control
- Two modes per direction: **Limit** (hard cap) / **Guard** (guaranteed bandwidth, burst to total)
- LuCI web UI: settings page with inline editing, real-time status with parsed tc stats
- Auto-restart service on save
- Dark mode compatible (argon theme)

## Screenshots

### Settings
Manage host rules with per-IP bandwidth and mode configuration.

### Status
Real-time tc class statistics, service control, collapsible raw config view.

## Quick Deploy (without SDK)

```bash
# Deploy to router via SSH (default IP: 10.168.1.22)
./deploy.sh 10.168.1.22
```

Requires: `kmod-ifb`, `tc-full` installed on the router.

```bash
apk add kmod-ifb tc-full
```

## Build APK Package

Requires OpenWrt SDK (Linux x86-64). Use Docker on macOS.

### 1. Download SDK

```bash
# Example for OpenWrt 23.05 x86-64, adjust version to match your router
SDK_URL="https://downloads.openwrt.org/releases/23.05.5/targets/x86/64/openwrt-sdk-23.05.5-x86-64_gcc-12.3.0_musl.Linux-x86_64.tar.xz"
wget "$SDK_URL"
tar xf openwrt-sdk-*.tar.xz
cd openwrt-sdk-*
```

### 2. Add package source

```bash
# Copy luci-app-iplimit into SDK package directory
cp -r /path/to/luci-app-iplimit package/
```

### 3. Update feeds

```bash
./scripts/feeds update -a
./scripts/feeds install -a
```

### 4. Build

```bash
make package/luci-app-iplimit/compile V=s
```

### 5. Find output

```bash
find bin/ -name "luci-app-iplimit*"
```

### 6. Install on router

```bash
# Copy to router and install
scp bin/packages/*/base/luci-app-iplimit*.apk root@10.168.1.22:/tmp/
ssh root@10.168.1.22 "apk add --allow-untrusted /tmp/luci-app-iplimit*.apk"
```

## Configuration

Edit `/etc/config/iplimit.conf` or use LuCI web UI (Network -> IP Limit).

```
config globals 'globals'
    option iface 'br-lan'
    option enabled '1'
    option total_bandwidth '1000mbit'

config host 'pc1'
    option name 'PC-1'
    option ip '192.168.1.100'
    option download '20mbit'
    option download_mode 'ceil'
    option upload '5mbit'
    option upload_mode 'ceil'
    option enabled '1'
```

### Mode Reference

| Mode | tc rate | tc ceil | Effect |
|------|---------|---------|--------|
| `ceil` (Limit) | value | value | Hard cap, cannot exceed |
| `rate` (Guard) | value | total_bandwidth | Guaranteed minimum, can burst when idle |

Upload and download modes are independent. Example: guaranteed 10M download, hard limit 3M upload:

```
option download '10mbit'
option download_mode 'rate'
option upload '3mbit'
option upload_mode 'ceil'
```

## CLI Usage

```bash
/etc/init.d/iplimit start       # Start
/etc/init.d/iplimit stop        # Stop
/etc/init.d/iplimit restart     # Restart (after config change)
/etc/init.d/iplimit status      # Show rules and statistics
```

### UCI Commands

```bash
# View current config
uci show iplimit

# Modify global settings
uci set iplimit.globals.enabled='1'
uci set iplimit.globals.iface='br-lan'
uci set iplimit.globals.total_bandwidth='1000mbit'

# Modify existing host
uci set iplimit.pc1.download='30mbit'
uci set iplimit.pc1.download_mode='ceil'
uci set iplimit.pc1.upload='5mbit'
uci set iplimit.pc1.upload_mode='rate'

# Add new host
uci add iplimit host
uci set iplimit.@host[-1].name='PC-2'
uci set iplimit.@host[-1].ip='192.168.1.101'
uci set iplimit.@host[-1].download='50mbit'
uci set iplimit.@host[-1].download_mode='ceil'
uci set iplimit.@host[-1].upload='10mbit'
uci set iplimit.@host[-1].upload_mode='ceil'
uci set iplimit.@host[-1].enabled='1'

# Delete host
uci delete iplimit.pc1

# Apply changes
uci commit iplimit
/etc/init.d/iplimit restart
```

## Project Structure

```
├── deploy.sh                          # Quick deploy script
├── luci-app-iplimit/
│   ├── Makefile                       # OpenWrt SDK build file
│   ├── htdocs/luci-static/resources/view/iplimit/
│   │   ├── settings.js                # LuCI settings page
│   │   └── status.js                  # LuCI status page
│   ├── po/
│   │   ├── templates/iplimit.pot      # Translation template
│   │   └── zh_Hans/iplimit.po         # Simplified Chinese
│   └── root/
│       ├── etc/config/iplimit.conf    # Default UCI config
│       ├── etc/init.d/iplimit         # Init script (tc HTB + ifb)
│       └── usr/share/
│           ├── luci/menu.d/luci-app-iplimit.json   # Menu entry
│           └── rpcd/acl.d/luci-app-iplimit.json    # ACL permissions
```

## HTTP API

OpenWrt natively exposes UCI and file operations via ubus JSON-RPC (`POST /ubus`). No additional service needed.

### Authentication

```bash
# Login to get session token
curl -s -d '{
  "jsonrpc": "2.0", "id": 1, "method": "call",
  "params": ["00000000000000000000000000000000", "session", "login",
    {"username": "root", "password": "YOUR_PASSWORD"}]
}' http://ROUTER_IP/ubus

# Response: {"jsonrpc":"2.0","id":1,"result":[0,{"ubus_rpc_session":"TOKEN",...}]}
```

### Read Config

```bash
# Get all iplimit config
curl -s -d '{
  "jsonrpc": "2.0", "id": 1, "method": "call",
  "params": ["'$TOKEN'", "uci", "get", {"config": "iplimit"}]
}' http://ROUTER_IP/ubus

# Get single section
curl -s -d '{
  "jsonrpc": "2.0", "id": 1, "method": "call",
  "params": ["'$TOKEN'", "uci", "get", {"config": "iplimit", "section": "pc1"}]
}' http://ROUTER_IP/ubus
```

### Modify Config

```bash
# Update host
curl -s -d '{
  "jsonrpc": "2.0", "id": 1, "method": "call",
  "params": ["'$TOKEN'", "uci", "set", {"config": "iplimit", "section": "pc1",
    "values": {"download": "30mbit", "upload": "10mbit"}}]
}' http://ROUTER_IP/ubus

# Add host
curl -s -d '{
  "jsonrpc": "2.0", "id": 1, "method": "call",
  "params": ["'$TOKEN'", "uci", "add", {"config": "iplimit", "type": "host",
    "values": {"name": "PC-3", "ip": "192.168.1.103",
      "download": "50mbit", "download_mode": "ceil",
      "upload": "10mbit", "upload_mode": "ceil", "enabled": "1"}}]
}' http://ROUTER_IP/ubus

# Delete host
curl -s -d '{
  "jsonrpc": "2.0", "id": 1, "method": "call",
  "params": ["'$TOKEN'", "uci", "delete", {"config": "iplimit", "section": "pc1"}]
}' http://ROUTER_IP/ubus

# Commit changes
curl -s -d '{
  "jsonrpc": "2.0", "id": 1, "method": "call",
  "params": ["'$TOKEN'", "uci", "commit", {"config": "iplimit"}]
}' http://ROUTER_IP/ubus
```

### Restart Service

```bash
curl -s -d '{
  "jsonrpc": "2.0", "id": 1, "method": "call",
  "params": ["'$TOKEN'", "file", "exec",
    {"command": "/etc/init.d/iplimit", "params": ["restart"]}]
}' http://ROUTER_IP/ubus
```

## Dependencies

- `kmod-ifb` - IFB kernel module for ingress traffic shaping
- `tc-full` - tc command for traffic control

## License

GPL-3.0-or-later
