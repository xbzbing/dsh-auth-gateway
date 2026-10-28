# Deployment Guide

> [简体中文](../zh/DEPLOYMENT.md) | English

## dsh version compatibility

**The supported dsh version range is stated in the [README](../../README.en.md).** Run `dsh --version` to see what you have installed.

Every extension point this plugin relies on is unchanged across the supported range, so it works as-is:

| Official extension point used | Purpose |
|---|---|
| `webServer.tapIndex` | Inject the `randomUUID` polyfill and the `basePath` global (self-contained globals only) |
| `dsh.bundle` patch | Bind the internal webserver to `127.0.0.1:<N+1>` (the security foundation — see [SECURITY.md](SECURITY.md)) |
| `ctx.slots` (`settings.section`) | The client "authentication settings" panel |
| `credentials` service + the `client-connection/browser-session` record | Read the upstream BrowserAuth secret and mint an identical cookie for the loopback hop |
| BrowserAuth cookie shape (`dsh-auth-<sha256(authority)>`, `v1.<payload>.<hmac>`) | Indistinguishable from dsh's own browser-session cookie (the `v1` minted by its index route) as far as the upstream is concerned |

Version-line behavior:

- **dsh ≥ 0.1.2**: the internal webserver enforces BrowserAuth; the gateway adapts by minting the cookie automatically (see [SECURITY.md](SECURITY.md));
- **dsh ≥ 0.2.1-alpha.3**: BrowserAuth adds a `v2` cookie (an API operator carrying an `id`, minted by the new `/connect` launch-token exchange for API clients such as the SDKs and the desktop app); **the browser session is still `v1`**, and the gateway mints exactly `v1`, so the upstream keeps accepting it. The same release adds `remoteAccess` RBAC, but it constrains **non-owner** principals only: a browser request (holding the `v1` cookie) is always admitted as `owner`, so the gateway path is unaffected;
- **dsh ≥ 0.2.1-alpha.3 (account sign-in)**: the account-login callback comes back from the open platform as a **cross-site top-level navigation** to `http://localhost:<port>/oauth/callback`, which can never carry the gateway session cookie — it always arrives anonymously, so it needs the `publicPaths` exemption (the default value already includes it). Set it to `[]` and account login stalls at "waiting for sign-in" until it times out, after which the platform keeps answering "authorization failed" (`ALREADY_CONSUMED` — the `authorize_id` was already consumed when it was approved). **There is also a precondition**: account sign-in requires the **browser origin** itself to be a loopback http origin with an explicit non-zero port (the upstream `loginOrigin` constraint) — on a domain / https reverse-proxy entry, clicking "sign in with a DeepSeek account" fails immediately with "Could not sign in" (`account: protocol`), which is unrelated to `publicPaths` and cannot be fixed by changing it; for triage and fixes see [TROUBLESHOOTING.md §10](TROUBLESHOOTING.md). Boundaries: [SECURITY.md](SECURITY.md#anonymous-upstream-handshake-paths);
- **dsh ≤ 0.1.1**: no BrowserAuth and no such record; the gateway silently degrades to verbatim forwarding, matching the old behavior.

> **After upgrading dsh, note this**: dsh's **WebSocket endpoint path changes across versions** — older releases used `/api/events.mux` and `/sidebar/ws/*`, while releases since 0.1.5 only have `/api/remote.mux`. The gateway forwards by path transparently and **hardcodes no endpoint name**, so the plugin needs no change — but **if your reverse proxy keeps a WebSocket path allowlist, it fails silently the moment dsh renames the path** (symptom: HTTP works, login works, the page reports a connection failure). Forward `Upgrade`/`Connection` on the **catch-all location**; see [NGINX-DEPLOYMENT.md](NGINX-DEPLOYMENT.md) and [TROUBLESHOOTING.md](TROUBLESHOOTING.md) §7.

## Signing in to a DeepSeek account over remote access

**The root cause is upstream (the gateway is not at fault, but it has no server-side workaround)**: when a sign-in starts, the upstream requires the **browser origin** to be a loopback http origin with an explicit non-zero port (`http://localhost:<port>`, `http://127.0.0.1:<port>` or `http://[::1]:<port>`). Any non-loopback entry — domain, https reverse proxy, LAN IP — is rejected before the open platform is contacted: clicking "sign in with a DeepSeek account" in the bottom-left fails **immediately** with "Could not sign in / Could not complete the operation. Try again." (`account: protocol`). A loopback address resolves on the machine running the **browser**, so rewriting the origin server-side would only point the browser at its own loopback — there is no server-side way around the constraint, and since remote access is exactly what this plugin provides, the limitation is unavoidable in that setup. Apart from that, **everything works normally over remote access**. Triage and evidence: [TROUBLESHOOTING.md](TROUBLESHOOTING.md) §10.

Manual workarounds (pick one):

1. **Loopback access on the same machine** — simplest when the browser runs next to dsh: open `http://127.0.0.1:<gateway port>` (with `dsh web --port 8080` that is `http://127.0.0.1:8080`). The scheme must be `http` (`https://127.0.0.1:...` is refused as well) and the port must be explicit.
2. **SSH local port forward** — when the browser is on another machine, map the remote gateway onto a local loopback port:

   ```bash
   # run on the machine with the browser:
   #   the first 8080 = local port, any free port will do;
   #   the second port = the gateway listenPort (the N of `dsh web --port N`, default 3080)
   ssh -L 8080:127.0.0.1:<gateway listenPort> <host>
   ```

   Then browse `http://127.0.0.1:8080` (the **local** port) and authenticate at the gateway login page first (password, then OTP if enabled). The cross-site sign-in callback also returns to `http://127.0.0.1:8080/oauth/callback` on the browser's side, travels the same tunnel back to the gateway, and is forwarded upstream by `publicPaths` (exempt by default) — so the whole flow works. Note: if the deployment pins `cookieSecure: true` (e.g. the proxy terminates TLS without forwarding the protocol header, or the attribute is pinned for determinism), a plain-http loopback entry cannot store the session cookie per the documented rule — use the default `auto` for that entry when you need account sign-in (see "Network and security recommendations").

3. **Any other loopback forward** — any tunnel / port-forward tool that maps a loopback `http://127.0.0.1:<explicit port>` to the remote gateway is equivalent (VS Code / JetBrains port forwarding, `kubectl port-forward`, `gost`, …). The only constraint: the browser's origin must be `http://{localhost|127.0.0.1|[::1]}:<non-zero port>`.
4. **Use the API Key route instead** — skip account sign-in and click "Add API Key" in the sign-in dialog (or configure an API key the way dsh normally does). On a domain-only / reverse-proxy deployment this is the established substitute — see [SECURITY.md](SECURITY.md#anonymous-upstream-handshake-paths).

> The desktop app (`dsh-hub-desktop`) is bound by the same rule: it uses the service address origin, which is rejected on a remote domain just like in a browser. To use account sign-in, point it at a loopback entry (workarounds 1–3).

## Ports and listening addresses

### Port: use `dsh web --port <N>` directly

The bundle patch follows `ctx.webStartup` (the same mechanism as web-app's own webserver row); the port is controlled by the CLI flag:

```bash
dsh web --port 8080 --no-open    # external URL 8080, internal webserver auto-moves to 8081
dsh web --no-open                # default: external 3080, internal 3081
```

Derivation rule: **external port = `--port` (default 3080), internal port = external + 1**. Port range 1–65534 (the internal port must stay valid after +1, otherwise config validation fails at startup).

> `--port 0` (OS-assigned) is not supported: the gateway needs a fixed internal port to forward to.

### Always pass `--no-open`

The gateway prints its own external URL, so dsh does not need to open a browser too. Without `--no-open`, dsh's browser handoff opens the **internal** webserver address and appends the launch token to the URL (`appRootUrl()` → `authenticatedUrl()` → `openBrowser()`):

- Without `--public-url` it opens `http://127.0.0.1:<internal port>/?token=…`, and `frontend-static`'s index accepts that token and mints a dsh session cookie outright — **that tab never passes the gateway password**. It only works locally (the internal port listens on loopback alone) and is part of the local-trust model recorded in [SECURITY.md](SECURITY.md), not a vulnerability — but there is no reason to create it. The console also gains a `dsh web: opening the default browser; pass --no-open to disable` line beside the gateway's own.
- With `--public-url` it opens the external origin instead, the request hits the gateway's auth gate first, and that local bypass disappears.

### Why `--host 0.0.0.0` cannot be used

`dsh web --host 0.0.0.0` is rejected outright by dsh (web-app built-in security restriction, hardcoded in `startup.ts`). Since dsh 0.2.1-alpha.2 this check was tightened from the literal `0.0.0.0` to rejecting every wildcard address (`isWildcardHost`: `0.0.0.0`, `::`, `0`, …), while now accepting a **concrete** IPv4/IPv6 literal to bind one local interface. Either way the gateway has no use for it: this is a dsh code-level limit that configuration cannot lift — and **does not need to be lifted**:

- The internal webserver must listen only on `127.0.0.1` (security-critical: an internal port exposed to the outside bypasses the auth gateway);
- External listening is handled by the plugin's `listenHost` (default `0.0.0.0`), which does not pass through web-startup validation.

The correct way to expose externally: **do not pass `--host`; use the default**.

### Local-only access

Set the `listenHost` of the `dsh-auth-gateway` row to `127.0.0.1` (local machine only).

### Fixed ports (without `--port`)

Override both the `webserver` and `dsh-auth-gateway` rows in the profile's own `cordis.patch.yml` (the user patch layer takes priority over the bundle layer); note that `webserver.port` must equal `dsh-auth-gateway.config.upstreamPort`. Once overridden manually, the `--port` flag no longer takes effect.

## Network and security recommendations

- **LAN deployment**: keep it on a trusted network; the gateway listens on all interfaces by default — configure a firewall before exposing it across networks;
- **HTTPS / Secure cookie**: the `cookieSecure` config (default `auto`) governs the `Secure` attribute of the session cookie — it is attached automatically once the connection is TLS (the reverse proxy must forward `X-Forwarded-Proto: https`), after which browsers only send the cookie back over the encrypted link; `true` forces the attribute (for deployments behind a TLS proxy that does not forward the protocol header); `false` opts out explicitly. **Note**: Secure only works over HTTPS — on a plain-HTTP link forcing it makes browsers refuse to store the cookie and logins fail loudly rather than downgrading silently. Transport encryption still has to come from your deployment: in production put a TLS reverse proxy (nginx/Caddy etc.) in front of the gateway port and configure `trustedHosts` (below); for direct LAN access without a public certificate, stand up an internal CA (e.g. mkcert) issuing a certificate for the gateway and import its root into the client trust stores for warning-free HTTPS;
- **Mixed HTTPS/HTTP entry points (same domain, two protocols)**: the session cookie carries `SameSite=Strict`, and an HTTPS login's cookie also carries `Secure` — so browsers never send the HTTPS entry's session to an `http://` entry: after signing in at `https://dsh.example.com`, visiting `http://dsh.example.com:8080` requires a new sign-in. That is **expected behavior** (the encrypted entry's session does not downgrade to a cleartext entry); if multiple entries genuinely need to share sessions, put them all on HTTPS (TLS on every port of the same reverse proxy) instead of relaxing the cookie attributes. Note that once an HTTPS Secure cookie exists, **re-signing-in on the plaintext entry also fails** (browsers refuse to overwrite a Secure cookie from an insecure origin) — the login page now detects this and shows an explicit message ("Sign-in did not take effect: the browser did not keep the session cookie…") instead of silently bouncing back; sign out on the HTTPS entry (or clear the site's cookies) to recover.
- **trustedHosts**: when accessed via a reverse proxy / custom domain, configure `trustedHosts` on the `dsh-client-connection` row (the authorization authority of the internal fence; this plugin rewrites Host/Origin to loopback on forwarded requests, so normally no configuration is needed — follow the dsh docs for special topologies);
- **Backups**: credentials live in `$DSH_HOME/auth-gateway/` (password.json, otp.json, otp-master.key); encrypt them when backing up (the OTP secret is already AES-256-GCM encrypted, but the master key `otp-master.key` needs equal protection — see SECURITY.md);
- **OTP master key management**: an `auth-gateway/otp-master.key` is auto-generated by default — key and ciphertext live in the same directory (local trust model). To isolate disk disclosure, set the `DSH_AUTH_GATEWAY_MASTER_KEY` environment variable before deployment (32 bytes, hex or base64 encoded) and store it on an encrypted volume or in external key management (KMS / Docker secret / systemd credentials etc.); once the environment variable is set, the key file is neither generated nor read. Generate one with: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`. See the "OTP 密钥加密" section of [SECURITY.md](SECURITY.md) for details.

## Deployment behind nginx / a reverse proxy

The gateway can serve directly or sit behind nginx (or any reverse proxy). Full topologies with complete config examples (bare-metal direct connection, subdomain deployment, sub-path deployment, Docker nginx container) are in:

- [NGINX-DEPLOYMENT.md](NGINX-DEPLOYMENT.md) (English) ｜ [简体中文](../zh/NGINX-DEPLOYMENT.md)

Quick summary:

- **Subdomain deployment (recommended)**: root-path deployment on `dsh.example.com`, nginx reverse-proxies 443 to the gateway port — zero conflicts, zero maintenance;
- **Sub-path deployment**: configure `basePath: /dsh` on the gateway (override it in the deployer's profile patch — note that `config:` is a whole-object replacement, so all bundle-patch fields must be kept); nginx must additionally proxy the root-path resources dsh references (`/assets/`, `/api/`, `/plugins/`, etc.);
- **Proxying WebSockets**: `Upgrade` / `Connection` must be forwarded, and they belong on the **catch-all location** — use `map $http_upgrade $connection_upgrade` (in the `http {}` scope) with `proxy_set_header`; do not hardcode `"upgrade"` and do not allowlist paths. dsh's WebSocket path has changed across versions (older `/api/events.mux`, current `/api/remote.mux`), and a drifting allowlist fails silently: HTTP works, login works, only the page reports a connection failure. Also raise `proxy_read_timeout` / `proxy_send_timeout`, or the SSE event stream is cut at 60s. Full configs are in [NGINX-DEPLOYMENT.md](NGINX-DEPLOYMENT.md); how to confirm the diagnosis is in [TROUBLESHOOTING.md](TROUBLESHOOTING.md) §7.

## Troubleshooting

| Symptom | Cause & fix |
|---|---|
| Page shows "加载提供方目录失败: crypto.randomUUID is not a function" | Browser Web Crypto restriction in a non-secure context (HTTP + non-localhost); the plugin injects a polyfill — make sure the latest version is installed and dsh web was restarted |
| Many `/api/*` 403 after login | The internal fence rejects external Host — confirm the bundle patch is in effect (webserver should be `127.0.0.1:<internal port>`) and the gateway rewrites Host/Origin |
| Cannot reach `http://<LAN IP>:<port>` | Check whether the gateway listens on `0.0.0.0` (`listenHost` config) and the firewall rules |
| Login rejected with 429 | Global rate limit or OTP throttle triggered — wait for the window to reset (1 minute / 5-minute lockout) |
| Login succeeds but the page reports a connection failure, console shows `WebSocket connection to '.../api/remote.mux' failed` | The reverse proxy did not forward `Upgrade`/`Connection` for that path (typically a per-path WS allowlist with a catch-all location lacking those headers) — see [TROUBLESHOOTING.md](TROUBLESHOOTING.md) §7; the gateway log carries a `WebSocket 握手缺少 Upgrade 头` warning |
| `--port 65535` fails to start | Internal port 65536 is invalid — port range is 1–65534 |
| Duplicate installation (two dsh-auth-gateway rows in the composition tree) | The second gateway must fail with EADDRINUSE on the same port — remove the duplicate row |

## Credential reset and uninstall commands

The plugin package ships two commands (`bin` in `package.json`): `dsh-auth-gateway-reset` (deletes only the password record) and `dsh-auth-gateway-uninstall` (deletes the whole `$DSH_HOME/auth-gateway/`). `dsh plugin add` links the commands into the profile's `node_modules/.bin` via pnpm — **that directory is not on PATH by default**, so typing the short name gives "command not found". Two ways to run them:

```bash
# Option 1: full path (replace the profile name with yours)
~/.dsh/profiles/web/node_modules/.bin/dsh-auth-gateway-reset

# Option 2: add the profile bin to PATH (append to ~/.zshrc / ~/.bashrc and reopen the terminal)
export PATH="$HOME/.dsh/profiles/web/node_modules/.bin:$PATH"
dsh-auth-gateway-reset
```

> **Where is `$DSH_HOME`**: credentials live in `$DSH_HOME/auth-gateway/` (password.json, otp.json, otp-master.key). `$DSH_HOME` defaults to `~/.dsh` (i.e. `$HOME/.dsh`) and can be overridden with an environment variable — dsh and the plugin read the same value.

After `dsh-auth-gateway-reset` deletes the password record, you **must restart dsh web**: the initial password is generated and printed to the console at startup (the plugin has no "set password" page); log in and go through onboarding to set a personal password. If the authenticator was lost, also delete `$DSH_HOME/auth-gateway/otp.json` (or just run `dsh-auth-gateway-uninstall`).

> **Order reminder**: if you also want to remove the plugin, **run the credential command above first, then `dsh plugin --profile web remove dsh-auth-gateway`** — remove deletes the plugin dependency from the profile, which breaks the bin links of both commands (dangling references to deleted targets).

## Upgrades

After `dsh plugin --profile web add file:...` you must **remove + add** to refresh the pnpm snapshot (a `file:` dependency is snapshotted at install time), then restart dsh web. The plugin ships its own `dsh-auth-gateway-reset` / `dsh-auth-gateway-uninstall` commands (no need to run them when upgrading).