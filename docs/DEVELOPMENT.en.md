# Development Guide

> [简体中文](DEVELOPMENT.md) | English

## Architecture

```
host (zero build, node:crypto / node:http)
├── index.js          # Cordis plugin entry: gateway lifecycle, tapIndex injection (randomUUID + authenticated LAN trust), security-event & login-audit wiring, first-run initial password
├── lib/gateway.js    # Auth gateway: HTTP/WS interception & forwarding, auth state machine, three-layer brute-force protection, replay protection, basePath routing/redirect/forward stripping, login-audit events, static-asset pass-through
├── lib/gateway-otp.js # OTP route handlers (/otp/setup|enable|verify-setup|verify|verify-backup|disable, split out of gateway.js)
├── lib/auth.js       # Session table & cookies: in-memory 256-bit tokens, onboarding/OTP state flags, revocation on password change
├── lib/page-shell.js # Shared page scaffolding (base CSS, HTML skeleton, script head: ERRORS + post)
├── lib/errors.js     # Master page-error dictionary (zh/en; errorsFor selects per page with overrides)
├── lib/locale.js     # Page language resolution (dsh preference > Accept-Language > zh)
├── lib/store.js      # Password storage (async scrypt hash, $DSH_HOME/auth-gate/password.json)
├── lib/otp-store.js  # OTP storage (secret + hashed backup codes + lastCounter watermark)
├── lib/otp-crypto.js # OTP secret encryption/decryption (AES-256-GCM; master key from env var or key file)
├── lib/totp.js       # TOTP (RFC 6238/4226): base32, generate/verify, replay protection, otpauth URI, backup codes
├── lib/qr-svg.js     # Zero-dependency QR SVG generation (Reed-Solomon, mask evaluation)
├── lib/otp-page.js   # OTP setup/verify pages (self-contained HTML)
├── lib/login-page.js # Login/settings/change-password page
├── lib/onboarding-page.js # Onboarding page (set a personal password + optional OTP binding)
├── lib/policy.js     # Password-strength policy
└── lib/config.js     # Standard Schema config validation (incl. the basePath sub-path prefix)

client (optional, source-built)
└── client/src/index.jsx  # Settings panel (auth settings: OTP/change password/logout), slot registration (settings.section)
    client/build.mjs      # esbuild build → client/index.js (served by dsh via exports["./client"])

scripts / tests
├── scripts/deploy.sh         # Deploy pipeline: syntax check → full tests → sync to the DSH install dir → post-install verification (--restart optionally restarts)
├── scripts/e2e.mjs           # Playwright end-to-end (real dsh web: login/2FA/password-change flows)
├── scripts/smoke.mjs         # Mock Cordis ctx + fake upstream smoke service (for verify.sh; ports avoid 3080/3081)
├── scripts/screenshots.mjs   # README UI screenshots (docs/assets/*.png)
├── scripts/verify.sh         # curl gate verification (401/302/WS rejection/lockout)
├── scripts/reset.mjs         # dsh-auth-gateway-reset: deletes only password.json (bilingual output)
├── scripts/uninstall.mjs     # dsh-auth-gateway-uninstall: deletes the whole auth-gate/ (bilingual output)
└── tests/                    # gateway / config / policy / otp / locale / basepath / patch-ports / plugin-contract / client-contract
```

Design points:

- **Zero runtime dependencies**: the host uses only Node built-ins; the client build artifact only externally references modules provided by the dsh runtime;
- **Official extension points**: `ctx.effect` (lifecycle), `webServer.tapIndex` (randomUUID and authenticated LAN trust injection), `ctx.slots` (client UI), `ctx.emit` (security events), `dsh.bundle` (composition patch);
- **basePath sub-path deployment**: the gateway strips the `basePath` prefix before routing (with a boundary check, so `/dsh2/foo` is not mistaken for the `/dsh` prefix), prepends it to 302 redirects, and strips it again when forwarding upstream; PWA metadata (`manifest.webmanifest` / `favicon.svg`) and static assets (`/assets/*`) pass through without authentication (browser sub-resource requests, no sensitive data);
- **Client trust timing**: the index transform inserts the bootstrap after the queue-mode `__ModuleLoader__` is created and before parser-preloaded bundles register; it wraps both queue/live registrations and sets `handle.isLoopback = true` before `dsh-client-connection` calls `ctx.provide('connection', handle)`, preventing Settings from binding to the memory scope too early. This depends on DSH's internal loader protocol; on a structural mismatch it logs a single warning;
- **Bilingual pages**: `lib/locale.js` resolves the render language (`locale.preference` in `$DSH_HOME/settings.yaml` > the request's `Accept-Language` > zh) and page copy is selected by language; error messages are maintained in one place, `lib/errors.js` (login failures return the single `invalid-credentials` code to prevent credential enumeration);
- **Login audit**: login success/failure/logout/password change go through the `gateway.onAuthEvent` callback to the audit log (`ctx.logger.info`, only event kind + IP + reason — never credentials);
- **Storage**: atomic writes (temp + rename), 0600/0700, same pattern as the password; the OTP secret is stored AES-256-GCM encrypted (master key from `DSH_AUTH_GATEWAY_MASTER_KEY` or `auth-gate/otp-master.key`, see SECURITY.md).

## Build

```bash
npm run build:client   # build the client bundle (esbuild)
npm run build:check    # rebuild and assert the artifact matches the source
npm run check          # syntax check (lib/*.js) + full test suite
npm test               # full test suite
npm run deploy         # deploy pipeline (syntax → tests → sync → post-install verification)
```

The client build artifacts (`client/index.js` + `.map`) are committed, but `build:check` keeps them consistent — after changing the JSX source you must rebuild.

## Development statistics

This project was developed and tested by **DeepSeek Harness (dsh)**. The early development session (password-gate phase, model `deepseek-v4-flash`):

| Metric | Value |
|---|---|
| Development time | ~93 minutes |
| Turns | 20 |
| Steps | 381 |
| Tool calls | 393 |
| Input tokens (new) | 206,172 |
| Cached tokens (KV cache) | 95,108,864 |
| Cache hit rate | 99.8% |
| Output tokens | 243,803 (of which reasoning 121,760) |
| Total tokens (input + output) | ≈ 95.56 million |

> Note: cache-hit data comes from the prefix-cache (KV cache) metric returned by the model provider; the high hit rate stems from stable reuse of the input prefix across steps in a long session. The OTP phase (incl. security review and cross-repo PR collaboration) is counted separately and not included in the table above.

## Version history

- `0.5.0`: bilingual reset/uninstall commands; bilingual deployment docs (DEPLOYMENT / NGINX-DEPLOYMENT); docs maintenance;
- `0.4.2`: basePath sub-path deployment (route/redirect/forward stripping + PWA/static-asset pass-through), login audit logs, unified login-failure error + centralized page error dictionary (lib/errors.js), bilingual deployment docs;
- `0.4.1`: authenticated LAN browser settings support (loopback-trusted, PR #7);
- `0.4.0`: OTP secret encrypted at rest with AES-256-GCM (master key from `DSH_AUTH_GATEWAY_MASTER_KEY` or an auto-generated `otp-master.key`), compatible with legacy plaintext records;
- `0.3.1`: enable OTP from the settings panel without a deployment switch; revoke all sessions on activation;
- `0.3.0`: gateway pages follow the dsh language (preference > Accept-Language > zh), settings-panel i18n, bilingual first-run console notice;
- `0.2.0`: OTP two-factor authentication (TOTP + backup codes + QR), layered brute-force protection, client settings panel, security-review fixes (re-verification, replay protection, rate limiting);
- `0.1.0`: password gate (set/login/change password, password policy, failure lockout, global rate limit, security events).