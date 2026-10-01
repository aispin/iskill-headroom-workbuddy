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

# 双击（无参数）时才等一等，避免菜单退出后窗口立刻消失看不到结果；
# 在终端里带参数调用（脚本化）就不要多这一步，免得卡住调用方。
if [ "$#" -eq 0 ] && [ -t 0 ]; then
  echo
  printf "按回车键关闭窗口…"
  read -r _ || true
fi
exit $rc
