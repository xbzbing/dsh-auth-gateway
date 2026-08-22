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
  lib/forward.js
  lib/gateway.js
  lib/gateway-otp.js
  lib/login-page.js
  lib/onboarding-page.js
  lib/otp-page.js
  lib/paths.js
)

ALL_FILES=("${JS_FILES[@]}" cordis.patch.yml)

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

# ── 3. Post-deploy 验证（installed 版本语法） ────────────────────────────
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
