# Testing Guide

> [简体中文](../zh/TESTING.md) | English

## Unit and contract tests

```bash
npm test
```

131 tests (node:test), covering:

| File | Coverage |
|---|---|
| `tests/gateway.test.mjs` | Auth gate (401/302/WS rejection), forwarding (Host/Origin rewrite, absolute-URI normalization), lockout/rate-limit/security events, session lifecycle, DNS-rebinding contract |
| `tests/otp.test.mjs` | TOTP algorithm (RFC 6238/4226), backup codes, OTP storage, OTP routes (enable/disable re-verification, replay protection, throttling, otpDigits), S1/S2 security regressions |
| `tests/basepath.test.mjs` | basePath routing/redirect/forward, PWA metadata and static-asset pass-through |
| `tests/locale.test.mjs` | Page language resolution (preference > Accept-Language > zh) |
| `tests/policy.test.mjs` | Password-strength policy matrix |
| `tests/config.test.mjs` | Config Schema validation (defaults, invalid values, boundaries) |
| `tests/plugin-contract.test.mjs` | Cordis plugin contract (loader normalize, Config validation) |
| `tests/patch-ports.test.mjs` | Bundle-patch port expression derivation (`--port` following) |
| `tests/client-contract.test.mjs` | Client bundle contract (loader registration, inject alignment, api inject face, no ctx, externals) |

## Build consistency

```bash
npm run build:check   # rebuilds the client bundle and asserts the artifact matches the source (guards against hand-edited artifacts)
```

## Browser end-to-end (Playwright, real instance)

Runs the full browser flow against a live instance (initial-password login → onboarding to set a personal password → homepage load → logout/login → weak-password/confirm validation → password change/re-login, asserting zero JS errors; **it really changes the password** — the final password is `PASSWORD-2`):

```bash
# Configured instance
BASE=http://127.0.0.1:8002 PASSWORD=your-password node scripts/e2e.mjs
# Fresh deployment: copy the initial password from the dsh console
BASE=http://127.0.0.1:8002 INITIAL_PASSWORD=<initial password from console> PASSWORD=your-password node scripts/e2e.mjs
```

The script distinguishes "fresh deployment (pass `INITIAL_PASSWORD`, goes through onboarding)" from "configured (direct login)"; requires a local playwright (`npm i -D playwright`) with chromium.

## API/WebSocket gate verification (curl)

```bash
BASE=http://127.0.0.1:8002 PASSWORD=your-password ./scripts/verify.sh
```

Covers: unauthenticated 401/302, full settings/login/change/logout flow, authenticated forwarding, **unauthenticated WebSocket upgrade rejection**, old-session revocation after a password change. **It really changes the password** (the final password is `PASSWORD-new`).

## Local smoke (no dsh environment)

```bash
node scripts/smoke.mjs    # mock ctx + fake upstream, quick gateway-behavior verification
```

## Screenshots (README demo images)

```bash
# Needs an instance with otpEnabled (an overlay patch example is in the script header), then:
node scripts/screenshots.mjs    # outputs to docs/assets/*.png
```

The script rebuilds credentials (logs in with the initial password, sets the demo password `DemoPass!1`, enables OTP) and is repeatable; it covers: onboarding (set a personal password), login (with 2FA), 2FA login success, OTP setup (QR), settings menu, auth settings panel.