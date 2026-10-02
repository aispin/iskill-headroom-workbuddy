#!/usr/bin/env bash
# iskill-headroom-workbuddy2api · 复用 / 更新上游 token 并重启 workbuddy2api
#
# 默认行为：**.env 里已有 CODEBUDDY_AUTH_TOKEN 就直接复用它并重启**（不会让你重新输）。
# 想换新 token：bash token.sh --set      （或设置环境变量 CODEBUDDY_AUTH_TOKEN）
# Headroom 进程不动（它不依赖上游 token）。
set -eo pipefail

RUNTIME="${ISKILL_RUNTIME:-$HOME/.iskill-headroom-workbuddy2api}"
SKILL_DIR="$(cd "$(dirname "$0")/.." && pwd)"
WB2API_DIR="$RUNTIME/workbuddy2api"
VENV="$RUNTIME/venv"
PY="$VENV/bin/python"
ENV_FILE="$WB2API_DIR/.env"

FORCE_SET=0
DRY_RUN=0
for a in "$@"; do
  case "$a" in
    --set|--update|-s) FORCE_SET=1 ;;
    --dry-run|-n)      DRY_RUN=1 ;;
    -h|--help)
      echo "用法: bash token.sh [--set] [--dry-run]"
      echo "  默认      : 复用 .env 里已有的 CODEBUDDY_AUTH_TOKEN，并重启 workbuddy2api（不询问）"
      echo "  --set     : 强制交互粘贴一个新 token 覆盖 .env"
      echo "  --dry-run : 只打印决策，不改 .env、不重启"
      exit 0 ;;
  esac
done

if [ ! -x "$PY" ]; then
  echo "[✗] venv 未就绪，请先运行: bash ${SKILL_DIR}/scripts/start.sh"
  exit 1
fi
if [ ! -f "$ENV_FILE" ]; then
  echo "[✗] ${ENV_FILE} 缺失，请先运行: bash ${SKILL_DIR}/scripts/start.sh"
  exit 1
fi

# 读 .env 里已有的值（grep 无匹配会返回非零，故都兜 || true）
env_get() { grep -E "^$1=" "$ENV_FILE" 2>/dev/null | tail -1 | cut -d= -f2- || true; }
ENV_TOKEN="$(env_get CODEBUDDY_AUTH_TOKEN || true)"
ENV_REFRESH="$(env_get CODEBUDDY_REFRESH_TOKEN || true)"

mask() {
  if [ -n "${1:-}" ]; then
    printf '%s…（共 %s 字符）' "$(printf '%s' "$1" | cut -c1-12)" "${#1}"
  else
    printf '（空）'
  fi
}

echo "[iskill-headroom-workbuddy2api] 上游 token：复用 / 更新"
echo "  [·] .env 现有: $(mask "$ENV_TOKEN")"

TOK="${CODEBUDDY_AUTH_TOKEN:-}"
RTOK="${CODEBUDDY_REFRESH_TOKEN:-}"

need_input=0
# 显式 --set 且没给环境变量 → 问；或者 .env 与环境变量都没有 → 问
if [ "$FORCE_SET" -eq 1 ] && [ -z "$TOK" ]; then need_input=1; fi
if [ -z "$TOK" ] && [ -z "$ENV_TOKEN" ]; then need_input=1; fi

if [ "$need_input" -eq 1 ]; then
  if [ -t 0 ]; then
    echo "  ── 请粘贴新 token（F12 → Network → 发一条消息 → 复制发往 copilot.tencent.com"
    echo "     请求的 Authorization: Bearer 后那串）"
    read -r -p "  新的 CODEBUDDY_AUTH_TOKEN: " in_tok || true
    [ -n "${in_tok:-}" ] && TOK="$in_tok"
    read -r -p "  CODEBUDDY_REFRESH_TOKEN（可留空）: " in_rtok || true
    [ -n "${in_rtok:-}" ] && RTOK="$in_rtok"
  else
    echo "  [✗] 非交互环境且拿不到 token：请设置环境变量 CODEBUDDY_AUTH_TOKEN，或在交互终端重跑。"
    exit 1
  fi
fi

# 环境变量没给时，回落到 .env 已有值
[ -z "$TOK" ] && TOK="$ENV_TOKEN"
[ -z "$RTOK" ] && RTOK="$ENV_REFRESH"

if [ -z "$TOK" ]; then
  echo "  [✗] 仍未拿到 token，中止。"
  exit 1
fi

if [ "$TOK" = "$ENV_TOKEN" ]; then
  echo "  [✓] 复用 .env 里的 token（未变化）"
else
  echo "  [✓] 使用新 token: $(mask "$TOK")"
fi

if [ "$DRY_RUN" -eq 1 ]; then
  echo "  [·] --dry-run：不改 .env、不重启，结束。"
  exit 0
fi

# 写入 .env（token 无变化则跳过写盘）
if [ "$TOK" != "$ENV_TOKEN" ] || [ "$RTOK" != "$ENV_REFRESH" ]; then
  "$PY" - "$ENV_FILE" "$TOK" "$RTOK" <<'PY'
import sys, re
f, a, r = sys.argv[1], sys.argv[2], sys.argv[3]
s = open(f, encoding="utf-8").read()
# 用 lambda 做替换，避免 token 里出现 \g 之类被 re.sub 当反向引用解释
s = re.sub(r'^CODEBUDDY_AUTH_TOKEN=.*$', lambda m: 'CODEBUDDY_AUTH_TOKEN=' + a, s, flags=re.M)
if ('CODEBUDDY_AUTH_TOKEN=' + a) not in s:
    s += '\nCODEBUDDY_AUTH_TOKEN=' + a + '\n'
if r:
    s = re.sub(r'^CODEBUDDY_REFRESH_TOKEN=.*$', lambda m: 'CODEBUDDY_REFRESH_TOKEN=' + r, s, flags=re.M)
    if ('CODEBUDDY_REFRESH_TOKEN=' + r) not in s:
        s += '\nCODEBUDDY_REFRESH_TOKEN=' + r + '\n'
open(f, "w", encoding="utf-8").write(s)
PY
  echo "  [✓] 已写入 ${ENV_FILE}"
else
  echo "  [·] .env 无需改动"
fi

# 重启 workbuddy2api（不影响 Headroom）
if [ -f "$RUNTIME/pids.json" ]; then
  wb=$("$PY" -c "import json;print(json.load(open('$RUNTIME/pids.json')).get('workbuddy2api',''))" 2>/dev/null || true)
  if [ -n "$wb" ] && kill -0 "$wb" 2>/dev/null; then
    kill "$wb" 2>/dev/null
    echo "  [·] 已停止旧 workbuddy2api (pid $wb)"
    for _ in $(seq 1 20); do
      "$PY" -c "import socket,sys;s=socket.socket();s.settimeout(1);sys.exit(0 if s.connect_ex(('127.0.0.1',8788))!=0 else 1)" 2>/dev/null && break
      sleep 0.3
    done
  fi
fi

PORT=$(grep '^PORT=' "$ENV_FILE" 2>/dev/null | tail -1 | cut -d= -f2)
PORT="${PORT:-8788}"
mkdir -p "$RUNTIME/logs"
(
  cd "$WB2API_DIR"
  set -a; . ./.env; set +a
  exec "$PY" server.py
) >> "$RUNTIME/logs/workbuddy2api.log" 2>&1 &
newpid=$!
"$PY" - "$newpid" "$RUNTIME/pids.json" <<'PY'
import sys, json, os
p, path = sys.argv[1], sys.argv[2]
try:
    d = json.load(open(path))
except Exception:
    d = {}
d['workbuddy2api'] = int(p)
json.dump(d, open(path, "w"))
PY

sleep 1
if kill -0 "$newpid" 2>/dev/null; then
  echo "  [✓] 已重启 workbuddy2api (pid $newpid) → http://localhost:${PORT}"
else
  echo "  [✗] workbuddy2api 启动后立即退出，看日志: ${RUNTIME}/logs/workbuddy2api.log"
  exit 1
fi
echo "  [·] 验证: curl -s localhost:${PORT}/v1/models | head"
echo "  [·] 状态与省 token 统计: bash ${SKILL_DIR}/scripts/status.sh"
