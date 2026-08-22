# 安全模型

> 中文文档 | [English](../en/SECURITY.md)

本文档描述 dsh-auth-gateway 的威胁模型、认证安全设计、已知限制与恢复路径。

## 威胁模型

本插件为 **dsh web 的远程访问认证**设计：默认威胁是"能路由到对外端口但无法访问本机文件系统"的攻击者。本机用户（可读取 `$DSH_HOME`）不在防护范围内——本机可信模型，等同"能登录本机账户即拥有全部权限"。

| 攻击面 | 防护 |
|---|---|
| 未认证远程调用 `/api`（创建 agent、执行 bash、读写文件） | 网关全量拦截：未认证 401 / 302 / WS 拒绝，请求到不了内部 webserver |
| 密码爆破（单来源 / 多来源轮换） | 按来源锁定（默认 5 次/5 分钟）+ 全局速率限制（60 次/分钟）+ OTP 独立限流（10 次/分钟），三层叠加 |
| OTP 验证码暴力猜测 | 每来源限流 + 失败计入统一锁定；scrypt 异步执行，洪峰不阻塞事件循环 |
| OTP 重放（同一验证码在窗口内复用） | 记录已接受时间步（`lastCounter`，持久化），同一步或更早步骤的验证码拒绝 |
| 会话劫持（Cookie 窃取） | HttpOnly + SameSite=Strict；禁用 OTP、修改密码等敏感操作要求完整重验证 |
| DNS-rebinding / 跨站请求 | 网关 Cookie 门禁接管（跨站请求无会话 Cookie 即被拒）；内部 fence 职责移交后，Host/Origin 改写为回环（见下） |
| LAN 浏览器获得客户端 loopback trust | trust bootstrap 只随内部 DSH index 提供；外部浏览器必须先通过网关完整认证才能取得页面，内部 webserver 仍只监听回环，服务端 privileged fence 保持启用 |
| 存储泄露（`$DSH_HOME` 文件被读取） | 密码与备份代码为 scrypt 哈希；**OTP 密钥为 AES-256-GCM 加密**（读取需主密钥，见"已知限制"） |
| 首次部署抢占 | 初始密码由服务器自动生成（console 打印，本机可见）——无"先到先得"窗口；初始密码为一次性凭据，完成引导后失效 |

## 认证安全设计

### 状态机

```
首次部署（自动生成初始密码）→ 初始密码登录 → 引导页（强制设置个人密码）→ 登录（密码）
  →（OTP 已启用时）必须完成 OTP 验证 → 完整会话
  →（OTP 未启用时）直接完整会话
```

- **未完成 2FA 的会话**（OTP 启用后才登录的会话）：仅能访问 `/otp/verify`、`/otp/verify-backup` 及验证页；设置、OTP 管理、修改密码全部拒绝（`otp-required`）；
- **敏感操作**（启用/禁用 OTP、修改密码）要求完整验证会话；**禁用 OTP** 额外要求当前密码 + 验证码或未使用的备份代码——会话本身不足以关闭第二因素；
- 登录成功清零失败计数；修改密码/禁用 OTP 吊销全部会话。

### TOTP 实现

- RFC 6238 / RFC 4226 标准（HMAC-SHA1、6 位、30 秒周期，均可配置），常数时间比较；
- 验证窗口 ±1 步，并记录已接受时间步防重放；
- 备份代码：scrypt 哈希存储、单次使用、生成时去除易混淆字符。

### OTP 密钥加密（at rest）

TOTP secret 是第二因素的根密钥：拿到它就能生成任意有效验证码。为阻止 `$DSH_HOME` 文件泄露直接交出该密钥，`otp-store.js` 在写入 `otp.json` 前用 `lib/otp-crypto.js` 将其以 **AES-256-GCM** 密封（格式 `v1.<iv>.<tag>.<cipher>`，均 hex），读取时再用主密钥解密。旧版明文记录仍可读取（按 `v1.` 前缀判断），无需手动迁移。

主密钥（32 字节）解析优先级：

1. 环境变量 `DSH_AUTH_GATEWAY_MASTER_KEY`（hex 或 base64，32 字节）；设置了即用它，不再写密钥文件；
2. 否则首次启用 OTP 时自动生成 `auth-gateway/otp-master.key`（0600，目录 0700），进程内缓存一次。

密钥来自环境变量时，应将它置于加密卷或外部密钥管理（KMS / Docker secret 等），方能真正隔离磁盘泄露——默认自动生成路径下密钥与密文同目录，本机可信模型不变（能读 `$DSH_HOME` 的本机用户可取二者）。

### 防爆破分层

| 层 | 机制 | 覆盖 |
|---|---|---|
| 全局 | 每分钟全局预算（默认 60 次） | 密码、OTP、备份码验证共用 |
| 来源 | 失败锁定（5 次/5 分钟） | 密码失败与 OTP 失败计入同一锁定 |
| 来源 | OTP 独立窗口（10 次/分钟） | OTP/备份码验证 |

`x-forwarded-for` 不参与来源判定（防止伪造）；锁触发与限流耗尽时输出 `ctx.logger.warn` 并广播 `dsh-auth-gateway/brute-force` 事件（`{kind: 'lockout'|'global-rate-limit'|'otp-rate-limit', ...}`，JSON 负载，每个锁定/窗口一次）。认证事件与暴力破解告警同时**持久化落盘** `$DSH_HOME/auth-gateway/audit.log`（JSONL，每行一个 `{ts, kind, ip, reason?, ...}` 对象，文件 0600）：活跃文件按本地日历日轮转为 `audit.log.<YYYY-MM-DD>`，归档保留 90 天后删除；启动时收紧既有文件权限至 0600 并清理过期归档，优雅停机时等待在途写入落盘（仅硬崩溃可能丢失正在写入的最后一行）；写失败降级为告警日志且自动去重（首次即时上报，持续失败每 5 分钟提醒一次并附抑制计数，恢复时记录 info），绝不影响认证流程。

### 转发与 fence

网关转发前将 `Host`/`Origin` 改写为回环地址：内部 trust fence 的 LAN 信任列表基于 webserver 监听地址采样，而本插件将 webserver 钉在 `127.0.0.1`，若不改写则 LAN 访问会被内部 403。改写是安全的——fence 的远程可达性防护职责已由网关 Cookie 门禁接管（跨站/DNS-rebinding 请求无会话 Cookie，在网关即被拒绝）。

### 认证后的浏览器 trust

DSH 客户端会用页面 hostname 初始化 `connection.isLoopback`，并在 Settings 启动时一次性选择 host 或 memory scope。通过 LAN IP 访问时该值原本为 `false`，导致 Models、Credentials、Locale/Theme/Preferences 等 host-backed settings 在浏览器端被提前禁用，即使网关已经把服务端 Host/Origin 改写为回环也无法恢复。

网关的 client 插件（client/src/index.jsx）通过官方 inject seam 声明依赖 `connection` 服务，在 apply 时对 LAN hostname（非 loopback）把 `handle.isLoopback` 改写为恒真的 getter——任何消费者无论何时读取都得到信任值。不触碰 DSH 模块加载器与第三方模块的激活路径，完全符合 dsh/Cordis 扩展规范；认证、HTTP/WS 拦截、Host/Origin 改写和服务端 privileged fence 均不变。对外页面仍必须先通过完整会话（含 onboarding/OTP）门禁；内部 DSH 必须继续只监听 `127.0.0.1`。

## 已知限制

- **OTP 密钥加密存储**：`$DSH_HOME/auth-gateway/otp.json` 中的 Base32 密钥已用 AES-256-GCM 加密（lib/otp-crypto.js），读取需主密钥。主密钥来自环境变量 `DSH_AUTH_GATEWAY_MASTER_KEY`（hex/base64）或首次启用时自动生成的 `auth-gateway/otp-master.key`（0600）；仍属本机可信模型——能读 `$DSH_HOME` 的本机用户同时可取密钥，故需将主密钥置于加密卷或外部密钥管理方能真正隔离磁盘泄露；
- **明文 HTTP**：密码与 Cookie 在网络中明文传输。局域网部署建议置于可信网络，或前置 TLS 反向代理（见 DEPLOYMENT.md）；
- **OTP 启用权限（DoS 面）**：`/otp/enable` 与 `/otp/verify-setup` 仅要求任意有效会话——启用 2FA 是用户操作（无需部署开关），密码泄露场景下攻击者可用泄露的密码登录后绑定自己的认证器，锁死真实用户登录。这不构成凭据窃取，主要是 DoS 面；缓解为启用成功后**吊销全部会话**（含启用者自身，强制在 2FA 策略下重新登录）；后续方向为启用时要求密码重验证；
- **内存会话**：dsh 重启后全员下线（需重新登录；OTP 已启用时需重新完成 2FA）；
- **无分布式防护**：全局限流按单进程计数，多实例部署或分布式攻击者可分摊请求；
- **backup code 生成存在轻微模偏差**（`bytes % 34`），不影响实际安全性（空间仍为 34^8）。

## 恢复路径

忘记密码、丢失认证器或遭遇上述 DoS 面时（需本机访问权限）：

```bash
# 清除密码记录（等价于下面的 dsh-auth-gateway-reset）
rm -f "$DSH_HOME/auth-gateway/password.json"
# 丢失认证器时，一并清除 OTP 绑定
rm -f "$DSH_HOME/auth-gateway/otp.json"
# OTP 主密钥丢失（或想彻底弃用加密）：删除密钥文件，重新启用 OTP 时会生成新密钥
rm -f "$DSH_HOME/auth-gateway/otp-master.key"
```

> **主密钥丢失 = OTP 不可解密**：若此前用环境变量 `DSH_AUTH_GATEWAY_MASTER_KEY` 注入主密钥、且该值已无法恢复，则 `otp.json` 中的密文无法解密、2FA 验证全部失败。此时删除 `otp.json`（必要时连同 `otp-master.key`）后重启，重新绑定认证器即可；删除 `otp.json` 不影响密码登录。
>
> 解密路径**不会**静默重新生成密钥：若 `otp.json` 已存在 `v1.` 密封密文、但既无 env 主密钥也无 `otp-master.key`，进程启动解密时会明确抛出 `master key missing` 并停止，而不会写入一个与密文不匹配的新密钥文件去掩盖根因。这正是备份恢复场景的典型情况——只拷回了 `otp.json` 却丢了密钥：请同时恢复 `otp-master.key`（或重新设置 env 主密钥），或删除 `otp.json` 以重新绑定。自动生成密钥仅发生在**首次启用 OTP（seal 路径）**时。

#### OTP 密文解密失败时的 HTTP 响应

解密失败不会冒泡成裸 `500 internal error`（text/plain），而是返回 JSON 错误码，便于客户端/运维定位：

| 错误码 | HTTP | 触发场景 | 处理建议 |
| --- | --- | --- | --- |
| `otp-master-key-missing` | 503 | `otp.json` 存在 `v1.` 密文，但既无 env 主密钥也无 `otp-master.key` | 恢复 `otp-master.key` / 设置 `DSH_AUTH_GATEWAY_MASTER_KEY`，或删 `otp.json` 重绑 |
| `otp-master-key-invalid` | 500 | `DSH_AUTH_GATEWAY_MASTER_KEY` 或 `otp-master.key` 存在但长度不是 32 字节 | 修正主密钥值（hex/base64 编码的 32 字节） |
| `otp-secret-corrupted` | 500 | 密文格式损坏、被篡改，或曾用**不同主密钥**密封（如密钥被误轮换） | 恢复与密文匹配的主密钥，或删 `otp.json` 重绑 |

两类错误都带 `message` 字段给出可操作提示，登录/禁用 OTP 不再是无差别 500。

插件包自带重置命令 `dsh-auth-gateway-reset`（只删 password.json；安装时链接到 profile 的 `node_modules/.bin`，默认不在 PATH 上，用完整路径或先 `export PATH="$HOME/.dsh/profiles/<profile>/node_modules/.bin:$PATH"`）：

```bash
~/.dsh/profiles/web/node_modules/.bin/dsh-auth-gateway-reset
```

> `$DSH_HOME` 默认取 `~/.dsh`（即 `$HOME/.dsh`），可用环境变量覆盖；dsh 与插件读取同一值。

清除后**重启 dsh web**：插件在启动时生成新的初始密码并打印到控制台，用初始密码登录并完成引导、重新设置个人密码（插件没有"设置密码"页面，重置后不重启则无法登录）。

## 安全事件契约

`ctx.emit('dsh-auth-gateway/brute-force', payload)`，payload：

| kind | 字段 |
|---|---|
| `lockout` | `sourceAddress`, `maxFailures`, `lockedUntil` |
| `global-rate-limit` | `limit`, `windowSeconds` |
| `otp-rate-limit` | `sourceAddress`, `limit`, `windowSeconds` |

每个锁定/每个时间窗口只广播一次。
