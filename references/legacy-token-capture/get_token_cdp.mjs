#!/usr/bin/env node
// iskill-headroom-workbuddy · 用 CDP 自动抓取 WorkBuddy 桌面端发出的 Bearer（含 webview / iframe / 懒加载 target）
// 前置：桌面端须以 --remote-debugging-port 启动（见 enable_cdp.sh）。
// 用法: node get_token_cdp.mjs [--port 9222] [--timeout 90] [--verbose]
// 机制已用真实 Chrome 端到端验证（2026-10-01）：CDP 监听 Network.requestWillBeSent 可 100% 抓到 Authorization 头。
//
// v2 改进（2026-10-01）：
//   - 开 Target.setDiscoverTargets 动态监听「运行中才创建」的 webview/iframe target，并自动 attach + Network.enable
//   - 不再硬编码 copilot.tencent.com：捕获所有 Authorization 头，按 URL 含 tencent/copilot 优先，否则用任意 Bearer 并告警
//   - 诊断输出：监听期间见过的所有请求域名 + 所有 Authorization 头（脱敏），便于定位端点域名差异
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const WebSocket = globalThis.WebSocket; // Node 22 全局 WHATWG WebSocket，无需装 ws
const HOME = os.homedir();
const RUNTIME = path.join(HOME, ".iskill-headroom-workbuddy");
const ENV_PATH = path.join(RUNTIME, "workbuddy2api", ".env");

// 技能安装目录全路径（用于打印可直接复制的完整命令）
const SKILL_DIR = (() => {
  const installed = path.join(HOME, ".workbuddy", "skills", "iskill-headroom-workbuddy");
  try { if (fs.existsSync(installed)) return installed; } catch {}
  return path.dirname(path.dirname(fileURLToPath(import.meta.url)));
})();

const VERBOSE = process.argv.includes("--verbose");
function arg(name, def) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}
const TIMEOUT = Number(arg("--timeout", 90));

function candidatePorts() {
  const ports = [];
  const p = arg("--port", null);
  if (p) ports.push(Number(p));
  for (const base of [
    path.join(HOME, "Library/Application Support/WorkBuddy"),
    path.join(HOME, "Library/Application Support/CodeBuddy"),
  ]) {
    try {
      const txt = fs.readFileSync(path.join(base, "DevToolsActivePort"), "utf8").trim().split("\n")[0];
      if (txt) ports.push(Number(txt));
    } catch {}
  }
  ports.push(9222);
  return [...new Set(ports.filter((x) => x > 0))];
}

function getVersion(port) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: "127.0.0.1", port, path: "/json/version", timeout: 3000 }, (res) => {
      let b = ""; res.on("data", (d) => (b += d));
      res.on("end", () => { try { resolve(JSON.parse(b)); } catch (e) { reject(e); } });
    });
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("timeout")); });
  });
}

const TOKEN_HINT = ["copilot", "tencent.com", "tencentai", "hunyuan"];
function looksLikeTokenUrl(url) {
  const u = (url || "").toLowerCase();
  return TOKEN_HINT.some((h) => u.includes(h));
}

async function main() {
  const ports = candidatePorts();
  let ver = null, usedPort = null;
  for (const port of ports) {
    try { ver = await getVersion(port); usedPort = port; break; } catch {}
  }
  if (!ver) {
    console.error("[✗] 连不上 CDP。桌面端未以调试端口启动？");
    console.error("    请先运行: bash " + SKILL_DIR + "/scripts/enable_cdp.sh");
    console.error("    探测过的端口: " + ports.join(", "));
    process.exit(2);
  }
  console.log("[✓] CDP 已连上 (" + usedPort + "): " + ver.Browser);

  const ws = new WebSocket(ver.webSocketDebuggerUrl);
  let nextId = 1;
  const pending = new Map();
  function send(method, params = {}, sessionId = null) {
    return new Promise((resolve, reject) => {
      const id = nextId++;
      const msg = { id, method, params: params || {} };
      if (sessionId) msg.sessionId = sessionId;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify(msg));
    });
  }

  let preferred = null;   // URL 命中 tencent/copilot 的 Bearer
  let anyAuth = null;      // 兜底：任意 Bearer
  const seenHosts = new Set();
  const seenAuth = [];      // 去重后的 {host, sample}
  let attachedCount = 0;

  function noteAuth(url, auth) {
    const token = String(auth).replace(/^Bearer\s+/i, "");
    const host = (() => { try { return new URL(url).host; } catch { return url.slice(0, 60); } })();
    if (VERBOSE) console.log("    · auth@" + host + " = " + token.slice(0, 10) + "…");
    if (!seenAuth.some((x) => x.host === host)) seenAuth.push({ host, sample: token.slice(0, 12) });
    if (looksLikeTokenUrl(url)) {
      if (!preferred) preferred = token;
    } else if (!anyAuth) {
      anyAuth = token;
    }
  }

  function onNetworkRequest(m) {
    const url = m.params?.request?.url || "";
    const headers = m.params?.request?.headers || {};
    try { seenHosts.add(new URL(url).host); } catch {}
    const auth = headers["authorization"] || headers["Authorization"] || headers["AUTHORIZATION"];
    if (auth) noteAuth(url, auth);
  }

  // 动态挂载一个 target 并开 Network（flatten 让子 target 自动 attach）
  async function attachTarget(targetId, label) {
    try {
      const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
      await send("Network.enable", {}, sessionId).catch(() => {});
      attachedCount++;
      if (VERBOSE) console.log("    [attach] " + label + " session=" + sessionId.slice(0, 10));
    } catch (e) { if (VERBOSE) console.log("    [attach-fail] " + label + ": " + e.message); }
  }

  ws.addEventListener("message", (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const p = pending.get(m.id); pending.delete(m.id);
      m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result);
      return;
    }
    if (m.method === "Network.requestWillBeSent") return onNetworkRequest(m);
    // 动态挂载：flatten 自动 attach 出来的子 target（webview / iframe）
    if (m.method === "Target.attachedToTarget") {
      const sid = m.params?.sessionId;
      if (sid) send("Network.enable", {}, sid).catch(() => {}).then(() => { attachedCount++; });
    }
    // 运行中新冒出来的 target（懒加载的 webview）
    if (m.method === "Target.targetCreated") {
      const t = m.params?.targetInfo;
      if (t && (t.type === "page" || t.type === "webview" || t.type === "iframe")) {
        attachTarget(t.targetId, t.type + ":" + (t.url || "").slice(0, 40));
      }
    }
  });
  await new Promise((r) => ws.addEventListener("open", r));

  // 开发现式监听（targetCreated 会推送新 target）
  await send("Target.setDiscoverTargets", { discover: true }).catch(() => {});

  // 初始 target 全挂
  const { targetInfos } = await send("Target.getTargets");
  const initial = targetInfos.filter((t) => t.type === "page" || t.type === "webview" || t.type === "iframe");
  console.log("[*] 初始发现 " + initial.length + " 个 page/webview/iframe target，逐个挂载 Network 监听…");
  for (const t of initial) await attachTarget(t.targetId, t.type + ":" + (t.url || "").slice(0, 40));

  console.log("[*] 监听中…请在 WorkBuddy 桌面端随便发一条消息（触发一次请求）。");
  console.log("    （若聊天 UI 在 webview，会自动挂载；监听期内新出现的 target 也会动态挂载）");
  if (VERBOSE) console.log("    [verbose] 将打印每个带 Authorization 的请求域名");

  const deadline = Date.now() + TIMEOUT * 1000;
  while (!preferred && !anyAuth && Date.now() < deadline) await new Promise((r) => setTimeout(r, 300));

  // 收尾：决定用哪个 token
  const captured = preferred || anyAuth;
  if (!captured) {
    console.error("\n[✗] " + TIMEOUT + "s 内未抓到任何 Authorization 头。");
    if (seenHosts.size) console.error("    监听期见过的请求域名: " + [...seenHosts].slice(0, 30).join(", "));
    console.error("    排查：");
    console.error("    ① 桌面端确实以调试端口启动（enable_cdp.sh 输出应显示 CDP 就绪）");
    console.error("    ② 在桌面端真实发了一条消息（不是只打开窗口）");
    console.error("    ③ 聊天 UI 在 webview 时 enable_cdp.sh 已带 --enable-remote-debugging-webview");
    console.error("    ④ 若仍无，用 --verbose 看是否连请求都没监听到（说明挂错了 target）");
    process.exit(1);
  }

  writeEnv(captured);
  const which = preferred ? "命中 tencent/copilot 端点" : "兜底（端点域名不在白名单，请确认是否真的是登录 token）";
  console.log("\n[✓] 抓到 Authorization Bearer（" + which + "）: " + captured.slice(0, 12) + "…");
  if (seenAuth.length) {
    console.log("    本次见过的鉴权端点: " + seenAuth.map((x) => x.host + "(" + x.sample + "…)").join(", "));
  }
  console.log("==== 已写入 " + ENV_PATH + " 的 CODEBUDDY_AUTH_TOKEN ====");
  console.log("现在可起服务: bash " + SKILL_DIR + "/scripts/start.sh  或仅重启 workbuddy2api: bash " + SKILL_DIR + "/scripts/token.sh");
  try { ws.close(); } catch {}
  process.exit(0);
}

function writeEnv(token) {
  let content = "";
  try { content = fs.readFileSync(ENV_PATH, "utf8"); } catch {}
  if (content.includes("CODEBUDDY_AUTH_TOKEN=")) {
    content = content.replace(/^CODEBUDDY_AUTH_TOKEN=.*$/m, "CODEBUDDY_AUTH_TOKEN=" + token);
  } else {
    content += "\nCODEBUDDY_AUTH_TOKEN=" + token + "\n";
  }
  fs.mkdirSync(path.dirname(ENV_PATH), { recursive: true });
  fs.writeFileSync(ENV_PATH, content);
}

main().catch((e) => { console.error("[✗] " + e.message); process.exit(1); });
