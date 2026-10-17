# Troubleshooting

> [简体中文](../zh/TROUBLESHOOTING.md) | English

Real-world failure cases from dsh-auth-gateway deployments: symptoms, root causes and fixes. Work top-down: confirm the service is alive, then the proxy chain, then version-line differences.

## 1. The "Models" settings page reports "加载提供方目录失败: settings are unavailable in this browser" on domain access

**Symptom**: reaching dsh through a domain / reverse proxy (e.g. `https://dsh.example.com`) and opening Settings → Models fails with `settings are unavailable in this browser`; "Retry" never recovers. Opening `http://127.0.0.1:8081` (the internal webserver) directly works.

**Root cause** (dsh official design, not a gateway fault):

1. dsh pins its configuration plane (`settings.describe` / `settings.update` privileged RPCs) to loopback-same-origin — originally explained by the comment *"until a real authentication layer exists"* (removed when dsh 0.1.2 implemented BrowserAuth; configuration-plane access is now governed by the browser-session authentication).
2. Client-side, `ui-settings` snapshots `connection.isLoopback` (derived from `location.hostname`: true for `127.0.0.1`/`localhost`, false for any domain) at ITS apply instant and locks settings persistence to **host** (loopback) or **memory** (domain).
3. In memory mode the settings mirror's `load()/ensure()` are **no-ops** — no request is ever sent and `view` stays undefined forever.
4. The Models page binds the provider directory and the settings view into one `Promise.all`; a missing view fails the whole page, and `Retry` calls the same no-op `load()` — permanent failure.

**Why the gateway can fix it**: the official comment anticipates the need for an "authentication layer" but never implements or endorses any specific solution. This project chooses to fill that role itself: every page it serves has passed password + optional OTP, and the gateway rewrites Host/Origin to the loopback upstream. Flipping the client-side `connection.isLoopback` to true is therefore this project's own security-model decision (the page is authenticated, and the RPCs pass the server fence through the gateway's rewrite) — not an officially sanctioned behavior. It is the single recorded security exception; implementation details below.

**Fix implementation** (`lib/lan-trust-script.js`, injected with the index page):

- A head script placed AFTER dsh's loader bootstrap (`window.__ModuleLoader__=`) and before any bundle registration;
- A pass-through proxy on `loader.load` that intercepts **only** the `@deepseek-ai/dsh-client-connection` registration; every other plugin passes untouched;
- Its `apply` wrapper does **not touch `ctx.provide`** — that is a mixin-generated accessor bound to the reading ctx's receiver; assigning it pollutes the shared `ReflectService` and redirects every `ctx.provide(...)` during the window into connection's fiber scope. That is exactly the mechanism by which auth-gateway@0.4.2 broke better-sidebar;
- Instead it temporarily replaces the unbound `provide` method on the shared `ctx.reflect`, captures the `connection` handle, and forwards via `originalProvide.call(this, ...)` so registrations land on the caller's own fiber;
- After the original `apply` returns, it synchronously `defineProperty`s `isLoopback = true` on the captured handle — before any dependent fiber (ui-settings) wakes from PENDING, so its snapshot reads true;
- Idempotent (`bootstrapKey` guard), silently degrades when the loader shape is unexpected, and never throws.

**Verification** (isolated instance over a domain hostname `dsh.local`): the Models page lists all providers with working edit controls and no error; coexisting plugins (better-sidebar) report zero errors; stable across restarts.

## 2. Plugin reports `cannot get property "X" without inject` (native dependency not built)

**Symptom**: a plugin panel won't open; the console shows `dsh-better-sidebar: cannot get property "betterSidebar" without inject`; the plugin's HTTP API returns 200.

**Root cause**: the plugin's host half failed to load a native module during initialization, so its service was never `provide`d; the first frontend access throws. Common after pnpm blocked build scripts — the profile's `pnpm-workspace.yaml` contains:

```yaml
allowBuilds:
  node-pty: false
```

better-sidebar depends on `node-pty` (native, required for its terminal feature); pure-JS plugins (e.g. vision-toolkit) are unaffected.

**Fix**:

```sh
node -e "require('<profile>/node_modules/node-pty')"   # confirm missing binding
cd <profile>         # e.g. ~/.dsh/profiles/web
pnpm approve-builds   # mark needed packages (e.g. node-pty) as allowed
pnpm rebuild node-pty
# restart dsh web so the host half re-initializes
```

## 3. Browser reports `failed to import loader entry ... bundle script ... failed to load`

Meaning: the page loaded, but one `/plugins/<id>/client.js?rev=...` script failed at the **network** level. Three common sources:

| Source | Signature |
|---|---|
| dsh process not listening (restart window / boot failure) | nginx error log shows bursts of `connect() failed (111: Connection refused)`; matching access-log entries are 502 |
| Gateway session lost mid-boot (in-memory sessions die with the process) | A single script request gets 302 → `/login`; the script receives HTML and fails to execute |
| Cross-border link timeout | Browser shows `net::ERR_TIMED_OUT`; a retry recovers |

**Diagnose**:

```sh
tail -20 <nginx-logs>/dsh_error.log          # any connect() refused?
curl -sI http://127.0.0.1:<internal-port>/plugins/@deepseek-ai/dsh-client-modules/client.js   # direct upstream
curl -skI https://<domain>/                    # full chain (unauthenticated should 302 → /login)
```

As long as the process is alive and the session valid, the gateway forwards byte-for-byte; bundle loading never fails because of the gateway.

## 4. dsh version lines vs credentials file format (dsh fails to boot after upgrade/downgrade)

| dsh line | `.credentials.yaml` format | Behavior |
|---|---|---|
| 0.1.0-rc.7 / rc.8 | Flat: `KEY: value` | Top-level keys must be non-empty strings |
| 0.1.1-rc.1 / rc.2 | `version: 1` + `refs:` / `records:` | Flat files are migrated automatically on boot (**one-way**) |
| 0.1.2-rc.1+ | Same as 0.1.1, plus the `client-connection/browser-session` record | The internal webserver gains browser authentication (BrowserAuth); this plugin adapts automatically by reading that record through the official `credentials` service — no manual action needed |

**Symptom**: after switching versions, `dsh web` exits at startup with `credentials-local: the value for "version" in ~/.dsh/.credentials.yaml must be a string`; nothing listens on the external port, and the browser shows a white page or the section-3 loader error.

**Fix**: staying on the 0.1.1 line needs nothing; to return to 0.1.0, convert the file back to flat manually (drop the `version:` line, lift `refs:` keys to the top level).

**Prevention**: back up the data directory before switching lines:

```sh
tar -C ~ -czf "dsh-home-backup-$(date +%F-%H%M).tgz" .dsh
```

> Do not "fix" problems with `rm -rf ~/.dsh`: it also wipes the gateway password store (a one-time initial password is minted on next boot), OTP enrollment, all sessions and settings.

## 5. nginx tuning for slow / cross-border links

dsh boots by fetching ~40 small JS bundles, served with `cache-control: no-cache`; nginx by default neither gzips `application/javascript` nor enables HTTP/2. On high-latency links individual requests can time out. Add:

```nginx
listen 443 ssl;
http2 on;                        # nginx ≥ 1.25.1; older: listen 443 ssl http2;

gzip on;
gzip_types application/javascript text/javascript application/json;
gzip_min_length 1024;
```
## 6. Upstream answers `dsh web authentication required` (dsh ≥ 0.1.2)

**Symptom**: logging into the gateway succeeds, but pages and `/api` answer `dsh web authentication required; reopen the URL printed by dsh web.` That text is the BrowserAuth 401 of the dsh ≥ 0.1.2 internal webserver — the request already crossed the gateway and reached the internal server, but carried no valid upstream cookie.

**Background**: since dsh 0.1.2 the internal server enforces browser authentication on the index page and `/api`; the gateway must read the `client-connection/browser-session` secret through the official `credentials` service and mint an identical cookie for the loopback hop (see SECURITY.md). The cookie is missing in these scenarios:

| Scenario | Symptom | Fix |
|---|---|---|
| Plugin is an old npm release (≤ 0.5.1, no `lib/upstream-auth.js` bridge) | Every forward is permanently 401 | Install from GitHub main (`dsh plugin --profile web add github:xbzbing/dsh-auth-gateway#main`) or re-install after the npm release |
| Fresh deployment / post-revocation restart window (the record is created by dsh's Connection on activation, possibly after the gateway warmed) | Brief 401s right after boot, then self-recovery | Upgrade to a build with fast retry (2s) + background probing (since `eca3b0b`) |

**Triage**: confirm the plugin version and that `node_modules/dsh-auth-gateway/lib/upstream-auth.js` exists; check the startup log for the `读取 upstream browser-session 密钥失败` warning (persistent 401 + warning = a secret-read problem, not a version problem).

## 7. Login succeeds but the page reports a connection failure (`WebSocket connection to '.../api/remote.mux' failed`)

**Symptom**: the page loads and password (+ OTP) login succeeds, then the page reports a connection failure; the browser console shows only `WebSocket connection to 'wss://<domain>/api/remote.mux' failed:` — every HTTP request works, only the WebSocket does not.

**Root cause**: `/api/remote.mux` is the Remote-stream multiplexer WebSocket owned by the dsh API Gateway. nginx treats `Upgrade`/`Connection` as **hop-by-hop** headers: they are forwarded **only** by a location that explicitly sets `proxy_set_header Upgrade`. If the reverse-proxy config writes separate locations for "the known WebSocket paths" (e.g. copying the older docs' `/api/events.mux`, `/sidebar/ws/*`) while the catch-all `location /` lacks those headers, `/api/remote.mux` falls into the catch-all:

```
browser --Upgrade--> nginx --(Upgrade dropped, degrades to a plain GET)--> gateway
                                                                          ↓
                     Node never fires 'upgrade' -> proxied as ordinary HTTP
                                                                          ↓
                                upstream answers the plain GET -> 404
                                                                          ↓
                          the browser only sees "WebSocket connection failed"
```

**Quick check** (run on the deployment host, bypassing nginx, straight at the gateway port):

```bash
# replace 8080 with the gateway listenPort. 101 = gateway side is fine, the
# problem is the nginx config
curl -i -s -N -o /dev/null -w '%{http_code}\n' \
  -H 'Connection: Upgrade' -H 'Upgrade: websocket' \
  -H 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==' -H 'Sec-WebSocket-Version: 13' \
  http://127.0.0.1:8080/api/remote.mux
```

- `101` or `401` (without a session cookie the gateway refuses the handshake first) → the gateway is fine, the nginx config is the problem: apply the fix below;
- a `WebSocket 握手缺少 Upgrade 头` line in the gateway log → confirms the proxy dropped `Upgrade`; apply the fix below (the warning is emitted once per instance, so client retries cannot flood the log).

**Fix**: put `Upgrade`/`Connection` on the **catch-all location** and use a `map` so ordinary requests keep keep-alive (do not hardcode `"upgrade"`, and do not allowlist paths):

```nginx
# inside the http {} block, sibling of server
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      keep-alive;   # ordinary requests keep keep-alive (close triggers intermittent empty 400s, see §8)
}

server {
    # ...
    location / {                        # the catch-all must carry these two
        proxy_pass http://127.0.0.1:8080;   # inside a container: host.docker.internal
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        # ... plus Host / X-Real-IP / X-Forwarded-* / read_timeout etc.
    }
}
```

> **Do not** maintain a path allowlist for WebSockets. dsh's WebSocket path has changed (the older `/api/events.mux` and `/sidebar/ws/*` no longer exist in current dsh), and a drifting allowlist fails silently: HTTP works, login works, only one feature reports a connection failure. Forwarding on the catch-all location is the only form that cannot go stale with a dsh version — see [NGINX-DEPLOYMENT.md](NGINX-DEPLOYMENT.md).

---

## 8. Intermittent `400 Bad Request` (empty body) behind an nginx reverse proxy

**Symptom**: direct access to the gateway port (e.g. `http://<IP>:8080`) works perfectly; through nginx (`https://<domain>/`) random requests fail with `400 Bad Request` and an **empty body** — static assets (`/assets/*`, `/favicon.svg`, `/manifest.webmanifest`), pages and `/api/*` RPCs are all affected. The more parallel requests (the initial page view fires dozens, RPC retries burst), the more frequent the failures — typically about 1/3 of a burst. Browsers show partial resource-load failures and retried RPC errors.

**Root cause**: the connection semantics of the request and the response contradict each other (an RFC 9110 hop-by-hop header leak):

1. The reverse proxy injects `Connection: close` on **every ordinary request** via `map $http_upgrade $connection_upgrade { '' close; }` (the old doc examples in this repository did exactly this);
2. The gateway relays upstream response headers verbatim, and the upstream dsh webserver is Node, so **every response carries `connection: keep-alive`** — the request says "close", the response says "keep-alive";
3. nginx sees a reusable connection and **sends the next request on the same TCP connection** (captured on the wire: request → 200 → request → 400 on one connection);
4. The gateway's Node HTTP parser had already finalized the close-marked connection, so the next request on it is rejected — `HPE_CLOSED_CONNECTION: Parse Error: Data after 'Connection: close'` — and the client receives a bare `400 Bad Request` (empty body) relayed by nginx.

**Quick check** (on the deployment host, compared against direct access):

```bash
# direct to the gateway port: always normal (200/302)
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8080/favicon.svg
# concurrent blasts through the proxy: repeated 400s confirm this issue
seq 30 | xargs -P 30 -n1 curl -s -o /dev/null -w '%{http_code}\n' \
  https://dsh.example.com/favicon.svg | sort | uniq -c
```

**Fix** (both layers recommended):

1. **nginx (immediate)**: change the ordinary-request branch of the map from `close` to `keep-alive` (the WebSocket branch `upgrade` stays), then `nginx -s reload` — no dsh restart needed:

```nginx
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      keep-alive;   # never close — it contradicts the upstream keep-alive responses
}
```

2. **Gateway (optional hardening, ships with a release)**: `lib/forward.js` strips upstream hop-by-hop headers (`connection`/`keep-alive`/`te`/`trailer`/`upgrade` plus tokens named by `Connection`, see `stripResponseHopByHop`) before relaying, so Node derives connection semantics solely from the **client's own** `Connection` header — the contradiction cannot occur regardless of how the proxy is configured.

> Found on a production 0.7.0 deployment (2026-09). After the fix the same concurrent blast produced 0 400s; direct access to 8080 never showed the issue (browsers use normal keep-alive, so no close/keep-alive contradiction exists).

## 9. Account sign-in stalls at "waiting for sign-in", then the platform keeps answering "authorization failed" (`ALREADY_CONSUMED`)

**Symptom**: after clicking "sign in with a DeepSeek account" the browser goes to the platform and authorization succeeds, but the return to localhost stalls at "waiting for sign-in" until it times out; retries then get "authorization failed" from the platform, and the dsh log shows `ALREADY_CONSUMED`. (If the click fails **immediately** with "Could not sign in" and "waiting for sign-in" never appears, that is a different cause — see §10.)

**Cause**: the account-login callback comes back from the open platform as a **cross-site top-level navigation** to `http://localhost:<port>/oauth/callback`, and such a navigation does **not** carry the gateway's `SameSite=Strict` session cookie — the request always arrives anonymously. Without a `publicPaths` exemption the gateway treats it as an ordinary page path and answers 302 to `/login`, so dsh never receives the `code` (no `auth_exchange` ever happens), while the platform's `authorize_id` was already consumed when it was approved — every later retry only gets `ALREADY_CONSUMED`.

**Checks**:

1. Confirm the dsh version: the feature is available in the Web (`profile web`) surface since **dsh 0.2.1-alpha.3**; earlier releases registered the account UI in the desktop renderer only, so the local Web surface had no sign-in entry at all;
2. Confirm `publicPaths` was not closed or mis-written:
   - `publicPaths: []` closes the exemption entirely (the default is `['/oauth/callback']`);
   - entries match the **basePath-stripped** path, so a sub-path deployment that writes `/dsh/oauth/callback` will **never** match — it must be `/oauth/callback`;
   - reserved paths (`/`, `/api*`, `/connect`, …) are refused at load, so account sign-in may only use upstream handshake endpoints;
3. Confirm the exemption is live with an anonymous probe: request `http://<gateway host>:<port>/oauth/callback?code=x&state=y` — with **no sign-in in flight** the upstream answers 404 (which proves the request crossed the gateway); a 302 to `/login` means the exemption is not in effect.

**Fix**: correct `publicPaths` and **start a fresh sign-in** — a consumed `authorize_id` cannot be reused.

## 10. On a domain / reverse-proxy deployment "Sign in with a DeepSeek account" fails immediately (unlike the §9 "waiting for sign-in")

**Symptom**: reaching dsh through a domain / reverse proxy (or any non-loopback http entry), clicking "sign in with a DeepSeek account" turns the dialog into "Could not sign in / Could not complete the operation. Try again." **immediately** — the browser never navigates to `platform.deepseek.com`, and "waiting for sign-in" never appears; retries always fail the same way, and the dsh log shows **no** `ALREADY_CONSUMED` (the platform was never contacted).

**Root cause** (dsh upstream design; the gateway is not at fault, but it has no server-side workaround): when starting an account sign-in the upstream insists that the **browser origin** be a loopback http origin with an explicit non-zero port (one of `localhost`, `127.0.0.1`, `[::1]`, with no path/query/hash); a domain origin (including an https reverse proxy) is rejected by the very first check:

1. The web client passes the page's `window.location.origin` as `callbackOrigin` to `account/startSignIn` (`@deepseek-ai/dsh-client-ui-settings-account/lib/client.js:4671`; the desktop half uses the origin of `transport.streamBaseUrl`) — behind a domain that is the external origin such as `https://dsh.example.com`; the client then treats `ok === false` as a login failure (`:4672`, `:4681`);
2. The upstream `loginOrigin()` accepts only that loopback shape: the regex lives at `@deepseek-ai/dsh-deepseek-account-platform/lib/index.js:318`, the hostname allowlist at `:319-322`, and anything else throws `PlatformAuthError("protocol")` (`:323`). The call site is at the top of `startSignIn` (`:826`), far ahead of `auth_init` (`:1019`) — **the request never reaches the open platform**, and no `authorize_id` is ever consumed. The message format is `account: ${code}` (`:13-19`), which surfaces in the RPC envelope as `message: "account: protocol"`;
3. The upstream README itself states under "Known Limitations": *"Only local access and SSH local forwarding through HTTP localhost, 127.0.0.1, or [::1] with an explicit port are supported; non-loopback reverse proxies are unsupported."*;
4. **No switch can relax it**: among all 13 fields of the account-platform config (`lib/index.js:500-518`), `allowLoopbackHttp` only affects `platformOrigin` and `rewriteBrowserOrigin` only rewrites the platform return address; `loginOrigin` reads no config or environment variable;
5. On this path the **gateway is not at fault**: `publicPaths` only exempts the **inbound** `GET /oauth/callback` (the §9 chain — boundaries in [SECURITY.md](SECURITY.md#anonymous-upstream-handshake-paths)), while `callbackOrigin` is computed inside the browser and uploaded as an RPC **request-body** parameter — the Host/Origin rewrite in `lib/forward.js` touches forwarded headers only and cannot reach the body.

**Quick check** (any one of these settles it):

1. Browser DevTools → Network, filter `startSignIn`: `POST /api/account/startSignIn` returns **200 immediately** (17 ms measured), with a tiny body (~174 B plaintext with the client's UUID `rpcId`, 146 B measured with a short probe `rpcId`; browsers send `Accept-Encoding: gzip`, and once the **upstream** gzips it that is the 153-157 B seen in the access log (174 B uncompressed)), where the envelope carries `result.ok:false` and `error.message` equal to **`account: protocol`**:

   ```json
   {"type":"server-response","rpcId":"…","result":{"ok":false,"error":{"code":"gateway/internal","message":"account: protocol","details":{}}}}
   ```

   If the response contains an `authorizeUrl` or the UI reaches "waiting for sign-in", a platform request did happen — that is the §9 scenario;
2. The nginx / reverse-proxy access log shows the same shape: a burst of `POST /api/account/startSignIn` → 200, 153-157 B, with **zero** `/oauth/callback` hits in the same window (those 153-157 B are the transfer bytes after the **upstream** gzips the response — about 174 B uncompressed, i.e. the body length in DevTools' Response tab, while its Size column shows the gzipped size);
3. Loopback control: after an SSH tunnel, open the page at `http://127.0.0.1:<gateway port>` and click again → "waiting for sign-in" appears, proving the gateway forwarding is fine and the browser origin is the only variable.

**How this differs from §9**:

| | §9 | This section |
|---|---|---|
| Where it gets stuck | The platform authorized, but the callback never reaches dsh | The sign-in request never leaves (the upstream refuses before `auth_init`) |
| Symptom | Stuck at "waiting for sign-in" → timeout → `ALREADY_CONSUMED` | Immediate "Could not sign in", no platform request at all |
| Browser origin | Loopback (`http://localhost:<port>`) | Domain / https reverse proxy / LAN IP, i.e. non-loopback |
| Gateway-side variable | Whether `publicPaths` exempts `/oauth/callback` | Unrelated to `publicPaths` (the failure is one step earlier) |
| Fix | Correct `publicPaths`, then start a fresh sign-in | Use a loopback entry (SSH -L), or switch to the API Key route |

**What to do** (recommendations):

1. **Use a loopback entry after an SSH local forward**: `ssh -L 8080:127.0.0.1:8080 <host>`, then browse `http://127.0.0.1:8080` (replace 8080 with the gateway `listenPort`). The **explicit non-zero port is mandatory** — `http://127.0.0.1` (no port) is refused as well;
2. **On a domain-only / reverse-proxy deployment, switch to the API Key route** (panel → "Add API Key"): account sign-in is unavailable in that topology — an upstream origin hard limit, not a configuration problem;
3. **Do not** widen `publicPaths`, relax cookies or disable the gate for this symptom — none of them is on this causal chain.

> This section is based on dsh 0.2.1-rc.2 (the highest `next`-line release; the `latest` tag is actually the older 0.2.0-rc.2). Across all 13 published `@deepseek-ai/dsh-deepseek-account-platform` versions the body of `loginOrigin` is byte-identical — upgrading or downgrading dsh does not change this behavior.
