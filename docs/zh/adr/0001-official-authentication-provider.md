# ADR-0001：上游认证改用官方 `connection.authentication` 提供者

> 中文文档 | [English](../../en/adr/0001-official-authentication-provider.md)

- 状态：已采纳（0.9.0）
- 日期：2026-11-23
- 涉及版本：dsh `0.2.3-alpha.1` 起新增认证提供者注册表；`0.2.2` 及更早没有

## 背景

网关转发的每个请求都已经通过了密码（+ OTP）认证门，但 dsh 内部 webserver 还有自己的浏览器认证：index 与 `/api` 要求启动 token 或一枚签名 cookie。0.8.x 的做法是通过 `ctx.credentials` 读取 dsh 的签名密钥记录 `client-connection/browser-session`，按 dsh 的私有 cookie 格式（`dsh-auth-<hash>` = `v1.<payload>.<HMAC>`）在回环一跳上自己签发 cookie（`lib/upstream-auth.js`）。

这条路依赖三样都不是公开契约的东西：密钥记录的形态、cookie 的名称与载荷格式、authority 的取值口径。dsh 0.2.3 把 BrowserAuth 拆成独立包 `@deepseek-ai/dsh-host-authentication-token`，格式暂时保持不变，但随时可能演进。

同一版本里，Connection 新增了 `connection.authentication` 提供者注册表：webserver 准入时依次询问已注册的提供者，第一个返回 Peer 的提供者胜出。官方的 Token 与 remote-connection 都通过它接入。网关与 dsh 同进程，可以直接注册自己的提供者，不再需要复刻 Token 的格式。

## 决策

1. **0.2.3 起注册官方提供者。** 网关在 `apply` 中用 `ctx.get('connection.authentication')` 探测注册表。存在时：
   - 以子插件（`inject: ['connection', 'connection.authentication']`）注册提供者，并用 `connection.createPeer({ principal: { kind: 'owner' } })` 创建网关自己的共享 Peer。子插件的作用域随网关卸载，提供者与 Peer 一同撤销；
   - 插件每次激活（含重载）生成一枚 32 字节随机凭据，只存在于内存。认证门放行后的每个转发请求（HTTP 与 WS 升级）带请求头 `x-dsh-auth-gateway-credential: <凭据>`，提供者用恒定时间比较认出它并返回网关的 Peer；
   - 注册在网关监听之前 `await` 完成；默认 10s 超时未完成即**抛错终止启动**（fail loud），不进入「启动成功、转发全 401」的降级态——那种状态比启动失败更难排查；
   - 不读取 `client-connection/browser-session`，不签发 dsh 格式的 cookie。
2. **0.2.2 及更早保留原路径。** 注册表不存在时，行为与 0.8.x 完全一致：读取签名密钥、签发 v1 cookie。两条路径在启动时二选一，运行期不切换、不混用。
3. **任何转发都先删除浏览器发来的同名请求头**，包括认证前的公开资产与 `publicPaths` 握手转发，防止伪造；匿名转发不附加凭据。
4. **相关调整**（同一适配，独立提交）：
   - `publicPaths` 转发保留浏览器的回环 Host。0.2.3 的账号回调按 `Host === 发起登录时的浏览器 origin` 匹配，回环改写会让回调永远错过；
   - bundle patch 禁用 `remote-connection` 一行。它的二维码兑换要求 `Host === publicUrl`，在网关后面必然失败；匿名配对路由被网关认证门拦住；设置卡片还会显示进程启动 token。远程访问由网关负责。

## 不变的部分

- 回环绑定：内部 webserver 仍只监听 `127.0.0.1`。
- Host/Origin 改写：Connection 的来源检查（Host 栅栏）与认证提供者是两层，前者仍然看 Host。
- LAN trust 脚本：客户端的 `connection.isLoopback` 仍只看页面地址，这个安全例外保留。
- 支持区间下限不变（`0.1.5-rc.2`），因为原路径仍在。

## 后果

- 0.2.3 起，网关不再依赖 Token 的密钥记录与 cookie 格式；Token 包的格式演进不会再让转发全部 401。
- 浏览器经网关访问时，dsh 看到的是网关自己的 owner Peer，与 Token 的浏览器 Peer、API Peer 分开。卸载网关会关闭这个 Peer 上的连接，不影响 Token 连接。
- 凭据只在进程内存与回环一跳上出现，插件每次激活都换新；能读到它的只有能检查 dsh 进程内存或监听回环流量的本机用户，这类用户本来就在信任边界内。
- 网关新增注入 `connection`，生命周期随 Connection：Connection 重载（例如它的配置变化）会让网关一同重启，内存会话表清空、所有用户需要重新登录。Connection 的配置（`trustedHosts`）来自 CLI，运行期很少变化，风险可接受。该注入在支持区间下限即成立：0.1.5-rc.2 的 `@deepseek-ai/dsh-web-app` bundle patch 已启用 `@deepseek-ai/dsh-client-connection`，其 lib 以 `super(ctx, 'connection')` 提供该服务。
- 两条路径要一起维护和测试，直到支持区间下限越过 0.2.3。届时删除 `lib/upstream-auth.js` 与回退分支，并在本 ADR 末尾补记。

## 被否决的方案

- **只保留签发 cookie**：最省事，但继续依赖 dsh 私有格式，0.2.3 已经把它挪进独立包，下一次格式变化就会全部 401。
- **直接把下限提到 0.2.3**：代码更简单，但 0.2.2 的用户没有替代方案；回退路径就是现有代码，保留成本低。
- **提供者直接校验网关会话 cookie**：可以省掉请求头，但会把会话表、onboarding/OTP 状态与 basePath 处理暴露给 dsh 的准入流程，认证门从一处变成两处。当前方案让认证门仍是唯一决策点，提供者只确认“这个请求来自网关”。
- **监听 `webserver/authorize` 自行放行**：它是 webserver 的内部准入事件，Connection 已经占用；提供者注册表才是官方给认证插件的扩展点。
