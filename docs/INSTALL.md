# 安装、更新与卸载

本指南覆盖 `dsh-auth-gateway` 的完整生命周期操作：安装、验证、更新、卸载与凭据重置。面向 dsh Web profile 部署场景；其他 profile（如 `dsh`）把命令中的 `web` 替换为对应 profile 名即可。

> 前置条件：已安装 [dsh](https://github.com/deepseek-ai/deepseek-harness) CLI，且 `dsh` 在 PATH 上。

---

## 1. 安装

### 1.1 从 npm registry 安装（推荐）

```bash
dsh plugin --profile web add dsh-auth-gateway
```

### 1.2 从 GitHub 仓库安装

```bash
# 默认分支
dsh plugin --profile web add github:xbzbing/dsh-auth-gateway

# 指定版本 / 分支 / 提交
dsh plugin --profile web add github:xbzbing/dsh-auth-gateway#v0.4.2
dsh plugin --profile web add github:xbzbing/dsh-auth-gateway#main
```

### 1.3 从本地开发目录安装

```bash
dsh plugin --profile web add file:/path/to/dsh-auth-gateway
```

> **注意**：`file:` 依赖是**安装时快照**——之后修改本地源码不会自动生效，需要 remove + add 刷新（见第 3 节）。

### 1.4 验证安装

```bash
# 1) 确认组合树中出现 dsh-auth-gateway，且 webserver 被钉在回环地址
dsh web --dump-config | grep -E "dsh-auth-gateway|127.0.0.1"

# 2) 启动
dsh web --port 8080
```

首次启动时控制台会打印**初始密码**（醒目提示块，中英对照）。浏览器访问 `http://<host>:8080`，用初始密码登录后进入引导页设置个人密码。

端口推导：对外端口 = `--port`（默认 3080），内部 webserver = 对外 + 1（如 8080 → 8081）。不支持 `--port 0`。

---

## 2. 凭据管理命令

插件包自带两个命令（链接在 profile 的 `node_modules/.bin`，默认不在 PATH 上）：

| 命令 | 作用 | 影响范围 |
|---|---|---|
| `dsh-auth-gateway-reset` | 重置密码记录 | 删除 `$DSH_HOME/auth-gate/password.json`，重启后打印新初始密码 |
| `dsh-auth-gateway-uninstall` | 彻底清理全部凭据 | 删除整个 `$DSH_HOME/auth-gate/`（密码 + OTP 密钥 + 备份码） |

运行方式（二选一）：

```bash
# 方式一：完整路径（把 profile 名换成实际使用的）
~/.dsh/profiles/web/node_modules/.bin/dsh-auth-gateway-reset
~/.dsh/profiles/web/node_modules/.bin/dsh-auth-gateway-uninstall

# 方式二：把 profile bin 加入 PATH（写入 ~/.zshrc / ~/.bashrc 后重开终端）
export PATH="$HOME/.dsh/profiles/web/node_modules/.bin:$PATH"
dsh-auth-gateway-reset
```

**忘记密码场景**：

```bash
dsh-auth-gateway-reset     # 1. 删除密码记录
# 重启 dsh web             # 2. 重启后控制台打印新初始密码
# 用初始密码登录            # 3. 走引导流程设置个人密码
```

**丢失认证器（OTP）场景**：OTP 与密码是分开存储的。若只丢认证器、记得密码：

```bash
# 删除 OTP 记录（含备份码），密码保留
rm ~/.dsh/auth-gate/otp.json
# 重启 dsh web 后重新绑定 OTP
```

`$DSH_HOME` 默认取 `~/.dsh`（即 `$HOME/.dsh`），可用环境变量覆盖——dsh 与插件读取同一值。

---

## 3. 更新

```bash
# 方式一：registry / GitHub 安装
dsh plugin --profile web update dsh-auth-gateway

# 方式二：本地目录安装（file: 快照必须 remove + add 刷新）
dsh plugin --profile web remove dsh-auth-gateway
dsh plugin --profile web add file:/path/to/dsh-auth-gateway
```

更新后**重启 dsh web** 生效：

```bash
# 找到 dsh web 进程并重启（若在 tmux / systemd 中则从对应会话重启）
kill $(pgrep -f 'dsh web')
dsh web --port 8080
```

> 升级不需要运行凭据命令——密码与 OTP 凭据存储与插件代码分离，升级不会影响。
>
> **部署层配置不随升级丢失**：`basePath` 等部署相关配置写在**部署方自己的 profile patch**（`~/.dsh/profiles/web/cordis.patch.yml`），不属于插件 bundle，升级/重装插件不会覆盖。插件默认 `basePath: /`（根路径）。
>
> **⚠️ `config:` 是整个对象替换**：Cordis profile patch 里 `config: { basePath: /dsh }` 会将 bundle patch 里通过 `!!js` 动态计算的 `listenPort`、`upstreamPort` **一并丢弃**，导致 `--port 8080` 失效（端口变成 config.js 默认值 3080）。正确做法是保留 bundle patch 里的所有字段，只追加 `basePath`。详见 [NGINX-DEPLOYMENT.md](NGINX-DEPLOYMENT.md) 拓扑 C 示例。

---

## 4. 卸载

**顺序很关键**：先清理凭据，再移除插件。`dsh plugin remove` 会移除 profile 里的插件依赖，`dsh-auth-gateway-reset`/`dsh-auth-gateway-uninstall` 的 bin 链接随之失效（变成悬空引用），届时命令不可再用。

```bash
# 1. 清理凭据（二选一）
~/.dsh/profiles/web/node_modules/.bin/dsh-auth-gateway-uninstall   # 全部凭据（密码 + OTP）
# 或
~/.dsh/profiles/web/node_modules/.bin/dsh-auth-gateway-reset       # 仅密码（保留 OTP）

# 2. 移除插件
dsh plugin --profile web remove dsh-auth-gateway

# 3. 重启 dsh web 使组合生效
```

---

## 5. 故障排查

| 现象 | 原因与处理 |
|---|---|
| 首次启动看不到初始密码 | 说明凭据已存在（`$DSH_HOME/auth-gate/password.json`）——非首次部署。用已有密码登录，或 `reset` 后重启 |
| 安装后启动失败（EADDRINUSE） | 组合树中出现重复的 dsh-auth-gateway 行（重复安装导致）——删除重复行后重启 |
| `file:` 安装改了代码不生效 | 快照未刷新——remove + add 重新安装 |
| 登录被 429 拒绝 | 触发全局速率限制或 OTP 限流——等待窗口重置（1 分钟 / 锁定 5 分钟） |
| `dsh-auth-gateway-reset` 提示 command not found | profile bin 不在 PATH——用完整路径或先 `export PATH=...` |
| 卸载后凭据仍残留 | 没有先运行凭据命令就 remove 了——手动删除 `$DSH_HOME/auth-gate/` 目录 |

---

## 6. 相关文档

- [README.md](../README.md) — 功能特性、配置表、快速开始
- [NGINX-DEPLOYMENT.md](NGINX-DEPLOYMENT.md) — 反向代理部署拓扑与 nginx 配置示例
- [DEPLOYMENT.md](DEPLOYMENT.md) — 端口与监听、LAN 部署、HTTPS 建议
- [SECURITY.md](SECURITY.md) — 威胁模型、OTP 密钥加密、恢复路径
