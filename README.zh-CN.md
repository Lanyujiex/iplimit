# luci-app-iplimit

[English](README.md) | 中文

基于 tc HTB + ifb 的 OpenWrt 单 IP 带宽控制，带 LuCI Web 管理界面。

适用于单 `br-lan` 接口的旁路由场景。

## 功能

- 单 IP 上传/下载带宽控制
- 每个方向两种模式：**限制**（硬上限）/ **保障**（保底带宽，空闲时可突发到总带宽）
- LuCI Web 界面：设置页支持行内编辑，状态页实时显示 tc 统计
- 保存后自动重启服务
- 适配暗黑模式（argon 主题）

## 截图

### 设置页
管理主机规则，配置单 IP 带宽和模式。

### 状态页
实时 tc class 统计，服务控制，可折叠的原始配置视图。

## 快速部署（无需 SDK）

```bash
# 通过 SSH 部署到路由器（默认 IP: 10.168.1.22）
./deploy.sh 10.168.1.22
```

前置依赖：路由器上需安装 `kmod-ifb` 和 `tc-full`。

```bash
apk add kmod-ifb tc-full
```

## 通过 GitHub Actions 编译 APK

推送 tag 即可自动编译并发布 Release：

```bash
git tag v1.0-1
git push origin v1.0-1
```

Actions 会自动下载 OpenWrt SDK、编译 APK 并创建 GitHub Release。

## 手动编译 APK

需要 OpenWrt SDK（Linux x86-64），macOS 可用 Docker。

### 1. 下载 SDK

```bash
# 示例：OpenWrt 25.12.2 x86-64，请根据路由器版本调整
SDK_URL="https://downloads.openwrt.org/releases/25.12.2/targets/x86/64/openwrt-sdk-25.12.2-x86-64_gcc-*.Linux-x86_64.tar.zst"
wget "$SDK_URL"
tar --zstd -xf openwrt-sdk-*.tar.zst
cd openwrt-sdk-*
```

### 2. 添加包源码

```bash
cp -r /path/to/luci-app-iplimit package/
```

### 3. 更新 feeds

```bash
./scripts/feeds update luci
./scripts/feeds install luci-base
```

### 4. 编译

```bash
echo "CONFIG_PACKAGE_luci-app-iplimit=y" >> .config
make defconfig
make package/luci-app-iplimit/compile V=s
```

### 5. 查找产物

```bash
find bin/ -name "*iplimit*"
```

### 6. 安装到路由器

```bash
scp bin/packages/*/*.apk root@10.168.1.22:/tmp/
ssh root@10.168.1.22 "apk add --allow-untrusted /tmp/luci-app-iplimit*.apk /tmp/luci-i18n-iplimit*.apk"
```

## 配置

编辑 `/etc/config/iplimit.conf` 或通过 LuCI Web 界面（网络 -> IP 限速）。

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

### 模式说明

| 模式 | tc rate | tc ceil | 效果 |
|------|---------|---------|------|
| `ceil`（限制） | 设定值 | 设定值 | 硬上限，不可超过 |
| `rate`（保障） | 设定值 | 总带宽 | 保底最低带宽，空闲时可突发 |

上传和下载模式相互独立。示例：保障 10M 下载，限制 3M 上传：

```
option download '10mbit'
option download_mode 'rate'
option upload '3mbit'
option upload_mode 'ceil'
```

## 命令行

```bash
/etc/init.d/iplimit start       # 启动
/etc/init.d/iplimit stop        # 停止
/etc/init.d/iplimit restart     # 重启（修改配置后）
/etc/init.d/iplimit status      # 查看规则和统计
```

### UCI 命令

```bash
# 查看当前配置
uci show iplimit

# 修改全局设置
uci set iplimit.globals.enabled='1'
uci set iplimit.globals.iface='br-lan'
uci set iplimit.globals.total_bandwidth='1000mbit'

# 修改已有主机
uci set iplimit.pc1.download='30mbit'
uci set iplimit.pc1.download_mode='ceil'
uci set iplimit.pc1.upload='5mbit'
uci set iplimit.pc1.upload_mode='rate'

# 添加新主机
uci add iplimit host
uci set iplimit.@host[-1].name='PC-2'
uci set iplimit.@host[-1].ip='192.168.1.101'
uci set iplimit.@host[-1].download='50mbit'
uci set iplimit.@host[-1].download_mode='ceil'
uci set iplimit.@host[-1].upload='10mbit'
uci set iplimit.@host[-1].upload_mode='ceil'
uci set iplimit.@host[-1].enabled='1'

# 删除主机
uci delete iplimit.pc1

# 应用变更
uci commit iplimit
/etc/init.d/iplimit restart
```

## 项目结构

```
├── deploy.sh                          # 快速部署脚本
├── DESIGN.md                          # 技术设计文档（英文）
├── DESIGN.zh-CN.md                    # 技术设计文档（中文）
├── .github/workflows/build.yml        # GitHub Actions 编译发布
├── luci-app-iplimit/
│   ├── Makefile                       # OpenWrt SDK 编译文件
│   ├── htdocs/luci-static/resources/view/iplimit/
│   │   ├── settings.js                # LuCI 设置页
│   │   └── status.js                  # LuCI 状态页
│   ├── po/
│   │   ├── templates/iplimit.pot      # 翻译模板
│   │   └── zh_Hans/iplimit.po         # 简体中文翻译
│   └── root/
│       ├── etc/config/iplimit.conf    # 默认 UCI 配置
│       ├── etc/init.d/iplimit         # Init 脚本（tc HTB + ifb）
│       └── usr/share/
│           ├── luci/menu.d/luci-app-iplimit.json   # 菜单入口
│           └── rpcd/acl.d/luci-app-iplimit.json    # ACL 权限
```

## 依赖

- `kmod-ifb` — IFB 内核模块，用于入站流量整形
- `tc-full` — tc 命令，用于流量控制

## 许可证

GPL-3.0-or-later
