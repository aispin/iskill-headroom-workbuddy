#!/usr/bin/env bash
# iskill-headroom-workbuddy2api · 验证 Headroom 到底有没有在压缩（A/B 对照实验）
#
# 为什么要做对照：Headroom 默认跑在 `--mode cache`，这个模式的设计目标是
# **让上游的 prompt cache 命中**——历史前缀按字节原样回放，只压最新那条增量。
# 所以 /stats 里 requests_compressed 多数时候是 0（历史都落在冻结区）**属正常**；
# 但用「以工具结果结尾」的 payload 测，就能看到它确实在压（2026-10-01 实测省 4.1%）。
# 只有当你需要把**全部历史**都压掉时才切 `--mode token`（官方原话：可延长会话 25–35%），
# 代价是首个请求要加载 Kompress 模型 —— 实测端口就绪 151s、首请求 32s。
#
# 本脚本用**同一份带大块日志历史的 payload** 打两个实例：
#   A) 当前实例（默认 cache 模式，:8787）
#   B) 临时实例（HEADROOM_MODE=token，:8789，同一个 hub 上游）
# 比较响应头 x-headroom-compressed / tokens-before / after / saved，
# 并打印上游 usage 里的 cached_tokens（这才是「cache 模式值不值」的关键指标）。
# 临时实例跑完即杀，不影响正在服务的 A。

set -eo pipefail

RUNTIME="${ISKILL_RUNTIME:-$HOME/.iskill-headroom-workbuddy2api}"
SKILL_DIR="$(cd "$(dirname "$0")/.." && pwd)"
VENV="$RUNTIME/venv"
HEADROOM_ENV="$RUNTIME/headroom.env"
PROBE="$SKILL_DIR/scripts/compression_probe.py"

HEADROOM_PORT="${HEADROOM_PORT:-8787}"
TEST_PORT="${TEST_PORT:-8789}"
HUB_PORT="${HUB_PORT:-8788}"
CONSOLE_PORT="${CONSOLE_PORT:-8786}"
TEST_LOG="$RUNTIME/logs/headroom-token-test.log"

step() { echo; echo "════ $1"; }
ok()   { echo "  [✓] $*"; }
bad()  { echo "  [✗] $*" >&2; }
info() { echo "  [·] $*"; }
warn() { echo "  [!] $*"; }

PY="$VENV/bin/python"
[ -x "$PY" ] || PY="$(command -v python3)"
[ -f "$PROBE" ] || { bad "缺少探针脚本 $PROBE"; exit 1; }

cleanup() {
  if [ -n "${TMP_PID:-}" ] && kill -0 "$TMP_PID" 2>/dev/null; then
    kill "$TMP_PID" 2>/dev/null || true
    sleep 1
    kill -9 "$TMP_PID" 2>/dev/null || true
    info "临时实例（:$TEST_PORT）已停止"
  fi
  # 端口兜底：pidfile 拿不到句柄时按端口清
  if command -v lsof >/dev/null 2>&1; then
    for p in $(lsof -nP -iTCP:"$TEST_PORT" -sTCP:LISTEN -t 2>/dev/null); do
      kill "$p" 2>/dev/null || true
    done
  fi
}
trap cleanup EXIT

port_open() { lsof -nP -iTCP:"$1" -sTCP:LISTEN -t >/dev/null 2>&1; }

# 同一轮 A/B 用同一个 nonce（塞进 system 消息）：
# 完全相同的请求会被 Headroom 的响应缓存直接回放，连压缩管线都不走，对照就失真。
NONCE="${NONCE:-$($PY -c 'import os,hashlib;print(hashlib.md5(os.urandom(8)).hexdigest()[:8])' 2>/dev/null || date +%s)}"
PROBE_COMMON=(--console-port "$CONSOLE_PORT" --nonce "$NONCE")

# ─────────────────────────────────────────────────────────────
step "0 · 环境自检"
if ! port_open "$HUB_PORT"; then bad "hub（:$HUB_PORT）没在监听，先跑 start.sh"; exit 1; fi
ok "hub 在 :$HUB_PORT"
if ! port_open "$HEADROOM_PORT"; then bad "headroom（:$HEADROOM_PORT）没在监听，先跑 start.sh"; exit 1; fi
ok "headroom 在 :$HEADROOM_PORT"

# 打印当前实例**实际生效**的模式（日志横幅才是可信来源）
BANNER="$(grep -aE 'Mode:|Prefix freeze|Mutati' ~/.headroom/logs/proxy-"$HEADROOM_PORT".log 2>/dev/null | tail -3 | tr '\n' '; ')"
[ -n "$BANNER" ] && info "当前实例横幅：$BANNER"
case "$BANNER" in
  *"Mode: cache"*) warn "当前是 cache 模式 —— 历史前缀按字节原样回放（不重写历史），只压最新那条增量，所以 tokens_saved 多为 0 属正常" ;;
esac

# ─────────────────────────────────────────────────────────────
step "A · 当前实例（cache 模式，:$HEADROOM_PORT）"
info "payload = agent-mid 式（以工具结果结尾 —— 真实 agent 循环的形状，cache 模式能压的就是它）"
"$PY" "$PROBE" --port "$HEADROOM_PORT" --style agent-mid --label "A0 当前实例 · agent-mid payload（应能看到压缩）" "${PROBE_COMMON[@]}" || true
info "payload = agent 式（带工具结果但以提问结尾）"
"$PY" "$PROBE" --port "$HEADROOM_PORT" --label "A1 当前实例 · agent payload" "${PROBE_COMMON[@]}" || true
info "payload = 纯聊天式（对照：压不动，但也是设计如此）"
"$PY" "$PROBE" --port "$HEADROOM_PORT" --style prose --label "A2 当前实例 · prose payload" "${PROBE_COMMON[@]}" || true

# ─────────────────────────────────────────────────────────────
step "B · 临时实例（token 模式，:$TEST_PORT）"
if port_open "$TEST_PORT"; then
  warn "端口 $TEST_PORT 被占用，先清理"
  for p in $(lsof -nP -iTCP:"$TEST_PORT" -sTCP:LISTEN -t 2>/dev/null); do kill "$p" 2>/dev/null || true; done
  sleep 1
fi
if [ ! -f "$HEADROOM_ENV" ]; then bad "缺少 $HEADROOM_ENV，先跑一次 start.sh"; exit 1; fi

: > "$TEST_LOG"
(
  set -a; . "$HEADROOM_ENV"; set +a
  export HEADROOM_PORT="$TEST_PORT"
  export HEADROOM_MODE=token
  exec "$VENV/bin/headroom" proxy --host 127.0.0.1 --port "$TEST_PORT"
) >> "$TEST_LOG" 2>&1 &
TMP_PID=$!

info "等待 token 模式实例就绪（首次要加载 Kompress 模型，最多 180s）…"
READY=0
for _ in $(seq 1 180); do
  if port_open "$TEST_PORT"; then READY=1; break; fi
  if ! kill -0 "$TMP_PID" 2>/dev/null; then break; fi
  sleep 1
done
if [ "$READY" -eq 1 ]; then
  ok "token 实例已监听 :$TEST_PORT"
  TBANNER="$(grep -aE 'Mode:|Prefix freeze|Mutati' "$TEST_LOG" | tail -3 | tr '\n' '; ')"
  [ -n "$TBANNER" ] && info "横幅：$TBANNER"
else
  bad "token 实例没起来 → tail -n 30 $TEST_LOG"
  exit 1
fi

"$PY" "$PROBE" --port "$TEST_PORT" --label "B1 token 实例 · agent payload" "${PROBE_COMMON[@]}" || true
info "payload = 纯聊天式（对照）"
"$PY" "$PROBE" --port "$TEST_PORT" --style prose --label "B2 token 实例 · prose payload" "${PROBE_COMMON[@]}" || true

# ─────────────────────────────────────────────────────────────
step "C · 汇总"
A_STATS="$($PY - "$HEADROOM_PORT" <<'PYEOF'
import json, sys, urllib.request
try:
    d = json.load(urllib.request.urlopen("http://127.0.0.1:%s/stats" % sys.argv[1], timeout=5))
    c = d["summary"]["compression"]
    print("compressed=%s before=%s saved=%s removed=%s"
          % (c["requests_compressed"], c["total_tokens_before"],
             c["total_tokens_saved_all_layers"], c["total_tokens_removed"]))
except Exception as e:
    print("(读取失败 %s)" % e)
PYEOF
)"
B_STATS="$($PY - "$TEST_PORT" <<'PYEOF'
import json, sys, urllib.request
try:
    d = json.load(urllib.request.urlopen("http://127.0.0.1:%s/stats" % sys.argv[1], timeout=5))
    c = d["summary"]["compression"]
    print("compressed=%s before=%s saved=%s removed=%s"
          % (c["requests_compressed"], c["total_tokens_before"],
             c["total_tokens_saved_all_layers"], c["total_tokens_removed"]))
except Exception as e:
    print("(读取失败 %s)" % e)
PYEOF
)"
info "cache 模式 /stats：$A_STATS"
info "token 模式 /stats：$B_STATS"

echo
echo "  判读："
echo "   · A0（以工具结果结尾）saved>0        → cache 模式确实在压最新那条增量，符合设计"
echo "   · A1/A2（提问结尾 / 纯聊天）saved=0  → 那两处本来就不是它的压缩位置，不代表坏了"
echo "   · token 的 saved 高于 cache         → 压缩上限更高，代价是首请求 30s + 压缩前缀稳定性风险"
echo "   · 每个 case 都打印 cached_tokens     → 上游命中率才是「cache 模式值不值」的判据"
echo "   · 出现 x-headroom-compression-failed=true → **压缩管线自己出错了**，不是模式问题："
echo "       多为临时目录写不进去（沙箱拦 unlink、磁盘只读等）。此种情况下 saved 恒 0，不可用来比较模式。"
echo
echo "  维持默认 cache（推荐）：bash scripts/start.sh"
echo "  确实需要全史压缩才切：HEADROOM_MODE=token bash scripts/start.sh"
