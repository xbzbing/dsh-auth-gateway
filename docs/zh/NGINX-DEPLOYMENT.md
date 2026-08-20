# 配合 nginx 部署

> 中文文档 | [English](../en/NGINX-DEPLOYMENT.md)

`dsh-auth-gateway` 本身是一个独立监听的网关进程（运行在 dsh 进程内），可以直接对外提供服务，也可以放在 nginx 反向代理之后。本文覆盖四种典型拓扑，均给出完整配置示例。

> 本文所有示例使用占位符：域名 `dsh.example.com`、公网 IP `203.0.113.10`、网关端口 `8080`。请替换为你自己的值。

---

## 拓扑总览

```
拓扑 A：裸金属直连          拓扑 B：子域名部署（推荐）    拓扑 C：子路径部署        拓扑 D：Docker nginx 容器
浏览器 ──> 网关:8080        浏览器 ──> nginx:443          浏览器 ──> nginx:443      浏览器 ──> nginx:443
                                   │  dsh.example.com     │  example.com/dsh/             │
                                   └─> 网关:8080           ├─> /dsh/ → 网关:8080          └─> 网关:8080
                                    （独立域名，零冲突）    ├─> /assets/ → 网关:8080       (nginx 在容器里)
                                                          ├─> /api/ → 网关:8080
                                                          └─> 其他 → 博客应用
```

| 拓扑 | 适用场景 | basePath | 复杂度 |
|---|---|---|---|
| A. 裸金属直连 | 内网/可信网络 | `/` | 最低 |
| **B. 子域名部署** | **与其他应用共存（推荐）** | **`/`** | **低** |
| C. 子路径部署 | 同域名、无法加子域 | `/dsh` | 高（根路径资源冲突） |
| D. Docker nginx | nginx 在容器中 | `/` | 中 |

**推荐方案：子域名（拓扑 B）**。DSH 是根路径应用——前端 JS 硬编码了 `/assets/...`、`/api/...`、`/plugins/...` 等绝对 URL。`basePath` 只影响网关的路由和跳转，不改变这些路径。子路径部署（拓扑 C）需要 nginx 把每一个根路径前缀都转发到网关，每次 DSH 新增插件都要更新 nginx 配置。**子域名彻底隔离，零冲突，配置最简。**

---

## 0. 网关侧公共配置

无论哪种拓扑，`dsh-auth-gateway` 的 profile patch（或 bundle patch）都包含：

```yaml
# cordis.patch.yml 中 dsh-auth-gateway 行的 config
config:
  listenHost: 0.0.0.0      # 对外监听所有网卡（nginx 转发 / 直连都可达）
  listenPort: 8080
  upstreamHost: 127.0.0.1
  upstreamPort: 8081
```

启动命令（对外端口 8080）：

```bash
dsh web --port 8080
```

---

## 拓扑 A：裸金属直连（无 nginx）

**适用**：内网 / 可信网络，不需要域名和 HTTPS。

网关监听 `0.0.0.0:8080`，浏览器直接访问：

```
http://203.0.113.10:8080
```

- `basePath` 保持默认 `/`（根路径部署），无需任何额外配置；
- 认证、OTP、WebSocket 全部由网关自行处理；
- 若公网可达，务必配置防火墙只放行必要来源（网关本身有密码 + OTP 保护，但端口暴露面越小越好）。

---

## 拓扑 B：子域名部署（推荐，零冲突）

**适用**：DSH 与其他应用（如博客）共存于同一台服务器。用独立子域名（如 `dsh.example.com`）部署，DSH 根路径部署（`basePath=/`），与主站完全隔离——无需处理根路径资源冲突、无需维护 nginx 白名单、无需 `basePath` 配置。

```
浏览器 ──> nginx (443, TLS 终结) ──> http://127.0.0.1:8080 ──> 网关
          dsh.example.com
```

网关配置：`basePath` 保持默认 `/`。nginx server 块：

```nginx
server {
    listen 443 ssl;
    server_name dsh.example.com;

    ssl_certificate     /etc/nginx/ssl/cert.pem;
    ssl_certificate_key /etc/nginx/ssl/key.pem;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;
    }
}

# HTTP → HTTPS 跳转
server {
    listen 80;
    server_name dsh.example.com;
    return 301 https://$host$request_uri;
}
```

要点：

- `Upgrade` / `Connection` 头必须转发——DSH 的 WebSocket 端点（`/api/events.mux`、`/sidebar/ws/*` 等）依赖握手；
- `proxy_read_timeout` / `proxy_send_timeout` 设长——SSE 事件流（`/plugins/events`）是长连接，默认 60s 会被掐断；
- 网关默认没有 HTTPS（`Secure` Cookie 未启用），由 nginx 终结 TLS 即可。

---

## 拓扑 C：子路径部署（如 `/dsh/`，有维护成本）

**适用**：同一域名下还跑着其他 Web 应用，且**无法添加子域名**。dsh 需要挂在子路径（如 `https://example.com/dsh/`）。

> **⚠️ 为什么推荐子域名而非子路径**：DSH 是根路径应用——前端 JS 硬编码了 `/assets/...`、`/api/`、`/plugins/`、`/sidebar/`、`/_dsh/`、`/events/` 等**根路径**绝对 URL。子路径部署时，这些路径不会自动带上 `/dsh/` 前缀，需要 nginx 逐个转发到网关。每次 DSH 新增插件（新的根路径前缀），都要更新 nginx 配置。**子域名（拓扑 B）彻底隔离，零维护。**

### 网关侧：配置 `basePath`

插件**默认 `basePath: /`（根路径）**，不随插件分发任何子路径配置。需要子路径部署时，在**部署方自己的 profile patch**（`~/.dsh/profiles/web/cordis.patch.yml`）中覆盖——用户补丁层优先级高于插件 bundle 层。

> **⚠️ 注意**：Cordis 的 `config:` 是**整个对象替换**，不是字段级合并。必须保留 bundle patch 里的所有字段（`listenHost`、`listenPort`、`upstreamHost`、`upstreamPort`），只追加 `basePath`。漏写任何字段会导致该字段回退到 config.js 默认值——例如漏写 `listenPort` 会导致 `--port 8080` 失效（端口变成默认 3080）。

```yaml
# ~/.dsh/profiles/web/cordis.patch.yml
# 必须保留 bundle patch 里的所有字段，不能只写 basePath
- id: dsh-auth-gateway
  config:
    listenHost: 0.0.0.0
    listenPort: !!js ctx.webStartup.port ?? 3080     # 保留动态表达式，跟随 --port 参数
    upstreamHost: 127.0.0.1
    upstreamPort: !!js (ctx.webStartup.port ?? 3080) + 1
    basePath: /dsh                                    # ← 子路径前缀
```

> **`!!js` 表达式**：Cordis 自定义 YAML 标签，用于在启动时动态计算值。`ctx.webStartup.port` 取自 `dsh web --port <N>`，默认 3080。Profile patch 支持同样的 `!!js` 语法。

### nginx 侧：按前缀分流

```nginx
# 其他 Web 应用（示例：博客站点）
server {
    listen 443 ssl;
    server_name example.com;

    ssl_certificate     /etc/nginx/ssl/cert.pem;
    ssl_certificate_key /etc/nginx/ssl/key.pem;

    # 你的其他应用
    location / {
        # ... 其他应用自己的处理 ...
    }
}

# dsh 专用 server 块（也可并入上面的 server，按 location 分流）
server {
    listen 443 ssl;
    server_name example.com;

    ssl_certificate     /etc/nginx/ssl/cert.pem;
    ssl_certificate_key /etc/nginx/ssl/key.pem;

    # dsh 主入口：/dsh/ → 网关根路径（去掉前缀）
    location /dsh/ {
        proxy_pass http://127.0.0.1:8080/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;
    }

    # /dsh 无斜杠 → 301 补斜杠
    location = /dsh {
        return 301 /dsh/;
    }

    # dsh 页面引用的根路径资源（HTML 里是 /assets/...、/api/... 等绝对 URL）
    # 必须同样转发到网关（网关 basePath 逻辑会正确处理这些根路径请求）
    location ~ ^/(api|plugins|sidebar|_dsh)(/|$) {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
    location ~ ^/assets/(index-|vendor-) {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $host;
    }
    location = /manifest.webmanifest {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $host;
    }
    location = /favicon.svg {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $host;
    }
}
```

> **关于 dsh 页面内引用的根路径资源**：dsh 生成的 HTML 会引用 `/assets/...`、`/api/...`、`/plugins/...` 等**根路径**绝对 URL（不走 `/dsh/` 前缀）。这些路径必须由 nginx 转发到网关（见上面的 `location ~ ^/(api|plugins|sidebar|_dsh)` 等块），网关的 `basePath` 逻辑会正确处理它们。
>
> **与同域其他应用冲突时**：如果该域名下还有其他应用占用 `/api/`、`/assets/` 等路径，需要把 dsh 的根路径转发块放到**更具体的匹配**（如 `location ~ ^/(api|plugins|sidebar|_dsh)` 用前缀区分），或改用独立子域名（如 `dsh.example.com`）根路径部署，避免与现有应用冲突。

### WebSocket 与 SSE 子路径

若同一 nginx 上还有其他应用占用 `/api/` 等路径，可将 dsh 的 WebSocket / SSE 端点显式分流：

```nginx
# dsh WebSocket 事件流
location ~ ^/dsh/events/ {
    proxy_pass http://127.0.0.1:8080;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_read_timeout 86400s;
    proxy_send_timeout 86400s;
}
```

---

## 拓扑 D：Docker 内 nginx 容器 + 宿主机网关

**适用**：nginx 跑在 Docker 容器里，dsh 网关直接跑在宿主机（或另一个容器）。nginx 容器需要一种方式访问宿主机端口。可配合拓扑 B（子域名）或拓扑 C（子路径）使用——**推荐子域名**。

### 让 nginx 容器访问宿主机

Docker Compose 中给 nginx 服务加 `extra_hosts`：

```yaml
services:
  nginx:
    image: nginx:1.27-alpine
    ports:
      - "80:80"
      - "443:443"
    extra_hosts:
      - "host.docker.internal:host-gateway"   # 容器内 host.docker.internal → 宿主机
    volumes:
      - ./nginx.conf:/etc/nginx/conf.d/default.conf:ro
```

> `host-gateway` 需要 Docker 20.10+ 与 Compose v2。旧版本可改用宿主机在 Docker 桥接网络上的网关 IP（如 `172.17.0.1`）。

### nginx 配置（容器内视角，推荐子域名根路径部署）

```nginx
# 容器内 nginx，访问宿主机网关用 host.docker.internal
# 子域名 dsh.example.com 根路径部署，与主站零冲突
server {
    listen 443 ssl;
    server_name dsh.example.com;

    ssl_certificate     /etc/nginx/ssl/cert.pem;
    ssl_certificate_key /etc/nginx/ssl/key.pem;

    location / {
        proxy_pass http://host.docker.internal:8080;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;
    }
}
```

子路径部署（`/dsh/`）时，把拓扑 C 的 location 写法搬过来，`proxy_pass` 目标换成 `http://host.docker.internal:8080`（或 `/` 形式去前缀）即可——但**强烈建议用子域名替代子路径**，避免根路径资源冲突。

### 若网关也在容器里

网关容器与 nginx 容器同网络时，`proxy_pass` 直接用服务名：

```yaml
# docker-compose.yml
services:
  nginx:
    ...
    depends_on:
      - dsh-gateway
  dsh-gateway:
    build: ./dsh-auth-gateway
    ports:
      - "8080:8080"
```

```nginx
location / {
    proxy_pass http://dsh-gateway:8080;
    # ... 其余头同上 ...
}
```

---

## 安全建议（所有拓扑通用）

1. **对外只暴露必要的端口**：理想情况下公网只开 443（nginx），网关端口（8080）仅允许 nginx / 内网访问；
2. **TLS 由 nginx 终结**：网关保持明文 HTTP 即可，不要在网关端口上重复加 TLS；
3. **WebSocket/SSE 长连接**：`Upgrade`/`Connection` 头与 `proxy_read_timeout`/`proxy_send_timeout` 三件套必须配齐，否则事件流 / 终端会被 60s 掐断（浏览器表现为 `ERR_INCOMPLETE_CHUNKED_ENCODING` 或 WS failed）；
4. **直连与代理不要混用**：浏览器端要么全部走域名 + 代理，要么全部直连网关端口。混用时（如页面从 `https://dsh.example.com` 打开、却直连 `http://203.0.113.10:8080`）会因跨 scheme / 跨端口被 dsh 插件的同源校验拒绝（403 `origin-rejected`）——这是预期保护，不是故障。

---

## 相关文档

- [INSTALL.md](INSTALL.md) — 安装、更新、卸载
- [DEPLOYMENT.md](DEPLOYMENT.md)（中文）｜ [English](../en/DEPLOYMENT.md) — 端口推导、LAN 部署、故障排查
- [SECURITY.md](SECURITY.md) — 威胁模型与 OTP 安全设计
