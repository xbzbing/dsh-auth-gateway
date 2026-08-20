# AGENTS.md

Cordis 插件（`dsh-auth-gateway`）：在 dsh web 前面加一道密码 + TOTP 认证网关。ESM（`"type": "module"`）、Node >= 20、**零运行时依赖** —— host 代码只能用 Node 内置模块（client bundle 可以 external 引用 dsh 运行时模块）。

## 命令

```bash
npm test          # 全量测试（131 项）；测试文件在 package.json 中显式列出 ——
                  # 新增 tests/*.mjs 不会被自动发现，必须手动加入列表
npm run check     # node --check lib/*.js + npm test（无 linter/typecheck）
npm run build:client  # esbuild → client/index.js + .map（提交入库的构建产物）
npm run build:check   # 重建并断言产物与源码一致（改动 client/src/ 后运行）
npm run deploy        # scripts/deploy.sh：语法检查 → 测试 → 同步到已安装 profile → 验证
```

测试用 `node:test` + `assert/strict`；gateway/otp/basepath/locale 测试自己把 `process.env.DSH_HOME` 设为临时目录。

## 架构

- `index.js` — 插件入口：`tapIndex` 注入 randomUUID polyfill + `__ModuleLoader__` bootstrap（把 `connection.isLoopback` 标记为 true，让认证后的 LAN 浏览器获得 host-backed 设置）；铸造首次部署初始密码；把 `onSecurityEvent` / `onAuthEvent` 接到日志 + `ctx.emit`。
- `lib/gateway.js` — 整个认证门禁（路由、认证状态机、速率限制、转发、basePath）。OTP 路由在 `lib/gateway-otp.js`。
- `lib/errors.js` — 页面错误文案的总中英字典；登录失败故意只返回一个码（`invalid-credentials`，防枚举）。
- `client/src/index.jsx` — 设置面板（slot `settings.section`）；改完必须重建 + `build:check`。
- `cordis.patch.yml` — bundle patch 把 webserver 钉在 `127.0.0.1:<N+1>`；对外端口 N 归网关。**绝不放宽回环钉扎** —— index.js 在 `webServer.host !== '127.0.0.1'` 时告警。

## 坑

- **新增 lib 文件 → 必须更新 `scripts/deploy.sh` 的 `JS_FILES`** —— 它按显式列表同步到 `$DSH_PROFILE_DIR`（默认 `~/.dsh/profiles/web`）；不在列表上的文件不会到达已安装副本。
- Cordis patch 里的 `config:` 是**整对象替换**，不是字段合并。文档/`basePath` 覆盖必须重申所有字段（见 docs/zh/NGINX-DEPLOYMENT.md 拓扑 C）。
- CLI 脚本（`scripts/reset.mjs`、`scripts/uninstall.mjs`）输出中英双语 —— 保持这个风格。
- bin 链接在 profile 的 `node_modules/.bin`，不在 PATH 上。

## 文档与发布约定

- 文档中英双语：`docs/zh/*.md` + `docs/en/*.md`（第 3 行语言切换，跨语言链接 `../zh/` / `../en/`），README.md（中文）+ README.en.md。**两种语言必须一起改**；验证链接可解析（docs 不打进 npm 包 —— package.json 的 `files` 不含 docs/）。
- 版本号：`package.json` **和** `package-lock.json`（两处：根 + `packages[""]`）都要改。打 tag `vX.Y.Z`，`gh release` 用中文发布说明（历史发布都是中文）。
- 提交风格：conventional 前缀（`feat:`/`fix:`/`docs:`/`chore:`）+ 中文描述。

## 对真实 dsh 实例验证

- `scripts/verify.sh`（curl 门禁）和 `scripts/e2e.mjs`（Playwright）需要运行中的实例：`BASE=... PASSWORD=... ./scripts/verify.sh`；两者**真的会改密码**。
- `scripts/smoke.mjs` = mock ctx + 假上游，端口 3180/3181（故意避开 3080/3081）。
- `scripts/screenshots.mjs` 把 README 图片写到 `docs/assets/`。