#!/usr/bin/env bash
# deploy.sh — 将 workspace 改动同步到 DSH 已安装位置。
#
# 流程：pre-check（语法 + 测试）→ 复制 → post-check（installed 语法）→ 可选重启
#
# 用法：./scripts/deploy.sh [--restart]
#   --restart  同步后自动重启 DSH 进程
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SRC="$(cd "$SCRIPT_DIR/.." && pwd)"
DST="${DSH_PROFILE_DIR:-$HOME/.dsh/profiles/web}/node_modules/dsh-auth-gateway"

JS_FILES=(
  lib/audit-log.js
  lib/config.js
  lib/lan-trust-script.js
  lib/rate-limit.js
  lib/forward.js
  lib/gateway.js
  lib/gateway-otp.js
  lib/login-page.js
  lib/onboarding-page.js
  lib/otp-page.js
  lib/paths.js
  lib/upstream-auth.js
  lib/update-check.js
  lib/version.js
)

# package.json rides along: lib/version.js reads the INSTALLED copy's
# version/repository (lib/../package.json) for the panel and the update
# check — a deploy that leaves a stale metadata file behind would show an
# old version and misjudge updates against it.
#
# The client bundle is the panel half (dsh serves it via exports["./client"]).
# A `file:` install is a snapshot copy — the profile's pnpm-workspace.yaml sets
# `nodeLinker: hoisted`, so node_modules/dsh-auth-gateway is real files, not a
# symlink into this checkout — which means a rebuilt bundle reaches an
# installed copy ONLY through this script. Without these two entries a deploy
# shipped the new server routes with the OLD panel.
CLIENT_FILES=(
  client/index.js
  client/index.js.map
)
ALL_FILES=("${JS_FILES[@]}" "${CLIENT_FILES[@]}" cordis.patch.yml package.json)

errors=0

# ── 1. Pre-deploy 检查（在 workspace 源码上跑） ──────────────────────────
echo "▸ [1/3] 语法检查（workspace 源码）"
for f in "${JS_FILES[@]}"; do
  if node --check "$SRC/$f" 2>/dev/null; then
    echo "  ✓ $f"
  else
    echo "  ✗ $f" >&2
    node --check "$SRC/$f" 2>&1 | sed 's/^/    /' >&2
    ((errors++))
  fi
done

if ((errors > 0)); then
  echo; echo "✗ 语法错误，中止部署。" >&2; exit 1
fi

echo
echo "▸ [2/3] 单元测试"
cd "$SRC"
if npm test 2>&1 | tail -1; then
  echo "  ✓ 测试通过"
else
  echo "  ✗ 测试失败，中止部署。" >&2
  echo "  运行 npm test 查看详情" >&2
  exit 1
fi

# ── 2. 复制 ──────────────────────────────────────────────────────────────
echo
echo "▸ [3/3] 同步 → $DST"
for f in "${ALL_FILES[@]}"; do
  if [[ ! -f "$SRC/$f" ]]; then
    echo "  ✗ 源文件不存在: $f" >&2; exit 1
  fi
  cp "$SRC/$f" "$DST/$f"
  echo "  ✓ $f"
done

# ── 3. Post-deploy 验证（installed 版本语法 + 元数据） ────────────────────
echo
echo "▸ 验证 installed 版本"
for f in "${JS_FILES[@]}"; do
  if node --check "$DST/$f" 2>/dev/null; then
    echo "  ✓ $f"
  else
    echo "  ✗ $f  ← installed 版本语法错误！" >&2
    node --check "$DST/$f" 2>&1 | sed 's/^/    /' >&2
    ((errors++))
  fi
done

# The client bundle is generated and would otherwise never be verified:
# a truncated or half-written copy would fail in the browser, not here.
for f in "${CLIENT_FILES[@]}"; do
  if [[ "$f" == *.js ]] && node --check "$DST/$f" 2>/dev/null; then
    echo "  ✓ $f"
  elif [[ "$f" == *.js ]]; then
    echo "  ✗ $f  ← installed 客户端产物语法错误！" >&2
    node --check "$DST/$f" 2>&1 | sed 's/^/    /' >&2
    ((errors++))
  elif [[ -s "$DST/$f" ]]; then
    echo "  ✓ $f"
  else
    echo "  ✗ $f  ← installed 客户端产物缺失或为空！" >&2
    ((errors++))
  fi
done

# package.json cannot go through `node --check` (it is JSON, not JS), so the
# loop above skips it — verify the two properties lib/version.js actually
# reads instead: it must parse, and name+version must equal the workspace's.
# Without this the copy in step 2 is the one thing nothing checks, and a
# stale metadata file would show the wrong version in the panel and compare
# the update check against that wrong number.
read_meta() { node -e 'const p = require(process.argv[1]); process.stdout.write(`${p.name} ${p.version}`)' "$1" 2>/dev/null; }
if ! src_meta="$(read_meta "$SRC/package.json")" || [[ -z "$src_meta" ]]; then
  echo "  ✗ workspace package.json 无法解析或缺少 name/version" >&2
  ((errors++))
elif ! dst_meta="$(read_meta "$DST/package.json")" || [[ -z "$dst_meta" ]]; then
  echo "  ✗ installed package.json 无法解析或缺少 name/version" >&2
  ((errors++))
elif [[ "$src_meta" != "$dst_meta" ]]; then
  echo "  ✗ package.json 元数据未同步：installed=[$dst_meta] workspace=[$src_meta]" >&2
  ((errors++))
else
  echo "  ✓ package.json ($dst_meta)"
fi

echo
if ((errors > 0)); then
  echo "✗ 部署后验证失败。" >&2; exit 1
fi
echo "✓ 部署完成。"

# ── 4. 可选：重启 DSH ────────────────────────────────────────────────────
if [[ "${1:-}" == "--restart" ]]; then
  pid=$(pgrep -f 'dsh web' || true)
  if [[ -n "$pid" ]]; then
    echo
    echo "▸ 重启 DSH (pid=$pid)"
    kill "$pid" 2>/dev/null || true
    sleep 1
    echo "  ℹ 请在 tmux 中手动重启: tmux attach -t dsh-space"
  else
    echo; echo "  ℹ 未找到 DSH 进程，请手动启动"
  fi
fi
