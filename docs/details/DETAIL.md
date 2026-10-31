# dsh-auth-gateway

为 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) Web 提供认证门禁的 Cordis 插件：**密码认证 + TOTP 双因素认证 + 多层防爆破 + 会话管理 + 登录审计**。网关独占对外端口，内部 webserver 绑定在本地回环，每个 HTTP 请求与 WebSocket 升级都先过认证门——未认证流量无法触及后端。

## 功能介绍

- **密码认证**：首次部署自动生成初始密码（控制台一次性打印），登录后引导设置个人密码（scrypt 异步哈希存储）；
- **双因素认证（TOTP）**：可选启用，兼容 Google Authenticator、Authy、1Password 等主流认证器，含一次性备份代码；OTP 密钥以 AES-256-GCM 加密落盘，磁盘泄露不直接暴露第二因素根密钥；
- **真实请求拦截**：未认证 `/api/*` 返回 401、页面路径重定向登录页、WebSocket 升级直接拒绝；认证通过后透明转发（Host/Origin 回环改写，兼容内部 trust fence）；
- **多层防爆破**：密码失败按来源 IP 锁定 + 全局限流 + OTP/备份码独立限流，登录洪峰不阻塞事件循环；
- **会话管理**：内存 256-bit token，HttpOnly + SameSite=Strict Cookie，修改密码或停用 OTP 时吊销全部会话；
- **登录审计**：登录/登出/改密与暴力破解告警持久化落盘（JSONL，按天轮转，保留 90 天），不含任何凭据。

## 仓库

源码、完整文档与部署指南见 GitHub：<https://github.com/xbzbing/dsh-auth-gateway>
