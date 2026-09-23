# Deploying behind nginx

> [简体中文](../zh/NGINX-DEPLOYMENT.md) | English

`dsh-auth-gateway` is a gateway process with its own listening socket (running inside the dsh process). It can serve directly, or sit behind an nginx reverse proxy. This document covers four typical topologies, each with a complete configuration example.

> All examples use placeholders: domain `dsh.example.com`, public IP `203.0.113.10`, gateway port `8080`. Replace them with your own values.

---

## Topology overview

```
Topology A: bare metal          Topology B: subdomain (recommended)  Topology C: sub-path            Topology D: Docker nginx
browser ──> gateway:8080        browser ──> nginx:443                 browser ──> nginx:443           browser ──> nginx:443
                                        │  dsh.example.com            │  example.com/dsh/                    │
                                        └─> gateway:8080              ├─> /dsh/ → gateway:8080              └─> gateway:8080
                                         (own subdomain, no conflict) ├─> /assets/ → gateway:8080       (nginx in a container)
                                                                      ├─> /api/ → gateway:8080
                                                                      └─> everything else → blog app
```

| Topology | When to use | basePath | Complexity |
|---|---|---|---|
| A. Bare metal direct | Intranet / trusted network | `/` | Lowest |
| **B. Subdomain deployment** | **Coexistence with other apps (recommended)** | **`/`** | **Low** |
| C. Sub-path deployment | Same domain, cannot add a subdomain | `/dsh` | Medium (prefix-stripping proxy) |
| D. Docker nginx | nginx runs in a container | `/` | Medium |

**Recommended: subdomain (topology B)**. Since dsh 0.1.7 pages use document-relative routes, sub-path deployment (topology C) only needs nginx to strip the `/dsh/` prefix plus a `basePath` on the gateway — no root-path allowlist to maintain. A subdomain needs no prefix handling at all: it isolates DSH from every other app with the simplest config.

---

## 0. Common gateway-side configuration

Regardless of topology, the `dsh-auth-gateway` profile patch (or bundle patch) includes:

```yaml
# config of the dsh-auth-gateway row in cordis.patch.yml
config:
  listenHost: 0.0.0.0      # listen on all interfaces (reachable via nginx or direct)
  listenPort: 8080
  upstreamHost: 127.0.0.1
  upstreamPort: 8081
```

Startup command (external port 8080):

```bash
dsh web --port 8080
```

---

## Topology A: bare metal direct (no nginx)

**Use when**: intranet / trusted network, no domain or HTTPS needed.

The gateway listens on `0.0.0.0:8080`; the browser connects directly:

```
http://203.0.113.10:8080
```

- `basePath` stays at the default `/` (root-path deployment); no extra configuration;
- Auth, OTP and WebSocket are all handled by the gateway itself;
- If reachable from the public internet, make sure the firewall only allows necessary sources (the gateway itself has password + OTP protection, but a smaller exposure surface is always better).

---

## Topology B: subdomain deployment (recommended, zero conflicts)

**Use when**: DSH coexists with other apps (e.g. a blog) on the same server. Deploy on a dedicated subdomain (e.g. `dsh.example.com`) at the root path (`basePath=/`), fully isolated from the main site — no root-path resource conflicts, no nginx whitelist to maintain, no `basePath` config needed.

```
browser ──> nginx (443, TLS termination) ──> http://127.0.0.1:8080 ──> gateway
          dsh.example.com
```

Gateway config: `basePath` stays at the default `/`. nginx server block:

```nginx
# Key: pass the WebSocket handshake through while ordinary requests keep
# keep-alive. Must live in the http {} block (sibling of server, not inside it).
# Do NOT hardcode Connection "upgrade" — that tags every plain request too.
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      keep-alive;   # ordinary requests keep keep-alive (close triggers intermittent empty 400s, see TROUBLESHOOTING.md §8)
}

server {
    listen 443 ssl;
    server_name dsh.example.com;

    ssl_certificate     /etc/nginx/ssl/cert.pem;
    ssl_certificate_key /etc/nginx/ssl/key.pem;

    # Catch-all location: every path (WebSocket included) is proxied here.
    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;
    }
}

# HTTP → HTTPS redirect
server {
    listen 80;
    server_name dsh.example.com;
    return 301 https://$host$request_uri;
}
```

Key points:

- **Forward `Upgrade` / `Connection` on the catch-all location — never on a per-path allowlist.** DSH's WebSocket endpoint is `/api/remote.mux` (the API Gateway's Remote-stream multiplexer). The path has changed across dsh versions (older releases used `/api/events.mux`, `/sidebar/ws/*`, which **no longer exist**). If you set the upgrade headers only for some paths and let the rest fall into a `location /` without them, nginx drops `Upgrade` as a hop-by-hop header, the handshake degrades to a plain GET, and the browser only reports `WebSocket connection to 'wss://.../api/remote.mux' failed` — the gateway log is where the real diagnosis appears;
- **The ordinary-request branch of the map must be `keep-alive`, never `close`**: the gateway strips hop-by-hop headers (including `connection`/`keep-alive`) from relayed responses and derives connection semantics solely from the client's own `Connection` header. Injecting `Connection: close` on ordinary requests contradicts the upstream's keep-alive responses, and under load (the initial page view fires dozens of parallel requests) produces intermittent empty `400 Bad Request` responses (see [TROUBLESHOOTING.md §8](TROUBLESHOOTING.md));
- Set `proxy_read_timeout` / `proxy_send_timeout` long — the SSE event stream (`/plugins/events`) is a long-lived connection and the default 60s will cut it off;
- The gateway has no HTTPS by default (`Secure` cookie not enabled) — let nginx terminate TLS.

---

## Topology C: sub-path deployment (e.g. `/dsh/`, has maintenance cost)

**Use when**: other web apps run on the same domain and you **cannot add a subdomain**. dsh must be mounted at a sub-path (e.g. `https://example.com/dsh/`).

> **Since 0.1.7**: dsh pages use `<base href="./">` and document-relative routes (`api/...`, `plugins/...`) to preserve the mount prefix. nginx only needs to strip `/dsh/` before forwarding to the gateway; no `/api/`, `/plugins/`, or `/assets/` root-path allowlist is required.
>
> **Below 0.1.7 (0.1.5-rc.2 / 0.1.6)**: pages resolve URLs against the root via `<base href="/">`, so forward the root-path prefixes (`/api/`, `/plugins/`, `/assets/`, etc.) to the gateway as well (the gateway's `basePath` logic handles those requests correctly).

### Gateway side: configure `basePath`

The plugin **defaults to `basePath: /` (root path)** and ships no sub-path configuration. For sub-path deployment, override it in the **deployer's own profile patch** (`~/.dsh/profiles/web/cordis.patch.yml`) — the user patch layer takes priority over the plugin bundle layer.

> **⚠️ Note**: Cordis `config:` is a **whole-object replacement**, not a field-level merge. You must keep every field from the bundle patch (`listenHost`, `listenPort`, `upstreamHost`, `upstreamPort`) and only append `basePath`. Missing any field makes it fall back to the config.js default — e.g. a missing `listenPort` disables `--port 8080` (the port becomes the default 3080).

```yaml
# ~/.dsh/profiles/web/cordis.patch.yml
# Must keep all fields from the bundle patch; do not write basePath alone
- id: dsh-auth-gateway
  config:
    listenHost: 0.0.0.0
    listenPort: !!js ctx.webStartup.port ?? 3080     # keep the dynamic expression, follows --port
    upstreamHost: 127.0.0.1
    upstreamPort: !!js (ctx.webStartup.port ?? 3080) + 1
    basePath: /dsh                                    # ← sub-path prefix
```

> **`!!js` expressions**: a custom Cordis YAML tag for computing values dynamically at startup. `ctx.webStartup.port` comes from `dsh web --port <N>`, default 3080. Profile patches support the same `!!js` syntax.

### nginx side: split traffic by prefix

```nginx
# Hop-by-hop pass-through: lives in the http {} scope (conf.d/*.conf is http
# scope). Define it once per nginx instance.
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      keep-alive;   # ordinary requests keep keep-alive (close triggers intermittent empty 400s, see TROUBLESHOOTING.md §8)
}

# Other web apps (example: a blog site)
server {
    listen 443 ssl;
    server_name example.com;

    ssl_certificate     /etc/nginx/ssl/cert.pem;
    ssl_certificate_key /etc/nginx/ssl/key.pem;

    # your other apps
    location / {
        # ... your own app handling ...
    }
}

# Dedicated dsh server block (can also be merged into the one above, split by location)
server {
    listen 443 ssl;
    server_name example.com;

    ssl_certificate     /etc/nginx/ssl/cert.pem;
    ssl_certificate_key /etc/nginx/ssl/key.pem;

    # dsh entry and all document-relative resources: /dsh/ → gateway root
    location /dsh/ {
        proxy_pass http://127.0.0.1:8080/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;           # required for WebSocket
        proxy_set_header Connection $connection_upgrade;  # see the map at the top
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;
    }

    # /dsh without a slash → 301 add the slash
    location = /dsh {
        return 301 /dsh/;
    }

    # Root-path resources referenced by dsh pages (the HTML uses absolute
    # URLs like /assets/..., /api/..., etc.)
    # Must be forwarded to the gateway too (the gateway basePath logic
    # handles these root-path requests correctly)
    location ~ ^/(api|plugins|sidebar|_dsh)(/|$) {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;           # required for WebSocket:
        proxy_set_header Connection $connection_upgrade;  # /api/remote.mux is a root path
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

> **About the root-path resources referenced by dsh pages**: the HTML dsh generates references **root-path** absolute URLs like `/assets/...`, `/api/...`, `/plugins/...` (which do not carry the `/dsh/` prefix). These paths must be forwarded by nginx to the gateway (see the `location ~ ^/(api|plugins|sidebar|_dsh)` blocks above); the gateway's `basePath` logic handles them correctly.
>
> **The plugin's Auth Settings panel needs no extra forwarding**: the panel's API calls and redirects are driven by a basePath global injected into the page by the plugin (the `/dsh/` prefix is added automatically) and reach the gateway through the `location /dsh/` block above — they do not depend on the root-path forwarding list.
>
> **When other apps on the same domain conflict**: if other apps on that domain already use `/api/`, `/assets/` and other paths, put the dsh root-path forward blocks under **more specific matching** (e.g. distinguish prefixes with `location ~ ^/(api|plugins|sidebar|_dsh)`), or switch to a dedicated subdomain (e.g. `dsh.example.com`) root-path deployment to avoid conflicts with existing apps.

### WebSocket and SSE sub-paths

If other apps on the same nginx occupy paths like `/api/`, you can route dsh's WebSocket endpoint explicitly — but you **must cover every WebSocket path dsh actually uses**, currently `/api/remote.mux` (do not treat the old `/api/events.mux` / `/sidebar/ws/*` as the allowlist; they no longer exist):

```nginx
# requires the http {}-level map shown in Topology B
# dsh Remote-stream multiplexer WebSocket
location = /api/remote.mux {
    proxy_pass http://127.0.0.1:8080;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection $connection_upgrade;
    proxy_set_header Host $host;
    proxy_read_timeout 86400s;
    proxy_send_timeout 86400s;
}
```

> Prefer not to allowlist WebSocket paths at all: forward `Upgrade`/`Connection` on the **catch-all location** (Topology B). An allowlist that misses one endpoint shows up as "the page loads and login succeeds, but a feature reports a connection failure", with the only clue being a 502/404 here or a line in the gateway log.

---

## Topology D: nginx in a Docker container + gateway on the host

**Use when**: nginx runs in a Docker container and the dsh gateway runs directly on the host (or in another container). The nginx container needs a way to reach the host port. Can be combined with topology B (subdomain) or C (sub-path) — **subdomain is recommended**.

### Let the nginx container reach the host

Add `extra_hosts` to the nginx service in Docker Compose:

```yaml
services:
  nginx:
    image: nginx:1.27-alpine
    ports:
      - "80:80"
      - "443:443"
    extra_hosts:
      - "host.docker.internal:host-gateway"   # inside the container: host.docker.internal → host
    volumes:
      - ./nginx.conf:/etc/nginx/conf.d/default.conf:ro
```

> `host-gateway` requires Docker 20.10+ and Compose v2. On older versions use the host's gateway IP on the Docker bridge network instead (e.g. `172.17.0.1`).

### nginx config (from inside the container; subdomain root-path recommended)

```nginx
# nginx inside the container; reach the host gateway via host.docker.internal
# Subdomain dsh.example.com root-path deployment, zero conflicts with the main site
# map goes in the http {} block (sibling of server)
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      keep-alive;   # ordinary requests keep keep-alive (close triggers intermittent empty 400s, see TROUBLESHOOTING.md §8)
}

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
        proxy_set_header Connection $connection_upgrade;
        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;
    }
}
```

> **⚠️ The most common trap**: do not write a `location` allowlist for "the known WebSocket paths" while leaving the catch-all `location /` without `Upgrade`. The moment dsh changes its WebSocket path (it already has), the handshake fails silently: every HTTP request works, login works, and only the page reports a connection failure. **Putting `Upgrade`/`Connection` on the catch-all location is the only form that cannot drift with the version.**

For sub-path deployment (`/dsh/`), port the topology C location blocks over and change the `proxy_pass` target to `http://host.docker.internal:8080` (or the `/` form for prefix stripping) — but **strongly prefer a subdomain over a sub-path** to avoid root-path resource conflicts.

### When the gateway is also in a container

When the gateway container and the nginx container share a network, use the service name directly in `proxy_pass`:

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
    # ... same headers as above ...
}
```

---

## Security recommendations (common to all topologies)

1. **Expose only the necessary ports externally**: ideally only 443 (nginx) is public; the gateway port (8080) should only be reachable by nginx / the intranet;
2. **Terminate TLS at nginx**: keep the gateway on plain HTTP; do not add TLS on the gateway port;
3. **WebSocket/SSE long connections**: the `Upgrade`/`Connection` headers plus `proxy_read_timeout`/`proxy_send_timeout` trio must all be in place, and `Upgrade`/`Connection` belong on the **catch-all location** (use `map $http_upgrade $connection_upgrade`; do not hardcode `"upgrade"` and do not allowlist paths), otherwise event streams / terminals get cut at 60s, or the WebSocket handshake degrades and fails outright (browsers show `ERR_INCOMPLETE_CHUNKED_ENCODING` or `WebSocket connection to '.../api/remote.mux' failed`); the map's ordinary-request branch must be `keep-alive` (`close` causes intermittent empty 400s, see [TROUBLESHOOTING.md §8](TROUBLESHOOTING.md));
4. **Do not mix direct and proxied access**: the browser should go entirely through the domain + proxy, or entirely direct to the gateway port. Mixing (e.g. page opened from `https://dsh.example.com` but resources fetched direct from `http://203.0.113.10:8080`) gets rejected by the dsh plugin's same-origin check (403 `origin-rejected`) due to the cross-scheme / cross-port mismatch — that is expected protection, not a fault.

---

## Related documents

- [INSTALL.md](INSTALL.md) — install, update, uninstall
- [DEPLOYMENT.md](DEPLOYMENT.md)（简体中文）｜ [简体中文](../zh/DEPLOYMENT.md) (English) — port derivation, LAN deployment, troubleshooting
- [SECURITY.md](SECURITY.md) — threat model and OTP security design