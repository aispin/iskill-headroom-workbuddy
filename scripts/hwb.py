#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""iskill-headroom-workbuddy · 跨平台启动器（macOS / Windows / Linux）

链路：客户端 → Headroom(:8787 压缩) → workbuddy2api-hub(:8788 转换) → WorkBuddy 官方内置模型

用法：
    python3 scripts/hwb.py start        启动两个服务（首次自动拉源码 / 建 venv / 装 headroom）
    python3 scripts/hwb.py stop         停止
    python3 scripts/hwb.py restart      重启
    python3 scripts/hwb.py status       查看状态 / 账号池 / 省 token
    python3 scripts/hwb.py login        添加上游账号（OAuth）
    python3 scripts/hwb.py dashboard    本地控制台（:8786，默认打开浏览器）
    python3 scripts/hwb.py open         只打开用量看板
    python3 scripts/hwb.py doctor       环境体检（Python / Node / git / 端口…）
    python3 scripts/hwb.py              无参数 = 交互菜单（双击 .command / .ps1 走这条）

双击入口：
    macOS   →  hwb.command
    Windows →  hwb.ps1（双击）或 hwb.cmd（.ps1 双击默认会打开记事本，.cmd 才是双击就跑）

为什么是 Python 而不是把 shell 脚本翻译两遍：
    这套东西**本来就依赖 Python**（hub 是纯 stdlib 的 Python 程序、Headroom 装在 venv 里），
    所以「一份 Python 实现 + 各平台薄壳」既零额外依赖，又只有一个真源，不会双份漂移。
    设计要点见 references/cross-platform.md。
"""

from __future__ import annotations

import argparse
import ctypes
import json
import os
import re
import secrets
import shutil
import signal
import socket
import string
import subprocess
import sys
import threading
import time
import urllib.request
import webbrowser
from pathlib import Path

# ─────────────────────────────────────────────────────────────
# 控制台：Windows 终端默认 GBK，中文会乱码 → 切 UTF-8 代码页
IS_WINDOWS = os.name == "nt"
IS_MACOS = sys.platform == "darwin"


def _init_console() -> None:
    if not IS_WINDOWS:
        return
    try:
        k32 = ctypes.windll.kernel32
        k32.SetConsoleOutputCP(65001)   # 输出代码页 → UTF-8
        k32.SetConsoleCP(65001)         # 输入代码页 → UTF-8
    except Exception:
        pass
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass


_init_console()

# ─────────────────────────────────────────────────────────────
# 常量 / 路径
RUNTIME = Path(os.environ.get("ISKILL_RUNTIME") or (Path.home() / ".iskill-headroom-workbuddy"))
SKILL_DIR = Path(__file__).resolve().parent.parent

HUB_REPO = "https://github.com/ardeyouxipianyi/workbuddy2api-hub.git"
HUB_BRANCH = os.environ.get("HUB_BRANCH", "main")
HUB_DIR = RUNTIME / "workbuddy2api-hub"
HUB_ACCOUNTS = RUNTIME / "hub-accounts"      # 账号凭证 + settings.json（与源码分离，升级不丢）
HUB_USAGE = RUNTIME / "hub-usage"            # 请求流水
HUB_ENV = RUNTIME / "hub.env"
HEADROOM_ENV = RUNTIME / "headroom.env"
VENV = RUNTIME / "venv"
LOGS = RUNTIME / "logs"
PIDS = RUNTIME / "pids.json"

HEADROOM_HOST = os.environ.get("HEADROOM_HOST", "127.0.0.1")
HEADROOM_PORT = int(os.environ.get("HEADROOM_PORT") or 8787)
HUB_PORT = int(os.environ.get("HUB_PORT") or 8788)
DASH_PORT = int(os.environ.get("DASHBOARD_PORT") or 8786)

# Headroom 代理模式：
#   cache（默认）—— 严格冻结历史前缀（逐字节不变），靠上游 prompt cache 省钱；
#                   同时压缩每一轮**新到的增量**，但不重写历史 —— 所以 /stats 的
#                   「压缩次数 / 已省 token」经常是 0，这是设计如此。
#   token        —— 压缩历史后再重新冻结，真的压 token（agent 会话实测省 ~78%），
#                   代价是每次压缩可能让上游缓存失效、需要重算。
HEADROOM_MODE = os.environ.get("HEADROOM_MODE", "cache")

PIP_SPEC = "headroom-ai[proxy]"


# ─────────────────────────────────────────────────────────────
# 终端 UI（与旧 start.sh 的观感保持一致）
def step(n, title: str) -> None:
    print(f"\n════ {n} · {title}")


def ok(msg: str) -> None:
    print(f"  [✓] {msg}")


def bad(msg: str) -> None:
    print(f"  [✗] {msg}", file=sys.stderr)


def info(msg: str) -> None:
    print(f"  [·] {msg}")


def warn(msg: str) -> None:
    print(f"  [!] {msg}")


_SPIN_FRAMES = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏"


def _spin(desc: str, stop_evt: threading.Event, tty: bool) -> None:
    i = 0
    while not stop_evt.wait(0.2):
        if tty:
            sys.stdout.write(f"\r  [{_SPIN_FRAMES[i % 10]}] {desc} … {int(i * 0.2)}s")
            sys.stdout.flush()
        i += 1


def run_spin(desc: str, cmd: list, cwd: Path | None = None, env: dict | None = None,
             log: Path | None = None) -> int:
    """跑一条命令并转圈。返回退出码。输出进 log（若有）或丢弃。"""
    tty = sys.stdout.isatty()
    stop_evt = threading.Event()
    t = threading.Thread(target=_spin, args=(desc, stop_evt, tty), daemon=True)
    t.start()
    start = time.time()
    try:
        if log is not None:
            log.parent.mkdir(parents=True, exist_ok=True)
            with open(log, "ab") as fh:
                fh.write(f"\n$ {' '.join(str(c) for c in cmd)}\n".encode())
                rc = subprocess.call([str(c) for c in cmd], cwd=str(cwd) if cwd else None,
                                     env=env, stdout=fh, stderr=subprocess.STDOUT)
        else:
            rc = subprocess.call([str(c) for c in cmd], cwd=str(cwd) if cwd else None,
                                 env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    except FileNotFoundError:
        rc = 127
    finally:
        stop_evt.set()
        t.join()
    el = int(time.time() - start)
    if tty:
        sys.stdout.write("\r" + " " * 78 + "\r")
    if rc == 0:
        print(f"  [✓] {desc} （{el}s）")
    else:
        print(f"  [✗] {desc} 失败（{el}s，rc={rc}）")
    return rc


# ─────────────────────────────────────────────────────────────
# Python / venv：都在运行时里，位置随平台变
def find_python() -> str:
    """优先 env 指定 → 当前解释器（本脚本就是被它跑起来的）→ 平台候选 → PATH。"""
    explicit = os.environ.get("ISKILL_PYTHON")
    if explicit and Path(explicit).exists():
        return explicit
    if sys.version_info >= (3, 9):
        return sys.executable
    cands: list[str] = []
    if IS_WINDOWS:
        for name in ("py", "python"):
            p = shutil.which(name)
            if p:
                cands.append(p)
    else:
        for p in ("/usr/bin/python3", "/usr/local/bin/python3", "/opt/homebrew/bin/python3"):
            if Path(p).exists():
                cands.append(p)
        for name in ("python3", "python"):
            p = shutil.which(name)
            if p:
                cands.append(p)
    return cands[0] if cands else "python3"


PYTHON_BIN = find_python()


def venv_paths() -> tuple[Path, Path, Path, Path]:
    """返回 (bindir, python, pip, headroom)。Windows 是 Scripts/*.exe，POSIX 是 bin/*。"""
    if IS_WINDOWS:
        b = VENV / "Scripts"
        return b, b / "python.exe", b / "pip.exe", b / "headroom.exe"
    b = VENV / "bin"
    return b, b / "python", b / "pip", b / "headroom"


def headroom_cmd() -> list[str] | None:
    """Headroom 的启动命令：优先 venv 里的 console script，退化到 python -m headroom。"""
    _, vpy, _, hexe = venv_paths()
    if hexe.exists():
        return [str(hexe)]
    if vpy.exists():
        try:
            r = subprocess.run([str(vpy), "-m", "headroom", "--version"],
                               capture_output=True, text=True, timeout=30)
            if r.returncode == 0:
                return [str(vpy), "-m", "headroom"]
        except Exception:
            pass
    return None


# ─────────────────────────────────────────────────────────────
# KEY=VALUE 配置文件
def get_env(key: str, path: Path) -> str:
    try:
        for line in path.read_text(encoding="utf-8").splitlines():
            if line.startswith(key + "="):
                return line.split("=", 1)[1].strip()
    except FileNotFoundError:
        pass
    return ""


def set_env(key: str, value: str, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    try:
        text = path.read_text(encoding="utf-8")
    except FileNotFoundError:
        text = ""
    line = f"{key}={value}"
    if re.search(rf"^{re.escape(key)}=.*$", text, flags=re.M):
        text = re.sub(rf"^{re.escape(key)}=.*$", lambda m: line, text, flags=re.M)
    else:
        text = (text.rstrip("\n") + "\n" + line + "\n") if text else line + "\n"
    path.write_text(text, encoding="utf-8")


def read_env_dict(path: Path) -> dict:
    d: dict[str, str] = {}
    try:
        for line in path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            d[k.strip()] = v.strip()
    except FileNotFoundError:
        pass
    return d


def effective_api_key() -> str:
    """面板里一旦有 API Key，命令行的 --api-key 就不再被接受 → 优先返回面板 Key。"""
    launcher = get_env("API_KEY", HUB_ENV)
    try:
        data = json.loads((HUB_ACCOUNTS / "settings.json").read_text(encoding="utf-8"))
    except Exception:
        data = {}
    for entry in (data.get("api_keys") or []):
        if isinstance(entry, dict) and entry.get("enabled", True) is not False and entry.get("key"):
            return entry["key"]
    if data.get("api_key"):
        return data["api_key"]
    return launcher


# ─────────────────────────────────────────────────────────────
# 进程 / 端口
def pid_alive(pid: int) -> bool:
    if not pid or pid <= 0:
        return False
    if IS_WINDOWS:
        # ⚠️ 不能用 os.kill(pid, 0) —— Windows 上非 CTRL_* 的 sig 会直接 TerminateProcess，
        #    「探测存活」会把进程杀掉。用 OpenProcess + GetExitCodeProcess。
        PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
        STILL_ACTIVE = 259
        try:
            k32 = ctypes.windll.kernel32
            h = k32.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, False, int(pid))
            if not h:
                return False
            code = ctypes.c_ulong()
            got = k32.GetExitCodeProcess(h, ctypes.byref(code))
            k32.CloseHandle(h)
            return bool(got) and code.value == STILL_ACTIVE
        except Exception:
            return False
    # POSIX：先排掉「僵尸」——子进程死了但还没被 reap 时，os.kill(pid, 0) 依然成功，
    # 会被误判成「还活着」（实测踩过：stop 报「已停止」但进程其实早死了）。
    try:
        wpid, _ = os.waitpid(pid, os.WNOHANG)
        if wpid == pid:
            return False            # 是我们的子进程且已是僵尸，顺手 reap 掉
    except ChildProcessError:
        pass                        # 不是我们的子进程（守护进程重启后的常态），继续往下判
    except OSError:
        pass
    try:
        os.kill(pid, 0)
    except OSError:
        return False
    # 别的进程也可能是僵尸（真机 ps 可用；沙箱里 ps 被禁会返回空 → 按活着算）
    if _ps_state(pid).upper().startswith("Z"):
        return False
    return True


def _ps_state(pid: int) -> str:
    try:
        return subprocess.run(["ps", "-o", "state=", "-p", str(pid)],
                              capture_output=True, text=True).stdout.strip()
    except Exception:
        return ""


def kill_pid(pid: int, tree: bool = True) -> bool:
    if not pid_alive(pid):
        return False
    try:
        if IS_WINDOWS:
            # /T 连子进程一起收（headroom 会 fork worker），/F 强制
            args = ["taskkill", "/PID", str(pid), "/F"] + (["/T"] if tree else [])
            return subprocess.call(args, stdout=subprocess.DEVNULL,
                                   stderr=subprocess.DEVNULL) == 0
        os.kill(pid, signal.SIGTERM)
        for _ in range(20):           # 最多等 2s，让进程体面退出
            if not pid_alive(pid):
                return True
            time.sleep(0.1)
        os.kill(pid, signal.SIGKILL)
        return True
    except Exception:
        return False


def start_process(cmd: list, cwd: Path, logfile: Path, env: dict | None = None) -> int:
    """脱离父进程启动（父进程退出后仍在跑），返回 pid。"""
    logfile.parent.mkdir(parents=True, exist_ok=True)
    fh = open(logfile, "ab")
    kwargs: dict = dict(stdin=subprocess.DEVNULL, stdout=fh, stderr=subprocess.STDOUT,
                        cwd=str(cwd), env=env)
    if IS_WINDOWS:
        kwargs["creationflags"] = (subprocess.DETACHED_PROCESS
                                  | subprocess.CREATE_NEW_PROCESS_GROUP
                                  | subprocess.CREATE_NO_WINDOW)
    else:
        kwargs["start_new_session"] = True
    p = subprocess.Popen([str(c) for c in cmd], **kwargs)
    fh.close()
    return p.pid


def port_open(port: int) -> bool:
    s = socket.socket()
    s.settimeout(0.4)
    try:
        return s.connect_ex(("127.0.0.1", int(port))) == 0
    finally:
        s.close()


def wait_port(port: int, budget_s: float) -> bool:
    deadline = time.time() + budget_s
    while time.time() < deadline:
        if port_open(port):
            return True
        time.sleep(0.5)
    return False


def process_name(pid: int) -> str:
    """拿进程名（Windows 用 tasklist；POSIX 走 lsof，因为沙箱/最小环境里 ps 常被禁）。"""
    if IS_WINDOWS:
        try:
            out = subprocess.run(["tasklist", "/FI", f"PID eq {pid}", "/FO", "CSV", "/NH"],
                                 capture_output=True, text=True, errors="ignore").stdout
            m = re.match(r'\s*"([^"]+)"', out)
            return m.group(1).lower() if m else ""
        except Exception:
            return ""
    for owner_pid, name in _lsof_owners(None):
        if owner_pid == pid and name:
            return name
    return ""


def _lsof_owners(port: int | None) -> list:
    """lsof 的机器可读输出（-Fpc）：p<pid> / c<命令名> / f<fd> 逐行。
    port=None 时列出所有监听端口（用来按 pid 反查名字）。"""
    lsof = shutil.which("lsof")
    if not lsof:
        return []
    args = [lsof, "-nP", "-Fpc"]
    args += [f"-iTCP:{port}", "-sTCP:LISTEN"] if port is not None else ["-iTCP", "-sTCP:LISTEN"]
    try:
        out = subprocess.run(args, capture_output=True, text=True).stdout
    except Exception:
        return []
    pairs: list = []
    cur: int | None = None
    for line in out.splitlines():
        if line.startswith("p"):
            try:
                cur = int(line[1:])
            except ValueError:
                cur = None
        elif line.startswith("c") and cur is not None:
            pairs.append((cur, line[1:].lower()))
            cur = None
    return pairs


def port_owners(port: int) -> list:
    """返回监听该端口的 [(pid, 进程名)] —— 名字用于误杀守卫。"""
    if not IS_WINDOWS:
        return _lsof_owners(port)
    pairs: list = []
    try:
        out = subprocess.run(["netstat", "-ano", "-p", "TCP"], capture_output=True,
                             text=True, errors="ignore").stdout
        seen: set[int] = set()
        for line in out.splitlines():
            parts = line.split()
            if len(parts) >= 5 and parts[3].upper() == "LISTENING" \
                    and parts[1].endswith(":" + str(port)):
                try:
                    pid = int(parts[4])
                except ValueError:
                    continue
                if pid not in seen:
                    seen.add(pid)
                    pairs.append((pid, process_name(pid)))
    except Exception:
        pass
    return pairs


def looks_like_ours(name: str) -> bool:
    """只对「像是我们自己的进程」做端口清理，别把占了同端口的别的程序干掉。
    hub/headroom 都是 Python 进程；headroom 的 console script 在 Windows 上叫 headroom.exe。
    名字拿不到（ps/lsof 都不可用）时**保守跳过**，宁可漏清也不错杀。"""
    n = (name or "").lower()
    return n.startswith("python") or n.startswith("headroom")


def port_pids(port: int) -> list:
    """谁在监听这个端口（只有 pid 的简便版）。"""
    pids = sorted({pid for pid, _ in port_owners(port)})
    if pids or IS_WINDOWS:
        return pids
    # lsof 不可用时的退化路径
    lsof = shutil.which("lsof")
    if lsof:
        try:
            out = subprocess.run([lsof, "-nP", f"-iTCP:{port}", "-sTCP:LISTEN", "-t"],
                                 capture_output=True, text=True).stdout
            return sorted({int(x) for x in out.split() if x.isdigit()})
        except Exception:
            pass
    return []


def read_pids() -> dict:
    try:
        return json.loads(PIDS.read_text(encoding="utf-8"))
    except Exception:
        return {}


def write_pids(hub: int, headroom: int) -> None:
    PIDS.write_text(json.dumps({"hub": hub, "headroom": headroom}), encoding="utf-8")


# ─────────────────────────────────────────────────────────────
# 网络 / git
def find_git_proxy() -> str:
    if os.environ.get("GIT_PROXY"):
        return os.environ["GIT_PROXY"]
    for p in (10080, 7890, 1087, 6152):
        s = socket.socket()
        s.settimeout(0.3)
        try:
            if s.connect_ex(("127.0.0.1", p)) == 0:
                return f"http://127.0.0.1:{p}"
        finally:
            s.close()
    return ""


def sync_hub() -> bool:
    """原地 fetch，不依赖 rm -rf（容忍上次中断留下的半成品目录）。
    网络三级降级：直连 → HTTP/1.1 → 本地代理。"""
    HUB_DIR.mkdir(parents=True, exist_ok=True)
    git = shutil.which("git")
    if not git:
        return False
    # 用 rev-parse 判定「是不是合法 git 仓库」——只看 .git 目录会被空 .git 骗过
    if subprocess.call([git, "-C", str(HUB_DIR), "rev-parse", "--git-dir"],
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL) != 0:
        subprocess.call([git, "-C", str(HUB_DIR), "init", "-q"],
                        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    has_remote = subprocess.call([git, "-C", str(HUB_DIR), "remote", "get-url", "origin"],
                                 stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL) == 0
    if has_remote:
        subprocess.call([git, "-C", str(HUB_DIR), "remote", "set-url", "origin", HUB_REPO],
                        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    else:
        subprocess.call([git, "-C", str(HUB_DIR), "remote", "add", "origin", HUB_REPO],
                        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    strategies: list[list[str]] = [[], ["-c", "http.version=HTTP/1.1"]]
    proxy = find_git_proxy()
    if proxy:
        strategies.append(["-c", f"http.proxy={proxy}", "-c", "http.version=HTTP/1.1"])

    for extra in strategies:
        rc = subprocess.call([git, "-C", str(HUB_DIR), *extra, "fetch", "--depth", "1",
                              "origin", HUB_BRANCH],
                             stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        if rc == 0:
            subprocess.call([git, "-C", str(HUB_DIR), "-c", "advice.detachedHead=false",
                             "checkout", "-q", "-f", "FETCH_HEAD"],
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            return True
    return False


def hub_head() -> str:
    git = shutil.which("git")
    if not git:
        return ""
    try:
        out = subprocess.run([git, "-C", str(HUB_DIR), "log", "-1", "--format=%h %s"],
                             capture_output=True, text=True).stdout.strip()
        return out[:58]
    except Exception:
        return ""


def fetch_json(url: str, timeout: float = 5.0):
    try:
        with urllib.request.urlopen(url, timeout=timeout) as r:
            return json.loads(r.read().decode())
    except Exception as e:
        return {"_error": str(e)}


# ─────────────────────────────────────────────────────────────
# 浏览器
def open_url(url: str) -> None:
    try:
        if webbrowser.open(url):
            return
    except Exception:
        pass
    try:
        if IS_WINDOWS:
            os.startfile(url)          # type: ignore[attr-defined]
        elif IS_MACOS:
            subprocess.call(["open", url])
        else:
            subprocess.call(["xdg-open", url])
    except Exception:
        pass


# ─────────────────────────────────────────────────────────────
# 动作：start
def do_start() -> int:
    RUNTIME.mkdir(parents=True, exist_ok=True)
    LOGS.mkdir(parents=True, exist_ok=True)
    HUB_ACCOUNTS.mkdir(parents=True, exist_ok=True)
    HUB_USAGE.mkdir(parents=True, exist_ok=True)

    if not shutil.which("git"):
        bad("找不到 git —— 需要它来拉取 workbuddy2api-hub 源码")
        return 1

    # ── 1. 准备 hub 源码
    step(1, "准备 workbuddy2api-hub 源码")
    if not (HUB_DIR / "wb_proxy.py").exists():
        info("拉取 workbuddy2api-hub 源码（零依赖，约几 MB）…")
        if not sync_hub():
            bad("拉取失败。若网络受限，先设代理再重试：GIT_PROXY=http://127.0.0.1:端口")
            return 1
        if not (HUB_DIR / "wb_proxy.py").exists():
            bad("拉取后仍缺 wb_proxy.py，请检查仓库状态")
            return 1
        ok(f"源码就绪（{hub_head()}）")
    else:
        ok(f"源码已存在（{HUB_DIR}）")
        if sync_hub():
            ok(f"已同步：{hub_head()}")
        else:
            warn("同步失败（离线或代理受限），继续用本地当前版本")

    # ── 2. 网关配置与密钥
    step(2, "生成网关配置与密钥")
    HUB_ENV.touch(exist_ok=True)
    set_env("HUB_PORT", str(HUB_PORT), HUB_ENV)

    if os.environ.get("API_KEY"):
        set_env("API_KEY", os.environ["API_KEY"], HUB_ENV)
        ok("API_KEY 取自环境变量")
    elif not get_env("API_KEY", HUB_ENV):
        key = "sk-wb-" + secrets.token_hex(20)
        set_env("API_KEY", key, HUB_ENV)
        info(f"已生成随机 API_KEY（写入 {HUB_ENV}）：")
        print(f"      {key}")
    else:
        ok(f"复用 {HUB_ENV} 里已有的 API_KEY")

    # 面板密码：默认 admin 太弱。只用字母数字——token_urlsafe 含 "-"，以 "-" 开头会被
    # hub 的 argparse 当成选项而不是值（实测 "expected one argument"）。
    cur_pw = get_env("PANEL_PASSWORD", HUB_ENV)
    if cur_pw.startswith("-"):
        cur_pw = ""
    if os.environ.get("PANEL_PASSWORD"):
        set_env("PANEL_PASSWORD", os.environ["PANEL_PASSWORD"], HUB_ENV)
    elif not cur_pw:
        pw = "".join(secrets.choice(string.ascii_letters + string.digits) for _ in range(16))
        set_env("PANEL_PASSWORD", pw, HUB_ENV)
        info(f"已生成看板访问密码（写入 {HUB_ENV}）：{pw}")
    else:
        ok(f"复用 {HUB_ENV} 里已有的看板密码")
    if not IS_WINDOWS:
        try:
            os.chmod(HUB_ENV, 0o600)     # Windows 用 ACL，chmod 无效
        except Exception:
            pass

    # ── 3. Headroom
    step(3, "准备 Headroom（上下文压缩层）")
    _, vpy, vpip, _ = venv_paths()
    hexe = headroom_cmd()
    if hexe is not None:
        try:
            ver = subprocess.run(hexe + ["--version"], capture_output=True, text=True,
                                 timeout=60).stdout.strip().splitlines()
            ok(f"Headroom 已就绪（{ver[0] if ver else 'ok'}）")
        except Exception:
            ok("Headroom 已就绪")
    else:
        if not vpip.exists():
            if VENV.exists():
                shutil.rmtree(VENV, ignore_errors=True)
            info(f"创建 venv（{PYTHON_BIN}）")
            if subprocess.call([PYTHON_BIN, "-m", "venv", str(VENV)]) != 0:
                bad("venv 创建失败")
                return 1
            _, vpy, vpip, _ = venv_paths()
        okc = run_spin(f"安装 {PIP_SPEC}（首次约 1–2 分钟，hnswlib 需本地编译）",
                       [str(vpip), "install", "-q", "--upgrade", "pip"],
                       log=LOGS / "headroom-install.log")
        if okc != 0:
            bad(f"pip 升级失败，看日志：{LOGS / 'headroom-install.log'}")
            return 1
        rc = run_spin(f"安装 {PIP_SPEC}",
                      [str(vpip), "install", "-q", PIP_SPEC],
                      log=LOGS / "headroom-install.log")
        if rc != 0:
            bad(f"Headroom 安装失败，看日志：{LOGS / 'headroom-install.log'}")
            if IS_WINDOWS:
                info("Windows 若卡在 hnswlib 编译：装 Visual Studio Build Tools（C++ 生成工具）后重试，"
                     "或 pip install --only-binary :all: hnswlib 先拿到 wheel")
            return 1
        ok("Headroom 安装完成")

    if headroom_cmd() is None:
        bad("venv 里找不到 headroom 可执行文件或模块")
        return 1

    # ── 4. headroom.env
    step(4, "生成 headroom.env")
    lines = [
        f"HEADROOM_HOST={HEADROOM_HOST}",
        f"HEADROOM_PORT={HEADROOM_PORT}",
        f"OPENAI_TARGET_API_URL=http://127.0.0.1:{HUB_PORT}",
        "HEADROOM_TELEMETRY=off",
        f"HEADROOM_MODE={HEADROOM_MODE}",
    ]
    if os.environ.get("HEADROOM_BUDGET"):
        lines.append(f"HEADROOM_BUDGET={os.environ['HEADROOM_BUDGET']}")
    HEADROOM_ENV.write_text("\n".join(lines) + "\n", encoding="utf-8")
    ok(f"headroom.env 已生成（OPENAI_TARGET_API_URL=http://127.0.0.1:{HUB_PORT}，mode={HEADROOM_MODE}）")
    if HEADROOM_MODE == "cache":
        info("cache 模式（推荐，官方 coding 预设默认）：守住上游 prompt cache（命中单价仅为未命中的 2%），"
             "同时压缩每轮新到的增量；「已省 token」多为 0 属正常 —— 那部分是冻结前缀，省在缓存折扣里")
    elif HEADROOM_MODE == "token":
        warn("token 模式：会把全部历史都压掉（省得多），代价是首个请求要加载 Kompress 模型（实测 32s）；"
             "且压缩前缀一旦逐轮不稳定，上游缓存会失效重算")
    else:
        warn(f"未知模式 {HEADROOM_MODE} —— Headroom 只认 cache / token，已按默认值回落")

    # ── 5. 启动（先清理残留旧实例，保证幂等）
    step(5, "启动服务")
    do_stop(quiet=True, with_dashboard=False)

    api_key = get_env("API_KEY", HUB_ENV)
    panel_pw = get_env("PANEL_PASSWORD", HUB_ENV)

    panel_args: list[str] = []
    if not _panel_password_matches(panel_pw):
        panel_args = ["--panel-password", panel_pw]
        info("面板密码与已存记录不一致（或首次设置），本次会写入 settings.json")

    info(f"启动 workbuddy2api-hub (:{HUB_PORT})…")
    hub_pid = start_process(
        [PYTHON_BIN, "wb_proxy.py",
         "--host", "127.0.0.1", "--port", str(HUB_PORT),
         "--api-key", api_key, *panel_args,
         "--accounts-dir", str(HUB_ACCOUNTS), "--usage-dir", str(HUB_USAGE)],
        cwd=HUB_DIR, logfile=LOGS / "hub.log")

    info(f"启动 Headroom 代理 (:{HEADROOM_PORT})…")
    hr_env = dict(os.environ)
    hr_env.update(read_env_dict(HEADROOM_ENV))
    hr_pid = start_process(
        headroom_cmd() + ["proxy", "--host", HEADROOM_HOST, "--port", str(HEADROOM_PORT)],
        cwd=SKILL_DIR, logfile=LOGS / "headroom.log", env=hr_env)

    write_pids(hub_pid, hr_pid)
    info(f"pids: hub={hub_pid} headroom={hr_pid}")

    # ── 6. 自检
    step(6, "自检")
    if wait_port(HUB_PORT, 60):
        ok(f"hub 端口 {HUB_PORT} 已监听")
    else:
        bad(f"hub 未就绪 → 看 {LOGS / 'hub.log'}")
    if wait_port(HEADROOM_PORT, 180):
        ok(f"headroom 端口 {HEADROOM_PORT} 已监听")
    else:
        bad(f"headroom 未就绪 → 看 {LOGS / 'headroom.log'}")

    health = fetch_json(f"http://127.0.0.1:{HUB_PORT}/health")
    total = health.get("accounts", 0) if isinstance(health, dict) else 0
    ready = health.get("accounts_ready", 0) if isinstance(health, dict) else 0
    if isinstance(ready, int) and ready >= 1:
        ok(f"账号池就绪：{total} 个账号，{ready} 个可用")
    else:
        warn("账号池为空 —— 还不能真正调用模型")
        info(f"补账号：{launcher_hint()} login（看板里点 OAuth 登录，一次即可）")

    # ── 7. 客户端配置
    step(7, "客户端配置")
    current = effective_api_key()
    source = "本脚本生成（hub.env）" if current == api_key else "看板设置的 API Key（已优先生效）"
    print(f"""
══════════════════════════════════════════════════════════
 iskill-headroom-workbuddy 已启动
──────────────────────────────────────────────────────────
 链路：客户端 → Headroom(:{HEADROOM_PORT} 压缩) → hub(:{HUB_PORT} 转换) → 官方模型

 WorkBuddy 客户端「添加模型 → 自定义」：
   接口地址 : http://localhost:{HEADROOM_PORT}/v1/chat/completions
   API Key  : {current}
              （来源：{source}）
   模型名称 : 任意 hub 列出的模型 ID（见 http://127.0.0.1:{HUB_PORT}/v1/models）

 用量看板   : http://127.0.0.1:{HUB_PORT}/
   面板密码 : {panel_pw}
   （账号增删、API Key 管理、用量统计、签到任务都在这里）

 省 token   : {launcher_hint()} status
 加账号     : {launcher_hint()} login
 日志       : {LOGS}
 停止       : {launcher_hint()} stop
════════════════════════════════════════════════════════""")
    return 0


def _panel_password_matches(panel_pw: str) -> bool:
    """hub 的 set_panel_password() 是无条件覆盖写 settings.json；只要传了 --panel-password
    每次启动都会写盘，在只读/受限目录会被文件策略拒绝导致 hub 起不来。所以只在密码不一致时才传。"""
    try:
        sys.path.insert(0, str(HUB_DIR))
        import wb_settings  # type: ignore
        return bool(wb_settings.verify_panel_password(str(HUB_ACCOUNTS), panel_pw))
    except Exception:
        return False


# ─────────────────────────────────────────────────────────────
# 动作：stop
def do_stop(quiet: bool = False, with_dashboard: bool = False) -> int:
    def log(msg: str) -> None:
        print(f"[iskill-headroom-workbuddy] {msg}")

    killed_any = False
    d = read_pids()
    for name, pid in list(d.items()):
        try:
            pid = int(pid)
        except (TypeError, ValueError):
            continue
        if pid_alive(pid):
            if kill_pid(pid):
                killed_any = True
                if not quiet:
                    log(f"已停止 {name}（PID {pid}）")
            else:
                if not quiet:
                    log(f"停止 {name}（PID {pid}）失败")
        else:
            if not quiet:
                log(f"{name}（PID {pid}）已不在运行")
    if PIDS.exists():
        PIDS.unlink()

    # 按端口兜底：pids.json 可能丢失或过期。**只清 Python/headroom 进程** ——
    # 同一端口上可能是别人的程序（甚至别人也监听 8788），误杀代价太大。
    for port, label in ((HUB_PORT, "hub"), (HEADROOM_PORT, "headroom")):
        for pid, name in port_owners(port):
            if not looks_like_ours(name):
                if not quiet:
                    log(f"端口 {port} 被 PID {pid}（{name or '名字未知'}）占用，不像本服务，跳过（{label}）")
                continue
            if kill_pid(pid):
                killed_any = True
                if not quiet:
                    log(f"端口 {port} 被 PID {pid}（{name}）占用，已停止（{label}）")

    if with_dashboard:
        do_dashboard(action="stop")

    if not quiet:
        log("已清理 pids.json。" if killed_any else "没有在运行的服务。")
    return 0


# ─────────────────────────────────────────────────────────────
# 动作：status
def do_status(raw: bool = False) -> int:
    print("[iskill-headroom-workbuddy] 运行状态")
    print(f"  平台          : {sys.platform}　Python {sys.version.split()[0]}（{PYTHON_BIN}）")
    print(f"  运行时目录    : {RUNTIME}")

    d = read_pids()
    if d:
        for name, pid in d.items():
            try:
                alive = pid_alive(int(pid))
            except (TypeError, ValueError):
                alive = False
            print(f"  {'%-13s' % (name)} PID {pid}　{'运行中' if alive else '已退出'}")
    else:
        print(f"  未运行（无 pids.json）→ 启动：{launcher_hint()} start")

    print(f"\n── 网关 hub (:{HUB_PORT}) ──")
    health = fetch_json(f"http://127.0.0.1:{HUB_PORT}/health", timeout=4)
    if raw:
        print(json.dumps(health, ensure_ascii=False, indent=1))
    elif isinstance(health, dict) and "_error" in health:
        print(f"  hub 未响应：{health['_error']}")
    else:
        total = health.get("accounts", 0)
        ready = health.get("accounts_ready", 0)
        print(f"  账号池        : 共 {total} 个，可用 {ready} 个")
        print(f"  出口区域      : {health.get('realm') or '-'} ({health.get('domain') or '-'})")
        print(f"  /v1 鉴权      : {'需要 API Key' if health.get('api_key_required') else '关闭（本机可任意填）'}")
        if not total and not ready:
            print(f"  [!] 账号池为空 —— 先跑：{launcher_hint()} login 添加账号")
        try:
            data = json.loads((HUB_ACCOUNTS / "settings.json").read_text(encoding="utf-8"))
        except Exception:
            data = {}
        panel_key = None
        for entry in (data.get("api_keys") or []):
            if isinstance(entry, dict) and entry.get("enabled", True) is not False and entry.get("key"):
                panel_key = entry["key"]
                break
        if not panel_key and data.get("api_key"):
            panel_key = data["api_key"]
        if panel_key:
            print(f"  客户端 Key    : {panel_key}  （来自看板设置，优先于命令行）")
        else:
            print(f"  客户端 Key    : {get_env('API_KEY', HUB_ENV) or '???'}  （本脚本生成，存于 hub.env）")

    print(f"\n── Headroom 压缩 (:{HEADROOM_PORT}) ──")
    stats = fetch_json(f"http://127.0.0.1:{HEADROOM_PORT}/stats", timeout=4)
    if isinstance(stats, dict) and "_error" in stats:
        print("  (Headroom 未响应，可能已停止)")
    elif raw:
        print(json.dumps(stats, ensure_ascii=False, indent=1))
    else:
        s = stats.get("summary", {}) or {}
        req = stats.get("requests", {}) or {}
        tok = stats.get("tokens", {}) or {}
        comp = s.get("compression", {}) or {}
        print(f"  请求          : {req.get('total', 0)}  （压缩 {comp.get('requests_compressed', 0)} 次"
              f" / 失败 {req.get('failed', 0)}）")
        print(f"  压缩前 token  : {tok.get('total_before_compression', 0)}")
        print(f"  已省 token    : {tok.get('saved', 0)}")
        print(f"  省流比例      : {float(tok.get('savings_percent') or 0):.1f}%")

    # 遗留抓包开关提醒（macOS 专属能力，忘了关会持续写敏感数据）
    netlog = RUNTIME / "netlog.json"
    cap_on = port_open(9222)
    if not cap_on and IS_MACOS and netlog.exists():
        try:
            out = subprocess.run(["lsof", "-nP", str(netlog)], capture_output=True, text=True).stdout
            cap_on = ("WorkBuddy" in out) or ("Electron" in out)
        except Exception:
            pass
    if cap_on:
        print("\n⚠️  桌面端可能仍在抓包（CDP :9222 / netlog 持续写入）")
        if netlog.exists():
            print(f"    netlog: {netlog.stat().st_size / 1048576:.1f} MB  含 Authorization / Cookie 明文")
        print(f"    关闭（仅 macOS）: bash {SKILL_DIR}/references/legacy-token-capture/enable_cdp.sh --restore")
    elif netlog.exists():
        print(f"\n提示: 抓包已停，但残留 netlog 文件 {netlog.stat().st_size / 1048576:.1f} MB 还在（可安全删除）")

    print("\n── 入口 ──")
    print(f"  客户端地址 : http://localhost:{HEADROOM_PORT}/v1/chat/completions")
    print(f"  用量看板   : http://127.0.0.1:{HUB_PORT}/   （面板密码：{get_env('PANEL_PASSWORD', HUB_ENV) or 'admin'}）")
    print(f"  加账号     : {launcher_hint()} login")
    print(f"  原始 JSON  : {launcher_hint()} status --raw")
    return 0


# ─────────────────────────────────────────────────────────────
# 动作：login（OAuth）
def do_login(no_wait: bool = False, timeout: int = 600) -> int:
    port = int(get_env("HUB_PORT", HUB_ENV) or HUB_PORT)
    panel_pw = get_env("PANEL_PASSWORD", HUB_ENV) or "admin"
    dash = f"http://127.0.0.1:{port}/"

    print("════ 添加 WorkBuddy 上游账号 ════")
    if not port_open(port):
        bad(f"hub 没在 {port} 上监听 —— 先跑：{launcher_hint()} start")
        return 1

    print(f"\n  看板地址 : {dash}")
    print(f"  面板密码 : {panel_pw}")
    print("""
  步骤：
    1. 浏览器打开上面的地址，输入面板密码
    2. 点「+ 添加账号 (OAuth)」/「Login new account」
    3. 选区域：🌐 国际版 或 🇨🇳 国内版
    4. 在弹出的官方页面完成登录 → 程序自动检测回调并入库

  提示：国内版与国际版是两套独立账号池，常用哪个就先加哪个。
        （账号凭证只会留在本机 %s）
""" % HUB_ACCOUNTS)

    open_url(dash)
    info("已尝试打开浏览器（若没弹出请手动打开上面的地址）")

    if no_wait:
        info(f"--no-wait：完成登录后跑 {launcher_hint()} status 查看账号池")
        return 0

    print()
    info(f"等待账号入库（最多 {timeout}s，Ctrl+C 可中断）…")
    elapsed = 0
    last = ""
    while elapsed < timeout:
        h = fetch_json(f"http://127.0.0.1:{port}/health", timeout=4)
        total, ready = h.get("accounts", 0), h.get("accounts_ready", 0)
        realm = h.get("realm", "-")
        cur = f"total={total} ready={ready} realm={realm}"
        if cur != last:
            sys.stdout.write(f"\r  [·] {cur:<50}")
            sys.stdout.flush()
            last = cur
        if isinstance(ready, int) and ready >= 1:
            print()
            ok(f"账号已入库：共 {total} 个，可用 {ready} 个（当前出口区域：{realm}）")
            print(f"\n  客户端 API Key : {effective_api_key()}")
            print("  （若在面板里新增了 API Key，以面板里的为准 —— hub 会优先只认面板 Key）")
            print()
            info("提示：浏览器会话与看板会话相互独立；服务已就绪，可直接在客户端发消息了。")
            return 0
        time.sleep(2)
        elapsed += 2

    print()
    bad(f"等待超时（{timeout}s）：账号仍未入库。")
    info("排查：")
    info("  ① 确认点的是「添加账号 (OAuth)」而不是别的入口")
    info("  ② 登录页是否被浏览器拦截弹窗")
    info(f"  ③ 看 hub 日志：{LOGS / 'hub.log'}")
    info(f"  ④ 重试：{launcher_hint()} login")
    return 1


# ─────────────────────────────────────────────────────────────
# 动作：dashboard（React 控制台）
DASH_DIR = SKILL_DIR / "dashboard"
DIST_DIR = DASH_DIR / "dist"
DASH_PIDFILE = RUNTIME / "dashboard.pid"


def find_npm() -> str | None:
    for name in (["npm.cmd", "npm"] if IS_WINDOWS else ["npm"]):
        p = shutil.which(name)
        if p:
            return p
    for c in ("/opt/homebrew/bin/npm", "/usr/local/bin/npm"):
        if Path(c).exists():
            return c
    return None


def dash_pid() -> int | None:
    try:
        pid = int(DASH_PIDFILE.read_text().strip())
        if pid_alive(pid):
            return pid
    except Exception:
        pass
    pids = port_pids(DASH_PORT)
    return pids[0] if pids else None


def _build_dashboard() -> bool:
    npm = find_npm()
    if not npm:
        bad("找不到 npm —— 装 Node.js 后重试，或手动：cd dashboard && npm install && npm run build")
        return False
    nodebin = str(Path(npm).parent)
    LOGS.mkdir(parents=True, exist_ok=True)
    info("构建前端（首次要 npm install，约 1 分钟）…")
    env = dict(os.environ)
    env["PATH"] = nodebin + os.pathsep + env.get("PATH", "")
    bl = LOGS / "dashboard-build.log"
    if not (DASH_DIR / "node_modules").exists():
        if run_spin("npm install", [npm, "install"], cwd=DASH_DIR, env=env, log=bl) != 0:
            bad(f"npm install 失败，看日志：{bl}")
            return False
    if run_spin("npm run build", [npm, "run", "build"], cwd=DASH_DIR, env=env, log=bl) != 0:
        bad(f"构建失败，看日志：{bl}")
        return False
    ok(f"构建完成：{DIST_DIR}")
    return True


def do_dashboard(action: str = "start", foreground: bool = False) -> int:
    def log(msg: str) -> None:
        print(f"[iskill-headroom-workbuddy] {msg}")

    if action == "build":
        return 0 if _build_dashboard() else 1

    if action == "stop":
        pid = dash_pid()
        if pid:
            kill_pid(pid) and log(f"已停止控制台（PID {pid}）") or log(f"停止失败（PID {pid}）")
        else:
            log("控制台未在运行")
        DASH_PIDFILE.unlink(missing_ok=True)
        return 0

    if action == "status":
        pid = dash_pid()
        if pid:
            log(f"运行中：PID {pid}　http://127.0.0.1:{DASH_PORT}/")
        else:
            log("未运行")
        log("前端产物：已构建" if (DIST_DIR / "index.html").exists() else "前端产物：未构建（跑 dashboard --build）")
        return 0

    if not (DIST_DIR / "index.html").exists():
        if not _build_dashboard():
            warn("控制台仍会启动，但页面会提示需要先构建")

    if dash_pid():
        log(f"控制台已在运行：PID {dash_pid()}　http://127.0.0.1:{DASH_PORT}/")
    else:
        LOGS.mkdir(parents=True, exist_ok=True)
        cmd = [PYTHON_BIN, str(SKILL_DIR / "scripts" / "dashboard.py"), "--port", str(DASH_PORT)]
        if foreground:
            return subprocess.call(cmd)
        pid = start_process(cmd, cwd=SKILL_DIR, logfile=LOGS / "dashboard.log")
        DASH_PIDFILE.write_text(str(pid))
        time.sleep(1.2)
        if pid_alive(pid):
            log(f"控制台已启动：PID {pid}")
            log(f"地址：http://127.0.0.1:{DASH_PORT}/   （日志：{LOGS / 'dashboard.log'}）")
        else:
            bad(f"启动失败，看看日志：{LOGS / 'dashboard.log'}")
            return 1

    open_url(f"http://127.0.0.1:{DASH_PORT}/")
    log("已尝试打开浏览器")
    return 0


# ─────────────────────────────────────────────────────────────
# 动作：doctor（环境体检）
def do_doctor() -> int:
    print("[iskill-headroom-workbuddy] 环境体检")
    print(f"  平台          : {sys.platform}  ({'Windows' if IS_WINDOWS else 'macOS' if IS_MACOS else 'Linux'})")
    print(f"  Python        : {sys.version.split()[0]}  →  {PYTHON_BIN}")
    print(f"  运行时目录    : {RUNTIME}  ({'存在' if RUNTIME.exists() else '不存在（首次 start 会创建）'})")
    _, vpy, vpip, _ = venv_paths()
    print(f"  venv          : {'已建' if VENV.exists() else '未建'}  ({venv_paths()[0]})")
    print(f"  Headroom      : {'已装' if headroom_cmd() else '未装'}")
    print()
    print("  外部依赖：")
    for label, exe in (("git", "git"), ("node", "node"), ("npm", "npm"), ("ffmpeg", "ffmpeg")):
        p = shutil.which(exe)
        print(f"    {label:<8}: {p or '✗ 未找到（非必需，视用途）'}")
    print()
    print("  端口：")
    for label, port in (("headroom", HEADROOM_PORT), ("hub", HUB_PORT), ("dashboard", DASH_PORT)):
        if port_open(port):
            who = port_pids(port)
            print(f"    {port:<6}: 已占用（PIDs {who}）　{label}")
        else:
            print(f"    {port:<6}: 空闲　{label}")
    print()
    print("  双击入口：")
    for f in ("hwb.command", "hwb.ps1", "hwb.cmd"):
        p = SKILL_DIR / f
        print(f"    {f:<14}: {'✓ 存在' if p.exists() else '—'}")
    print()
    print(f"  提示：非 macOS 平台没有剪贴板/抓包等苹果专属能力，功能不受影响。")
    return 0


# ─────────────────────────────────────────────────────────────
def launcher_hint(action: str = "") -> str:
    """给用户看的「怎么再调起来」提示，按平台给不同写法。"""
    base = "hwb.ps1" if IS_WINDOWS else "./hwb.command"
    return f"{base} {action}".strip()


def do_open_panel() -> int:
    port = int(get_env("HUB_PORT", HUB_ENV) or HUB_PORT)
    url = f"http://127.0.0.1:{port}/"
    if not port_open(port):
        bad(f"hub 没在 {port} 上监听 —— 先跑：{launcher_hint()} start")
        return 1
    open_url(url)
    ok(f"已打开用量看板：{url}（面板密码：{get_env('PANEL_PASSWORD', HUB_ENV) or 'admin'}）")
    return 0


# ─────────────────────────────────────────────────────────────
MENU = [
    ("1", "启动服务", lambda: do_start()),
    ("2", "停止服务", lambda: do_stop()),
    ("3", "重启服务", lambda: do_stop() or do_start()),
    ("4", "查看状态", lambda: do_status()),
    ("5", "打开控制台（React 控制台 :8786）", lambda: do_dashboard("start")),
    ("6", "添加上游账号（OAuth）", lambda: do_login()),
    ("7", "打开用量看板", lambda: do_open_panel()),
    ("8", "环境体检", lambda: do_doctor()),
]


def do_menu() -> int:
    print("""
╔══════════════════════════════════════════════════════════╗
║   iskill-headroom-workbuddy · 启动器                      ║
║   WorkBuddy 内置模型 → OpenAI 兼容 API（自带上下文压缩）   ║
╚══════════════════════════════════════════════════════════╝""")
    while True:
        print()
        for k, label, _ in MENU:
            print(f"   {k}) {label}")
        print("   0) 退出")
        print()
        try:
            choice = input("  请选择 [0-8]: ").strip()
        except (EOFError, KeyboardInterrupt):
            print()
            return 0
        if choice in ("0", "q", "Q", ""):
            return 0
        for k, _, fn in MENU:
            if k == choice:
                try:
                    fn()
                except KeyboardInterrupt:
                    print("\n  已中断")
                break
        else:
            print("  无效选择")


# ─────────────────────────────────────────────────────────────
def main() -> int:
    ap = argparse.ArgumentParser(
        prog="hwb.py", add_help=True,
        description="iskill-headroom-workbuddy 跨平台启动器（macOS / Windows / Linux）")
    sub = ap.add_subparsers(dest="action")
    sub.add_parser("start", help="启动两个服务")
    p_stop = sub.add_parser("stop", help="停止服务")
    p_stop.add_argument("--with-dashboard", action="store_true", help="连本地控制台一起停")
    sub.add_parser("restart", help="重启")
    p_status = sub.add_parser("status", help="查看状态")
    p_status.add_argument("--raw", action="store_true", help="输出原始 JSON")
    p_login = sub.add_parser("login", help="添加账号（OAuth）")
    p_login.add_argument("--no-wait", action="store_true", help="只打印看板地址，不等待")
    p_login.add_argument("--timeout", type=int, default=600, help="等待上限（秒），默认 600")
    p_dash = sub.add_parser("dashboard", help="本地控制台")
    p_dash.add_argument("--build", action="store_true", help="只构建前端")
    p_dash.add_argument("--stop", action="store_true", help="停止控制台")
    p_dash.add_argument("--status", action="store_true", help="查看控制台状态")
    p_dash.add_argument("--fg", action="store_true", help="前台运行")
    sub.add_parser("open", help="打开用量看板")
    sub.add_parser("doctor", help="环境体检")
    sub.add_parser("menu", help="交互菜单")

    args = ap.parse_args()
    a = args.action

    if a in (None, "menu"):
        return do_menu()
    if a == "start":
        return do_start()
    if a == "stop":
        return do_stop(with_dashboard=args.with_dashboard)
    if a == "restart":
        do_stop(quiet=True)
        return do_start()
    if a == "status":
        return do_status(raw=args.raw)
    if a == "login":
        return do_login(no_wait=args.no_wait, timeout=args.timeout)
    if a == "dashboard":
        if args.build:
            return do_dashboard("build")
        if args.stop:
            return do_dashboard("stop")
        if args.status:
            return do_dashboard("status")
        return do_dashboard("start", foreground=args.fg)
    if a == "open":
        return do_open_panel()
    if a == "doctor":
        return do_doctor()
    ap.print_help()
    return 2


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        print("\n已中断")
        sys.exit(130)
