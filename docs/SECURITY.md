# 安全模型

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
| 存储泄露（`$DSH_HOME` 文件被读取） | 密码与备份代码为 scrypt 哈希；**OTP 密钥为明文 Base32**（见"已知限制"） |
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

### 防爆破分层

| 层 | 机制 | 覆盖 |
|---|---|---|
| 全局 | 每分钟全局预算（默认 60 次） | 密码、OTP、备份码验证共用 |
| 来源 | 失败锁定（5 次/5 分钟） | 密码失败与 OTP 失败计入同一锁定 |
| 来源 | OTP 独立窗口（10 次/分钟） | OTP/备份码验证 |

`x-forwarded-for` 不参与来源判定（防止伪造）；锁触发与限流耗尽时输出 `ctx.logger.warn` 并广播 `dsh-auth-gateway/brute-force` 事件（`{kind: 'lockout'|'global-rate-limit'|'otp-rate-limit', ...}`，JSON 负载，每个锁定/窗口一次）。

### 转发与 fence

网关转发前将 `Host`/`Origin` 改写为回环地址：内部 trust fence 的 LAN 信任列表基于 webserver 监听地址采样，而本插件将 webserver 钉在 `127.0.0.1`，若不改写则 LAN 访问会被内部 403。改写是安全的——fence 的远程可达性防护职责已由网关 Cookie 门禁接管（跨站/DNS-rebinding 请求无会话 Cookie，在网关即被拒绝）。

## 已知限制

- **OTP 密钥明文存储**：`$DSH_HOME/auth-gate/otp.json` 中的 Base32 密钥未加密。缓解：文件 0600、目录 0700、本机可信模型；生产建议用主密钥加密（后续方向）；
- **明文 HTTP**：密码与 Cookie 在网络中明文传输。局域网部署建议置于可信网络，或前置 TLS 反向代理（见 DEPLOYMENT.md）；
- **OTP 启用权限（DoS 面）**：`/otp/enable` 与 `/otp/verify-setup` 仅要求任意有效会话——启用 2FA 是用户操作（无需部署开关），密码泄露场景下攻击者可用泄露的密码登录后绑定自己的认证器，锁死真实用户登录。这不构成凭据窃取，主要是 DoS 面；缓解为启用成功后**吊销全部会话**（含启用者自身，强制在 2FA 策略下重新登录）；后续方向为启用时要求密码重验证；
- **内存会话**：dsh 重启后全员下线（需重新登录；OTP 已启用时需重新完成 2FA）；
- **无分布式防护**：全局限流按单进程计数，多实例部署或分布式攻击者可分摊请求；
- **backup code 生成存在轻微模偏差**（`bytes % 34`），不影响实际安全性（空间仍为 34^8）。

## 恢复路径

忘记密码、丢失认证器或遭遇上述 DoS 面时（需本机访问权限）：

```bash
# 清除密码记录（等价于下面的 dsh-auth-gateway-reset）
rm -f "$DSH_HOME/auth-gate/password.json"
# 丢失认证器时，一并清除 OTP 绑定
rm -f "$DSH_HOME/auth-gate/otp.json"
```

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
