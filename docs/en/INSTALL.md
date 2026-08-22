# Install, Update and Uninstall

> [简体中文](../zh/INSTALL.md) | English

This guide covers the full lifecycle of `dsh-auth-gateway`: install, verify, update, uninstall and credential reset. It targets the dsh Web profile; for other profiles (e.g. `dsh`), replace `web` in the commands with the profile name.

> Prerequisites: the [dsh](https://github.com/deepseek-ai/deepseek-harness) CLI is installed and `dsh` is on PATH.

---

## 1. Install

### 1.1 From the npm registry (recommended)

```bash
dsh plugin --profile web add dsh-auth-gateway
```

### 1.2 From the GitHub repository

```bash
# default branch
dsh plugin --profile web add github:xbzbing/dsh-auth-gateway

# pinned version / branch / commit
dsh plugin --profile web add github:xbzbing/dsh-auth-gateway#v0.5.0
dsh plugin --profile web add github:xbzbing/dsh-auth-gateway#main
```

### 1.3 From a local development directory

```bash
dsh plugin --profile web add file:/path/to/dsh-auth-gateway
```

> **Note**: a `file:` dependency is **snapshotted at install time** — later changes to the local source do not take effect automatically; you need remove + add to refresh (see section 3).

### 1.4 Verify the installation

```bash
# 1) Confirm dsh-auth-gateway appears in the composition tree and the
#    webserver is pinned to the loopback address
dsh web --dump-config | grep -E "dsh-auth-gateway|127.0.0.1"

# 2) Start
dsh web --port 8080
```

On first start the console prints an **initial password** (a prominent notice block, bilingual zh/en). Open `http://<host>:8080` in a browser, log in with the initial password, and the onboarding page guides you to set a personal password.

Port derivation: external port = `--port` (default 3080), internal webserver = external + 1 (e.g. 8080 → 8081). `--port 0` is not supported.

---

## 2. Credential management commands

The plugin package ships two commands (linked into the profile's `node_modules/.bin`, not on PATH by default):

| Command | Purpose | Scope |
|---|---|---|
| `dsh-auth-gateway-reset` | Reset the password record | Deletes `$DSH_HOME/auth-gateway/password.json`; a new initial password is printed after restart |
| `dsh-auth-gateway-uninstall` | Remove all credentials | Deletes the whole `$DSH_HOME/auth-gateway/` (password + OTP secret + backup codes) |

Run them either way:

```bash
# Option 1: full path (replace the profile name with yours)
~/.dsh/profiles/web/node_modules/.bin/dsh-auth-gateway-reset
~/.dsh/profiles/web/node_modules/.bin/dsh-auth-gateway-uninstall

# Option 2: add the profile bin to PATH (append to ~/.zshrc / ~/.bashrc and reopen the terminal)
export PATH="$HOME/.dsh/profiles/web/node_modules/.bin:$PATH"
dsh-auth-gateway-reset
```

**Forgot your password**:

```bash
dsh-auth-gateway-reset     # 1. delete the password record
# restart dsh web          # 2. a new initial password is printed to the console after restart
# log in with it           # 3. go through onboarding to set a personal password
```

**Lost your authenticator (OTP)**: OTP and the password are stored separately. If only the authenticator was lost and you still know the password:

```bash
# Delete the OTP record (incl. backup codes); the password is kept
rm ~/.dsh/auth-gateway/otp.json
# Rebind OTP after restarting dsh web
```

`$DSH_HOME` defaults to `~/.dsh` (i.e. `$HOME/.dsh`) and can be overridden with an environment variable — dsh and the plugin read the same value.

---

## 3. Update

```bash
# Option 1: registry / GitHub installs
dsh plugin --profile web update dsh-auth-gateway

# Option 2: local-directory install (file: snapshot must be refreshed with remove + add)
dsh plugin --profile web remove dsh-auth-gateway
dsh plugin --profile web add file:/path/to/dsh-auth-gateway
```

**Restart dsh web** after the update:

```bash
# Find the dsh web process and restart it (or restart from its tmux / systemd session)
kill $(pgrep -f 'dsh web')
dsh web --port 8080
```

> No credential command is needed when upgrading — password and OTP credential storage is separate from the plugin code, so upgrades do not affect it.
>
> **Deployment-layer config survives upgrades**: deployment config like `basePath` lives in the **deployer's own profile patch** (`~/.dsh/profiles/web/cordis.patch.yml`), not in the plugin bundle, so it is not overwritten by upgrades/reinstalls. The plugin defaults to `basePath: /` (root path).
>
> **⚠️ `config:` is a whole-object replacement**: `config: { basePath: /dsh }` in a Cordis profile patch **drops** the `listenPort` / `upstreamPort` fields that the bundle patch computes dynamically via `!!js`, disabling `--port 8080` (the port falls back to the config.js default 3080). The correct approach is to keep every field from the bundle patch and only append `basePath`. See the topology C example in [NGINX-DEPLOYMENT.md](NGINX-DEPLOYMENT.md).

---

## 4. Uninstall

**Order matters**: clean up credentials first, then remove the plugin. `dsh plugin remove` removes the plugin dependency from the profile, breaking the bin links of `dsh-auth-gateway-reset` / `dsh-auth-gateway-uninstall` (they become dangling references) — the commands are no longer usable afterwards.

```bash
# 1. Clean up credentials (pick one)
~/.dsh/profiles/web/node_modules/.bin/dsh-auth-gateway-uninstall   # all credentials (password + OTP)
# or
~/.dsh/profiles/web/node_modules/.bin/dsh-auth-gateway-reset       # password only (keep OTP)

# 2. Remove the plugin
dsh plugin --profile web remove dsh-auth-gateway

# 3. Restart dsh web for the composition to take effect
```

---

## 5. Troubleshooting

| Symptom | Cause & fix |
|---|---|
| No initial password on first start | Credentials already exist (`$DSH_HOME/auth-gateway/password.json`) — this is not a first deployment. Log in with the existing password, or `reset` and restart |
| Startup fails after install (EADDRINUSE) | A duplicate dsh-auth-gateway row in the composition tree (caused by duplicate installation) — remove the duplicate row and restart |
| `file:` install: code changes have no effect | The snapshot was not refreshed — reinstall with remove + add |
| Login rejected with 429 | Global rate limit or OTP throttle triggered — wait for the window to reset (1 minute / 5-minute lockout) |
| `dsh-auth-gateway-reset` says command not found | The profile bin is not on PATH — use the full path or `export PATH=...` first |
| Credentials remain after uninstall | The plugin was removed without running the credential command first — delete `$DSH_HOME/auth-gateway/` manually |

---

## 6. Related documents

- [README.md](../../README.md) — features, configuration table, quick start
- [NGINX-DEPLOYMENT.md](NGINX-DEPLOYMENT.md) — reverse-proxy deployment topologies and nginx config examples
- [DEPLOYMENT.md](DEPLOYMENT.md) — ports & listening, LAN deployment, HTTPS advice
- [SECURITY.md](SECURITY.md) — threat model, OTP secret encryption, recovery paths