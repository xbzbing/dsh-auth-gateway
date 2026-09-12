#!/usr/bin/env bash
#
# End-to-end verification against a running dsh web instance with the
# dsh-auth-gateway installed. Run from anywhere:
#
#   BASE=http://127.0.0.1:3080 PASSWORD=your-password ./scripts/verify.sh
#
# Works against both a fresh deployment (auto-generated initial password,
# pass it via INITIAL_PASSWORD — printed by the dsh console on first boot;
# the script then walks the onboarding flow) and an already configured one.
#
set -euo pipefail

BASE="${BASE:-http://127.0.0.1:3080}"
PASSWORD="${PASSWORD:-verify-pass-123}"
INITIAL="${INITIAL_PASSWORD:-}"
JAR="$(mktemp)"
trap 'rm -f "$JAR"' EXIT

pass=0
fail=0

check() { # name expected actual
  if [ "$2" = "$3" ]; then
    pass=$((pass + 1))
    printf 'ok   %s\n' "$1"
  else
    fail=$((fail + 1))
    printf 'FAIL %s (expected %s, got %s)\n' "$1" "$2" "$3"
  fi
}

code() { # path [curl args...]
  curl -s -o /dev/null -w '%{http_code}' "$@"
}

echo "== targeting $BASE =="

# ── unauthenticated gate ─────────────────────────────────────────────────
check 'unauthenticated /api -> 401' 401 "$(code "$BASE/api/session.list" -X POST -H 'content-type: application/json' -d '{}')"
check 'unauthenticated page -> 302' 302 "$(code "$BASE/")"

# ── login ────────────────────────────────────────────────────────────────
check 'wrong password -> 401' 401 "$(code "$BASE/login/auth" -X POST -H 'content-type: application/json' -d '{"password":"wrong-pass"}')"

# Fresh deployment: the personal password does not exist yet — use the
# initial password, land on onboarding, set the personal password, re-login.
auth_body="{\"password\":\"$PASSWORD\"}"
login_code="$(code "$BASE/login/auth" -c "$JAR" -X POST -H 'content-type: application/json' -d "$auth_body")"
if [ "$login_code" = "401" ]; then
  if [ -z "$INITIAL" ]; then
    fail=$((fail + 1)); printf 'FAIL login (no password yet; pass INITIAL_PASSWORD from the dsh console)\n'
  else
    initial_body="{\"password\":\"$INITIAL\"}"
    init_code="$(code "$BASE/login/auth" -c "$JAR" -X POST -H 'content-type: application/json' -d "$initial_body")"
    check 'initial password login -> 200' 200 "$init_code"
    # The session owes onboarding: pages redirect, APIs refuse.
    check 'onboarding gate: / -> 302 /onboarding' 302 "$(code "$BASE/" -b "$JAR")"
    check 'onboarding gate: /api -> 401' 401 "$(code "$BASE/api/session.list" -b "$JAR" -X POST -H 'content-type: application/json' -d '{}')"
    ob_body="{\"oldPassword\":\"$INITIAL\",\"newPassword\":\"$PASSWORD\"}"
    check 'onboarding change password -> 200' 200 "$(code "$BASE/login/change" -b "$JAR" -X POST -H 'content-type: application/json' -d "$ob_body")"
    check 'old session after onboarding -> 401' 401 "$(code "$BASE/api/session.list" -b "$JAR" -X POST -H 'content-type: application/json' -d '{}')"
    login_code="$(code "$BASE/login/auth" -c "$JAR" -X POST -H 'content-type: application/json' -d "$auth_body")"
    check 'login with new password -> 200' 200 "$login_code"
  fi
else
  check 'login -> 200' 200 "$login_code"
fi

# ── authenticated access through the gate ────────────────────────────────
check 'authenticated / -> forwarded' 200 "$(code "$BASE/" -b "$JAR")"
api_code="$(code "$BASE/api/session.list" -b "$JAR" -X POST -H 'content-type: application/json' -d '{}')"
if [ "$api_code" = "200" ] || [ "$api_code" = "404" ]; then
  pass=$((pass + 1)); printf 'ok   authenticated /api forwarded (got %s)\n' "$api_code"
else
  fail=$((fail + 1)); printf 'FAIL authenticated /api (got %s)\n' "$api_code"
fi

# ── version API: gated, default-off, and manually checkable ──────────────
# Anonymous: no cookie jar here. The endpoint sits behind the same session
# gate as /login-api/settings, so an unauthenticated caller must get 401.
check 'unauthenticated /login-api/version -> 401' 401 "$(code "$BASE/login-api/version")"
version_body="$(curl -sS "$BASE/login-api/version" -b "$JAR")"
if printf '%s' "$version_body" | node -e '
  let raw = "";
  process.stdin.on("data", (c) => { raw += c });
  process.stdin.on("end", () => {
    const body = JSON.parse(raw);
    // The panel needs a version string and a possibly-empty http(s) repository.
    const okVersion = typeof body.version === "string" && body.version.length > 0;
    const okRepo = typeof body.repository === "string"
      && (body.repository === "" || body.repository.startsWith("https://"));
    // A passive load must claim no verdict when automatic checks are off (the
    // default): the shape is null-or-cached, never a fabricated "up to date".
    const u = body.update;
    const okUpdate = u && typeof u === "object"
      && (u.updateAvailable === true || u.updateAvailable === false || u.updateAvailable === null)
      && (u.checkedAt === null || typeof u.checkedAt === "string");
    process.exit(body.ok === true && okVersion && okRepo && okUpdate ? 0 : 1);
  });
'; then
  pass=$((pass + 1)); printf 'ok   authenticated /login-api/version shape (%s)\n' "$version_body"
else
  fail=$((fail + 1)); printf 'FAIL /login-api/version shape (%s)\n' "$version_body"
fi

# The explicit "check now" action: this is the one path that contacts the
# registry with automatic checks off, so it must come back with a timestamp.
refresh_body="$(curl -sS "$BASE/login-api/version?refresh=1" -b "$JAR")"
if printf '%s' "$refresh_body" | node -e '
  let raw = "";
  process.stdin.on("data", (c) => { raw += c });
  process.stdin.on("end", () => {
    const u = JSON.parse(raw).update || {};
    // Either a real verdict, or an error code — but always a completion time;
    // a manual check that silently did nothing would leave checkedAt null.
    const done = typeof u.checkedAt === "string" && u.checkedAt.length > 0;
    const reported = u.updateAvailable === true || u.updateAvailable === false
      || (typeof u.error === "string" && u.error.length > 0);
    process.exit(done && reported ? 0 : 1);
  });
'; then
  pass=$((pass + 1)); printf 'ok   manual ?refresh=1 completes a check (%s)\n' "$refresh_body"
else
  fail=$((fail + 1)); printf 'FAIL manual ?refresh=1 (%s)\n' "$refresh_body"
fi

# ── websocket gate (unauthenticated upgrade must be refused) ─────────────
ws_out="$(node -e '
  const http = require("node:http");
  const url = new URL(process.argv[1]);
  const req = http.request({ host: url.hostname, port: url.port, path: "/api/remote.mux", method: "GET",
    headers: { connection: "Upgrade", upgrade: "websocket", "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==", "sec-websocket-version": "13" } });
  req.on("upgrade", () => process.exit(1));   // 101 accepted: leak -> fail
  req.on("response", () => process.exit(0));  // HTTP answer (401/302): rejected -> pass
  req.on("error", () => process.exit(0));     // connection refused: pass
  req.end();
  setTimeout(() => process.exit(0), 3000);    // hung: pass (no handshake)
' "$BASE"; echo $?)"
if [ "$ws_out" != "0" ]; then
  fail=$((fail + 1)); printf 'FAIL unauthenticated WebSocket upgrade was accepted\n'
else
  pass=$((pass + 1)); printf 'ok   unauthenticated WebSocket upgrade refused\n'
fi

# ── change password: revokes the old session ─────────────────────────────
change_body="{\"oldPassword\":\"$PASSWORD\",\"newPassword\":\"${PASSWORD}-new\"}"
check 'change password -> 200' 200 "$(code "$BASE/login/change" -b "$JAR" -X POST -H 'content-type: application/json' -d "$change_body")"
check 'old session after change -> 401' 401 "$(code "$BASE/api/session.list" -b "$JAR" -X POST -H 'content-type: application/json' -d '{}')"

# ── login with the new password, then logout ─────────────────────────────
new_auth_body="{\"password\":\"${PASSWORD}-new\"}"
check 'login with new password -> 200' 200 "$(code "$BASE/login/auth" -c "$JAR" -X POST -H 'content-type: application/json' -d "$new_auth_body")"
check 'logout -> 200' 200 "$(code "$BASE/login/logout" -b "$JAR" -X POST -H 'content-type: application/json' -d '{}')"
check 'session after logout -> 401' 401 "$(code "$BASE/api/session.list" -b "$JAR" -X POST -H 'content-type: application/json' -d '{}')"

echo
echo "== $pass passed, $fail failed =="
[ "$fail" -eq 0 ]
