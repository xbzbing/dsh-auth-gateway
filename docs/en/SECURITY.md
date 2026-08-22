# Security Model

> [简体中文](../zh/SECURITY.md) | English

This document describes the dsh-auth-gateway threat model, authentication security design, known limitations and recovery paths.

## Threat model

This plugin is designed for **remote-access authentication of dsh web**: the default threat is an attacker who can route to the external port but cannot read the local filesystem. Local users (who can read `$DSH_HOME`) are out of scope — the local trust model, equivalent to "logging into the machine's account grants full access".

| Attack surface | Protection |
|---|---|
| Unauthenticated remote calls to `/api` (create agents, run bash, read/write files) | Full gateway interception: unauthenticated requests get 401 / 302 / WS rejection and never reach the internal webserver |
| Password brute force (single source / rotating sources) | Per-source lockout (default 5 failures / 5 min) + global rate limit (60/min) + independent OTP throttle (10/min), three layers stacked |
| OTP code brute-force guessing | Per-source throttling + failures count toward the unified lockout; scrypt runs asynchronously, so floods never block the event loop |
| OTP replay (reusing the same code within its window) | Accepted time-steps are recorded (`lastCounter`, persisted); codes for the same or earlier steps are rejected |
| Session hijacking (cookie theft) | HttpOnly + SameSite=Strict; sensitive operations like disabling OTP or changing the password require full re-verification |
| DNS-rebinding / cross-site requests | The gateway cookie gate takes over (cross-site requests carry no session cookie and are rejected at the gateway); after the internal fence's duty shifts, Host/Origin are rewritten to loopback (see below) |
| LAN browsers obtaining client loopback trust | The trust bootstrap is only served with the internal DSH index; external browsers must pass full gateway authentication before they get a page, the internal webserver still listens only on loopback, and the server-side privileged fence stays enabled |
| Storage disclosure (`$DSH_HOME` files read) | Passwords and backup codes are scrypt-hashed; **the OTP secret is AES-256-GCM encrypted** (reading it requires the master key — see "Known limitations") |
| First-deployment squatting | The initial password is auto-generated server-side (printed to the console, visible locally) — no "first-come-first-served" window; the initial password is a one-time credential and is invalidated after onboarding |

## Authentication security design

### State machine

```
first deployment (auto-generated initial password) → initial-password login → onboarding (mandatory personal password) → login (password)
  → (when OTP is enabled) OTP verification required → full session
  → (when OTP is disabled) full session directly
```

- **Sessions that have not completed 2FA** (sessions logged in after OTP was enabled): can only reach `/otp/verify`, `/otp/verify-backup` and the verification pages; settings, OTP management and password changes are all rejected (`otp-required`);
- **Sensitive operations** (enable/disable OTP, change password) require a fully verified session; **disabling OTP** additionally requires the current password plus a verification code or an unused backup code — a session alone is not enough to turn off the second factor;
- A successful login resets the failure counter; changing the password or disabling OTP revokes all sessions.

### TOTP implementation

- RFC 6238 / RFC 4226 standards (HMAC-SHA1, 6 digits, 30-second period — all configurable), constant-time comparison;
- Verification window ±1 step; accepted time-steps are recorded to prevent replay;
- Backup codes: scrypt-hashed, single-use, generated without confusable characters.

### OTP secret encryption (at rest)

The TOTP secret is the root key of the second factor: whoever holds it can generate any valid code. To stop a `$DSH_HOME` file disclosure from handing over that key directly, `otp-store.js` seals it with **AES-256-GCM** via `lib/otp-crypto.js` before writing `otp.json` (format `v1.<iv>.<tag>.<cipher>`, all hex) and decrypts it with the master key when reading. Legacy plaintext records remain readable (detected by the `v1.` prefix) — no manual migration needed.

Master key (32 bytes) resolution priority:

1. The `DSH_AUTH_GATEWAY_MASTER_KEY` environment variable (hex or base64, 32 bytes); when set, it is used and no key file is written;
2. Otherwise an `auth-gateway/otp-master.key` is auto-generated on first OTP enable (0600, directory 0700), cached once per process.

When the key comes from an environment variable, it should live on an encrypted volume or in external key management (KMS / Docker secret etc.) to truly isolate disk disclosure — on the default auto-generated path the key and the ciphertext share a directory, so the local trust model is unchanged (a local user who can read `$DSH_HOME` can obtain both).

### Layered brute-force protection

| Layer | Mechanism | Covers |
|---|---|---|
| Global | Per-minute global budget (default 60) | Shared by password, OTP and backup-code verification |
| Source | Failure lockout (5 failures / 5 min) | Password and OTP failures count toward the same lockout |
| Source | Independent OTP window (10/min) | OTP/backup-code verification |

`x-forwarded-for` never counts toward source determination (anti-spoofing). Lockout triggers and exhausted rate-limit windows log via `ctx.logger.warn` and broadcast a `dsh-auth-gateway/brute-force` event (`{kind: 'lockout'|'global-rate-limit'|'otp-rate-limit', ...}`, JSON payload, once per lockout/window). Auth events and brute-force alerts are also **persisted** to `$DSH_HOME/auth-gateway/audit.log` (JSONL, one `{ts, kind, ip, reason?, ...}` object per line, file mode 0600): the live file rolls over per local calendar day into `audit.log.<YYYY-MM-DD>`, archives are kept for 90 days and then deleted; on startup the existing file's mode is tightened and expired archives pruned, and graceful shutdown drains in-flight writes (only a hard crash can lose the single line being written); write failures degrade to a warning log with dedupe (the first failure reports immediately, a sustained failure reminds at most every 5 minutes with a silenced count attached, and recovery logs an info) and never affect the auth flow.

### Forwarding and the fence

Before forwarding, the gateway rewrites `Host`/`Origin` to the loopback address: the internal trust fence's LAN trust list is sampled from the webserver's listening address, and since this plugin pins the webserver to `127.0.0.1`, LAN access would be 403'd internally without the rewrite. The rewrite is safe — the fence's remote-reachability duty has been taken over by the gateway cookie gate (cross-site/DNS-rebinding requests carry no session cookie and are rejected at the gateway).

### Authenticated browser trust

The DSH client initializes `connection.isLoopback` from the page hostname and chooses the host or memory scope once when Settings starts. Accessed via a LAN IP, that value was `false`, so host-backed settings like Models, Credentials, Locale/Theme/Preferences got disabled client-side — even though the gateway already rewrites the server-side Host/Origin to loopback.

The gateway's client plugin (client/src/index.jsx) declares a `connection` dependency through the official inject seam and, at apply time, rewrites `handle.isLoopback` to an always-true getter for non-loopback hostnames — every consumer reads the trusted value whenever it looks. It never touches the DSH module loader or third-party module activation paths, staying fully within dsh/Cordis extension conventions; authentication, HTTP/WS interception, Host/Origin rewriting and the server-side privileged fence all stay untouched. External pages still must pass the full session gate (incl. onboarding/OTP); the internal DSH must keep listening only on `127.0.0.1`.

## Known limitations

- **OTP secret encryption at rest**: the Base32 secret in `$DSH_HOME/auth-gateway/otp.json` is AES-256-GCM encrypted (lib/otp-crypto.js) and requires the master key to read. The master key comes from the `DSH_AUTH_GATEWAY_MASTER_KEY` environment variable (hex/base64) or an auto-generated `auth-gateway/otp-master.key` (0600) created on first enable; this is still the local trust model — a local user who can read `$DSH_HOME` can obtain the key too, so put the master key on an encrypted volume or in external key management to truly isolate disk disclosure;
- **Plaintext HTTP**: passwords and cookies travel in cleartext on the network. For LAN deployments, keep it on a trusted network or put a TLS reverse proxy in front (see DEPLOYMENT.md);
- **OTP-enable permission (DoS surface)**: `/otp/enable` and `/otp/verify-setup` only require any valid session — enabling 2FA is a user action (no deployment switch). If a password leaks, an attacker could log in with it and bind their own authenticator, locking out the real user. This is not credential theft; it is mainly a DoS surface. Mitigation: enabling OTP **revokes all sessions** (including the enabler's own, forcing re-login under the 2FA policy); a future direction is requiring password re-verification when enabling;
- **In-memory sessions**: everyone is logged out on dsh restart (must log in again; with OTP enabled, 2FA must be redone);
- **No distributed protection**: the global rate limit counts per process; multi-instance deployments or distributed attackers can spread requests;
- **Slight modulo bias in backup-code generation** (`bytes % 34`), no practical security impact (the space is still 34^8).

## Recovery paths

When you forgot the password, lost the authenticator, or hit the DoS surface above (local access required):

```bash
# Clear the password record (equivalent to dsh-auth-gateway-reset below)
rm -f "$DSH_HOME/auth-gateway/password.json"
# If the authenticator was lost, clear the OTP binding too
rm -f "$DSH_HOME/auth-gateway/otp.json"
# If the OTP master key is lost (or you want to drop encryption entirely):
# delete the key file; a new key is generated when OTP is re-enabled
rm -f "$DSH_HOME/auth-gateway/otp-master.key"
```

> **A lost master key = undecryptable OTP**: if the master key was injected via `DSH_AUTH_GATEWAY_MASTER_KEY` and that value can no longer be recovered, the ciphertext in `otp.json` cannot be decrypted and every 2FA verification fails. In that case delete `otp.json` (and `otp-master.key` if present), restart, and rebind the authenticator; deleting `otp.json` does not affect password login.
>
> The decryption path **never silently regenerates the key**: if `otp.json` holds a `v1.` sealed ciphertext but neither an env master key nor `otp-master.key` exists, startup decryption throws an explicit `master key missing` and stops — instead of writing a fresh key file that would not match the ciphertext and hide the root cause. This is the typical backup-restore scenario: only `otp.json` was restored while the key was lost — restore `otp-master.key` too (or re-set the env master key), or delete `otp.json` and rebind. Auto-generation only happens on **first OTP enable (the seal path)**.

#### HTTP responses when OTP ciphertext decryption fails

A decryption failure does not bubble up as a bare `500 internal error` (text/plain); a JSON error code is returned instead so clients/ops can localize the problem:

| Error code | HTTP | Trigger | Suggested fix |
| --- | --- | --- | --- |
| `otp-master-key-missing` | 503 | `otp.json` holds a `v1.` ciphertext but neither an env master key nor `otp-master.key` exists | Restore `otp-master.key` / set `DSH_AUTH_GATEWAY_MASTER_KEY`, or delete `otp.json` and rebind |
| `otp-master-key-invalid` | 500 | `DSH_AUTH_GATEWAY_MASTER_KEY` or `otp-master.key` exists but is not 32 bytes | Fix the master key value (hex/base64-encoded 32 bytes) |
| `otp-secret-corrupted` | 500 | Ciphertext format damaged, tampered with, or sealed with a **different master key** (e.g. the key was rotated by mistake) | Restore the master key matching the ciphertext, or delete `otp.json` and rebind |

Both error classes carry a `message` field with actionable hints; login/OTP-disable no longer returns an undifferentiated 500.

The plugin package ships the `dsh-auth-gateway-reset` reset command (deletes only password.json; linked into the profile's `node_modules/.bin` at install, not on PATH by default — use the full path or `export PATH="$HOME/.dsh/profiles/<profile>/node_modules/.bin:$PATH"` first):

```bash
~/.dsh/profiles/web/node_modules/.bin/dsh-auth-gateway-reset
```

> `$DSH_HOME` defaults to `~/.dsh` (i.e. `$HOME/.dsh`) and can be overridden with an environment variable; dsh and the plugin read the same value.

After clearing, **restart dsh web**: the plugin generates a new initial password and prints it to the console at startup; log in with it and complete onboarding to set a personal password (the plugin has no "set password" page — without a restart after the reset you cannot log in).

## Security event contract

`ctx.emit('dsh-auth-gateway/brute-force', payload)`, payload:

| kind | fields |
|---|---|
| `lockout` | `sourceAddress`, `maxFailures`, `lockedUntil` |
| `global-rate-limit` | `limit`, `windowSeconds` |
| `otp-rate-limit` | `sourceAddress`, `limit`, `windowSeconds` |

Broadcast once per lockout / per time window.