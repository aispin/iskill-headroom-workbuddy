#!/usr/bin/env bash
# iskill-headroom-workbuddy · 双击运行入口（macOS）
#
# 在 Finder 里双击本文件即可（.command 会被「终端」打开并执行）。
# 无参数 = 交互菜单；也可以在终端里 ./hwb.command status 这样用，参数原样透传。
#
# 为什么是这么薄的一层：真正的逻辑全在 scripts/hwb.py（一份跨平台代码），
# 本文件只负责「找到 python + 把参数转过去 + 收尾」。
#
# 收尾判定的每一步都会写日志：~/.iskill-headroom-workbuddy/logs/launcher.log
# （关窗这件事依赖 osascript，可能被系统权限拦下；没有日志就只能靠猜。）

cd "$(dirname "$0")" || exit 1
here="$(pwd)"
me="$(basename "$0")"
LOGDIR="${HOME}/.iskill-headroom-workbuddy/logs"
mkdir -p "$LOGDIR" 2>/dev/null
LAUNCH_LOG="${LOGDIR}/launcher.log"
launch_log() { printf '%s %s\n' "$(date '+%F %T')" "$*" >>"$LAUNCH_LOG" 2>/dev/null; }

# ── 场景判定 ────────────────────────────────────────────────
# 「双击打开」还是「用户在自己 shell 里手动跑的」？三条证据，任一命中即 direct：
#   a) 父进程 = login（Terminal 双击 .command 时的包装进程）/ 终端 App 本身
#   b) 父 shell 的命令行里含本脚本名（shell 被专门拉来跑本脚本）
#   c) 父 shell 刚被拉起（存活 < 90s）—— 双击新建的窗口就是这个形态
# 父进程是「与脚本无关的老 shell」→ manual（退出后提示符自然回来，绝不动窗口）
# 三条都判不了 → unknown（既不冒险关窗，也不留死窗口，换成交互 shell）
classify_open() {
  local ppid pcomm pcmd petime mm
  ppid="$(ps -o ppid= -p $$ 2>/dev/null | tr -d ' ')"
  if [ -z "$ppid" ]; then launch_log "classify: ps 取不到 ppid → unknown"; echo "unknown"; return; fi
  pcomm="$(ps -o comm= -p "$ppid" 2>/dev/null)"; pcomm="${pcomm##*/}"
  pcmd="$(ps -o command= -p "$ppid" 2>/dev/null)"
  petime="$(ps -o etime= -p "$ppid" 2>/dev/null | tr -d ' ')"
  launch_log "classify: ppid=$ppid pcomm=[$pcomm] etime=[$petime] pcmd=[$pcmd]"
  case "$pcomm" in
    login|Terminal|iTerm|iTerm2|Warp|WezTerm|kitty|Alacritty|ghostty)
      launch_log "classify: 命中终端 App/包装进程 → direct"; echo "direct"; return ;;
  esac
  case "$pcomm" in
    zsh|bash|sh|fish|dash|-zsh|-bash)
      case "$pcmd" in
        *"$me"*) launch_log "classify: 父 shell 命令行含脚本名 → direct"; echo "direct"; return ;;
      esac
      # etime 形态：SS（秒） / MM:SS / HH:MM:SS / DD-HH:MM:SS
      case "$petime" in
        *-*|*:*:*) launch_log "classify: 父 shell 已存在较久[$petime] → manual"; echo "manual"; return ;;
        *:*)
          mm="${petime%%:*}"
          if [ "$((10#$mm))" -lt 2 ] 2>/dev/null; then
            launch_log "classify: 父 shell 很新[$petime] → direct"; echo "direct"
          else
            launch_log "classify: 父 shell 已存在[$petime] → manual"; echo "manual"
          fi; return ;;
        *)
          if [ "$petime" -lt 90 ] 2>/dev/null; then
            launch_log "classify: 父 shell 很新[${petime}s] → direct"; echo "direct"
          else
            launch_log "classify: 父 shell 已存在[${petime}s] → manual"; echo "manual"
          fi; return ;;
      esac ;;
  esac
  launch_log "classify: 父进程形态陌生 → unknown"; echo "unknown"
}

# 关掉本脚本所在的那个标签页（按 tty 精确定位）；若终端里已没有别的标签，连 App 一起退。
# ⚠️ osascript 必须后台 + 延迟：此刻 bash 自身还占着窗口，同步 close/quit 会弹
#    「关闭窗口将终止正在运行的进程」确认框。失败原因写进日志（可能是系统权限拦了）。
close_terminal_window() {
  local my_tty script
  my_tty="$(ps -o tty= -p $$ 2>/dev/null | tr -d ' ')"
  launch_log "close: my_tty=[$my_tty] TERM_PROGRAM=[${TERM_PROGRAM:-}]"
  if [ -n "$my_tty" ]; then
    case "${TERM_PROGRAM:-}" in
      iTerm.app)
        ( sleep 0.4; osascript -e 'tell application "iTerm2"
            if (count of windows) <= 1 then
              quit
            else
              close current window
            end if
          end tell' >/dev/null 2>>"$LAUNCH_LOG"; launch_log "close: iTerm osascript rc=$?" ) >/dev/null 2>&1 &
        return ;;
    esac
    script="
      tell application \"Terminal\"
        set total to 0
        set closed_mine to false
        repeat with w in windows
          repeat with t in tabs of w
            set total to total + 1
            if not closed_mine then
              try
                if (tty of t) is \"/dev/$my_tty\" then
                  set closed_mine to true
                  close t
                end if
              end try
            end if
          end repeat
        end repeat
        if total <= 1 then quit
      end tell"
    ( sleep 0.4; osascript -e "$script" >/dev/null 2>>"$LAUNCH_LOG"; launch_log "close: Terminal osascript rc=$? (tab_tty=/dev/$my_tty)" ) >/dev/null 2>&1 &
    return
  fi
  ( sleep 0.4; osascript -e 'tell application "Terminal"
      if (count of windows) <= 1 then
        quit
      else
        close front window
      end if
    end tell' >/dev/null 2>>"$LAUNCH_LOG"; launch_log "close: Terminal(front) osascript rc=$?" ) >/dev/null 2>&1 &
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
launch_log "run: $me $* → rc=$rc"

# ── 收尾 ────────────────────────────────────────────────────
# rc=10 = 用户在菜单里选了退出（hwb.py 只表达意图，关不关窗由本壳决定）。
if [ "$rc" -eq 10 ] && [ "$#" -eq 0 ] && [ -t 0 ]; then
  case "$(classify_open)" in
    direct)
      close_terminal_window
      exit 0
      ;;
    manual)
      exit $rc
      ;;
    *)
      # 判不了：既不动用户的窗口，也不留「[Process completed]」死窗口 ——
      # 换成交互 shell，窗口还能继续用。
      echo ""
      exec "${SHELL:-/bin/zsh}"
      ;;
  esac
fi

if [ "$#" -eq 0 ] && [ -t 0 ]; then
  echo
  printf "按回车键关闭窗口…"
  read -r _ || true
  case "$(classify_open)" in
    direct) close_terminal_window ;;
  esac
fi
exit $rc
