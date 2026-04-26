# Technical Design: Per-IP Bandwidth Control

## Architecture Overview

```
                    ┌─────────────────────────────────────┐
                    │         OpenWrt Side Router          │
                    │           Interface: br-lan          │
                    └─────┬──────────────────────┬────────┘
                          │                      │
                     egress (out)           ingress (in)
                          │                      │
                     Download                 Upload
                          │                      │
                   tc HTB on br-lan    tc cannot shape ingress
                          │                      │
                          │             mirred redirect to ifb0
                          │                      │
                          │             tc HTB on ifb0 egress
```

Linux `tc` (traffic control) can only apply queuing disciplines to **egress** (outbound) traffic. For `br-lan`:

| Direction | br-lan perspective | tc direct shaping? | Solution |
|-----------|-------------------|-------------------|----------|
| Download (internet → client) | egress | Yes | HTB directly on br-lan |
| Upload (client → internet) | ingress | No | Redirect via ifb0 |

**ifb0** (Intermediate Functional Block) is a virtual network device. By redirecting br-lan ingress traffic to ifb0's egress, HTB shaping becomes possible for upload traffic. This requires the `kmod-ifb` kernel module.

## tc Rule Tree

### Download (br-lan egress)

```
root qdisc (handle 1:) HTB, default → 1:9999
  └─ 1:1   Root class   rate=total_bandwidth
       ├─ 1:9999  Default    rate=remaining   ceil=total     ← unmatched traffic
       ├─ 1:10    Host-1     rate=20mbit      ceil=...       ← filter: dst ip
       ├─ 1:11    Host-2     rate=30mbit      ceil=...       ← filter: dst ip
       └─ ...
```

### Upload (ifb0 egress)

```
root qdisc (handle 2:) HTB, default → 2:9999
  └─ 2:1   Root class   rate=total_bandwidth
       ├─ 2:9999  Default    rate=remaining   ceil=total     ← unmatched traffic
       ├─ 2:10    Host-1     rate=5mbit       ceil=...       ← filter: src ip
       ├─ 2:11    Host-2     rate=8mbit       ceil=...       ← filter: src ip
       └─ ...
```

### Traffic Matching

```bash
# Download: match destination IP (router → client)
tc filter ... u32 match ip dst 192.168.1.100/32 flowid 1:10

# Upload: match source IP (client → router, via ifb0)
tc filter ... u32 match ip src 192.168.1.100/32 flowid 2:10
```

### Sub-qdisc: fq_codel

Each per-IP HTB class has an **fq_codel** (Fair Queuing + Controlled Delay) child qdisc:

```bash
tc qdisc add ... parent 1:10 handle 100: fq_codel
```

- Fair scheduling across multiple connections from the same IP
- Reduces bufferbloat, keeps latency low under load

## Two Shaping Modes

### Limit Mode (`ceil`)

Hard cap. Traffic cannot exceed the configured value regardless of available bandwidth.

```bash
tc class ... rate 20mbit ceil 20mbit
```

- `rate` = `ceil` = configured value
- Use case: strict bandwidth cap per host

### Guard Mode (`rate`)

Guaranteed minimum bandwidth with burst capability when the link is idle.

```bash
tc class ... rate 10mbit ceil 1000mbit
```

- `rate` = configured value (guaranteed minimum)
- `ceil` = total bandwidth (can burst up to full link speed)
- HTB satisfies each class's `rate` first, then distributes remaining bandwidth proportionally

Upload and download modes are independent per host.

## Default Class Bandwidth

```
default_bandwidth = total_bandwidth - sum(all Guard mode rates)
```

Only Guard mode reserves bandwidth (its `rate` is a guarantee). Limit mode does not reserve (its `rate = ceil`, so it doesn't participate in the borrowing mechanism).

If the remaining bandwidth drops to zero or below, a floor of 1000kbit is applied.

## Service Startup Flow

```
1. Load UCI config from /etc/config/iplimit
2. Pass 1: Sum all Guard mode rates → calculate default class remaining bandwidth
3. Load ifb kernel module, create and bring up ifb0
4. Clear any existing tc rules on br-lan and ifb0
5. Download (br-lan): create root qdisc → root class → default class
6. Upload: create ingress qdisc on br-lan → mirred redirect to ifb0 →
   create root qdisc → root class → default class on ifb0
7. Pass 2: For each enabled host, add HTB class + fq_codel + u32 filter
```

## Configuration Example

```
total_bandwidth = 1000mbit

Host-1: download Guard 10mbit, upload Limit 3mbit
Host-2: download Limit 20mbit, upload Guard 5mbit
```

Effective behavior:

| Host | Download | Upload |
|------|----------|--------|
| Host-1 | Guaranteed 10mbit, burst up to 1000mbit when idle | Hard cap 3mbit |
| Host-2 | Hard cap 20mbit | Guaranteed 5mbit, burst up to 1000mbit when idle |
| Default (others) | Share 990mbit (1000-10), burst to 1000mbit | Share 995mbit (1000-5), burst to 1000mbit |

## Key Components

| File | Role |
|------|------|
| `/etc/init.d/iplimit` | Service script: builds tc rules from UCI config |
| `/etc/config/iplimit` | UCI config: global settings + per-host rules |
| `settings.js` | LuCI settings page: edit hosts and bandwidth |
| `status.js` | LuCI status page: real-time tc class statistics |

## Dependencies

- **kmod-ifb** — IFB kernel module for ingress traffic redirection
- **tc-full** — `tc` command with HTB, u32, fq_codel, mirred support
