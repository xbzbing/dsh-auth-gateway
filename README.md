# dsh-password-gate

为 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) Web 提供密码登录网关的插件。

`dsh web` 本身**没有任何认证机制**——只要能路由到 Web 端口，任何人都可以调用全部 `/api` RPC（创建 agent、执行 bash、读写文件系统）。本插件在**每一个请求**（HTTP 与 WebSocket，包括直接 POST 到后端接口）之前加一道最小密码门禁。

设计与可行性分析见 [docs/PROPOSAL.md](docs/PROPOSAL.md)。

## 功能

- **首次打开（尚未设置密码）** → 显示"设置密码"页面。设置密码之前，任何功能都不可用。
- **已设置密码** → 显示登录页面。登录成功前，每一个请求都被拦截：
  - `/api/*` → `401`
  - 页面类路径 → `302 /login`
  - WebSocket 升级（`/api/events.mux`、`/api/events.host`）→ 拒绝连接
- **设置/登录成功** → 直接跳转 dsh 首页（`/`）。
- **修改密码** → 校验旧密码后更新，并**吊销全部会话**（所有端下线）。
- **OTP 双因素认证**（可选）→ 启用后，登录需要密码 + OTP 验证码，支持：
  - TOTP（基于时间的一次性密码），兼容 Google Authenticator、Authy 等认证器应用
  - 备份代码，用于设备丢失时恢复访问
  - 可配置为强制或可选启用

这是真正的服务端门禁，不是仅限前端的 UI 锁：未认证的客户端根本到不了后端。

### OTP 双因素认证

启用 OTP 后，登录流程变为：**密码 + OTP 验证码**。OTP 基于 TOTP（RFC 6238），兼容所有主流认证器应用（Google Authenticator、Authy、1Password 等）。

**用户流程：**

1. **设置 OTP**：已登录用户访问 `/otp/setup`，扫描 QR 码或手动输入密钥，输入验证码确认。
2. **登录验证**：密码验证后，系统提示输入 OTP 验证码。
3. **备份代码**：如果丢失认证器设备，可以使用一次性备份代码登录。

**安全特性：**

- OTP 密钥使用 Base32 编码存储
- 备份代码使用 scrypt 哈希存储（与密码相同的安全级别）
- 验证时使用时间窗口（±N 步）并记录最近已用时间步（`lastCounter`），同一时间步内的验证码不可重放
- 每个备份代码只能使用一次
- OTP 验证路径（`/otp/verify`、`/otp/verify-setup`、`/otp/verify-backup`、`/otp/disable`、登录的 OTP 步骤）共享全局每分钟限流，并按客户端地址统计失败次数——连续失败达到 `maxLoginFailures` 后锁定该地址（与登录失败同一套锁定）

> **⚠️ OTP 密钥明文存储风险（已知限制）**
>
> TOTP 密钥以 **Base32 明文**保存在 `$DSH_HOME/login-plugin/otp.json`（与密码不同，密码是 scrypt 哈希存储）。任何能读取该文件的进程/用户都能克隆你的 2FA 身份。
>
> **缓解措施**（当前实现已具备）：
> - 文件权限 `0600`、目录 `0700`（仅属主可读写）；
> - 信任模型为**本机可信**：插件运行在 dsh 所在主机，攻击面取决于主机上其他进程的隔离程度；
> - 建议部署时启用磁盘加密（FileVault / LUKS）。
>
> **生产建议**：用主密钥加密存储 OTP 密钥（例如用 `$DSH_HOME` 下的主机密钥派生加密密钥），这是后续工作的方向之一。

**配置示例：**

```yaml
# 启用 OTP（可选）
dsh-password-gate:
  config:
    otpEnabled: true
    otpRequired: false  # 设为 true 强制所有用户启用
    otpIssuer: my-dsh-instance
    otpPeriod: 30
    otpDigits: 6
    otpWindow: 1
    backupCodeCount: 10
    backupCodeLength: 8
```

> **非安全上下文兼容**：通过 `http://<局域网 IP>`（而非 localhost）访问时，浏览器 Web Crypto 的
> `crypto.randomUUID` 不可用，会导致 dsh 前端报"crypto.randomUUID is not a function"。
> 插件通过 `ctx.webServer.tapIndex()` 向每个 index.html 注入基于 `crypto.getRandomValues`
> （始终可用）的 polyfill，明文 LAN 部署无需任何额外配置。

## 工作原理

```
浏览器 ──> dsh-password-gate 网关（0.0.0.0:3080，运行在 dsh 进程内）
               │  每个请求都做认证检查（内存会话表，O(1)）
               ├─ 通过 ──> 转发（Host/Origin 改写为回环）──> dsh webserver（127.0.0.1:3081）
               └─ 未通过 ─> 401 / 302 / 拒绝 upgrade
```

本插件是标准的 Cordis 插件，**运行在 dsh 进程内**：随 dsh 启动而启动、随 dsh 退出而退出，不需要额外的服务进程，也不 fork 核心。它的 bundle patch 会把真实的 webserver 移到仅回环（loopback）的内部端口，使内部端口无法从远程访问，网关成为唯一入口。

**关于转发时的 Host/Origin 改写**：dsh 内部 `/api` trust fence 的 LAN 信任列表是根据 webserver 的监听地址（`0.0.0.0`）采样的；插件把 webserver 钉在 `127.0.0.1` 后该列表恒为空，外部地址（LAN IP）的请求会被内部 fence 以 403 拒绝。网关因此在转发时把 `Host`/`Origin` 改写为回环地址——安全上成立，因为 fence 的"远程可达性防护"已由网关认证层接管：跨站/DNS-rebinding 请求没有会话 cookie（HttpOnly + SameSite=Strict），在网关层即被拒绝，到不了内部。

- **密码**：scrypt 哈希（`node:crypto`），存于 `$DSH_HOME/login-plugin/password.json`（仅属主可读写）。
- **密码策略**：至少 8 位，且包含**大小写字母或特殊字符**（服务端强制 + 登录页即时反馈；可通过配置调整，见下）。
- **失败锁定**：同一来源连续输错 5 次密码后锁定 5 分钟（期间正确密码也拒绝），登录成功即清零计数；按客户端 socket 地址计数，`x-forwarded-for` 伪造无效。
- **全局限速**：全局每分钟最多 60 次登录尝试（防多 IP 轮换爆破），超限返回 `429 rate-limited`；scrypt 在 libuv 线程池异步执行，登录洪峰不阻塞事件循环（不影响已登录用户的转发）。
- **爆破提醒**（符合 dsh 规范）：锁触发或全局速率耗尽时，插件写一条 `ctx.logger.warn` 日志，并 `ctx.emit('dsh-password-gate/brute-force', payload)` 广播 Cordis 事件——payload 为 JSON 安全数据（`{kind: 'lockout'|'global-rate-limit', ...}`），任何插件可监听；每个锁定/窗口只提醒一次。**锁定不影响正在使用的用户**：已登录会话走转发通道，不经过登录端点。
- **会话**：随机 256-bit token，存于内存，**30 天有效期**；dsh 重启后全员下线；修改密码吊销全部会话。
- **Cookie**：`dsh_auth`，`HttpOnly; SameSite=Strict`（未加 `Secure`——MVP 走明文 HTTP）。
- **修改密码入口**：访问 `/login`（已登录时直接显示改密表单）。
- **前端 UI（client 插件）**：按 dsh 规范通过 `ctx.slots.register` 在「用户设置」槽位注册设置面板（OTP 启用/禁用、修改密码、退出登录）。客户端源码位于 `client/src/index.jsx`（JSX），构建产物 `client/index.js` 由 `npm run build:client` 生成（esbuild，含 source map）；dsh 通过 `exports["./client"]` 加载该产物。修改源码后需重新构建并同步到已安装副本。

以上策略均为可配置项（bundle patch 或 profile patch 中覆盖 `dsh-password-gate` 行的 config）：

| 字段 | 默认 | 含义 |
|---|---|---|
| `minPasswordLength` | `8` | 密码最小长度（4–128） |
| `requireMixedCase` | `true` | 是否要求大小写混合（与特殊字符二选一满足即可） |
| `requireSpecial` | `true` | 是否要求特殊字符（与大小写混合二选一满足即可） |
| `maxLoginFailures` | `5` | 连续错误多少次后锁定（1–100） |
| `lockMinutes` | `5` | 锁定分钟数（1–1440） |
| `maxGlobalAuthAttemptsPerMinute` | `60` | 全局每分钟最大登录尝试次数（1–10000） |
| `maxOtpAttemptsPerMinute` | `10` | 每个客户端地址每分钟的 OTP 验证尝试上限，防暴力猜测验证码/备份码（1–10000） |
| `otpEnabled` | `false` | 是否启用 OTP 双因素认证 |
| `otpRequired` | `false` | 是否强制所有用户启用 OTP |
| `otpIssuer` | `dsh-password-gate` | OTP 发行者名称（显示在认证器应用中） |
| `otpPeriod` | `30` | TOTP 周期（秒，10–120） |
| `otpDigits` | `6` | OTP 位数（4–10） |
| `otpWindow` | `1` | OTP 验证窗口（±N 个周期，0–5） |
| `backupCodeCount` | `10` | 备份代码数量（5–20） |
| `backupCodeLength` | `8` | 备份代码长度（6–12） |

## 安装

前置条件：已安装 dsh，且 web profile 已初始化（首次使用 `dsh web` 时自动创建）。

### 方式一：本地开发目录安装（推荐）

```bash
dsh plugin --profile web add file:/path/to/dsh-password-gate
```

### 方式二：发布为 npm 包后安装

```bash
dsh plugin --profile web add dsh-password-gate
```

`dsh plugin` 支持 pnpm 的全部 spec（`file:`、`link:`、`git:`、tarball、registry 包名）。

### 安装后验证

```bash
# 1. 查看组合树：webserver 应变为 host 127.0.0.1、port 3081，并多出 dsh-password-gate 行
dsh web --dump-config

# 2. 启动
dsh web

# 3. 浏览器打开 http://<host>:3080 —— 应看到"设置密码"或"登录"页面
```

### 安装原理说明

插件包的 `package.json` 声明了 `"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }`。`dsh plugin add` 检测到 `dsh.bundle` 声明后，会自动把该包加入 profile 的 bundle 层叠列表（`dsh plugin` 的 reconcile 逻辑），启动即挂载：

- 包内 `cordis.patch.yml` 会把 webserver 行改为 `127.0.0.1:3081`（回环内部端口），并插入 `dsh-password-gate` 插件行；
- **无需手动编辑任何 patch 文件**；
- 该 bundle 层的改动仍可被 profile 自身的 `cordis.patch.yml`、`$DSH_HOME/cordis.patch.yml` 及 `--patch` overlay 覆盖。

若不想使用 bundle 声明（比如要手动管理补丁），也可以只把包作为普通依赖安装，然后手动在 `$DSH_HOME/profiles/web/cordis.patch.yml` 中加入以下两段（效果等同）：

```yaml
- id: webserver
  config:
    host: 127.0.0.1
    port: 3081

- insert:
    - id: dsh-password-gate
      name: dsh-password-gate
      config:
        listenHost: 0.0.0.0
        listenPort: 3080
        upstreamHost: 127.0.0.1
        upstreamPort: 3081
```

### 重复安装会怎样？

- **再次执行 `dsh plugin --profile web add`**：幂等，无影响。pnpm 不会重复写入依赖（package.json 同名 key 唯一），reconcile 检查 `bundles.includes()` 也不会重复添加层。
- **组合树中出现两个插件行**（例如两个 bundle 都 `insert` 了 `id: dsh-password-gate`，patch 的顶层 insert 不查重）：loader 会把插件挂载两次，第二个网关绑定同一对外端口时必然 `EADDRINUSE`，**启动明确失败**（fail loud，不会静默半坏）。第一个实例继续正常工作。删除重复行即可恢复。
- **webserver 行被多层 patch**：patch 按 `id` 替换整行 config，后层覆盖前层，幂等。
- **热重载（HMR）**：卸载先释放旧网关（端口释放），重新加载再绑定，不受影响。

## 卸载

卸载分两步：**移除组合** + **清理数据**。

### 第一步：从 profile 移除插件

```bash
dsh plugin --profile web remove dsh-password-gate
```

该命令会移除插件依赖，reconcile 逻辑自动把它从 bundle 层叠列表摘除，其 bundle patch 随之失效——webserver 恢复默认的 `0.0.0.0` / `3080` 配置。

> 注意：`dsh plugin remove` 只是移除组合行，**不会执行插件代码**，因此密码文件不会被自动删除。

> **为什么数据保留是刻意设计**：Cordis 的可逆副作用（`ctx.effect` disposer）负责撤销**注册行为**——网关服务器、polyfill 注入等卸载时自动消失；而**持久化数据**（密码哈希文件）属于用户数据，生命周期由用户决定，不由插件装载周期决定。这与 dsh 生态一致：`settings-file`、`credentials-local`、`session-persistence-jsonl` 等插件卸载后，其 `settings.yaml`、`.credentials.yaml`、`.sessions/` 数据同样保留。数据保留的好处：重装后无需重新设置密码（连续性）；且卸载后没有网关就没有门禁，残留的仅是磁盘上无用的 scrypt 哈希字节（0600 权限），无安全危害。想要彻底清除，执行下面的第二步即可。

### 第二步：清理数据（推荐）

停止 `dsh web` 后，删除插件的数据目录（密码哈希文件所在）：

```bash
# 方式一：运行包自带的清理命令（安装后已链接到 profile 的 bin）
dsh-password-gate-uninstall

# 方式二：手动删除
rm -rf "$DSH_HOME/login-plugin"
```

### 运行时卸载说明

插件在运行中被卸载（组合变更、热重载、进程退出）时，会通过 `ctx.effect` 注册的 disposer 自动关闭网关（端口与连接），无需手动处理——参见 `index.js`。

## 忘记密码怎么办

密码丢失后无法通过 `/login/change` 改密（需要旧密码），只能**本地重置**：删除密码记录，网关回到"设置密码"状态。这是本机可信模型下的正解——能物理访问本机的用户本就拥有全部权限，密码文件也仅是 scrypt 哈希（非明文、0600）。

```bash
# 方式一：运行包自带的重置命令（安装后已链接到 profile 的 bin）
dsh-password-gate-reset

# 方式二：手动删除
rm -f "$DSH_HOME/login-plugin/password.json"
```

然后打开 Web UI，会再次出现"设置密码"页面，设置新密码即可。

几点说明：

- **无需重启**：网关每次校验都实时读文件，删除后立即进入未设置状态（内存中的既有会话仍有效，直到过期或重启；想让所有会话立刻下线，重启 `dsh web` 即可）；
- 与卸载的区别：重置只删密码记录，**插件保持安装**、其余数据不受影响；`dsh-password-gate-uninstall` 才是彻底移除插件（含数据）；
- 若 `$DSH_HOME` 未设置，默认目录为 `~/.dsh`。

## 自定义端口与监听地址

### 端口：直接用 `dsh web --port <N>`（推荐）

插件的 bundle patch 跟随 `ctx.webStartup`（与 web-app 自身的 webserver 行同一机制），所以端口由命令行 flag 控制：

```bash
# 对外 URL 8080，内部 webserver 自动挪到 8081
dsh web --port 8080

# 默认（不传 flag）：对外 3080，内部 3081
dsh web
```

推导规则：**对外端口 = `--port`（默认 3080），内部端口 = 对外 + 1**。端口范围 1–65534（内部端口 +1 后仍须合法，否则插件配置校验会在启动时明确报错）。

> 不支持 `--port 0`（让 OS 自动分配端口）：网关需要固定的内部端口才能转发。

### 为什么不能用 `--host 0.0.0.0`

`dsh web --host 0.0.0.0` 会被 dsh 直接拒绝并报错（web-app 内置的安全限制，`startup.ts` 硬编码：`--host 0.0.0.0 is intentionally not supported yet for safety`），**这是 dsh 代码层的限制，配置无法解除，也不需要解除**——装了本插件后：

- 内部 webserver **必须**只监听 `127.0.0.1`（安全关键：内部端口一旦对外，就绕过了登录网关）；
- 对外监听由**插件的 `listenHost`** 承担，默认已是 `0.0.0.0`，不经过 web-startup 的校验。

所以对外暴露的正确姿势是：**不要传 `--host`，直接用默认**（网关默认监听所有网卡）。

### 只允许本机访问

如果只想本机访问（不要对外监听），把 bundle patch（或 profile 自己的 patch）里 `dsh-password-gate` 行的 `listenHost` 改为 `127.0.0.1` 即可。

### 固定端口（不使用 `--port`）

若不想依赖 flag，可在 profile 自己的 `cordis.patch.yml` 中覆盖 `webserver` 与 `dsh-password-gate` 两行（你的补丁层优先级高于 bundle 层），注意 `webserver.port` 必须等于 `dsh-password-gate.config.upstreamPort`。手动覆盖后 `--port` flag 将不再生效（你的值优先）。

## 验证

### 浏览器端到端测试（playwright，真实实例）

对运行中的实例执行完整浏览器流程（设置密码 → 首页加载 → 登出/登录 → 改密/重登录，并断言零 JS 错误，**会真实修改密码**，最终密码为 `PASSWORD-2`）：

```bash
BASE=http://127.0.0.1:8002 PASSWORD=your-password node scripts/e2e.mjs
```

脚本自适应"首次设置"与"已配置"两种状态；需要本机有 playwright（`npm i -D playwright`）与 chromium。

### API/WebSocket 门禁验证（curl）

对运行中的实例执行自动化流程（**会真实修改密码**，最终密码为 `PASSWORD-new`）：

```bash
BASE=http://127.0.0.1:3080 PASSWORD=your-password ./scripts/verify.sh
```

或参见 [docs/PROPOSAL.md §7](docs/PROPOSAL.md) 的手动检查清单。

单元测试与插件契约测试：

```bash
npm test
```

## Model Experience

None，本包是浏览器与内部 dsh webserver 之间的 Web 载体，不会进入任何模型请求。

#### KV Cache effect

None；本包既不组装也不发送 provider 请求。

## Known Limitations and Deferred Work（MVP）

- **本机可绕过**：内部端口只绑定 127.0.0.1，本机上已有的任何进程都可以直接访问 `:3081`。可接受——威胁模型是远程访问。
- **明文 HTTP**：密码与 cookie 在网络中明文传输。局域网部署应保持在可信网络内，或为网关前置 TLS。
- **暴力破解防护有限**：有按来源的失败锁定（默认 5 次/5 分钟）+ 全局限速（默认 60 次/分钟），均可配置；无分布式/换 IP 绕过全局限速的防护（攻击者可等待窗口重置或分布到多机）。
- **内存会话**：dsh 重启后全员下线。
- **OTP 密钥存储**：当前 OTP 密钥以明文 Base32 存储在 `otp.json` 文件中。生产环境建议加密存储。
- **OTP 无多用户支持**：当前 OTP 配置为全局共享，不支持多用户独立的 OTP 密钥。
- 后续工作：TLS、多用户、UI 级爆破提醒（需在 client 插件中监听 `dsh-password-gate/brute-force` 事件并展示）。

## 开发统计

本项目由 **DeepSeek Harness（dsh）** 完成开发与测试：从方案调研、源码分析（deepseek-harness 的 Cordis 插件机制、webserver/connection 源码、graphify 图谱）到实现、实机部署与端到端验证（curl + Playwright），全部由运行在 dsh 上的编码智能体完成。

单次开发会话（模型 `deepseek-v4-flash`）消耗：

| 指标 | 数值 |
|---|---|
| 开发时长 | 约 93 分钟 |
| 轮数（turn） | 20 |
| 步数（step） | 381 |
| 工具调用 | 393 |
| 输入 token（新增） | 206,172 |
| 缓存命中 token（KV cache） | 95,108,864 |
| 缓存命中率 | 99.8% |
| 输出 token | 243,803（其中推理 121,760） |
| 总 token（输入 + 输出） | ≈ 9,556 万 |

> 说明：缓存命中数据来自模型提供方返回的 prefix-cache（KV cache）指标；高命中率源于长会话中每步输入前缀的稳定复用。

## License

MIT
