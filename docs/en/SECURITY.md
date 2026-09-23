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

The TOTP secret is the root key of the second factor: whoever holds it can generate any valid code. To stop a `$DSH_HOME` file disclosure from handing over that key directly, `otp-store.js` seals it with **AES-256-GCM** via `lib/otp-crypto.js` before writing `otp.json` (format `v1.<iv>.<tag>.<cipher>`, all hex) and decrypts it with the master key when reading. An unsealed record is treated as corrupt and refused (`otp-secret-corrupted`).

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

`x-forwarded-for` never counts toward source determination (anti-spoofing). Lockout triggers and exhausted rate-limit windows log via `ctx.logger.warn` and broadcast a `dsh-auth-gateway/brute-force` event (`{kind: 'lockout'|'global-rate-limit'|'otp-rate-limit', ...}`, JSON payload, once per lockout/window). Auth events and brute-force alerts are also **persisted** to `$DSH_HOME/auth-gateway/log/audit.log` (JSONL, one `{ts, kind, ip, reason?, ...}` object per line, file mode 0600): the live file rolls over per local calendar day into `audit.log.<YYYY-MM-DD>`, archives are kept for 90 days and then deleted; on startup the existing file's mode is tightened and expired archives pruned, and graceful shutdown drains in-flight writes (only a hard crash can lose the single line being written); write failures degrade to a warning log with dedupe (the first failure reports immediately, a sustained failure reminds at most every 5 minutes with a silenced count attached, and recovery logs an info) and never affect the auth flow.

### Forwarding and the fence

Before forwarding, the gateway rewrites `Host`/`Origin` to the loopback address: the internal trust fence's LAN trust list is sampled from the webserver's listening address, and since this plugin pins the webserver to `127.0.0.1`, LAN access would be 403'd internally without the rewrite. The rewrite is safe — the fence's remote-reachability duty has been taken over by the gateway cookie gate (cross-site/DNS-rebinding requests carry no session cookie and are rejected at the gateway).

### Relationship to the built-in dsh browser authentication (dsh ≥ 0.1.2)

Starting with dsh 0.1.2, the internal webserver itself enforces BrowserAuth: the index page and `/api` demand either the process launch token (a one-shot `?token=` exchange) or a persistent, authority-bound signed cookie. The browser only holds the gateway's session cookie and can never complete the upstream token exchange — without handling this, every forwarded request would be answered 401 by the upstream. How the gateway fills the gap:

- **The secret is read through the official channel**: via the injected `credentials` service, reading the official `client-connection/browser-session` record (the same `ctx.credentials.readRecord` seam dsh's own BrowserAuth reads and writes; `kind: grant`, payload `version: 1`, 32-byte secret — the same acceptance criteria as dsh's `storedSecret`). It does not depend on the private `.credentials.yaml` file layout; a missing record (dsh ≤ 0.1.1) silently degrades to verbatim forwarding, matching the old behavior. Cache semantics: while no secret has ever been read (fresh deployment — dsh's Connection writes the record on activation, possibly after the gateway warmed) the cache retries every 2s and probes in the background, so forwarding carries the minted cookie as soon as the record appears; once a secret was seen, an asynchronous refresh every 60s follows rotation. Forwarded requests only ever touch the synchronous fast path.
- **The cookie exists only on the loopback hop**: the gateway uses that secret to mint a cookie identical in shape to dsh's own issuance for the rewritten loopback authority (`127.0.0.1:<internal port>`, matching how dsh derives the authority from the Host header): `dsh-auth-<b64url(sha256(authority))>` = `v1.<payload>.<HMAC-SHA256>`, 24h TTL (well under dsh's 30-day default cap). It is attached only to gate-passed forwards (HTTP and WS upgrades), never set in the browser, and is not attached to pre-gate public asset forwards (manifest/favicon/assets) either.
- **Rotation is followed immediately**: a minted cookie records the fingerprint of the secret it was minted with; the moment the secret changes (dsh-side rotation, or global revocation by deleting the record) the cookie is re-minted — or dropped — instead of 401ing on a stale cookie until the TTL lapses.

### Authenticated browser trust

The DSH client initializes `connection.isLoopback` from the page hostname and chooses the host or memory scope once when Settings starts. Accessed via a LAN IP, that value was `false`, so host-backed settings like Models, Credentials, Locale/Theme/Preferences got disabled client-side — even though the gateway already rewrites the server-side Host/Origin to loopback.

The gateway's client plugin (client/src/index.jsx) declares a `connection` dependency through the official inject seam and, at apply time, rewrites `handle.isLoopback` to an always-true getter for non-loopback hostnames — every consumer reads the trusted value whenever it looks. It never touches the DSH module loader or third-party module activation paths, staying fully within dsh/Cordis extension conventions; authentication, HTTP/WS interception, Host/Origin rewriting and the server-side privileged fence all stay untouched. External pages still must pass the full session gate (incl. onboarding/OTP); the internal DSH must keep listening only on `127.0.0.1`.

## Known limitations

- **OTP secret encryption at rest**: the Base32 secret in `$DSH_HOME/auth-gateway/otp.json` is AES-256-GCM encrypted (lib/otp-crypto.js) and requires the master key to read. The master key comes from the `DSH_AUTH_GATEWAY_MASTER_KEY` environment variable (hex/base64) or an auto-generated `auth-gateway/otp-master.key` (0600) created on first enable; this is still the local trust model — a local user who can read `$DSH_HOME` can obtain the key too, so put the master key on an encrypted volume or in external key management to truly isolate disk disclosure;
- **Plaintext HTTP (transport layer)**: passwords and cookies travel in cleartext on the network. This is a transport problem — the gateway's session cookie supports the `Secure` attribute (config `cookieSecure`, default `auto`): once the connection is TLS (a reverse proxy terminating TLS and forwarding `X-Forwarded-Proto: https`), the attribute is added automatically and browsers only send the cookie back over the encrypted link; `true` forces it (deployments behind a TLS proxy that does not forward the protocol header) — note that on plain HTTP forcing it makes browsers refuse to store the cookie and logins fail **loudly rather than silently downgrading** (the gateway also warns on the dsh console for every such login, pointing at TLS or back to `auto`); `false` opts out explicitly. **The panel can change it at runtime** (Auth Settings → Cookie Security): the override persists in the credential record and takes precedence over the deployment config; “Restore deployment config” drops it back to the patch value — so arming Secure when a TLS proxy goes live needs no patch edit or restart. The switch takes effect **immediately**: on a successful save the gateway reissues the caller's own session cookie under the new policy (same token, attribute changed), so the next request already follows the new mode — but browsers only let a **secure origin** overwrite an existing Secure cookie: if you choose “off” from a plaintext entry while a Secure cookie from an earlier HTTPS visit is still stored, the browser refuses the overwrite and the server cannot tell, so the panel tells you to repeat the change from an HTTPS entry or clear the site's cookies; conversely, choosing “force on” from a plaintext entry is **blocked by both the panel and the server** with an explanation (forcing Secure would break every login on that entry; the server answers `force-secure-requires-tls` to direct calls too). Secure only stops the cookie from travelling on a cleartext link — it does not encrypt the request itself; eliminating the cleartext exposure still requires TLS (reverse proxy or certificate, see DEPLOYMENT.md);
- **OTP-enable permission (DoS surface)**: `/otp/enable` and `/otp/verify-setup` only require any valid session — enabling 2FA is a user action (no deployment switch). If a password leaks, an attacker could log in with it and bind their own authenticator, locking out the real user. This is not credential theft; it is mainly a DoS surface. Mitigation: enabling OTP **revokes all sessions** (including the enabler's own, forcing re-login under the 2FA policy); a future direction is requiring password re-verification when enabling;
- **In-memory sessions**: everyone is logged out on dsh restart (must log in again; with OTP enabled, 2FA must be redone);
- **No distributed protection**: the global rate limit counts per process; multi-instance deployments or distributed attackers can spread requests.
- **Panel-writable deployment policy (cookieSecure)**: the Cookie Security card lets **any authenticated session** change `cookieSecure` (including setting it to `false`, which turns off transport protection) — a deliberate runtime convenience, but it means that on multi-user deployments any user can affect the transport policy for everyone; single-user LAN deployments are unaffected. Every change is audited (`cookie-secure-change`); if a multi-user deployment needs a stricter gate, lock it via the deployment composition instead (see DEPLOYMENT.md).
- **Outbound network request (new-version check)**: this is the plugin's **only** outbound connection, and it is **off by default** — a fresh install, and every panel open, makes no network call. Exactly two things trigger one: (1) a signed-in user pressing **check for updates** on the Auth Settings → About card (that user's own explicit intent, and the only trigger under the default config); or (2) the operator setting `updateCheck: true`, which makes opening the panel check **automatically**. The request is one GET to the public npm registry (`https://registry.npmjs.org/dsh-auth-gateway/latest`, 3s timeout) carrying no credentials, session cookie or instance identifier — but **your deployment's egress IP is visible to the registry**. Results and failures are cached in memory (6h success, 15min failure), and repeated manual clicks additionally honour a 5s floor so they cannot become a request flood; an unreachable registry makes the panel say "update check unavailable" rather than error out, and neither the auth nor the forwarding path is affected. The running version and repository link come from the local `package.json` with **no network involved**.

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