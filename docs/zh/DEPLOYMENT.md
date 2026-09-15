# 部署指南

> 中文文档 | [English](../en/DEPLOYMENT.md)

## dsh 版本兼容性

**已实机验证：dsh `0.1.5-rc.2`（编写本文时最新版）。** 用 `dsh --version` 查看当前安装版本。

本插件依赖的扩展点在该版本线上均未变动，因此 0.1.5 线可直接使用：

| 依赖的官方扩展点 | 用途 |
|---|---|
| `webServer.tapIndex` | 注入 `randomUUID` polyfill 与 `basePath` 全局量（仅自包含全局量） |
| `dsh.bundle` patch | 把内部 webserver 钉在 `127.0.0.1:<N+1>`（安全根基，见 [SECURITY.md](SECURITY.md)） |
| `ctx.slots`（`settings.section`） | 客户端「认证设置」面板 |
| `credentials` 服务 + `client-connection/browser-session` record | 读取上游 BrowserAuth 密钥，为回环一跳铸造同构 cookie |
| BrowserAuth cookie 形状（`dsh-auth-<sha256(authority)>`、`v1.<payload>.<hmac>`） | 与 dsh 自身的 token 交换同构，上游无法区分 |

版本线行为：

- **dsh ≥ 0.1.2**：内部 webserver 启用 BrowserAuth，网关自动铸 cookie 适配（机制见 [SECURITY.md](SECURITY.md)）；
- **dsh ≤ 0.1.1**：无 BrowserAuth，record 不存在，网关静默退化为逐字转发，行为与旧版一致。

> **升级 dsh 后请注意**：dsh 的 **WebSocket 端点路径会随版本变化**——旧版是 `/api/events.mux`、`/sidebar/ws/*`，当前（0.1.5）只有 `/api/remote.mux`。网关按路径透明转发、**不硬编码任何端点名**，所以插件侧无需改动；但**反向代理若为 WebSocket 维护了路径白名单，dsh 一换路径就会静默失效**（症状：HTTP 正常、登录正常、页面提示连接失败）。反代请把 `Upgrade`/`Connection` 转发放在**兜底 location** 上，详见 [NGINX-DEPLOYMENT.md](NGINX-DEPLOYMENT.md) 与 [TROUBLESHOOTING.md](TROUBLESHOOTING.md) 第 7 节。

## 端口与监听地址

### 端口：直接用 `dsh web --port <N>`

bundle patch 跟随 `ctx.webStartup`（与 web-app 自身 webserver 行同一机制），端口由命令行 flag 控制：

```bash
dsh web --port 8080    # 对外 URL 8080，内部 webserver 自动挪到 8081
dsh web                # 默认：对外 3080，内部 3081
```

推导规则：**对外端口 = `--port`（默认 3080），内部端口 = 对外 + 1**。端口范围 1–65534（内部端口 +1 后仍须合法，否则配置校验在启动时报错）。

> 不支持 `--port 0`（OS 自动分配）：网关需要固定的内部端口才能转发。

### 为什么不能用 `--host 0.0.0.0`

`dsh web --host 0.0.0.0` 会被 dsh 直接拒绝（web-app 内置安全限制，`startup.ts` 硬编码）。这是 dsh 代码层限制，配置无法解除，**也不需要解除**：

- 内部 webserver 必须只监听 `127.0.0.1`（安全关键：内部端口一旦对外就绕过了认证网关）；
- 对外监听由插件的 `listenHost` 承担（默认 `0.0.0.0`），不经过 web-startup 的校验。

对外暴露的正确姿势：**不传 `--host`，使用默认**。

### 只允许本机访问

修改 `dsh-auth-gateway` 行的 `listenHost` 为 `127.0.0.1` 即可（仅本机可访问）。

### 固定端口（不使用 `--port`）

在 profile 自己的 `cordis.patch.yml` 中覆盖 `webserver` 与 `dsh-auth-gateway` 两行（用户补丁层优先级高于 bundle 层），注意 `webserver.port` 必须等于 `dsh-auth-gateway.config.upstreamPort`。手动覆盖后 `--port` flag 不再生效。

## 网络与安全建议

- **LAN 部署**：置于可信网络；网关默认监听所有网卡，跨网络暴露前务必配置防火墙；
- **HTTPS / Secure Cookie**：配置项 `cookieSecure`（默认 `auto`）控制会话 Cookie 的 `Secure` 属性——连接经 TLS 时自动附加（反向代理需透传 `X-Forwarded-Proto: https` 头），浏览器自此只经加密链路回传 Cookie；`true` 强制附加（反代已终结 TLS 但未透传协议头时使用）；`false` 显式关闭。**注意**：Secure 只在 HTTPS 链路生效——纯 HTTP 下强制开启会使浏览器拒绝保存 Cookie、登录立即失败（显式失败而非静默降级）。传输加密仍需自行部署：生产建议前置 TLS 反向代理（nginx/Caddy 等）到网关端口并配置 `trustedHosts`（见下）；内网直连、无公网证书时可自建内部 CA（如 mkcert）为网关签发证书并导入终端信任库，即可获得无警告的 HTTPS；
- **混合 HTTPS/HTTP 入口（双协议同域）**：会话 Cookie 带 `SameSite=Strict`，且 HTTPS 登录的 Cookie 带 `Secure`——浏览器因此不会在 `http://` 入口携带 HTTPS 入口的会话：`https://dsh.example.com` 登录后访问 `http://dsh.example.com:8080` 会需要重新登录。这是**预期行为**（加密入口的会话不降级到明文入口）；若确实需要多入口共享会话，请让所有入口统一走 HTTPS（同一反代上各端口都部署 TLS），而不是放宽 cookie 属性。注意：该场景下在明文入口**重新登录**也会失败（浏览器拒绝用明文来源覆盖 HTTPS 入口的 Secure Cookie）——网关登录页会在此场景给出明确提示（「登录未生效：浏览器未能保存会话 Cookie…」），而不是静默跳回登录页；解除方法是在 HTTPS 入口退出登录（或清除该站点 Cookie）后重试。
- **trustedHosts**：若经反向代理/自定义域名访问，需在 `dsh-client-connection` 行配置 `trustedHosts`（内部 fence 的授权权威；本插件转发已改写 Host/Origin 为回环，正常情况下无需配置，特殊拓扑下按 dsh 文档配置）；
- **备份**：凭据数据位于 `$DSH_HOME/auth-gateway/`（password.json、otp.json、otp-master.key），备份时注意加密（OTP 密钥已 AES-256-GCM 加密，但主密钥 `otp-master.key` 同样需保护，见 SECURITY.md）。
- **OTP 主密钥管理**：默认自动生成 `auth-gateway/otp-master.key`，密钥与密文同目录（本机可信模型）。要隔离磁盘泄露，部署前设置环境变量 `DSH_AUTH_GATEWAY_MASTER_KEY`（hex 或 base64 编码的 32 字节），并把它放到加密卷或外部密钥管理（KMS / Docker secret / systemd credentials 等）；设置了环境变量即不再生成/读取密钥文件。生成示例：`node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`。详见 [SECURITY.md](SECURITY.md) 的「OTP 密钥加密」。

## 配合 nginx / 反向代理部署

网关可直接对外提供服务，也可以放在 nginx（或其他反向代理）之后。完整拓扑与配置示例（裸金属直连、子域名部署、子路径部署、Docker nginx 容器）见：

- [NGINX-DEPLOYMENT.md](NGINX-DEPLOYMENT.md)（中文）｜ [English](../en/NGINX-DEPLOYMENT.md)

要点速览：

- **子域名部署（推荐）**：`dsh.example.com` 根路径部署，nginx 将 443 反代到网关端口，零冲突、零维护；
- **子路径部署**：网关配置 `basePath: /dsh`（在部署方 profile patch 中覆盖，注意 `config:` 是整对象替换，须保留 bundle patch 全部字段），nginx 需额外转发 dsh 引用的根路径资源（`/assets/`、`/api/`、`/plugins/` 等）；
- **反代转发 WebSocket**：`Upgrade` / `Connection` 必须转发，且**要放在兜底 location 上**——用 `map $http_upgrade $connection_upgrade`（放在 `http {}` 作用域）配合 `proxy_set_header`，不要写死 `"upgrade"`、也不要按路径挑白名单。dsh 的 WebSocket 路径随版本变过（旧版 `/api/events.mux`、当前 `/api/remote.mux`），白名单一旦漂移就是「HTTP 正常、登录正常、只有页面提示连接失败」的静默故障；同时调大 `proxy_read_timeout` / `proxy_send_timeout`，否则 SSE 事件流 60s 被掐断。完整配置见 [NGINX-DEPLOYMENT.md](NGINX-DEPLOYMENT.md)，判定方法见 [TROUBLESHOOTING.md](TROUBLESHOOTING.md) 第 7 节。

## 故障排查

| 现象 | 原因与处理 |
|---|---|
| 页面显示"加载提供方目录失败: crypto.randomUUID is not a function" | 非安全上下文（HTTP + 非 localhost）下浏览器 Web Crypto 限制；插件已注入 polyfill——确认安装的是最新版本且已重启 dsh web |
| 登录后大量 `/api/*` 403 | 内部 fence 拒绝外部 Host——确认 bundle patch 生效（webserver 应为 `127.0.0.1:<内部端口>`），网关已改写 Host/Origin |
| 无法访问 `http://<LAN IP>:<port>` | 检查网关是否监听 `0.0.0.0`（`listenHost` 配置）、防火墙规则 |
| 登录被 429 拒绝 | 触发全局速率限制或 OTP 限流——等待窗口重置（1 分钟/锁定 5 分钟） |
| 登录成功但页面提示连接失败，console 报 `WebSocket connection to '.../api/remote.mux' failed` | 反代没有把 `Upgrade`/`Connection` 转发给该路径（常见于按路径写 WS 白名单、兜底 location 没带这两个头）——见 [TROUBLESHOOTING.md](TROUBLESHOOTING.md) 第 7 节；网关日志会有一条 `WebSocket 握手缺少 Upgrade 头` 告警 |
| `--port 65535` 启动失败 | 内部端口 65536 非法——端口范围 1–65534 |
| 重复安装（组合树出现两行 dsh-auth-gateway） | 第二个网关绑定同端口必然 EADDRINUSE 启动失败——删除重复行 |

## 凭据重置与卸载命令

插件包自带两个命令（`package.json` 的 `bin`）：`dsh-auth-gateway-reset`（仅删除密码记录）与 `dsh-auth-gateway-uninstall`（删除整个 `$DSH_HOME/auth-gateway/`）。`dsh plugin add` 通过 pnpm 把命令链接到 profile 的 `node_modules/.bin`——**该目录默认不在 PATH 上**，直接敲短名会提示 command not found。两种运行方式：

```bash
# 方式一：完整路径（把 profile 名换成你实际使用的）
~/.dsh/profiles/web/node_modules/.bin/dsh-auth-gateway-reset

# 方式二：把 profile bin 加入 PATH（写入 ~/.zshrc / ~/.bashrc 后重开终端）
export PATH="$HOME/.dsh/profiles/web/node_modules/.bin:$PATH"
dsh-auth-gateway-reset
```

> **`$DSH_HOME` 在哪**：凭据数据在 `$DSH_HOME/auth-gateway/`（password.json、otp.json、otp-master.key）。`$DSH_HOME` 默认取 `~/.dsh`（即 `$HOME/.dsh`），可用环境变量覆盖——dsh 与插件读取同一值。

`dsh-auth-gateway-reset` 删除密码记录后，**必须重启 dsh web**：初始密码在启动时生成并打印到控制台（插件没有"设置密码"页面），登录后走引导流程设置个人密码。丢失认证器时还需删除 `$DSH_HOME/auth-gateway/otp.json`（或直接运行 `dsh-auth-gateway-uninstall`）。

> **顺序提醒**：如需同时卸载插件，**先运行上面的凭据命令，再执行 `dsh plugin --profile web remove dsh-auth-gateway`**——remove 会移除 profile 里的插件依赖，两个命令的 bin 链接随之失效（悬空指向已删除的目标）。

## 升级

`dsh plugin --profile web add file:...` 后需 **remove + add** 刷新 pnpm 快照（`file:` 依赖是安装时快照），再重启 dsh web。插件自带 `dsh-auth-gateway-reset`/`dsh-auth-gateway-uninstall` 命令（升级无需运行）。
