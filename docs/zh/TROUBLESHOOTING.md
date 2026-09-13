# 故障排查

> 中文文档 | [English](../en/TROUBLESHOOTING.md)

本页收录 dsh-auth-gateway 实机部署中出现过的真实故障案例：症状、根因与修复。排查顺序：先确认服务存活 → 再看代理链路 → 最后核对版本差异。

## 1. 域名访问下「模型」设置页报「加载提供方目录失败： settings are unavailable in this browser」

**症状**：经域名/反向代理访问 dsh（如 `https://dsh.example.com`），打开 设置 → 模型 页报 `加载提供方目录失败: settings are unavailable in this browser`，点「重试」永久失败；直连 `127.0.0.1:8081`（内部 webserver）则一切正常。

**根因**（dsh 官方设计，非网关故障）：

1. dsh 把配置平面（`settings.describe`/`settings.update` 等特权 RPC）钉在 loopback-same-origin——最初以注释 *"until a real authentication layer exists"* 说明（该注释已在 dsh 0.1.2 实现 BrowserAuth 时移除，配置面访问改由浏览器会话认证接管）。
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
## 6. upstream 返回 `dsh web authentication required`（dsh ≥ 0.1.2）

**症状**：登录网关成功，但页面与 `/api` 报文本 `dsh web authentication required; reopen the URL printed by dsh web.`。该文本是 dsh 0.1.2+ 内部 webserver 的 BrowserAuth 401——请求已穿过网关到达内部服务器，但没带有效的上游 cookie。

**背景**：dsh 0.1.2 起内部服务器对 index 与 `/api` 强制浏览器认证；网关需经官方 `credentials` 服务读取 `client-connection/browser-session` 密钥，为回环一跳铸造同构 cookie（机制见 SECURITY.md）。下列场景会缺失该 cookie：

| 场景 | 现象 | 修复 |
|---|---|---|
| 插件是 npm 旧版（≤ 0.5.1，无 `lib/upstream-auth.js` 桥接） | 所有转发永久 401 | 改用 GitHub main（`dsh plugin --profile web add github:xbzbing/dsh-auth-gateway#main`）或等 npm 发版后重新安装 |
| 全新部署/撤销后重启的启动窗口（record 由 dsh 的 Connection 激活时创建，可能晚于网关启动） | 启动初期短暂 401，随后自行恢复 | 升级到含快速重试（2s）+ 后台轮询的版本（`eca3b0b` 起） |

**排查**：确认插件版本与 `node_modules/dsh-auth-gateway/lib/upstream-auth.js` 存在；查看启动日志有无 `读取 upstream browser-session 密钥失败` 告警（持续 401 + 告警 = 密钥读取问题，而非版本问题）。

## 7. 登录成功但页面提示连接失败（`WebSocket connection to '.../api/remote.mux' failed`）

**症状**：页面能打开、密码（+ OTP）登录成功，随后页面提示「连接失败」；浏览器 console 只有一句 `WebSocket connection to 'wss://<域名>/api/remote.mux' failed:`——HTTP 请求全部正常，只有 WebSocket 不通。

**根因**：`/api/remote.mux` 是 dsh API Gateway 独占的 Remote 流多路复用 WebSocket。nginx 把 `Upgrade`/`Connection` 当作**逐跳头**处理：**只有显式 `proxy_set_header Upgrade` 的 location 才会转发它们**。若反代配置里为「已知的 WebSocket 路径」单独写了 location（例如照抄旧文档的 `/api/events.mux`、`/sidebar/ws/*`），而兜底 `location /` 没有这两个头，那么 `/api/remote.mux` 会落到兜底 location：

```
浏览器 --Upgrade--> nginx --(Upgrade 被丢弃，降级为普通 GET)--> 网关
                                                              ↓
                              Node 不触发 'upgrade' 事件 → 按普通 HTTP 转发
                                                              ↓
                                          upstream 按普通 GET 处理 → 404
                                                              ↓
                                      浏览器只看到 "WebSocket connection failed"
```

**快速判定**（在部署机上执行，绕过 nginx 直连网关端口）：

```bash
# 把 8080 换成网关 listenPort。101 = 网关侧正常，问题在 nginx 配置
curl -i -s -N -o /dev/null -w '%{http_code}\n' \
  -H 'Connection: Upgrade' -H 'Upgrade: websocket' \
  -H 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==' -H 'Sec-WebSocket-Version: 13' \
  http://127.0.0.1:8080/api/remote.mux
```

- 返回 `101` 或 `401`（未带会话 cookie 时网关会先拒绝握手）→ 网关正常，问题在 nginx，按下表修；
- 网关日志出现 `WebSocket 握手缺少 Upgrade 头` → 确认是反代丢了 `Upgrade`，同样按下表修（该告警每个实例只打一次，客户端重试不会刷屏）。

**修复**：把 `Upgrade`/`Connection` 放到**兜底 location** 上，用 `map` 让普通请求保持 keep-alive（不要写死 `"upgrade"`，也不要按路径挑白名单）：

```nginx
# http {} 块内，与 server 同级
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      keep-alive;   # 普通请求保持 keep-alive（close 会触发间歇性空 400，见第 8 节）
}

server {
    # ...
    location / {                        # 兜底 location 必须带这两个头
        proxy_pass http://127.0.0.1:8080;   # 容器内 nginx 用 host.docker.internal
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        # ... 其余 Host / X-Real-IP / X-Forwarded-* / read_timeout 等
    }
}
```

> **不要**为 WebSocket 维护路径白名单。dsh 的 WebSocket 路径变过（旧版 `/api/events.mux`、`/sidebar/ws/*` 在当前 dsh 里已不存在），白名单一旦漂移就是「HTTP 正常、登录正常、只有某个功能提示连接失败」的静默故障。兜底 location 转发是唯一不会随 dsh 版本失效的写法，详见 [NGINX-DEPLOYMENT.md](NGINX-DEPLOYMENT.md)。

---

## 8. 经 nginx 反代后间歇性 `400 Bad Request`（空响应体）

**症状**：直连网关端口（如 `http://<IP>:8080`）一切正常；经 nginx（`https://<域名>/`）访问时随机请求返回 `400 Bad Request`——响应体为空、与业务内容无关，静态资源（`/assets/*`、`/favicon.svg`、`/manifest.webmanifest`）、页面、`/api/*` RPC 都可能中招。并发越高（页面首屏十几~几十个并行请求、批量 RPC 重试）越频繁，典型约 1/3 的突发请求命中；浏览器表现为局部资源加载失败、个别 RPC 报错重试。

**根因**：请求与响应的连接语义互相矛盾（RFC 9110「逐跳头」泄漏）：

1. 反代配置用 `map $http_upgrade $connection_upgrade { '' close; }` 给**每个普通请求**注入 `Connection: close`（本仓库旧文档示例也这么写）；
2. 网关转发上游响应时逐字回放响应头，而上游 dsh 是 Node 服务器，**每个响应都自带 `connection: keep-alive`**——于是「请求说 close、响应说 keep-alive」；
3. nginx 看到响应可 keep-alive，**在同一 TCP 连接上复用发下一个请求**（抓包可证：同一连接上连续出现 请求 → 200 → 请求 → 400）；
4. 网关的 Node HTTP 解析器已按请求的 `Connection: close` 将该连接终态化，同一连接上再到的请求被判为非法——`HPE_CLOSED_CONNECTION: Parse Error: Data after 'Connection: close'`——直接回裸 `400 Bad Request`（空 body），nginx 原样中继给浏览器。

**快速判定**（部署机上执行，以直连为对照）：

```bash
# 直连网关端口：恒为正常（200/302）
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8080/favicon.svg
# 经反代并发轰同一路径：反复出现 400 即命中本问题
for i in $(seq 1 30); do curl -s -o /dev/null -w '%{http_code}\n' https://dsh.example.com/favicon.svg; done | sort | uniq -c
```

**修复**（两层，建议都做）：

1. **nginx（即时生效）**：map 的普通请求分支从 `close` 改为 `keep-alive`（WebSocket 分支 `upgrade` 不变），改完 `nginx -s reload`，无需重启 dsh：

```nginx
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      keep-alive;   # 不要用 close——会与网关转发的上游 keep-alive 响应头矛盾
}
```

2. **网关（可选加固，随版本发布）**：`lib/forward.js` 转发响应时剥离上游逐跳头（`connection`/`keep-alive`/`te`/`trailer`/`upgrade` 及 `Connection` 头列出的字段，见 `stripResponseHopByHop`），由 Node 依据**客户端自己的** `Connection` 头决定连接语义——无论反代怎么配，请求/响应语义都不会再矛盾。

> 本案例于 0.7.0 实机部署中发现（2026-09）。修复后同一并发轰炸 0 个 400；直连 8080 全程无此问题（浏览器直连为正常 keep-alive，不存在 close/keep-alive 矛盾）。
