# 故障排查

> 中文文档 | [English](../en/TROUBLESHOOTING.md)

本页收录 dsh-auth-gateway 实机部署中出现过的真实故障案例：症状、根因与修复。排查顺序：先确认服务存活 → 再看代理链路 → 最后核对版本差异。

## 1. 域名访问下「模型」设置页报「加载提供方目录失败： settings are unavailable in this browser」

**症状**：经域名/反向代理访问 dsh（如 `https://dsh.example.com`），打开 设置 → 模型 页报 `加载提供方目录失败: settings are unavailable in this browser`，点「重试」永久失败；直连 `127.0.0.1:8081`（内部 webserver）则一切正常。

**根因**（dsh 官方设计，非网关故障）：

1. dsh 把配置平面（`settings.describe`/`settings.update` 等特权 RPC）钉在 loopback-same-origin——官方注释原文：*"until a real authentication layer exists"*（`packages/client/connection/src/index.ts` 的 `PRIVILEGED_METHODS` 注释）。
2. 客户端侧，`ui-settings` 在**自身 apply 的瞬间**快照 `connection.isLoopback`（由 `location.hostname` 判定：`127.0.0.1`/`localhost` 为 true，任何域名为 false），并把 settings 持久化锁定为 **host**（loopback）或 **memory**（域名）。
3. memory 模式下 settings mirror 的 `load()/ensure()` 是**空操作**——请求根本不发，`view` 永远 undefined。
4. 模型页把「提供方目录」与「settings 视图」绑在同一个 `Promise.all` 里，视图缺失即整页报错，`Retry` 调用的 `load()` 同样是空操作 → 永久失败。

**为什么网关能修**：官方注释预见了"认证层"这一需求，但从未实现或指定任何具体方案。本项目选择自行承担这一角色：每个页面已通过密码 + 可选 OTP，且网关在服务端把 Host/Origin 重写为 loopback。因此把客户端的 `connection.isLoopback` 翻转为 true，是本项目基于自身安全模型的决策（页面已认证、RPC 经网关改写可过服务端栅栏），而非官方承诺的行为。它是唯一的、记录在案的安全例外，实现细节见下。

**修复实现**（`lib/lan-trust-script.js`，随索引页注入）：

- head 脚本定位在 dsh 的 loader 引导（`window.__ModuleLoader__=`）**之后**、任何 bundle 注册之前执行；
- 在 `loader.load` 上套**透传代理**，**只拦截** `@deepseek-ai/dsh-client-connection` 的注册，其余插件原样通过；
- 其 `apply` 包装**不碰 `ctx.provide`**（它是 mixin 生成的 accessor，读取时绑定到当前 ctx 的 receiver；对它赋值会污染全局共享的 `ReflectService`，导致劫持期间一切 `ctx.provide(...)` 落入 connection 的 fiber scope——这正是 auth-gateway@0.4.2 破坏 better-sidebar 的精确机制）；
- 改为在共享 `ctx.reflect` 上**临时替换 `provide` 本体**，捕获 `connection` handle，转发用 `originalProvide.call(this, ...)` 保持注册落在调用者自己的 fiber；
- 原 `apply` 返回后，对捕获的 handle 同步 `defineProperty isLoopback = true`——早于任何依赖方（ui-settings）从 PENDING 唤醒，使其快照读到 true；
- 幂等（`bootstrapKey` 防重入）、loader 形状不符时静默降级、全程 try/catch 不抛错。

**验证**（隔离实例 + 域名 hostname `dsh.local`）：模型页提供方全部列出、编辑可用、无错误；better-sidebar 等共存插件 0 报错；多轮重启稳定。

## 2. 插件报 `cannot get property "X" without inject`（原生依赖未编译）

**症状**：某插件面板打不开，控制台报 `dsh-better-sidebar: cannot get property "betterSidebar" without inject`；其 HTTP API 正常返回 200。

**根因**：插件宿主半初始化时原生模块加载失败，服务从未 `provide`，前端随后访问即抛此错。常见于 pnpm 拦截构建脚本后——profile 的 `pnpm-workspace.yaml` 出现：

```yaml
allowBuilds:
  node-pty: false
```

better-sidebar 依赖 `node-pty`（终端功能必需的原生模块）；纯 JS 插件（如 vision-toolkit）不受影响。

**修复**：

```sh
node -e "require('<profile>/node_modules/node-pty')"   # 确认绑定缺失
cd <profile>         # 例: ~/.dsh/profiles/web
pnpm approve-builds   # 把需要的包(如 node-pty)选为允许
pnpm rebuild node-pty
# 重启 dsh web 使宿主半重新初始化
```

## 3. 浏览器报 `failed to import loader entry ... bundle script ... failed to load`

含义：页面已加载，但某 `/plugins/<id>/client.js?rev=...` 脚本在**网络层**失败。三种来源：

| 来源 | 特征 |
|---|---|
| dsh 进程不在监听（重启窗口/启动失败） | nginx 错误日志成批 `connect() failed (111: Connection refused)`；访问日志对应 502 |
| 网关会话失效瞬间（内存会话随进程重启丢失） | 个别脚本请求被 302 到 `/login`，脚本拿到 HTML 无法执行 |
| 跨境链路超时 | 浏览器报 `net::ERR_TIMED_OUT`，重试恢复 |

**排查**：

```sh
tail -20 <nginx日志>/dsh_error.log          # 有无 connect() refused
curl -sI http://127.0.0.1:<内部端口>/plugins/@deepseek-ai/dsh-client-modules/client.js   # 直连上游
curl -skI https://<域名>/                    # 全链路(未登录应 302 → /login)
```

只要进程存活且会话有效，网关转发是字节级透传，bundle 加载不会因网关失败。

## 4. dsh 版本线与凭据文件格式（升级/降级后 dsh 无法启动）

| dsh 版本线 | `.credentials.yaml` 格式 | 行为 |
|---|---|---|
| 0.1.0-rc.7 / rc.8 | 平铺：`KEY: value` | 顶层键必须为非空字符串 |
| 0.1.1-rc.1 / rc.2 | `version: 1` + `refs:`/`records:` | 启动时自动把平铺文件迁移为新格式（**单向**） |
| 0.1.2-rc.1+ | 同 0.1.1 格式，新增 `client-connection/browser-session` record | 内部 webserver 新增浏览器认证（BrowserAuth）；本插件经官方 `credentials` 服务读取该 record 自动适配，无需手工操作 |

**症状**：切换版本后 `dsh web` 启动即退出，报 `credentials-local: the value for "version" in ~/.dsh/.credentials.yaml must be a string`；对外端口无人监听，浏览器表现为白屏或第 3 节的 loader 错误。

**修复**：留在 0.1.1 线无需操作；必须回 0.1.0 时手工把文件转回平铺（去掉 `version:` 行、`refs:` 键提升到顶层）。

**预防**：切换前备份整个数据目录：

```sh
tar -C ~ -czf "dsh-home-backup-$(date +%F-%H%M).tgz" .dsh
```

> 不要用 `rm -rf ~/.dsh` 解决问题：它会连带清空网关密码库（下次启动重新铸造一次性初始密码）、OTP 绑定、全部会话与设置。

## 5. 跨境访问慢/超时的 nginx 优化

dsh 启动要拉取约 40 个小体积 JS bundle，默认 `cache-control: no-cache`，nginx 默认不对 `application/javascript` 做 gzip、也不启用 HTTP/2。跨境高延迟链路上容易个别请求超时。建议：

```nginx
listen 443 ssl;
http2 on;                        # nginx ≥ 1.25.1;旧版: listen 443 ssl http2;

gzip on;
gzip_types application/javascript text/javascript application/json;
gzip_min_length 1024;
```