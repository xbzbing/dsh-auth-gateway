# dsh-auth-gateway

A Cordis plugin that puts an authentication gate in front of DeepSeek Harness Web: **password login, TOTP two-factor authentication, layered brute-force protection, session management, and login auditing**. The gateway owns the public port while the internal webserver stays bound to loopback, and every HTTP request and WebSocket upgrade passes the gate first — unauthenticated traffic never reaches the backend.

## Features

- **Password login**: a one-time initial password is generated on first deployment (printed to the console), then a guided flow sets your personal password (stored as an asynchronous scrypt hash);
- **TOTP two-factor authentication**: optional, compatible with Google Authenticator, Authy, 1Password and other mainstream authenticators, with one-time backup codes; the OTP secret is sealed with AES-256-GCM on disk, so a disk leak no longer exposes the second-factor root secret directly;
- **Real request interception**: unauthenticated `/api/*` calls get 401, page paths redirect to the login page, and WebSocket upgrades are rejected outright; authenticated traffic is forwarded transparently (Host/Origin rewritten to loopback, compatible with the internal trust fence);
- **Layered brute-force protection**: per-source-IP lockout on password failures, plus a global rate limit and an independent OTP/backup-code limiter — login floods never block the event loop;
- **Session management**: in-memory 256-bit tokens with HttpOnly + SameSite=Strict cookies; changing the password or disabling OTP revokes every session;
- **Login auditing**: sign-ins, sign-outs, password changes, and brute-force alerts are persisted to disk (JSONL, rotated daily, kept 90 days), never containing any credential.

## Repository

Source, full documentation, and deployment guides on GitHub: <https://github.com/xbzbing/dsh-auth-gateway>
