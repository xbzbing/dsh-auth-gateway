# 开发指南

## 架构

```
host（零构建，node:crypto / node:http）
├── index.js          # Cordis 插件入口：gateway 生命周期、tapIndex 注入（randomUUID + authenticated LAN trust）、安全事件与登录审计接线、首次部署初始密码
├── lib/gateway.js    # 认证网关：HTTP/WS 拦截与转发、认证状态机、防爆破三层、防重放、basePath 路由/跳转/转发剥离、登录审计事件、静态资产免认证
├── lib/gateway-otp.js # OTP 路由 handler（/otp/setup|enable|verify-setup|verify|verify-backup|disable，自 gateway.js 拆分）
├── lib/auth.js       # 会话表与 Cookie：内存 256-bit token、onboarding/OTP 状态标记、改密吊销
├── lib/page-shell.js # 页面脚手架共享件（基础 CSS、HTML 骨架、script 头：ERRORS + post）
├── lib/errors.js     # 页面错误文案总字典（中英双语，errorsFor 按页选取 + 覆盖）
├── lib/locale.js     # 页面语言解析（dsh 偏好 > Accept-Language > zh）
├── lib/store.js      # 密码存储（scrypt 异步哈希，$DSH_HOME/auth-gate/password.json）
├── lib/otp-store.js  # OTP 存储（secret + 备份码哈希 + lastCounter 水印）
├── lib/otp-crypto.js # OTP 密钥加解密（AES-256-GCM，主密钥来自环境变量或 key 文件）
├── lib/totp.js       # TOTP（RFC 6238/4226）：base32、生成/验证、防重放、otpauth URI、备份码
├── lib/qr-svg.js     # 零依赖 QR SVG 生成（Reed-Solomon、掩码评估）
├── lib/otp-page.js   # OTP 设置/验证页面（自包含 HTML）
├── lib/login-page.js # 登录/设置/改密页面
├── lib/onboarding-page.js # 引导页（设置个人密码 + 可选 OTP 绑定）
├── lib/policy.js     # 密码强度策略
└── lib/config.js     # Standard Schema 配置校验（含 basePath 子路径前缀）

client（可选，源码构建）
└── client/src/index.jsx  # 设置面板（认证设置：OTP/改密/登出），slot 注册（settings.section）
    client/build.mjs      # esbuild 构建 → client/index.js（dsh 经 exports["./client"] 服务）

scripts / tests
├── scripts/deploy.sh         # 部署流水线：语法检查 → 全量测试 → 同步到 DSH 安装目录 → 安装后验证（--restart 可选重启）
├── scripts/e2e.mjs           # Playwright 端到端（真实 dsh web：登录/2FA/改密全流程）
├── scripts/smoke.mjs         # mock Cordis ctx + 假上游的冒烟服务（供 verify.sh 使用，端口避开 3080/3081）
├── scripts/screenshots.mjs   # README 界面截图（docs/assets/*.png）
├── scripts/verify.sh         # curl 门禁验证（401/302/WS 拒绝/锁定）
├── scripts/reset.mjs         # dsh-auth-gateway-reset：仅删 password.json（双语输出）
├── scripts/uninstall.mjs     # dsh-auth-gateway-uninstall：删整个 auth-gate/（双语输出）
└── tests/                    # gateway / config / policy / otp / locale / basepath / patch-ports / plugin-contract / client-contract
```

设计要点：

- **零运行时依赖**：host 全部使用 Node 内置模块；client 构建产物仅 external 引用 dsh 运行时提供的模块；
- **官方扩展点**：`ctx.effect`（生命周期）、`webServer.tapIndex`（randomUUID 与 authenticated LAN trust 注入）、`ctx.slots`（client UI）、`ctx.emit`（安全事件）、`dsh.bundle`（组合 patch）；
- **basePath 子路径部署**：网关路由先剥离 `basePath` 前缀（带边界检查，`/dsh2/foo` 不会被误当作 `/dsh` 前缀），302 跳转统一拼接前缀，转发上游时再剥离；PWA 元数据（`manifest.webmanifest` / `favicon.svg`）与静态资产（`/assets/*`）免认证放行（浏览器子资源请求，无敏感信息）；
- **客户端 trust 时序**：index transform 在 queue-mode `__ModuleLoader__` 建立后、parser preload 前插入 bootstrap；它同时包装 queue/live 注册，并在 `dsh-client-connection` 调用 `ctx.provide('connection', handle)` 前设置 `handle.isLoopback = true`，避免 Settings 过早绑定 memory scope。此处依赖 DSH 的内部 loader 协议，结构不匹配时只记录一次告警；
- **页面双语**：`lib/locale.js` 解析渲染语言（`$DSH_HOME/settings.yaml` 的 `locale.preference` > 请求 `Accept-Language` > zh），页面文案按语言选取；错误消息集中在 `lib/errors.js` 一处维护（登录失败统一返回单一 `invalid-credentials` 码，防凭据枚举）；
- **登录审计**：登录成功/失败/登出/改密经 `gateway.onAuthEvent` 回调输出审计日志（`ctx.logger.info`，仅事件种类 + IP + 原因，绝不记录凭据）；
- **存储**：原子写（temp + rename）、0600/0700，与密码同模式；OTP 密钥以 AES-256-GCM 加密存储（主密钥来自 `DSH_AUTH_GATEWAY_MASTER_KEY` 或 `auth-gate/otp-master.key`，见 SECURITY.md）。

## 构建

```bash
npm run build:client   # 构建 client bundle（esbuild）
npm run build:check    # 重建并断言产物与源码一致
npm run check          # 语法检查（lib/*.js）+ 全量测试
npm test               # 全量测试
npm run deploy         # 部署流水线（语法 → 测试 → 同步 → 安装后验证）
```

client 构建产物（`client/index.js` + `.map`）随源码入库，但 `build:check` 确保二者一致——修改 JSX 源码后必须重新构建。

## 开发统计

本项目由 **DeepSeek Harness（dsh）** 完成开发与测试。早期开发会话（密码门禁阶段，模型 `deepseek-v4-flash`）：

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

> 说明：缓存命中数据来自模型提供方返回的 prefix-cache（KV cache）指标；高命中率源于长会话中每步输入前缀的稳定复用。OTP 阶段（含安全评审、跨仓库 PR 协作）另计，未包含在上表。

## 版本历史

- `0.4.2`：basePath 子路径部署（路由/跳转/转发剥离 + PWA/静态资产免认证）、登录审计日志、登录失败统一错误码 + 页面错误字典集中化（lib/errors.js）、中英文部署文档（DEPLOYMENT / NGINX-DEPLOYMENT）；
- `0.4.1`：认证后 LAN 浏览器设置支持（loopback-trusted，PR #7）；
- `0.4.0`：OTP 密钥 AES-256-GCM 加密存储（主密钥来自 `DSH_AUTH_GATEWAY_MASTER_KEY` 或自动生成的 `otp-master.key`），兼容旧明文记录；
- `0.3.1`：从设置面板启用 OTP 无需部署开关；激活时吊销全部会话；
- `0.3.0`：网关页面跟随 dsh 语言（preference > Accept-Language > zh）、设置面板 i18n、首次部署控制台提示中英对照；
- `0.2.0`：OTP 双因素认证（TOTP + 备份码 + QR）、多层防爆破、client 设置面板、安全评审修复（重验证、防重放、限流）；
- `0.1.0`：密码门禁（设置/登录/改密、密码策略、失败锁定、全局限速、安全事件）。