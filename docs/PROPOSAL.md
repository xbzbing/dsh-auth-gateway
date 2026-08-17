# dsh-auth-gateway 方案报告（技术可行性分析）

> 版本：v1（调研基准：deepseek-harness 源码 2026-08 快照，`packages/` 目录）
> 目标：为 dsh Web 提供"打开即登录"的最小可安装 MVP 插件。

---

## 1. 背景与目标

`dsh web` 目前**没有任何认证层**，这是多个核心包的刻意设计：

- `dsh-host-webserver` README："No TLS, auth, or origin policy…deployment hardening is deliberately out of scope"。
- `dsh-client-connection` README："The fence is a reachability policy, not authentication; the Web carrier provides no authentication layer"。`dsh web --host 0.0.0.0` 被有意禁用，直到有认证层。
- 一旦把 webserver 的 `host` 配成 `0.0.0.0`，任何能路由到该端口的人都能：调用全部 `/api` RPC（创建 agent、执行 bash、读写文件系统）、接收实时会话事件流。

本插件目标（MVP）：

1. 打开 Web 时要求登录；**未设置密码时要求先设置密码**。
2. 登录成功前，**所有功能不可用**；不能只做前端 UI 门禁，**必须真实拦截每一次请求**（含直接 POST 到后端接口）。
3. 登录后支持修改密码。
4. 最简单密码认证即可：不考虑暴力破解、TLS、多用户等。

---

## 2. 现状：dsh Web 的完整请求面

`dsh web` 的 HTTP 面由 `ctx.webServer`（`packages/host/webserver`，唯一 `node:http` 服务器）承载，路由匹配顺序固定：

```
exact 表（完全匹配） → 最长 prefix 表 → fallback（单席位）
```

当前 web profile（`packages/bundle/web-app/cordis.patch.yml`）的入口清单：

| 请求 | 路由形态 | 所有者 |
|---|---|---|
| `POST /api/<method>`（全部 RPC） | prefix `/api`（独占，重复注册会 throw） | `dsh-client-connection` |
| `GET /api/session.export`（会话日志 ZIP 下载） | prefix `/api` | connection → apiproxy |
| WebSocket `/api/events.mux`、`/api/events.host`（会话/宿主事件下行流） | exact upgrade | connection |
| `/plugins/*`（客户端插件 bundle 静态资源） | prefix `/plugins` | `dsh-client-modules` |
| `/plugins/events`（HMR SSE 流） | exact（`EVENTS_ENDPOINT`） | `dsh-client-hmr` |
| 其余一切（SPA 页面、静态资源） | fallback 单席位 | `dsh-host-frontend-static` |

每个 `/api` 请求先过 **trust fence**（`api-request-trust.ts`）：校验 `Host` 头（loopback 或 `trustedHosts`）+ `Origin` 同源 + `sec-fetch-site`。**它防 DNS rebinding / 跨站，不是认证**——curl 带正确 Host 头即可完全通过。

`/api` 通道的 RPC 分发链：

```
bridge → connection.createSharedFetchHandler('/api', fallback)
         ├── interceptor 席位（channel '/api' 仅一个，已被 api-gateway/typert 占用）
         └── fallback → ctx.apiProxy（全部手写 RPC 方法）
```

---

## 3. 拦截面分析：纯插件能否"真实拦截每一次请求"？

### 3.1 逐一排除服务内挂点

| 候选挂点 | 结论 | 原因 |
|---|---|---|
| `webServer.register()` 注册 prefix `/` | **拦不住 `/api`** | `/api` 是更长的 prefix，最长前缀优先；`/api/*` 永远先命中 connection 的路由 |
| 替换 connection 的 `/api` 路由 | **不可行** | 重复注册（kind, path）直接 throw；connection 是核心包 |
| `webServer.registerFallback()` | **不可行** | fallback 单席位，已被 frontend-static 占用；且只覆盖未命名路由，拦不住 `/api` |
| `connection.rpc.intercept('/api', …)` | **不可行** | 该扩展点是"按 endpoint 匹配的拦截器"，但 **channel `/api` 只有一个席位，已被 api-gateway（typert Remote）占用**（`rpc-host.ts:133` 重复注册 throw） |
| `webServer` 中间件/事件钩子 | **不存在** | webserver 源码（266 行）没有 request 事件、没有中间件概念，`server` 实例也未暴露给插件 |
| 包装 `ctx.apiProxy` 的方法 | 反模式 | apiProxy 是 core service 实例，monkey-patch 易碎、不属于 Cordis 风格 |
| 前端门禁（tapIndex / 注入脚本） | **不满足需求** | 只挡浏览器 UI；直接 `curl POST /api/…` 依然畅通 |

**结论：在不修改 dsh 核心源码的前提下，不存在任何"服务内"挂点能拦下 `/api` RPC 与 WebSocket 下行流。**

### 3.2 唯一纯插件方案：前置认证网关（反向代理）

思路：**登录插件自带一个 `node:http` 服务器，成为唯一对外端口；dsh 的 webserver 退到 loopback 内部端口**。所有外部请求先到登录网关，认证通过才转发到内部 dsh，未认证一律拒绝。

- 对 dsh 核心的改动：**零**（只有一行 patch 把 webserver 监听地址改为 loopback 内部端口，这是 dsh 官方支持的 patch 机制，`examples/web-schedule` 已有改 webserver 端口的先例）。
- "真实拦截每一次请求"：HTTP、WebSocket upgrade、SSE 全部经过网关；不登录连 SPA 页面都拿不到，更不可能 POST 到 `/api`。

### 3.3 澄清："这还是一个插件吗？"

**是，而且是标准的 Cordis 插件**。在 dsh 中"插件"= 一个 npm 包 + 组合配置里的一行（`cordis.yml` / patch `insert`）。网关**运行在 dsh 进程内**：

- 插件的 `apply(ctx)` 里直接 `createServer()` 并监听对外端口；
- 生命周期与 dsh 绑定：dsh 启动 → 插件激活 → 网关上线；dsh 退出 → 插件 fiber 卸载 → 网关关闭。**没有第二个进程、没有额外部署的服务**。

它与普通插件的差异仅在于"角色"：其他插件注册服务/工具/路由，它注册一个"进程内反向代理"。对 dsh 的改动全部落在**配置层**（一行 patch 改 webserver 的监听地址），不 fork、不改核心源码。这与"用 nginx 做反代"（真正的独立服务部署）有本质区别。

---

## 4. 方案设计（前置认证网关）

### 4.1 部署形态

**推荐：插件自声明为 bundle，安装一步到位。** 插件包内自带 `cordis.patch.yml`（内容即下面的 patch），并在 `package.json` 声明 `"dsh": {"bundle": {"patch": "./cordis.patch.yml"}}`。`dsh plugin` 安装时会自动检测 `dsh.bundle` 声明并把该包加入 profile 的层叠列表（`apps/cli/src/plugin.ts` 的 reconcile 逻辑），启动即挂载——用户无需手写任何 patch：

```yaml
# 插件包内 cordis.patch.yml（bundle 层）
- id: webserver
  config:
    host: 127.0.0.1          # 关键：从 0.0.0.0 收回，内部端口不再对外
    port: 3081               # 内部端口（与插件 config 的 upstreamPort 一致）

- insert:
    - id: dsh-auth-gateway
      name: 'dsh-auth-gateway'
      config:
        listenHost: 0.0.0.0  # 对外监听（与用户期望一致）
        listenPort: 3080     # 对外端口，保持原 URL 不变
```

层叠顺序：`bundles 依次 → profile 的 cordis.patch.yml → $DSH_HOME/cordis.patch.yml → --patch overlay`。bundle 层对 webserver 的改动仍可被用户自己的 patch 层覆盖，符合 dsh 的组合哲学。

- 用户仍访问 `http://<host>:3080`，URL 不变。
- 内部 3081 只绑定 127.0.0.1，远程不可达 → 不存在"绕过网关直连后端"的远程路径（本机进程/本机用户可直连 3081，属本机可信模型，见 §6 已知限制）。

### 4.2 运行时架构

```mermaid
flowchart LR
    Browser["浏览器<br/>(任意网络位置)"] -->|"GET / , POST /api/* , WS upgrade"| GW
    subgraph GW["dsh-auth-gateway（进程内插件）"]
        GW["认证网关 node:http 服务器<br/>0.0.0.0:3080"]
        AUTH["认证状态机<br/>setup / login / change / logout"]
        STORE["密码哈希 + token 会话表<br/>(node:crypto scrypt / 随机 token)"]
    end
    GW -->|"已认证: 原样转发(保留 Host/Origin 头)"| INNER["dsh webserver<br/>127.0.0.1:3081"]
    INNER --> CONN["/api RPC + WS 下行流<br/>connection / apiproxy"]
    INNER --> SPA["SPA 静态资源<br/>frontend-static"]
```

关键点：**网关在插件 `apply()` 时启动**（`inject: ['webServer']`，从 `ctx.webServer.port` 读取内部端口，无需硬编码）；转发层为纯 `node:http`，零第三方依赖。

### 4.3 认证协议

**路径规划**（全部由插件自己注册在内部 dsh 上不需要——它们由网关直接处理，不转发）：

| 路径 | 方法 | 行为 |
|---|---|---|
| `GET /login` | GET | 返回登录页 HTML（内联 CSS/JS，无构建产物）。网关按状态渲染：未设置密码 → "设置密码"表单；已设置 → "登录"表单；已登录 → 附加"修改密码"区 |
| `POST /login/setup` | POST | 仅当尚未设置密码时可用；body `{password}`；成功后种 cookie 并视为已登录 |
| `POST /login/auth` | POST | body `{password}`；正确 → 签发 token、种 cookie；错误 → 401 |
| `POST /login/change` | POST | 需已登录；body `{oldPassword, newPassword}`；校验旧密码，更新哈希，**吊销全部既有 token** |
| `POST /login/logout` | POST | 删除 token（可选，MVP 内做） |

**未认证请求的处置**（网关对转发表之外路径的默认策略）：

- 路径以 `/api` 开头 → `401` + `application/json`（杜绝 302 污染 RPC 客户端）。
- 其余路径（页面、静态、`/plugins/*`、WS upgrade）→ `302 Found → /login`；WS upgrade 直接拒绝握手。

**认证机制**：

- 密码：`node:crypto` 的 scrypt（`crypto.scryptSync`，随机 salt），**不存明文**；文件存 `$DSH_HOME/login-plugin/password.json`（`0600`）。
- 会话：登录成功签发 256-bit 随机 token（`crypto.randomBytes(32).toString('hex')`），存内存 `Map<token, expiresAt>`；写入 cookie：`dsh_auth=<token>; Path=/; HttpOnly; SameSite=Strict`（MVP 无 HTTPS，`Secure` 暂不加，见 §6）。
- 修改密码：更新哈希 + 清空 token 表（全端下线，最简单且满足"改密后旧会话失效"直觉）。
- 首次启动判定：`password.json` 不存在 → 所有请求 302 到 `/login` 的设置密码页；未设置密码前**一切功能不可用**（包括 `/api`）。

### 4.4 转发实现要点（node:http，零依赖）

1. **HTTP 转发**：`http.request({ host: '127.0.0.1', port: inner, path: req.url, method, headers })`，双向 pipe body，响应状态/头/体原样回传。注意透传 `content-length`/`chunked` 语义（pipe 天然保持）。
2. **改写 Host / Origin 为回环**：转发前把 `Host`（及存在的 `Origin`）改写为 `127.0.0.1:<内部端口>`。原因：dsh 内部 trust fence 的 LAN 信任列表由 web-runtime 根据 **webserver 的 bind host** 采样（`resolveLanTrust`：监听 `0.0.0.0` 才产生 LAN IP 条目），而本方案把 webserver 钉在 `127.0.0.1` → `trustedHosts` 恒为空 → 外部地址（LAN IP）的 Host 会在内部被 403（实机验证：`/api/llm.providers`、`/api/agentPreset.list` 全部 403）。改写是安全的：fence 的"远程可达性防护"职责已由网关认证层接管——跨站/DNS-rebinding 请求因 HttpOnly + SameSite=Strict 不带会话 cookie，在网关层即被拒绝，到不了内部。fence 的 Host 检查退化为防本机进程伪造，改写不削弱该边界。
3. **WebSocket upgrade 转发**：`server.on('upgrade')` → 认证检查 → 用 `http.request` 向内部服务器发起同 headers 的请求，监听 `proxyReq.on('upgrade', …)` 把客户端 socket 与内部 socket 对接（Node 官方标准模式，约 30 行）。未认证 → 直接 `socket.destroy()`（拒绝握手，事件流零泄漏）。
4. **错误处理**：内部 dsh 不可达（未启动/端口错误）→ 网关返回 `502`；转发中的异常 → `504`/`destroy`，绝不让异常进程退出（仿照 webserver 的 per-request 容错姿态）。
5. **生命周期**：`ctx.effect()` 注册监听与清理——插件卸载即关服，与 Cordis 可逆副作用一致。

### 4.5 登录页（零构建、零侵入）

- 登录页是插件内嵌的字符串模板（内联 CSS + 原生 JS `fetch` 调 `/login/*` API），不依赖 dsh 的 SPA 构建链，也不需要 `tapIndex`（未认证请求根本不转发到内部服务器）。
- 登录/设置成功 → `location.reload()` → 网关放行 → SPA 正常 boot。**dsh 的前端、插件体系零改动**。
- 已登录用户访问 `/login` 时展示"修改密码"表单（此时 token 有效，改动立即可见）。

### 4.6 安装与卸载

前置网关插件仍是**标准 Cordis 插件**：一个 npm 包 + 组合配置里的一行，安装走 dsh 官方插件管理命令。web profile 首次使用自动从模板初始化，无需手工创建。

**路径 A：本地开发目录安装（MVP 首选）**

```bash
# 1. 安装：pnpm spec 装进 $DSH_HOME/profiles/web/ 的 node_modules。
#    插件声明了 dsh.bundle → 自动加入 profile 的 bundles 层叠列表
dsh plugin --profile web add file:/Users/ankh/workspace/private/dsh-auth-gateway

# 2. 验证组合树（应看到 webserver 行已被 bundle patch 改为 127.0.0.1:3081，
#    且多出 dsh-auth-gateway 行）
dsh web --dump-config

# 3. 启动
dsh web
```

**路径 B：发布为 npm 包（正式部署）**

```bash
dsh plugin --profile web add dsh-auth-gateway   # 其余步骤同上
```

`dsh plugin` 支持 pnpm 全部 spec：`file:`、`link:`、`git:`、tarball、registry 包名。

**不声明 `dsh.bundle` 时的手动安装**（插件包不打算自携带 patch 时）：

```bash
dsh plugin --profile web add dsh-auth-gateway
# 手动编辑 $DSH_HOME/profiles/web/cordis.patch.yml，加入 4.1 节的两段内容
```

**卸载**：

```bash
dsh plugin --profile web remove dsh-auth-gateway   # 移除依赖；reconcile 自动把它从 bundles 层叠列表摘除
# 若曾手动写 patch：从 profile 的 cordis.patch.yml 删除 webserver 行改动与 insert 段
# （webserver 的 host/port 恢复由 bundle 层消失自然完成）
```

**与"独立服务"类方案（nginx 反代）的安装对比**：反代需要单独安装、配置、守护一个进程，并手动处理 TLS、WebSocket 转发、与 dsh 的生命周期解耦；本方案只需一条 `dsh plugin add`，网关随 dsh 进程同生共死。

---

## 5. MVP 范围界定

**做**：

1. 前置认证网关（HTTP + WebSocket 全量拦截与转发）。
2. 首次设置密码 / 登录 / 修改密码 / 登出，共 4 个 API + 1 个登录页。
3. scrypt 密码哈希 + 内存 token 会话 + HttpOnly cookie。
4. 自携带 bundle patch（改 webserver 行 + insert 插件行）+ 安装说明（README）。
5. 验证脚本（curl 全流程 + WS 拦截验证）。

**不做**（明确排除，避免 MVP 膨胀）：

- 暴力破解防护（限速/锁定）——用户明确暂不考虑；仅预留注释位。
- TLS/HTTPS——MVP 用明文 HTTP，跨网络部署风险在 README 显著标注。
- 多用户/权限分级/记住我（长期 token）。
- 修改 dsh 核心源码或 fork。
- 前端 SPA 内嵌设置项（改密入口在登录页内完成，够用）。

---

## 6. 安全边界与已知限制

| 项 | 说明 |
|---|---|
| 本机绕过 | patch 后内部端口仅监听 127.0.0.1；**本机**任意进程/用户仍可直接访问 3081 绕过认证。对本机威胁模型而言，等同"能登录本机账户即可访问"，MVP 接受 |
| 明文传输 | 无 HTTPS 时密码与 cookie 明文过网络；LAN 部署建议置于可信网络或前置 TLS 反代（不在 MVP） |
| 暴力破解 | 不做失败限速；scrypt 哈希本身提高离线破解成本 |
| XSS/CSRF | `SameSite=Strict` + HttpOnly 已挡 CSRF 与脚本读取；登录页无用户内容渲染，XSS 面极小 |
| token 生命周期 | 内存态：dsh 重启即全部下线（需重新登录）；改密全量吊销 |
| 时序攻击 | 登录失败响应统一 401（不区分"未设置/密码错"），但 MVP 不做恒定时间比较 |

---

## 7. 验证计划

```bash
# 未认证：API 必须 401，页面必须跳登录
curl -i -X POST http://127.0.0.1:3080/api/session.create ...   # → 401
curl -i http://127.0.0.1:3080/                                 # → 302 /login

# 首次设置密码 → 登录 → 功能可用
curl -i -X POST http://127.0.0.1:3080/login/setup -d '{"password":"x"}'
curl -i -c cookies.txt -X POST http://127.0.0.1:3080/login/auth -d '{"password":"x"}'
curl -i -b cookies.txt http://127.0.0.1:3080/api/session.list   # → 200

# WebSocket 拦截：未认证 upgrade 必须被拒
# 修改密码后旧 cookie 必须失效
curl -i -b cookies.txt -X POST http://127.0.0.1:3080/login/change -d '{"oldPassword":"x","newPassword":"y"}'
curl -i -b cookies.txt http://127.0.0.1:3080/api/session.list   # → 401

# 内部端口不可从外部访问（0.0.0.0 主机上用另一台机器 curl 3081 → 拒连）
```

---

## 8. 备选与远期

| 方向 | 说明 |
|---|---|
| 服务内中间件（远期上游） | 给 `dsh-host-webserver` 增加"请求中间件/认证扩展点"（如 `registerGate`），connection 的 `/api` 路由也纳入 gate 链，则登录插件可完全服务内实现、无需改端口。属核心演进，超出本插件 MVP |
| 前端增强 | 在 SPA 内提供"修改密码"设置项（client 插件 + slot），替代登录页改密 |
| 加固 | 失败限速、`Secure` cookie（配 TLS 后）、token 持久化、PBKDF2 参数化配置 |
