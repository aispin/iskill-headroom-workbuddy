#!/usr/bin/env bash
# iskill-headroom-workbuddy · WorkBuddy 桌面端「抓包参数」开关
#
# ⚠️ 重要：开启后是**持续**的，不是一次性的。
#    WorkBuddy 会一直把整个网络栈（含 Authorization / Cookie 明文）追加写进 netlog，
#    实测 ~9 KB/s ≈ 0.7 GB/天，且**不会自己停**。用完必须 `--restore` 关掉。
#
# 用法：
#   enable_cdp.sh            开启两条抓取通道（需重启桌面端）
#   enable_cdp.sh --restore  恢复正常启动，关掉抓取通道   ← 用完务必执行
#   enable_cdp.sh --status   检查当前桌面端是否还带着抓取开关
#
# 两条通道（都只需重启一次）：
#   --remote-debugging-port=9222 --enable-remote-debugging-webview               → CDP 通道（get_token_cdp.mjs）
#   --log-net-log=<runtime>/netlog.json --net-log-capture-mode=IncludeSensitive  → netlog 通道（get_token_netlog.mjs）
#
# 历史背景：这条路线是为了「抓 WorkBuddy 自己的模型 token」。
# 现在已被 workbuddy2api-hub 的看板 OAuth 取代（账号池自带额度），正常情况下**不需要**再开抓包。
set -e

APP="/Applications/WorkBuddy.app"
BIN="$APP/Contents/MacOS/WorkBuddy"
PORT=9222
RUNTIME="${HOME}/.iskill-headroom-workbuddy"
NETLOG="${RUNTIME}/netlog.json"

running_with_capture() {
  lsof -nP -iTCP:$PORT -sTCP:LISTEN >/dev/null 2>&1 && return 0
  lsof -nP "$NETLOG" 2>/dev/null | grep -q "^WorkBuddy\|^Electron" && return 0
  return 1
}

case "${1:-}" in
  --status)
    echo "[*] 检查 WorkBuddy 桌面端抓取开关…"
    if running_with_capture; then
      echo "⚠️  仍在抓包："
      lsof -nP -iTCP:$PORT -sTCP:LISTEN 2>/dev/null | tail -1 | sed 's/^/    CDP  /'
      lsof -nP "$NETLOG" 2>/dev/null | tail -1 | sed 's/^/    netlog  /'
      [ -f "$NETLOG" ] && echo "    netlog 当前大小: $(du -h "$NETLOG" | cut -f1)"
      echo ""
      echo "    关闭：$0 --restore"
      exit 1
    fi
    echo "[✓] 干净：没有 CDP 端口，也没有 netlog 写入。"
    [ -f "$NETLOG" ] && echo "    但残留文件还在（可删）：$NETLOG  $(du -h "$NETLOG" | cut -f1)"
    exit 0
    ;;
  --restore)
    echo "[*] 恢复正常启动（关闭抓取通道）…"
    echo "⚠️  会重启 WorkBuddy 客户端：当前会话会断、未保存内容可能丢失。"
    if [ -t 0 ]; then
      read -r -p "确认重启？(y/N) " ans
      case "$ans" in y|Y) ;; *) echo "已取消"; exit 0 ;; esac
    fi
    osascript -e 'quit app "WorkBuddy"' 2>/dev/null || true
    pkill -f "$BIN" 2>/dev/null || true
    sleep 2
    open -a "$APP"
    echo "[✓] 已不带任何抓包参数启动。"
    if [ -f "$NETLOG" ]; then
      size=$(du -h "$NETLOG" | cut -f1)
      rm -f "$NETLOG" && echo "[✓] 已删除 netlog（${size}）——里面含明文 Authorization / Cookie。"
    fi
    echo ""
    echo "    之后用 $0 --status 复核应为「干净」。"
    exit 0
    ;;
  "" )
    ;;
  * )
    echo "未知参数：$1（可用：--restore / --status）" >&2
    exit 2
    ;;
esac

# ── 开启抓包 ─────────────────────────────────────────────────
echo "[iskill-headroom-workbuddy] 准备以抓包参数重启 WorkBuddy 桌面端"
echo "⚠️  这会关闭当前正在运行的 WorkBuddy 客户端（会话会断、未保存内容可能丢失），"
echo "    重启后它会监听 127.0.0.1:${PORT}（仅本机，不暴露公网）。"
echo ""
echo "⚠️  netlog 是**持续写入**的：含 Authorization / Cookie 明文，约 0.7 GB/天。"
echo "    写入位置: ${NETLOG}"
echo "    用完请立刻执行: $0 --restore"
if [ -t 0 ]; then
  read -r -p "确认重启？(y/N) " ans
  case "$ans" in y|Y) ;; *) echo "已取消"; exit 0 ;; esac
else
  echo "[!] 非交互环境，未确认，终止。请在本机 Terminal 手动运行："
  echo "    open -a \"$APP\" --args --remote-debugging-port=$PORT --enable-remote-debugging-webview --log-net-log=\"$NETLOG\" --net-log-capture-mode=IncludeSensitive"
  echo "    记得随后用 $0 --restore 关闭。"
  exit 0
fi

echo "[*] 关闭当前 WorkBuddy…"
osascript -e 'quit app "WorkBuddy"' 2>/dev/null || true
pkill -f "$BIN" 2>/dev/null || true
sleep 2

echo "[*] 以抓包参数启动…"
open -a "$APP" --args \
  --remote-debugging-port=$PORT \
  --enable-remote-debugging-webview \
  --log-net-log="$NETLOG" \
  --net-log-capture-mode=IncludeSensitive

echo "[*] 等待 DevTools 端口就绪…"
for i in $(seq 1 30); do
  if curl -s --max-time 2 "http://127.0.0.1:$PORT/json/version" >/dev/null 2>&1; then
    echo "[✓] CDP 就绪: http://127.0.0.1:$PORT"
    break
  fi
  sleep 1
done

SKILL_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
echo ""
echo "接下来在桌面端随便发一条消息，然后运行（推荐 netlog 通道）："
echo "    node \"$SKILL_DIR/references/legacy-token-capture/get_token_netlog.mjs\" --verbose"
echo "  （CDP 通道作为备选： node \"$SKILL_DIR/references/legacy-token-capture/get_token_cdp.mjs\" --verbose ）"
echo ""
echo "⚠️ 用完务必关闭抓包： $0 --restore"
