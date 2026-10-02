#!/usr/bin/env bash
# iskill-headroom-workbuddy · 双击运行入口（macOS）
#
# 在 Finder 里双击本文件即可（.command 会被「终端」打开并执行）。
# 无参数 = 交互菜单；也可以在终端里 ./hwb.command status 这样用，参数原样透传。
#
# 为什么是这么薄的一层：真正的逻辑全在 scripts/hwb.py（一份跨平台代码），
# 本文件只负责「找到 python + 把参数转过去 + 收尾」。

cd "$(dirname "$0")" || exit 1
here="$(pwd)"
me="$(basename "$0")"

# ── 场景判定 ────────────────────────────────────────────────
# 「本脚本是双击打开的」还是「用户在自己 shell 里手动跑的」？
#   · 双击：父进程 = login（终端 App 的包装进程）或终端 App 本身；
#           或者父 shell 是被专门拉来跑本脚本的（命令行里含脚本名）。
#   · 手动：父进程是交互 shell，且其命令行与本脚本无关 → 退出后提示符自然回来。
#   · 判不了：返回 unknown —— 收尾时既不冒险关窗、也不留死窗口。
classify_open() {
  local ppid pcomm pcmd
  ppid="$(ps -o ppid= -p $$ 2>/dev/null | tr -d ' ')"
  [ -n "$ppid" ] || { echo "unknown"; return; }
  pcomm="$(ps -o comm= -p "$ppid" 2>/dev/null)"; pcomm="${pcomm##*/}"
  pcmd="$(ps -o command= -p "$ppid" 2>/dev/null)"
  case "$pcomm" in
    login|Terminal|iTerm|iTerm2|Warp|WezTerm|kitty|Alacritty|ghostty) echo "direct"; return ;;
  esac
  case "$pcomm" in
    zsh|bash|sh|fish|dash|-zsh|-bash)
      case "$pcmd" in
        *"$me"*) echo "direct" ;;
        *)       echo "manual" ;;
      esac ;;
    *) echo "unknown" ;;
  esac
}

# 关掉本脚本所在的那个标签页/窗口；若终端里已没有别的标签，连 App 一起退。
# 按 tty 精确定位（而不是 close front window）：万一用户此刻切到了别的窗口，
# 也不会关错。⚠️ osascript 必须**放到后台并延迟一点点**：此刻 bash 自身还占着
# 这个窗口，同步 close/quit 会弹「关闭窗口将终止正在运行的进程」确认框；
# 让 bash 先退出、窗口里没活动进程了，再关就干净了。
close_terminal_window() {
  local my_tty script
  my_tty="$(ps -o tty= -p $$ 2>/dev/null | tr -d ' ')"   # 形如 ttys004
  if [ -n "$my_tty" ]; then
    case "${TERM_PROGRAM:-}" in
      iTerm.app)
        ( sleep 0.4; osascript -e 'tell application "iTerm2"
            if (count of windows) <= 1 then
              quit
            else
              close current window
            end if
          end tell' >/dev/null 2>&1 ) >/dev/null 2>&1 &
        return
        ;;
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
    ( sleep 0.4; osascript -e "$script" >/dev/null 2>&1 ) >/dev/null 2>&1 &
    return
  fi
  # tty 拿不到时的兜底：按「当前窗口」关（原行为）
  ( sleep 0.4; osascript -e 'tell application "Terminal"
      if (count of windows) <= 1 then
        quit
      else
        close front window
      end if
    end tell' >/dev/null 2>&1 ) >/dev/null 2>&1 &
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

# ── 收尾 ────────────────────────────────────────────────────
# rc=10 = 用户在菜单里选了退出（hwb.py 只表达意图，关不关窗由本壳决定）。
if [ "$rc" -eq 10 ] && [ "$#" -eq 0 ] && [ -t 0 ]; then
  case "$(classify_open)" in
    direct)
      # 双击场景：按 tty 精确关窗（最后一个标签则退掉整个终端 App）
      close_terminal_window
      exit 0
      ;;
    manual)
      # 手动运行：什么都不做，提示符自然回来，绝不动用户的窗口
      exit $rc
      ;;
    *)
      # 判不了（ps 不可用 / 父进程形态陌生）：既不冒险关窗，也不留
      # 「[Process completed]」死窗口 —— 直接换成交互 shell，窗口还能继续用。
      echo ""
      exec "${SHELL:-/bin/zsh}"
      ;;
  esac
fi

# 其余退出的双击场景（报错等）：等一个回车让人看清输出，然后也把窗口关干净；
# 手动运行场景这里不会走到（上面 unknown/manual 已覆盖，只有 rc=10 才提前 return）。
if [ "$#" -eq 0 ] && [ -t 0 ]; then
  echo
  printf "按回车键关闭窗口…"
  read -r _ || true
  case "$(classify_open)" in
    direct) close_terminal_window ;;
  esac
fi
exit $rc
