# dsh-auth-gateway

<p align="center">
<a href="https://www.npmjs.com/package/dsh-auth-gateway"><img src="https://img.shields.io/npm/v/dsh-auth-gateway.svg" alt="npm version"></a>
<a href="https://www.npmjs.com/package/dsh-auth-gateway"><img src="https://img.shields.io/npm/dt/dsh-auth-gateway.svg" alt="npm total downloads"></a>
<a href="LICENSE"><img src="https://img.shields.io/npm/l/dsh-auth-gateway.svg" alt="npm license"></a>
</p>

<p align="center"><b>Language: <a href="README.md">简体中文</a> | English</b></p>

A Cordis plugin that puts an authentication gate in front of the [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) Web UI: **password auth + TOTP two-factor authentication + layered brute-force protection + session management + login audit**, with **real interception of every request** (HTTP and WebSocket) at the gateway layer — unauthenticated traffic never reaches the backend.

`dsh web` ships with no authentication layer (its built-in trust fence is a reachability policy, not auth). This plugin fills that gap as an in-process gateway: the gateway exclusively owns the external port, the bundle patch pins the internal webserver to the loopback address, and the gateway is the only way in.

## Installation and Uninstallation

```bash
# Install (from npm registry)
dsh plugin --profile web add dsh-auth-gateway

# Start (external port 8080, internal webserver auto-moves to 8081)
dsh web --port 8080

# Uninstall (clean credentials first, then remove)
~/.dsh/profiles/web/node_modules/.bin/dsh-auth-gateway-uninstall
dsh plugin --profile web remove dsh-auth-gateway
```

- Supports installation from GitHub / local directory — see [docs/INSTALL.md](docs/INSTALL.md);
- **You must run the credential cleanup command before `remove`** (`reset` / `uninstall`), otherwise `$DSH_HOME/auth-gate/` password and OTP data will remain;
- Forgot your password? Use `dsh-auth-gateway-reset` to reset (restart prints a new initial password to the console);
- Update / detailed steps / troubleshooting — see [docs/INSTALL.md](docs/INSTALL.md).

## Features

- **Password auth**: on first deployment an initial password is auto-generated and printed to the console (one-time credential); after login you are guided to set a personal password (scrypt-hashed), and every subsequent visit requires login;
- **Two-factor authentication (TOTP)**: optional; works with Google Authenticator, Authy, 1Password and other mainstream authenticators; ships with one-time backup codes (scrypt-hashed, single-use) for recovery when a device is lost; **the OTP secret is stored encrypted at rest with AES-256-GCM** (master key from the `DSH_AUTH_GATEWAY_MASTER_KEY` env var or an auto-generated `auth-gate/otp-master.key`), so a disk disclosure no longer exposes the second-factor root key;
- **Real request interception**: unauthenticated `/api/*` returns 401, page paths 302 to the login page, WebSocket upgrades are rejected outright; authenticated traffic is forwarded transparently (Host/Origin normalization, compatible with the internal trust fence);
- **Sub-path deployment (basePath)**: supports mounting behind a reverse-proxy sub-path (e.g. `https://example.com/dsh/`). Configure `basePath: /dsh` and the gateway handles route stripping, 302 redirect prefixing, and upstream forwarding automatically; PWA metadata (`manifest`/`favicon`) and static assets (`/assets/*`) are served without authentication. **Note**: DSH is a root-path application — frontend JS references absolute URLs like `/assets/...`, `/api/...`, `/plugins/...`. Sub-path deployment requires nginx to proxy these root paths separately. **Subdomain deployment is recommended** (`dsh.example.com`, root path, zero conflicts) — see [docs/NGINX-DEPLOYMENT.md](docs/NGINX-DEPLOYMENT.md);
- **Login audit**: login success / failure / logout / password change are logged via `ctx.logger.info` (with source IP and failure reason — never any credentials), forming a complete audit trail alongside brute-force alerts;
- **Authenticated LAN settings support**: before dsh client modules initialize, browsers reached through the gateway receive loopback-trusted connection state, enabling Models, Credentials, locale/theme preferences, and other host-backed settings to load and persist;
- **Layered brute-force protection**: per-source lockout on password failures (default 5 failures / 5 min) + global rate limit (default 60 attempts/min) + per-source OTP/backup-code limit (default 10/min); scrypt runs asynchronously on the libuv thread pool, so login floods never block the event loop;
- **Session management**: in-memory 256-bit tokens (30 days), HttpOnly + SameSite=Strict cookies; changing the password or disabling OTP revokes all sessions;
- **Security events**: lockouts and exhausted rate-limit windows log warnings and broadcast a `dsh-auth-gateway/brute-force` Cordis event (JSON payload) for monitoring and automation;
- **Bilingual (zh/en)**: the settings panel follows the dsh UI language (Settings → Language); the login / onboarding / OTP pages render in your preferred language (`locale.preference` in `$DSH_HOME/settings.yaml`), falling back to the browser language (Accept-Language) when no preference was set — a change applies on the next page load; the first-run console notice prints both languages;
- **Compliant shape**: a host-only plugin (zero build, zero runtime dependencies) plus an optional client half (settings panel, source-built), all through official dsh extension points (`ctx.effect`, `webServer.tapIndex`, `ctx.slots`).

## How it works

```
Browser ──> dsh-auth-gateway gateway (external port, inside the dsh process)
               │  every request passes the auth check first (O(1) session table)
               ├─ unauthenticated ─> /api/*: 401 ｜ pages: 302 /login ｜ WS: rejected
               ├─ 2FA not passed ─> /otp/verify
               └─ authenticated ─> forward (Host/Origin rewritten to loopback) ──> dsh webserver (127.0.0.1:internal port)
```

- The gateway's lifecycle is bound to dsh: it starts/stops with dsh, no separate process;
- The bundle patch moves the webserver to a loopback port (external = `--port`, internal = external + 1), so remote clients cannot bypass the gateway and reach the backend directly;
- The gateway establishes client-side loopback trust while dsh's `__ModuleLoader__` loads the connection module, before Settings consumers start. This compatibility layer does not replace login, the HTTP/WebSocket gates, or the server-side fence;
- Auth state machine: `first deploy → initial-password login → onboarding (set a personal password) → login → (optional) OTP verification → session`; sessions that have not finished onboarding or 2FA can only reach their verification endpoints.

## Screenshots

<table>
<tr>
<td align="center"><img src="docs/assets/onboarding.png" width="480" alt="Onboarding page (set a personal password)"><br/>Onboarding (after initial-password login)</td>
<td align="center"><img src="docs/assets/login.png" width="480" alt="Login (with 2FA code)"><br/>Login (with 2FA code)</td>
</tr>
<tr>
<td align="center"><img src="docs/assets/login-success.png" width="480" alt="2FA login success"><br/>2FA login success</td>
<td align="center"><img src="docs/assets/otp-setup.png" width="480" alt="OTP setup (QR code)"><br/>OTP setup (QR code)</td>
</tr>
<tr>
<td align="center"><img src="docs/assets/settings-menu.png" width="480" alt="Settings menu (with Auth Settings entry)"><br/>Settings menu ("Auth Settings" entry)</td>
<td align="center"><img src="docs/assets/settings-auth.png" width="480" alt="Auth settings panel"><br/>Auth settings panel</td>
</tr>
</table>

## Quick start

1. Start `dsh web`: on first deployment an **initial password** is auto-generated and printed to the console (a prominent notice block); copy it and keep it safe;
2. Open the Web UI and log in with the initial password — you land on the **onboarding page**: set your own access password (at least 8 characters, mixed case or a special character; **mandatory** — all functionality stays locked until it is set). The initial password is one-time and invalidated once set;
3. After login you can visit `/otp/setup` to enable TOTP (scan the QR code or enter the secret manually, confirm with a verification code; backup codes are generated at the same time — store them safely);
4. Once OTP is enabled, login requires password + verification code (or a backup code);
5. Change password: visit `/login` (shows the change form when logged in), or use the "Auth Settings" panel.

## Configuration

The fields below are the `config` of the `dsh-auth-gateway` row in the bundle patch / profile patch (validated by Standard Schema):

| Field | Default | Meaning |
|---|---|---|
| `listenHost` / `listenPort` | `0.0.0.0` / `3080` | Gateway external listen address and port |
| `upstreamHost` / `upstreamPort` | `127.0.0.1` / `3081` | Internal webserver address and port |
| `basePath` | `/` | Reverse-proxy sub-path prefix (e.g. `/dsh`); **default `/` (root path)**. For sub-path deployment, set in the **deployer's profile patch**, not shipped with the plugin |
| `minPasswordLength` | `8` | Minimum password length (4–128) |
| `requireMixedCase` / `requireSpecial` | `true` / `true` | Password complexity: mixed case OR special character |
| `maxLoginFailures` / `lockMinutes` | `5` / `5` | Password-failure lockout threshold and duration |
| `maxGlobalAuthAttemptsPerMinute` | `60` | Global auth-attempt rate cap |
| `maxOtpAttemptsPerMinute` | `10` | Per-source OTP/backup-code verification rate cap |
| `otpEnabled` (deprecated) | `false` | No longer a switch — 2FA is bound and activated by the user from the Auth Settings panel; kept only for config compatibility |
| `otpRequired` | `false` | Require verification at every login once 2FA is active (no config needed) |
| `otpIssuer` / `otpPeriod` / `otpDigits` / `otpWindow` | `dsh-auth-gateway` / `30` / `6` / `1` | TOTP parameters (display name, period, digits, window) |
| `backupCodeCount` / `backupCodeLength` | `10` / `8` | Backup-code count and length |

## Security model

Authentication-state changes (enable/disable OTP, change password) always require a fully verified session: disabling OTP while 2FA is active additionally requires the current password plus a verification code or an unused backup code; sessions that have not completed 2FA cannot reach sensitive endpoints. OTP verification is replay-protected (accepted time-steps are recorded) and spoof-resistant (`x-forwarded-for` never counts toward the source). **The OTP secret is sealed with AES-256-GCM before it is written to disk** and can only be read with the master key — by default an auto-generated `auth-gate/otp-master.key` (0600), or injected via `DSH_AUTH_GATEWAY_MASTER_KEY` (hex/base64, 32 bytes) to isolate disk disclosure. Login audit records only event kind, source IP and failure reason — never any credentials. The full threat model, known limitations and recovery paths are in [docs/SECURITY.md](docs/SECURITY.md) (Chinese).

## Documentation

| Doc | Content |
|---|---|
| [docs/INSTALL.md](docs/INSTALL.md) | Install, update, uninstall, credential reset — full step-by-step |
| [docs/NGINX-DEPLOYMENT.md](docs/NGINX-DEPLOYMENT.md) | nginx deployment: bare-metal / host nginx / Docker nginx container — three topologies with full config examples |
| [docs/SECURITY.md](docs/SECURITY.md) | Threat model, OTP security design, known limitations, recovery paths |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Ports & listening, LAN deployment, HTTPS advice, troubleshooting |
| [docs/TESTING.md](docs/TESTING.md) | Unit tests, end-to-end (Playwright), API/WebSocket gate verification |
| [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) | Architecture, build, development stats |

The detailed docs above are in Chinese.

## Acknowledgements

- **@adra2n** — implemented OTP two-factor authentication ([PR #1](https://github.com/xbzbing/dsh-auth-gateway/pull/1)) and added AES-256-GCM encryption at rest for the OTP secret with error classification ([PR #6](https://github.com/xbzbing/dsh-auth-gateway/pull/6));
- **@meowtech** — implemented authenticated LAN browser settings support ([PR #7](https://github.com/xbzbing/dsh-auth-gateway/pull/7)), fixing the host-backed settings unavailability issue when accessing remotely.

## Verification overview

- Unit & contract tests: `npm test` (131 tests, incl. basePath route/redirect/forward, PWA metadata pass-through, login audit, OTP security regressions, client contract, patch port derivation)
- Deploy pipeline: `npm run deploy` (syntax check → full test suite → sync to DSH install dir → post-install verification)
- End-to-end against a real instance: `node scripts/e2e.mjs` (Playwright; login/2FA/password-change flows)
- Gate verification: `./scripts/verify.sh` (curl; 401/302/WS rejection/lockout)

See [docs/TESTING.md](docs/TESTING.md) for details.

## Model Experience

None — this package is an authentication carrier between the browser and the internal dsh webserver; it never enters any model request.

#### KV Cache effect

None — this package neither assembles nor sends provider requests.

## License

MIT
