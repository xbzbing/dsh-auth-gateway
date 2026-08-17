# 测试指南

## 单元与契约测试

```bash
npm test
```

86 项测试（node:test），覆盖：

| 文件 | 覆盖 |
|---|---|
| `tests/gateway.test.mjs` | 认证门禁（401/302/WS 拒绝）、转发（Host/Origin 改写、绝对 URI 规范化）、锁定/限流/安全事件、会话生命周期、DNS-rebinding 契约 |
| `tests/otp.test.mjs` | TOTP 算法（RFC 6238/4226）、备份码、OTP 存储、OTP 路由（启用/禁用重验证、防重放、限流、otpDigits）、S1/S2 安全回归 |
| `tests/policy.test.mjs` | 密码强度策略矩阵 |
| `tests/config.test.mjs` | 配置 Schema 校验（默认值、非法值、边界） |
| `tests/plugin-contract.test.mjs` | Cordis 插件契约（loader normalize、Config 校验） |
| `tests/patch-ports.test.mjs` | bundle patch 端口表达式推导（`--port` 跟随） |
| `tests/client-contract.test.mjs` | client bundle 契约（loader 注册、inject 对齐、api inject face、无 ctx、external） |

## 构建一致性

```bash
npm run build:check   # 重建 client bundle 并断言产物与源码一致（防手改产物）
```

## 浏览器端到端（Playwright，真实实例）

对运行中的实例执行完整浏览器流程（初始密码登录 → 引导设置个人密码 → 首页加载 → 登出/登录 → 弱密码/确认校验 → 改密/重登录，断言零 JS 错误；**会真实修改密码**，最终密码为 `PASSWORD-2`）：

```bash
# 已配置实例
BASE=http://127.0.0.1:8002 PASSWORD=your-password node scripts/e2e.mjs
# 全新部署：从 dsh 控制台复制初始密码
BASE=http://127.0.0.1:8002 INITIAL_PASSWORD=<控制台初始密码> PASSWORD=your-password node scripts/e2e.mjs
```

脚本区分"全新部署（传入 `INITIAL_PASSWORD` 走引导流程）"与"已配置（直接登录）"两种状态；需要本机有 playwright（`npm i -D playwright`）与 chromium。

## API/WebSocket 门禁验证（curl）

```bash
BASE=http://127.0.0.1:8002 PASSWORD=your-password ./scripts/verify.sh
```

覆盖：未认证 401/302、设置/登录/改密/登出全流程、已认证转发、**未认证 WebSocket 升级拒绝**、改密后旧会话吊销。**会真实修改密码**（最终密码为 `PASSWORD-new`）。

## 本地冒烟（无 dsh 环境）

```bash
node scripts/smoke.mjs    # mock ctx + 假上游，快速验证网关行为
```

## 界面截图（README 演示图）

```bash
# 需要带 otpEnabled 的实例（overlay patch 示例见脚本注释），然后：
node scripts/screenshots.mjs    # 输出到 docs/assets/*.png
```

截图脚本会重建凭据（初始密码登录后设置演示密码 `DemoPass!1`、启用 OTP），可重复运行；覆盖：引导（设置个人密码）、登录（含 2FA）、2FA 登录成功、OTP 设置（QR）、设置菜单、认证设置面板。
