#!/usr/bin/env bash
# iskill-headroom-workbuddy · 添加 / 登录上游账号（OAuth，一次性）
#
# ⚠️ 这里只是一层薄壳：真正的实现在 scripts/hwb.py（跨 macOS / Windows / Linux 一份代码）。
#    保留 .sh 文件名是为了兼容既有文档与习惯；改逻辑请改 hwb.py，别在这儿加。
set -e
SKILL_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PY="${ISKILL_PYTHON:-}"
if [ -z "$PY" ] || [ ! -x "$PY" ]; then
  PY="$(command -v python3 || command -v python || echo python3)"
fi
exec "$PY" "$SKILL_DIR/scripts/hwb.py" login "$@"
