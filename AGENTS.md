# AGENTS.md

dsh-auth-gateway 是 dsh web 前面的密码 + TOTP 认证网关（Cordis 插件）：网关独占对外端口，bundle patch 把内部 webserver 钉在 `127.0.0.1:<N+1>`，每个 HTTP 请求与 WebSocket 升级先过认证门再转发。ESM（`"type": "module"`）、Node >= 20。改 `lib/` 前先读 [docs/zh/DEVELOPMENT.md](docs/zh/DEVELOPMENT.md)；安全语义见 [docs/zh/SECURITY.md](docs/zh/SECURITY.md)。

## 仓库布局

```
index.js        插件入口：gateway 生命周期、tapIndex 注入（randomUUID polyfill +
                basePath 全局量 + authenticated LAN trust bootstrap）、初始密码铸造、
                安全事件与登录审计接线
lib/
  gateway.js    认证门禁：路由、认证状态机（会话/onboarding/OTP 三态）、三层防爆破、basePath 剥离
  gateway-otp.js OTP 路由 handler（自 gateway.js 拆分，经 priv 桥接访问网关私有方法）
  forward.js    HTTP/WS 转发管道：Host/Origin 回环改写、upgrade 双向管道、lanAddresses
  auth.js       内存会话表（256-bit token）+ Cookie 编解码
  audit-log.js  审计日志文件 sink（JSONL，$DSH_HOME/auth-gate/audit.log，按天轮转、保留 90 天）
  locale.js     页面语言解析（settings.yaml preference > Accept-Language > zh）
  errors.js     页面错误文案总字典（中英；errorsFor 按页选取 + 场景覆盖）
  store.js      密码存储（异步 scrypt，$DSH_HOME/auth-gate/password.json）
  otp-store.js  OTP 记录（mtime+size 缓存；secret AES-256-GCM 密封落盘）
  otp-crypto.js 主密钥解析（env > key 文件）与 seal/unseal；解密失败分类为 OTPCryptoError
  totp.js       TOTP RFC 6238/4226 + 备份码；qr-svg.js 零依赖 QR SVG
  *-page.js     自包含 HTML 页面（login / onboarding / otp），共享脚手架在 page-shell.js
  policy.js     密码强度策略（服务端权威，客户端仅提前反馈）
  config.js     Standard Schema v1 配置校验
client/         设置面板（slot settings.section）；src/index.jsx 源码，index.js+.map 为入库构建产物
scripts/        deploy.sh 同步流水线；verify.sh/e2e.mjs 实机验证；smoke.mjs 冒烟；
                reset.mjs/uninstall.mjs 凭据命令（bin）；screenshots.mjs README 截图
tests/          node:test 单测（文件清单见 package.json 的 test script）
docs/           zh/ 与 en/ 双语文档目录
```

## 命令

```sh
npm test              # 全量测试；测试文件在 package.json 显式列出——
                      # 新增 tests/*.mjs 必须手动加入该列表，否则不会被执行
npm run check         # node --check lib/*.js + npm test（无 linter/typecheck）
npm run build:client  # esbuild 构建 client bundle（改动 client/src/ 后必须运行）
npm run build:check   # 重建并断言产物与源码一致
npm run deploy        # 语法检查 → 测试 → 同步到 $DSH_PROFILE_DIR（默认 ~/.dsh/profiles/web）→ 安装后验证
```

单文件语法检查用 `node --check <file>`；实机端到端见下方「实机验证」。

## 约定

- **零运行时依赖**：host 代码只用 Node 内置模块；client 构建产物只允许 external 引用 dsh 运行时模块。新依赖需要证明现有手段不可行。
- **依赖只从公共 npm registry 解析**：package-lock.json 的 `resolved` 必须指向 `https://registry.npmjs.org/`，禁止内网镜像；提交前检查 lock 文件无内网 registry 残留。
- **回环钉扎是安全根基**：webserver 必须保持 `127.0.0.1`（cordis.patch.yml），对外暴露由网关 `listenHost` 承担；任何放宽都是破坏性变更。
- **新增 lib 文件必须同步两处清单**：package.json 的 `test` script（测试可见性）与 scripts/deploy.sh 的 `JS_FILES`（部署同步按显式列表复制，不在列表即不到达已安装副本）。
- **Cordis patch 的 `config:` 是整对象替换**：profile patch 覆盖字段时必须重申 bundle patch 的全部字段（含 `!!js` 动态端口表达式），漏写即回退默认值。
- **客户端面板经注入的 basePath 全局量构造 API 路径**（`window.__dshAuthGatewayBasePath__`，由 index.js tapIndex 写入）：面板内禁止根绝对路径 fetch/跳转，否则子路径部署失效。
- **登录失败只返回统一错误码** `invalid-credentials`（防凭据枚举）；受保护流程（OTP 绑定/禁用）才允许细分错误码。页面文案一律走 lib/errors.js 字典，不硬编码。
- **安全状态变更必须留审计**：登录/登出/改密/OTP 启停经 `onAuthEvent` 输出（只含 kind/ip/reason，绝不带凭据），并与暴力破解告警（`onSecurityEvent`）一同落盘 `audit.log`（lib/audit-log.js）；错误密码计入与登录共享的按地址锁定。
- **凭据落盘模式**：原子写（temp + rename）、文件 0600 / 目录 0700；scrypt 只用异步 API；OTP secret 先 AES-256-GCM 密封再写盘，主密钥缺失时显式报错、绝不静默重生成。
- **CLI 脚本输出中英双语**（reset/uninstall 及首次部署控制台提示），保持既有格式风格。

## 文档与发布

- 文档双语：`docs/zh/` + `docs/en/` 一一对应（第 3 行语言切换，跨语言链接 `../zh/`、`../en/`），README.md（中文）与 README.en.md 成对修改；改动后校验链接可解析。docs 不打进 npm 包（`files` 不含 docs/）。
- 版本号同时改 `package.json` 与 `package-lock.json`（根 + `packages[""]` 两处）；打 tag `vX.Y.Z`，`gh release` 用中文发布说明。
- 提交信息：conventional 前缀（`feat:`/`fix:`/`docs:`/`chore:`）+ 中文描述。

## 实机验证

`scripts/verify.sh`（curl 门禁）与 `scripts/e2e.mjs`（Playwright）需要运行中的实例（`BASE=... PASSWORD=... ./scripts/verify.sh`），且**都会真实修改密码**。无 dsh 环境用 `node scripts/smoke.mjs`（mock ctx + 假上游，端口 3180/3181，避开真实 3080/3081）。