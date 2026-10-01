#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""iskill-headroom-workbuddy · 本地控制台

零三方依赖（纯标准库），只看本机：

    浏览器 → 本控制台(:8786) → hub(:8788) 的 /health /v1/models /accounts ...
                            → Headroom(:8787) 的 /stats

设计上刻意「只读 + 少量写操作」：
  - 读取：链路健康、账号池、省 token 统计、生效 API Key、模型列表、日志
  - 写入：OAuth 加账号（服务端代持面板会话，用户只点一下）、手动保活 refresh

账号管理、API Key 管理、签到任务等深度操作，跳转 hub 自己的看板完成。
"""

import argparse
import json
import os
import socket
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HOME = os.path.expanduser("~")
RUNTIME = os.environ.get("ISKILL_RUNTIME") or os.path.join(HOME, ".iskill-headroom-workbuddy")
HUB_ENV = os.path.join(RUNTIME, "hub.env")
HUB_ACCOUNTS = os.path.join(RUNTIME, "hub-accounts")
PIDS_FILE = os.path.join(RUNTIME, "pids.json")
LOGS_DIR = os.path.join(RUNTIME, "logs")
SKILL_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
# 前端是 React + Vite + TS + Tailwind 工程（dashboard/），构建产物在 dashboard/dist，
# 由本服务直接托管 —— 运行时只需要 Python，不需要 Node。
DIST_DIR = os.path.join(SKILL_DIR, "dashboard", "dist")

MIME = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".ico": "image/x-icon",
    ".webp": "image/webp",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".ttf": "font/ttf",
    ".map": "application/json; charset=utf-8",
    ".txt": "text/plain; charset=utf-8",
}

DEFAULT_DASHBOARD_PORT = 8786


def read_kv(path):
    out = {}
    try:
        with open(path, encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, v = line.split("=", 1)
                out[k.strip()] = v.strip()
    except FileNotFoundError:
        pass
    return out


def port_open(port, host="127.0.0.1", timeout=0.6):
    s = socket.socket()
    s.settimeout(timeout)
    try:
        return s.connect_ex((host, int(port))) == 0
    except Exception:
        return False
    finally:
        s.close()


def process_alive(pid):
    try:
        os.kill(int(pid), 0)
        return True
    except Exception:
        return False


def http_json(url, method="GET", payload=None, headers=None, timeout=8):
    data = None
    hdrs = dict(headers or {})
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")
        hdrs.setdefault("Content-Type", "application/json")
    req = urllib.request.Request(url, data=data, headers=hdrs, method=method)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        raw = resp.read().decode("utf-8", "replace")
    try:
        return json.loads(raw)
    except Exception:
        return {"_raw": raw}


# ──────────────────────────────────────────────────────────────
class HubClient:
    """持有 hub 面板会话（X-Panel-Token），按需自动登录 / 失效重登。"""

    def __init__(self, port, panel_password, api_key=""):
        self.base = "http://127.0.0.1:%d" % int(port)
        self.password = panel_password or "admin"
        self.api_key = api_key or ""
        self._token = None
        self._lock = threading.Lock()

    # -- 面板会话 --
    def _login(self):
        body = http_json(self.base + "/panel/login", "POST", {"password": self.password}, timeout=10)
        token = body.get("token") if isinstance(body, dict) else None
        if not token:
            raise RuntimeError("面板登录失败：%s" % (body.get("error") if isinstance(body, dict) else body))
        with self._lock:
            self._token = token
        return token

    def _panel_token(self):
        with self._lock:
            tok = self._token
        if tok:
            return tok
        return self._login()

    def panel(self, path, method="GET", payload=None):
        """调用需要面板会话的端点；401 时自动重登一次。"""
        for attempt in (0, 1):
            tok = self._panel_token()
            try:
                return http_json(self.base + path, method, payload,
                                 headers={"X-Panel-Token": tok}, timeout=15)
            except urllib.error.HTTPError as exc:
                if exc.code == 401 and attempt == 0:
                    with self._lock:
                        self._token = None
                    continue
                return {"_error": "HTTP %s" % exc.code}
            except Exception as exc:
                return {"_error": str(exc)}
        return {"_error": "unreachable"}

    # -- 公开端点 --
    def health(self):
        try:
            return http_json(self.base + "/health", timeout=5)
        except Exception as exc:
            return {"_error": str(exc)}

    def models(self):
        try:
            return http_json(self.base + "/v1/models", timeout=8,
                             headers={"Authorization": "Bearer %s" % self.api_key} if self.api_key else None)
        except Exception as exc:
            return {"_error": str(exc)}


# 进程内共享同一实例 —— 面板会话（X-Panel-Token）必须跨请求保持。
# 曾经每次请求都 new 一个 HubClient，导致实例级 token 缓存形同虚设：
# 轮询一次就 /panel/login 一次（实测 5s 一轮，hub 日志被登录请求淹没）。
_hub_lock = threading.Lock()
_hub_cache = {}


def hub_client(port, panel_password, api_key=""):
    key = (int(port), panel_password or "admin", api_key or "")
    with _hub_lock:
        client = _hub_cache.get(key)
        if client is None:
            client = HubClient(*key)
            _hub_cache.clear()          # 配置变了就丢弃旧会话，避免拿着过期密码反复重登
            _hub_cache[key] = client
        return client


# ──────────────────────────────────────────────────────────────
def effective_api_key():
    """面板 Key 优先（hub 语义：面板有 Key 时命令行 --api-key 不再被接受）。"""
    env = read_kv(HUB_ENV)
    launcher = env.get("API_KEY", "")
    try:
        with open(os.path.join(HUB_ACCOUNTS, "settings.json"), encoding="utf-8") as fh:
            data = json.load(fh)
    except Exception:
        data = {}
    for entry in (data.get("api_keys") or []):
        if isinstance(entry, dict) and entry.get("enabled", True) is not False and entry.get("key"):
            return entry["key"], "panel"
    if data.get("api_key"):
        return data["api_key"], "panel"
    return launcher, "launcher"


def tail_file(path, lines=120):
    try:
        with open(path, "rb") as fh:
            fh.seek(0, os.SEEK_END)
            size = fh.tell()
            block = min(size, max(4096, lines * 400))
            fh.seek(size - block)
            data = fh.read().decode("utf-8", "replace")
        return "\n".join(data.splitlines()[-lines:])
    except FileNotFoundError:
        return "(日志文件不存在：%s)" % path
    except Exception as exc:
        return "(读取日志失败：%s)" % exc


def build_status():
    env = read_kv(HUB_ENV)
    hub_port = int(env.get("HUB_PORT") or 8788)
    headroom_port = int(env.get("HEADROOM_PORT") or 8787)
    panel_pw = env.get("PANEL_PASSWORD") or "admin"
    api_key, key_source = effective_api_key()

    pids = {}
    try:
        with open(PIDS_FILE, encoding="utf-8") as fh:
            pids = json.load(fh)
    except Exception:
        pass

    services = {
        "hub": {
            "pid": pids.get("hub"),
            "alive": process_alive(pids.get("hub")) if pids.get("hub") else False,
            "port": hub_port,
            "listening": port_open(hub_port),
        },
        "headroom": {
            "pid": pids.get("headroom"),
            "alive": process_alive(pids.get("headroom")) if pids.get("headroom") else False,
            "port": headroom_port,
            "listening": port_open(headroom_port),
        },
    }

    hub = hub_client(hub_port, panel_pw, api_key)
    health = hub.health()
    hub_reachable = "_error" not in health
    out_hub = {"reachable": hub_reachable, "health": health}

    if hub_reachable:
        accounts_resp = hub.panel("/accounts")
        out_hub["accounts"] = accounts_resp.get("accounts", []) if isinstance(accounts_resp, dict) else []
        out_hub["usable"] = accounts_resp.get("usable") if isinstance(accounts_resp, dict) else None
        out_hub["accounts_error"] = accounts_resp.get("_error") if isinstance(accounts_resp, dict) else None
        sched = hub.panel("/scheduler")
        out_hub["scheduler"] = sched if isinstance(sched, dict) and "_error" not in sched else None
        models_resp = hub.models()
        out_hub["models"] = [m.get("id") for m in (models_resp.get("data") or [])] \
            if isinstance(models_resp, dict) else []
        out_hub["models_error"] = models_resp.get("_error") if isinstance(models_resp, dict) else None

    headroom = {"reachable": False, "stats": None}
    if port_open(headroom_port):
        try:
            headroom["stats"] = http_json("http://127.0.0.1:%d/stats" % headroom_port, timeout=5)
            headroom["reachable"] = True
        except Exception as exc:
            headroom["stats"] = {"_error": str(exc)}

    return {
        "now": time.strftime("%Y-%m-%d %H:%M:%S"),
        "services": services,
        "hub": out_hub,
        "headroom": headroom,
        "client": {
            "base_url": "http://localhost:%d/v1" % headroom_port,
            "chat_url": "http://localhost:%d/v1/chat/completions" % headroom_port,
            "api_key": api_key,
            "api_key_source": key_source,
            "panel_url": "http://127.0.0.1:%d/" % hub_port,
            "panel_password": panel_pw,
        },
        "runtime": RUNTIME,
        "log_files": sorted(f for f in os.listdir(LOGS_DIR)) if os.path.isdir(LOGS_DIR) else [],
    }


# ──────────────────────────────────────────────────────────────
class Handler(BaseHTTPRequestHandler):
    server_version = "iskill-headroom-dashboard/1.0"

    def log_message(self, fmt, *args):  # 安静模式：不要把每条请求打到终端
        pass

    # -- 工具 --
    def _send(self, code, body, ctype="application/json; charset=utf-8"):
        if isinstance(body, (dict, list)):
            body = json.dumps(body, ensure_ascii=False).encode("utf-8")
        elif isinstance(body, str):
            body = body.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        # 控制台常被嵌在预览面板的 iframe 里，而 clipboard-write 的默认授权只有 self
        # —— 不显式放行时 navigator.clipboard 会直接把写入请求拒掉（前端已加 execCommand 兜底）。
        self.send_header("Permissions-Policy", 'clipboard-write=*')
        self.end_headers()
        try:
            self.wfile.write(body)
        except BrokenPipeError:
            pass

    def _json_body(self):
        length = int(self.headers.get("Content-Length") or 0)
        if not length:
            return {}
        try:
            return json.loads(self.rfile.read(length).decode("utf-8") or "{}")
        except Exception:
            return {}

    def _hub(self):
        env = read_kv(HUB_ENV)
        return hub_client(int(env.get("HUB_PORT") or 8788),
                          env.get("PANEL_PASSWORD") or "admin",
                          effective_api_key()[0])

    def _serve_static(self, path):
        """托管 dashboard/dist 构建产物；未知路径回退 index.html（SPA）。"""
        index = os.path.join(DIST_DIR, "index.html")
        if not os.path.isfile(index):
            return self._send(
                503,
                "控制台前端还没构建。\n\n"
                "在本机执行一次：\n"
                "    bash %s/scripts/dashboard.sh --build\n\n"
                "（需要 Node.js；构建产物在 dashboard/dist/）\n"
                "期望文件：%s\n" % (SKILL_DIR, index),
                "text/plain; charset=utf-8",
            )

        rel = urllib.parse.unquote(path).lstrip("/") or "index.html"
        target = os.path.normpath(os.path.join(DIST_DIR, rel))
        # 目录穿越防护
        if target != DIST_DIR and not target.startswith(DIST_DIR + os.sep):
            return self._send(403, {"error": "forbidden"})

        if os.path.isfile(target):
            ctype = MIME.get(os.path.splitext(target)[1].lower(), "application/octet-stream")
            with open(target, "rb") as fh:
                return self._send(200, fh.read(), ctype)

        with open(index, "rb") as fh:
            return self._send(200, fh.read(), MIME[".html"])

    # -- 路由 --
    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        query = urllib.parse.parse_qs(parsed.query)

        if path == "/api/status":
            try:
                return self._send(200, build_status())
            except Exception as exc:
                return self._send(500, {"error": str(exc)})

        if path == "/api/login/poll":
            state = (query.get("state") or [""])[0]
            return self._send(200, self._hub().panel("/accounts/login/poll?state=" + urllib.parse.quote(state)))

        if path == "/api/logs":
            name = (query.get("name") or ["hub"])[0]
            if name not in ("hub", "headroom", "start", "stop"):
                return self._send(400, {"error": "未知日志名"})
            lines = int((query.get("lines") or ["150"])[0])
            return self._send(200, {"name": name, "text": tail_file(os.path.join(LOGS_DIR, "%s.log" % name), lines)})

        if path.startswith("/api/"):
            return self._send(404, {"error": "not found"})

        return self._serve_static(path)

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        payload = self._json_body()

        if path == "/api/login/start":
            realm = str(payload.get("realm") or "intl")
            if realm not in ("intl", "cn"):
                return self._send(400, {"error": "realm 只能是 intl 或 cn"})
            res = self._hub().panel("/accounts/login/start", "POST",
                                    {"realm": realm, "platform": payload.get("platform") or "CLI"})
            return self._send(200, res)

        if path == "/api/login/cancel":
            return self._send(200, self._hub().panel("/accounts/login/cancel", "POST",
                                                     {"state": str(payload.get("state") or "")}))

        if path == "/api/accounts/refresh":
            return self._send(200, self._hub().panel("/accounts/refresh", "POST", {}))

        if path == "/api/service":
            action = str(payload.get("action") or "")
            if action not in ("start", "stop", "restart"):
                return self._send(400, {"error": "action 只能是 start / stop / restart"})
            script = os.path.join(SKILL_DIR, "scripts", "%s.sh" % action)
            if not os.path.isfile(script):
                return self._send(404, {"error": "缺少脚本 %s" % script})
            try:
                proc = subprocess.run(["bash", script], capture_output=True, text=True, timeout=600)
                return self._send(200, {
                    "ok": proc.returncode == 0,
                    "code": proc.returncode,
                    "output": (proc.stdout or "")[-4000:] + (proc.stderr or "")[-2000:],
                })
            except subprocess.TimeoutExpired:
                return self._send(200, {"ok": False, "output": "脚本执行超时（600s）"})
            except Exception as exc:
                return self._send(500, {"error": str(exc)})

        return self._send(404, {"error": "not found"})


def main():
    ap = argparse.ArgumentParser(description="iskill-headroom-workbuddy 本地控制台")
    ap.add_argument("--port", type=int,
                    default=int(os.environ.get("DASHBOARD_PORT") or DEFAULT_DASHBOARD_PORT))
    ap.add_argument("--host", default="127.0.0.1")
    args = ap.parse_args()

    dist_ok = os.path.isfile(os.path.join(DIST_DIR, "index.html"))
    if not dist_ok:
        print("[!] 前端未构建：%s 不存在" % DIST_DIR, file=sys.stderr)
        print("    先跑：bash %s/scripts/dashboard.sh --build" % SKILL_DIR, file=sys.stderr)

    env = read_kv(HUB_ENV)
    if not env:
        print("[!] 还没找到 %s —— 请先跑 scripts/start.sh" % HUB_ENV, file=sys.stderr)

    srv = ThreadingHTTPServer((args.host, args.port), Handler)
    srv.daemon_threads = True
    url = "http://%s:%d/" % ("127.0.0.1", args.port)
    print("=" * 62)
    print(" iskill-headroom-workbuddy 控制台")
    print()
    print("   控制台   : %s" % url)
    print("   前端产物 : %s%s" % (DIST_DIR, "" if dist_ok else "  [未构建]"))
    print("   运行时   : %s" % RUNTIME)
    print("   hub 看板 : http://127.0.0.1:%s/" % (env.get("HUB_PORT") or 8788))
    print()
    print("   Ctrl+C 退出（不影响 hub / Headroom 服务）")
    print("=" * 62)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\n[控制台已退出]")
    finally:
        srv.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
