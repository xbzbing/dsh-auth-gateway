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
