#!/usr/bin/env bash
# iskill-headroom-workbuddy · 双击运行入口（macOS）
#
# 在 Finder 里双击本文件即可（.command 会被「终端」打开并执行）。
# 无参数 = 交互菜单；也可以在终端里 ./hwb.command status 这样用，参数原样透传。
#
# 为什么是这么薄的一层：真正的逻辑全在 scripts/hwb.py（一份跨平台代码），
# 本文件只负责「找到 python + 把参数转过去 + 收尾停一下别让窗口秒关」。

cd "$(dirname "$0")" || exit 1
here="$(pwd)"

# ── 关窗工具 ────────────────────────────────────────────────
# 「本脚本是不是被终端 App 直接打开的（= 双击场景）」：
# 运行本脚本的 bash 的**父进程**是终端 App 本身；而在用户自己的 shell 里敲
# ./hwb.command 时，父进程是那个交互 shell。ps 拿不到信息时**保守返回 false**
# —— 宁可不关窗口，也绝不能把用户自己的终端会话连同历史一起干掉。
launched_by_terminal_app() {
  local ppid pname
  ppid="$(ps -o ppid= -p $$ 2>/dev/null | tr -d ' ')"
  [ -n "$ppid" ] || return 1
  pname="$(ps -o comm= -p "$ppid" 2>/dev/null | tr -d ' ')"
  pname="${pname##*/}"
  case "$pname" in
    Terminal|iTerm|iTerm2|Warp|WezTerm|kitty|Alacritty|foot|ghostty) return 0 ;;
    *) return 1 ;;
  esac
}

# 关掉当前窗口；若已经是最后一个窗口，连终端 App 一起退。
# ⚠️ osascript 必须**放到后台并延迟一点点**：此刻 bash 自身还占着这个窗口，
#    同步调 close / quit 会弹出「关闭窗口将终止正在运行的进程」确认框。
#    让 bash 先退出、窗口里没活动进程了，再关就干净了。
close_terminal_window() {
  case "${TERM_PROGRAM:-}" in
    iTerm.app)
      ( sleep 0.4; osascript -e 'tell application "iTerm2"
          if (count of windows) <= 1 then
            quit
          else
            close current window
          end if
        end tell' >/dev/null 2>&1 ) >/dev/null 2>&1 &
      ;;
    *)
      ( sleep 0.4; osascript -e 'tell application "Terminal"
          if (count of windows) <= 1 then
            quit
          else
            close front window
          end if
        end tell' >/dev/null 2>&1 ) >/dev/null 2>&1 &
      ;;
  esac
}

PY="${ISKILL_PYTHON:-}"
if [ -z "$PY" ] || [ ! -x "$PY" ]; then
  PY="$(command -v python3 || command -v python)"
fi
if [ -z "$PY" ]; then
  echo "找不到 Python 3 —— 装一个（brew install python3，或 python.org 安装包）后重试。"
  echo
  printf "按回车键关闭窗口…"
  read -r _
  exit 1
fi

"$PY" "$here/scripts/hwb.py" "$@"
rc=$?

# rc=10 = 用户在菜单里选了退出。双击场景直接关窗（最后一个窗口则退掉整个终端 App）；
# 手动运行场景（或 ps 判断不了）走下面的老逻辑，等一个回车 —— 绝不替用户关窗口。
if [ "$rc" -eq 10 ] && [ "$#" -eq 0 ] && [ -t 0 ] && launched_by_terminal_app; then
  close_terminal_window
  exit 0
fi

# 双击（无参数）时才等一等，避免菜单退出后窗口立刻消失看不到结果；
# 在终端里带参数调用（脚本化）就不要多这一步，免得卡住调用方。
if [ "$#" -eq 0 ] && [ -t 0 ]; then
  echo
  printf "按回车键关闭窗口…"
  read -r _ || true
fi
exit $rc
