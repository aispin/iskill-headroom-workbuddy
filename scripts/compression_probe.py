#!/usr/bin/env python3
"""向 Headroom 发一份「带大量可压缩历史」的请求，读出压缩前后的 token 数与响应头。

只依赖标准库。**密钥不从命令行传**（命令行里出现密钥字样会触发沙箱的敏感信息确认），
默认从控制台 `/api/status` 读「当前真正生效」的那把 Key。

用法：
    python3 compression_probe.py --port 8787 [--label "当前实例"] [--json]
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request

CONSOLE_PORT_DEFAULT = 8786


def _get_json(url: str, timeout: float = 10.0):
    with urllib.request.urlopen(url, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def load_api_key(console_port: int) -> str:
    """取当前生效的 API Key：控制台优先，其次 hub.env。"""
    try:
        data = _get_json("http://127.0.0.1:%d/api/status" % console_port, timeout=5)
        key = (data.get("client") or {}).get("api_key") or ""
        if key:
            return key
    except Exception:
        pass

    env_path = os.path.expanduser("~/.iskill-headroom-workbuddy/hub.env")
    try:
        with open(env_path, "r", encoding="utf-8") as fh:
            for line in fh:
                m = re.match(r"\s*API_KEY\s*=\s*(.+?)\s*$", line)
                if m:
                    return m.group(1).strip().strip("'\"")
    except Exception:
        pass
    return ""


def _big_block(tag: str, lines: int = 18) -> str:
    """造一段「冗长但可压缩」的内容：典型的构建/运行日志。

    为什么要够长：块级压缩的闸门是 min_chars_for_block_compression
    （coding 档 = 25 字符，通用默认 500）。日志/工具输出这类高冗余文本
    正是 Headroom 的目标物，用自然语言短句去测是测不出来的。
    """
    rows = []
    for i in range(lines):
        rows.append(
            "[%s] 2026-10-01T12:%02d:%02d INFO  worker-%d  "
            "queue=ingest partition=p%d offset=%d status=OK duration=%dms retry=0"
            % (tag, i % 60, (i * 7) % 60, i % 4, i % 8, 100000 + i * 37, 12 + i)
        )
    body = "\n".join(rows)
    return "下面是最近一次任务运行的原始输出，请先不要分析：\n```\n%s\n```\n" % body


def build_payload(model: str, turns: int = 4, style: str = "agent", nonce: str = "") -> dict:
    """造一份"像真实 agent 会话"的请求。

    ── 为什么必须是这种形状 ────────────────────────────────────────────
    Headroom 判断哪些消息可以压，用的是 `CompressionCache.compute_frozen_count()`：
    从前往后数"稳定"消息，**遇到第一个不在压缩缓存里的 tool_result 就停下**，
    停下的位置之后就都是"活区"（可压缩）。而普通 user/assistant 文本消息
    **一律算稳定**（因为要保持上游 prompt cache 命中）。

    于是：**纯聊天式的请求（没有工具调用结果）会把整段历史全判成冻结，
    活区为空 → 压缩率恒为 0**。这不是配置问题，是 Headroom 的设计——
    它的压缩目标是 agent 会话里动辄上万 token 的工具输出，不是聊天。

    `style="prose"` 可以复现这个"压不动"的情形，用来做对照。

    `style="agent-mid"` 则去掉结尾提问、让最后一条是 tool 结果 —— **这是真实 agent 循环里
    最常见的请求形状，也是 cache 模式唯一能压的位置**。判 cache 模式有没有在干活必须用它；
    用 `agent`（结尾是提问）测会一律得到 0。

    `nonce` 会被塞进 system 消息：Headroom 有**响应缓存**，完全相同的请求
    第二次会被直接回放（连压缩管线都不走），A/B 对照就失真了。
    """
    sys_msg = "You are a build assistant. Answer in one short sentence."
    if nonce:
        sys_msg += " (probe %s)" % nonce

    if style == "prose":
        messages = [{"role": "system", "content": sys_msg}]
        for t in range(turns + 1):
            messages.append({"role": "user", "content": _big_block("run%d" % t)})
            messages.append({"role": "assistant", "content": "收到第 %d 批输出，已记录。" % (t + 1)})
        messages.append({"role": "user", "content": "回复两个字：收到"})
        return {"model": model, "messages": messages, "max_tokens": 24, "stream": False}

    # agent 式：user 提问 → assistant 发起工具调用 → tool 返回大段日志
    messages = [
        {"role": "system", "content": sys_msg},
        {"role": "user", "content": "跑一遍测试，然后告诉我哪个用例挂了。"},
    ]
    for t in range(turns):
        cid = "call_%d" % t
        messages.append(
            {
                "role": "assistant",
                "content": None,
                "tool_calls": [
                    {
                        "id": cid,
                        "type": "function",
                        "function": {"name": "run_tests", "arguments": json.dumps({"suite": "api-%d" % t})},
                    }
                ],
            }
        )
        messages.append({"role": "tool", "tool_call_id": cid, "content": _big_block("run%d" % t, lines=24)})
    messages.append({"role": "user", "content": "回复两个字：收到"})
    if style == "agent-mid":
        # 去掉结尾提问，让最后一条是 role="tool" —— 真实 agent 循环里「刚跑完一个大命令」
        # 的请求就长这样，而 cache 模式唯一能压的就是这条增量。
        # 用带结尾提问的形状去测 cache 模式，会一律得到 0（最新提问受 protect_prompt_text
        # 保护），从而误判成「cache 模式不压缩」。
        messages.pop()
    return {"model": model, "messages": messages, "max_tokens": 24, "stream": False}


def pick_model(port: int) -> str:
    """从 hub 的 /v1/models 里挑一个。"""
    try:
        data = _get_json("http://127.0.0.1:8788/v1/models", timeout=5)
        items = data.get("data") or []
        if items:
            return items[0].get("id") or "deepseek-v4.1-flash"
    except Exception:
        pass
    return "deepseek-v4.1-flash"


def probe(port: int, label: str, key: str, model: str, turns: int, style: str, nonce: str,
          as_json: bool) -> dict:
    payload = json.dumps(build_payload(model, turns, style, nonce)).encode("utf-8")
    req = urllib.request.Request(
        "http://127.0.0.1:%d/v1/chat/completions" % port,
        data=payload,
        headers={"Content-Type": "application/json", "Authorization": "Bearer " + key},
        method="POST",
    )

    started = time.time()
    result: dict = {"port": port, "label": label, "model": model, "input_bytes": len(payload)}
    try:
        with urllib.request.urlopen(req, timeout=180) as resp:
            headers = {k.lower(): v for k, v in resp.headers.items()}
            body = resp.read().decode("utf-8", "replace")
            result["status"] = resp.status
    except urllib.error.HTTPError as exc:
        headers = {k.lower(): v for k, v in (exc.headers or {}).items()}
        body = exc.read().decode("utf-8", "replace")
        result["status"] = exc.code
    except Exception as exc:  # 连不上 / 超时
        result["status"] = 0
        result["error"] = str(exc)
        result["elapsed"] = round(time.time() - started, 2)
        return result

    result["elapsed"] = round(time.time() - started, 2)
    for name in (
        "x-headroom-compressed",
        "x-headroom-tokens-before",
        "x-headroom-tokens-after",
        "x-headroom-tokens-saved",
        "x-headroom-model",
        "x-headroom-cache",
    ):
        result[name] = headers.get(name)
    # 把所有 headroom 自己的头都留一份，便于诊断（Proxy 版本与 ASGI 中间件不一定同名）
    result["_headroom_headers"] = {k: v for k, v in headers.items() if "headroom" in k}

    # 顺带看模型是否真的回话了（压缩不能把请求搞坏）
    try:
        parsed = json.loads(body)
        msg = (parsed.get("choices") or [{}])[0].get("message") or {}
        result["reply"] = (msg.get("content") or "").strip()[:60]
        if not result["reply"]:
            result["body_head"] = body[:220]
        # 上游前缀缓存命中数 —— 这是判断「cache 模式值不值」的关键指标，比 tokens_saved 重要
        usage = parsed.get("usage") or {}
        ptd = usage.get("prompt_tokens_details") or {}
        result["prompt_tokens"] = usage.get("prompt_tokens")
        result["cached_tokens"] = ptd.get("cached_tokens")
    except Exception:
        result["reply"] = ""
        result["body_head"] = body[:220]

    before = result.get("x-headroom-tokens-before")
    after = result.get("x-headroom-tokens-after")
    if before and after:
        try:
            b, a = int(before), int(after)
            result["saved_pct"] = round((b - a) / b * 100, 1) if b else 0.0
        except ValueError:
            pass
    return result


def main() -> int:
    ap = argparse.ArgumentParser(description="Headroom 压缩探针")
    ap.add_argument("--port", type=int, required=True, help="目标 Headroom 端口")
    ap.add_argument("--label", default="", help="这次探测的标签（打印用）")
    ap.add_argument("--turns", type=int, default=4, help="工具调用轮数（每轮返回一大块日志）")
    ap.add_argument("--style", choices=("agent", "agent-mid", "prose"), default="agent",
                    help="payload 形状：agent=带工具结果+结尾提问 / agent-mid=带工具结果且**以工具结果结尾**"
                         "（真实 agent 循环，cache 模式唯一能压的形状）/ prose=纯聊天（压不动，用于对照）")
    ap.add_argument("--nonce", default="", help="同一轮 A/B 用同一个值；不传则随机（避开响应缓存）")
    ap.add_argument("--model", default="", help="模型 ID（默认取 hub /v1/models 第一个）")
    ap.add_argument("--console-port", type=int, default=CONSOLE_PORT_DEFAULT)
    ap.add_argument("--json", action="store_true", help="输出 JSON")
    args = ap.parse_args()

    key = load_api_key(args.console_port)
    if not key:
        print("✗ 拿不到 API Key（控制台 /api/status 与 hub.env 都没有）", file=sys.stderr)
        return 2

    model = args.model or pick_model(args.port)
    nonce = args.nonce or hashlib.md5(os.urandom(8)).hexdigest()[:8]
    res = probe(args.port, args.label or ("port %d" % args.port), key, model,
                args.turns, args.style, nonce, args.json)

    if args.json:
        print(json.dumps(res, ensure_ascii=False))
        return 0

    print("  %s（:%d，model=%s）" % (res["label"], res["port"], res["model"]))
    if res.get("error"):
        print("    ✗ 请求失败：%s" % res["error"])
        return 1
    print("    HTTP %s · 耗时 %ss · 请求体 %d 字节"
          % (res["status"], res.get("elapsed"), res["input_bytes"]))

    hh = res.get("_headroom_headers") or {}
    if hh:
        print("    headroom 响应头：%s"
              % ", ".join("%s=%s" % (k, v) for k, v in sorted(hh.items())))
    pt, ct = res.get("prompt_tokens"), res.get("cached_tokens")
    if pt is not None:
        pct = ""
        try:
            pct = (
                "（%.0f%%，上游缓存命中）" % (ct / pt * 100)
                if ct
                else "（0%：单发探针每次都带新 nonce，前缀必然是冷的；命中率要连发同一前缀才看得到）"
            )
        except Exception:
            pct = ""
        print("    上游缓存   : prompt=%s · cached=%s %s" % (pt, ct, pct))
    if res.get("x-headroom-tokens-before") is None:
        # 关键判读：headroom 只在 tokens_saved > 0 时才下发这几个头
        print("    ⇒ 未下发 x-headroom-* 头 = **本次没有发生压缩**")
        if hh:
            print("      （但收到了其他 headroom 头，说明请求确实走了 Headroom）")
        else:
            print("      ⚠️  连一个 headroom 头都没有 —— 请求可能没走 Headroom")
        if res.get("reply"):
            print("    模型回话   : %s" % res["reply"])
        elif res.get("body_head"):
            print("    响应体片段 : %s" % res["body_head"])
        return 1

    print("    compressed : %s" % res.get("x-headroom-compressed"))
    print("    tokens     : %s → %s（省 %s，%s%%）"
          % (res.get("x-headroom-tokens-before"), res.get("x-headroom-tokens-after"),
             res.get("x-headroom-tokens-saved"), res.get("saved_pct")))
    print("    模型回话   : %s" % (res.get("reply") or "（空）"))
    return 0


if __name__ == "__main__":
    sys.exit(main())
