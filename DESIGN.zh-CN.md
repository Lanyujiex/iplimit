# 技术设计：单 IP 带宽控制

## 整体架构

```
                    ┌─────────────────────────────────────┐
                    │         OpenWrt 旁路由               │
                    │          接口: br-lan                │
                    └─────┬──────────────────────┬────────┘
                          │                      │
                     egress (出)            ingress (入)
                          │                      │
                       下载方向                上传方向
                          │                      │
                   tc HTB on br-lan     tc 无法对 ingress 整形
                          │                      │
                          │             mirred 重定向到 ifb0
                          │                      │
                          │             tc HTB on ifb0 egress
```

Linux `tc`（流量控制）只能对接口的 **egress（出站）** 流量做队列调度。对于 `br-lan`：

| 方向 | 对 br-lan 而言 | tc 能否直接限速 | 解决方案 |
|------|---------------|----------------|---------|
| 下载（互联网 → 客户端）| egress | 能 | 直接在 br-lan 上加 HTB |
| 上传（客户端 → 互联网）| ingress | 不能 | 通过 ifb0 中转 |

**ifb0**（Intermediate Functional Block）是虚拟网络设备。将 br-lan 的 ingress 流量重定向到 ifb0 的 egress，即可用 HTB 对上传流量进行限速。需要 `kmod-ifb` 内核模块。

## tc 规则树

### 下载方向（br-lan egress）

```
root qdisc (handle 1:) HTB, default → 1:9999
  └─ 1:1   根类         rate=总带宽
       ├─ 1:9999  默认类   rate=剩余带宽   ceil=总带宽     ← 未匹配的流量
       ├─ 1:10    主机-1   rate=20mbit    ceil=...       ← filter: 目的 IP
       ├─ 1:11    主机-2   rate=30mbit    ceil=...       ← filter: 目的 IP
       └─ ...
```

### 上传方向（ifb0 egress）

```
root qdisc (handle 2:) HTB, default → 2:9999
  └─ 2:1   根类         rate=总带宽
       ├─ 2:9999  默认类   rate=剩余带宽   ceil=总带宽     ← 未匹配的流量
       ├─ 2:10    主机-1   rate=5mbit     ceil=...       ← filter: 源 IP
       ├─ 2:11    主机-2   rate=8mbit     ceil=...       ← filter: 源 IP
       └─ ...
```

### 流量匹配

```bash
# 下载：匹配目的 IP（路由器 → 客户端）
tc filter ... u32 match ip dst 192.168.1.100/32 flowid 1:10

# 上传：匹配源 IP（客户端 → 路由器，经 ifb0 转发）
tc filter ... u32 match ip src 192.168.1.100/32 flowid 2:10
```

### 子队列：fq_codel

每个 IP 的 HTB class 下挂 **fq_codel**（公平队列 + 受控延迟）子队列：

```bash
tc qdisc add ... parent 1:10 handle 100: fq_codel
```

- 公平调度同一 IP 的多个连接
- 减少缓冲膨胀（bufferbloat），在负载下保持低延迟

## 两种限速模式

### 限制模式（`ceil`）

硬上限。无论网络多空闲，流量都不会超过设定值。

```bash
tc class ... rate 20mbit ceil 20mbit
```

- `rate` = `ceil` = 设定值
- 适用场景：严格限制每台主机的带宽

### 保障模式（`rate`）

保底最低带宽，空闲时可突发到总带宽。

```bash
tc class ... rate 10mbit ceil 1000mbit
```

- `rate` = 设定值（保障最低带宽）
- `ceil` = 总带宽（空闲时可突发到满速）
- HTB 优先满足每个类的 `rate`，剩余带宽按比例分配

上传和下载模式相互独立，可分别设置。

## 默认类的带宽计算

```
默认类带宽 = 总带宽 - 所有保障模式的保障带宽之和
```

只有保障模式会占用保障带宽（其 `rate` 是保底值）。限制模式不占用（其 `rate = ceil`，不参与借用机制）。

如果剩余带宽降为零或负数，强制设为 1000kbit 保底。

## 服务启动流程

```
1. 从 /etc/config/iplimit 加载 UCI 配置
2. 第一轮遍历：累加所有保障模式的保障带宽 → 计算默认类剩余带宽
3. 加载 ifb 内核模块，创建并启用 ifb0
4. 清除 br-lan 和 ifb0 上的旧 tc 规则
5. 下载方向（br-lan）：创建 root qdisc → 根类 → 默认类
6. 上传方向：在 br-lan 创建 ingress qdisc → mirred 重定向到 ifb0 →
   在 ifb0 创建 root qdisc → 根类 → 默认类
7. 第二轮遍历：为每台启用的主机添加 HTB class + fq_codel + u32 filter
```

## 配置示例

```
总带宽 = 1000mbit

主机-1: 下载 保障 10mbit, 上传 限制 3mbit
主机-2: 下载 限制 20mbit, 上传 保障 5mbit
```

实际效果：

| 主机 | 下载 | 上传 |
|------|------|------|
| 主机-1 | 保底 10mbit，空闲时可跑满 1000mbit | 硬限 3mbit |
| 主机-2 | 硬限 20mbit | 保底 5mbit，空闲时可跑满 1000mbit |
| 默认（其他） | 共享 990mbit（1000-10），可突发到 1000mbit | 共享 995mbit（1000-5），可突发到 1000mbit |

## 关键文件

| 文件 | 作用 |
|------|------|
| `/etc/init.d/iplimit` | 服务脚本：从 UCI 配置生成 tc 规则 |
| `/etc/config/iplimit` | UCI 配置：全局设置 + 主机规则 |
| `settings.js` | LuCI 设置页：编辑主机和带宽 |
| `status.js` | LuCI 状态页：实时 tc class 统计 |

## 依赖

- **kmod-ifb** — IFB 内核模块，用于入站流量重定向
- **tc-full** — `tc` 命令，支持 HTB、u32、fq_codel、mirred
