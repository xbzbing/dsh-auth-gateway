# dsh-auth-gateway

<p align="center">
<a href="https://www.npmjs.com/package/dsh-auth-gateway"><img src="https://img.shields.io/npm/v/dsh-auth-gateway.svg" alt="npm version"></a>
<a href="https://www.npmjs.com/package/dsh-auth-gateway"><img src="https://img.shields.io/npm/dt/dsh-auth-gateway.svg" alt="npm total downloads"></a>
<a href="LICENSE"><img src="https://img.shields.io/npm/l/dsh-auth-gateway.svg" alt="npm license"></a>
</p>

<p align="center"><b>Language: 简体中文 | <a href="README.en.md">English</a></b></p>

为 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) Web 提供认证门禁的 Cordis 插件：**密码认证 + TOTP 双因素认证 + 多层防爆破 + 会话管理 + 登录审计**，并在网关层**真实拦截每一个请求**（HTTP 与 WebSocket），未认证流量无法触及后端。

`dsh web` 本身没有任何认证层（其内置 trust fence 是可达性策略而非认证）。本插件以进程内网关形态补齐认证面：对外端口由网关独占，内部 webserver 由 bundle patch 钉在回环地址，网关是唯一入口。

## 安装和卸载

```bash
# 安装（从 npm registry）
dsh plugin --profile web add dsh-auth-gateway

# 启动（对外端口 8080，内部 webserver 自动挪到 8081）
dsh web --port 8080

# 卸载（先清凭据，再移除插件）
~/.dsh/profiles/web/node_modules/.bin/dsh-auth-gateway-uninstall
dsh plugin --profile web remove dsh-auth-gateway
```

- 支持从 GitHub / 本地目录安装，见 [docs/INSTALL.md](docs/INSTALL.md)；
- 忘记密码用 `dsh-auth-gateway-reset` 重置（重启后控制台打印新初始密码）；
- 部署指南：[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)

## 功能特性

- **密码认证**：首次部署自动生成初始密码（控制台打印，一次性），登录后引导设置个人密码（scrypt 哈希存储），之后每次访问需登录；
- **双因素认证（TOTP）**：可选启用，兼容 Google Authenticator、Authy、1Password 等主流认证器；含一次性备份代码（scrypt 哈希存储、单次使用），设备丢失时可恢复访问；**OTP 密钥以 AES-256-GCM 加密存储**（主密钥来自环境变量 `DSH_AUTH_GATEWAY_MASTER_KEY` 或自动生成的 `auth-gate/otp-master.key`），磁盘泄露不再直接暴露第二因素根密钥；
- **真实请求拦截**：未认证 `/api/*` 返回 401、页面类路径 302 到登录页、WebSocket 升级直接拒绝；认证通过后请求透明转发（Host/Origin 规范化，兼容内部 trust fence）；
- **子路径部署（basePath）**：支持挂在反向代理子路径下（如 `https://example.com/dsh/`）。配置 `basePath: /dsh` 后，网关自动处理路由剥离、302 跳转拼接与上游转发剥离；PWA 元数据（manifest/favicon）和静态资源（`/assets/*`）免认证放行。**注意**：DSH 是根路径应用，前端 JS 引用 `/assets/...`、`/api/...`、`/plugins/...` 等绝对 URL——子路径部署时这些路径不会自动带前缀，需要 nginx 额外转发。**推荐子域名部署**（`dsh.example.com`，根路径，零冲突），详见 [docs/NGINX-DEPLOYMENT.md](docs/NGINX-DEPLOYMENT.md)；
- **登录审计**：登录成功 / 失败 / 登出 / 改密均输出审计日志（`ctx.logger.info`，含来源 IP 与失败原因，不记录任何凭据），配合暴力破解告警形成完整可审计闭环；
- **认证后的 LAN 设置支持**：在 DSH 客户端模块初始化前，将经过网关访问的浏览器连接标记为 loopback-trusted，使 Models、Credentials、语言/主题偏好和其他 host-backed settings 可读取并持久化；
- **多层防爆破**：密码失败按来源锁定（默认 5 次/5 分钟）+ 全局速率限制（默认 60 次/分钟）+ OTP/备份码独立限流（默认 10 次/分钟），scrypt 在 libuv 线程池异步执行，登录洪峰不阻塞事件循环；
- **会话管理**：内存 256-bit token（30 天），HttpOnly + SameSite=Strict Cookie，修改密码/禁用 OTP 吊销全部会话；
- **安全事件**：锁触发、限流耗尽时输出告警日志并广播 `dsh-auth-gateway/brute-force` Cordis 事件（JSON 负载），供监控与联动；
- **中英双语**：设置面板跟随 dsh 界面语言（设置 → 语言）；登录 / 引导 / OTP 页面按你的语言偏好渲染（`$DSH_HOME/settings.yaml` 的 `locale.preference`），未设置偏好时跟随浏览器语言（Accept-Language），刷新即生效；首次部署的控制台提示中英对照输出；
- **合规形态**：host-only 插件（零构建、零运行时依赖）+ 可选 client 半（设置面板，源码构建），全部经 dsh 官方扩展点（`ctx.effect`、`webServer.tapIndex`、`ctx.slots`）。

## 工作原理

```
浏览器 ──> dsh-auth-gateway 网关（对外端口，运行在 dsh 进程内）
               │  每个请求先过认证检查（会话表 O(1)）
               ├─ 未认证 ─> /api/*: 401 ｜ 页面: 302 /login ｜ WS: 拒绝
               ├─ 未通过 2FA ─> /otp/verify
               └─ 已认证 ─> 转发（Host/Origin 改写为回环）──> dsh webserver（127.0.0.1:内部端口）
```

- 网关生命周期与 dsh 绑定：随 dsh 启动/退出，无独立进程；
- bundle patch 将 webserver 移到回环端口（对外 = `--port`，内部 = 对外 + 1），远程无法绕过网关直连后端；
- 网关在 DSH 的 `__ModuleLoader__` 加载 connection 模块时、Settings 等消费者启动前建立客户端 loopback trust；该兼容层不替代登录、HTTP/WebSocket 门禁或服务端 fence；
- 认证状态机：`首次部署 → 初始密码登录 → 引导（设置个人密码）→ 登录 →（可选）OTP 验证 → 会话`；未完成引导或 2FA 的会话仅能访问对应验证端点。

## 界面预览

<table>
<tr>
<td align="center"><img src="docs/assets/onboarding.png" width="480" alt="引导页（设置个人密码）"><br/>引导页（初始密码登录后）</td>
<td align="center"><img src="docs/assets/login.png" width="480" alt="登录（含 2FA 验证码）"><br/>登录（含 2FA 验证码）</td>
</tr>
<tr>
<td align="center"><img src="docs/assets/login-success.png" width="480" alt="2FA 登录成功"><br/>2FA 登录成功</td>
<td align="center"><img src="docs/assets/otp-setup.png" width="480" alt="OTP 设置（QR 码）"><br/>OTP 设置（QR 码）</td>
</tr>
<tr>
<td align="center"><img src="docs/assets/settings-menu.png" width="480" alt="设置菜单（含认证设置入口）"><br/>设置菜单（含"认证设置"入口）</td>
<td align="center"><img src="docs/assets/settings-auth.png" width="480" alt="认证设置面板"><br/>认证设置面板</td>
</tr>
</table>

## 快速开始

1. 启动 `dsh web`：首次部署自动生成**初始密码**并打印在控制台（醒目提示块）；请复制备用；
2. 打开 Web UI，用初始密码登录——将进入**引导页**：设置你自己的访问密码（至少 8 位，包含大小写字母或特殊字符；**强制**，设置完成前所有功能不可用）；初始密码为一次性凭据，设置后自动失效；
3. 登录后可访问 `/otp/setup` 启用 TOTP（扫码或手动输入密钥，输入验证码确认；同时生成备份代码请妥善保存）；
4. 已启用 OTP 后，登录需密码 + 验证码（或备份代码）；
5. 修改密码：访问 `/login`（已登录时显示改密表单），或经"认证设置"面板。

## 配置

以下字段为 bundle patch / profile patch 中 `dsh-auth-gateway` 行的 `config`（Standard Schema 校验）：

| 字段 | 默认 | 含义 |
|---|---|---|
| `listenHost` / `listenPort` | `0.0.0.0` / `3080` | 网关对外监听地址与端口 |
| `upstreamHost` / `upstreamPort` | `127.0.0.1` / `3081` | 内部 webserver 地址与端口 |
| `basePath` | `/` | 反向代理子路径前缀（如 `/dsh`）；**默认 `/`（根路径）**。子路径部署时在**部署方 profile patch** 中配置，不随插件分发 |
| `minPasswordLength` | `8` | 密码最小长度（4–128） |
| `requireMixedCase` / `requireSpecial` | `true` / `true` | 密码复杂度：大小写混合或特殊字符二选一满足 |
| `maxLoginFailures` / `lockMinutes` | `5` / `5` | 密码失败锁定阈值与时长 |
| `maxGlobalAuthAttemptsPerMinute` | `60` | 全局登录尝试速率上限 |
| `maxOtpAttemptsPerMinute` | `10` | 单来源 OTP/备份码验证速率上限 |
| `otpEnabled`（已废弃） | `false` | 不再作为启用开关——2FA 由用户登录后在「认证设置」中绑定激活；字段保留仅为兼容旧配置 |
| `otpRequired` | `false` | 2FA 激活后强制每次登录验证（无需任何配置） |
| `otpIssuer` / `otpPeriod` / `otpDigits` / `otpWindow` | `dsh-auth-gateway` / `30` / `6` / `1` | TOTP 参数（显示名、周期、位数、窗口） |
| `backupCodeCount` / `backupCodeLength` | `10` / `8` | 备份代码数量与长度 |

## 安全模型

认证状态变更（启用/禁用 OTP、修改密码）均要求完整验证：2FA 激活时禁用 OTP 需当前密码 + 验证码或备份代码；未完成 2FA 的会话不能访问敏感端点。OTP 验证防重放（记录已接受时间步）、防伪造（`x-forwarded-for` 不计入来源）。**OTP 密钥在落盘前以 AES-256-GCM 密封**，读取需主密钥——默认自动生成 `auth-gate/otp-master.key`（0600），也可经环境变量 `DSH_AUTH_GATEWAY_MASTER_KEY`（hex/base64，32 字节）注入以隔离磁盘泄露。登录审计只记录事件种类、来源 IP 与失败原因，不落任何凭据。完整威胁模型、已知限制与恢复路径见 [docs/SECURITY.md](docs/SECURITY.md)。

## 文档

| 文档 | 内容 |
|---|---|
| [docs/INSTALL.md](docs/INSTALL.md)（[English](docs/INSTALL.en.md)） | 安装、更新、卸载、凭据重置的完整操作步骤 |
| [docs/NGINX-DEPLOYMENT.md](docs/NGINX-DEPLOYMENT.md)（[English](docs/NGINX-DEPLOYMENT.en.md)） | 配合 nginx 部署：裸金属直连 / 子域名 / 子路径 / Docker nginx 容器四种拓扑与配置示例 |
| [docs/SECURITY.md](docs/SECURITY.md)（[English](docs/SECURITY.en.md)） | 威胁模型、OTP 安全设计、已知限制与恢复路径 |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)（[English](docs/DEPLOYMENT.en.md)） | 端口与监听、LAN 部署、HTTPS 建议、nginx 反向代理、故障排查 |
| [docs/TESTING.md](docs/TESTING.md)（[English](docs/TESTING.en.md)） | 单元测试、端到端（Playwright）、API/WebSocket 门禁验证 |
| [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)（[English](docs/DEVELOPMENT.en.md)） | 架构说明、构建、开发统计 |

## 致谢

- **@adra2n** — 实现 OTP 双因素认证（[PR #1](https://github.com/xbzbing/dsh-auth-gateway/pull/1)），并添加 OTP 密钥 AES-256-GCM 静态加密存储与解密路径错误分类（[PR #6](https://github.com/xbzbing/dsh-auth-gateway/pull/6)）；
- **@meowtech** — 实现认证后 LAN 浏览器设置支持（[PR #7](https://github.com/xbzbing/dsh-auth-gateway/pull/7)），修复远程访问下 host-backed settings 不可用的问题。

## 验证概览

- 单元与契约测试：`npm test`（131 项，含 basePath 路由/重定向/转发、PWA 元数据放行、登录审计、OTP 安全回归、client 契约、patch 端口推导）
- 部署流水线：`npm run deploy`（语法检查 → 全量测试 → 同步到 DSH 安装目录 → 安装后验证）
- 实机端到端：`node scripts/e2e.mjs`（Playwright，登录/2FA/改密全流程）
- 门禁验证：`./scripts/verify.sh`（curl，401/302/WS 拒绝/锁定）

详见 [docs/TESTING.md](docs/TESTING.md)。

## Model Experience

None，本包是浏览器与内部 dsh webserver 之间的认证载体，不会进入任何模型请求。

#### KV Cache effect

None；本包既不组装也不发送 provider请求。

## License

MIT
