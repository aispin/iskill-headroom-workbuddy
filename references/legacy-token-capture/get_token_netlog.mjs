#!/usr/bin/env node
// iskill-headroom-workbuddy · 从 Chromium netlog 中提取 WorkBuddy 的 Authorization Bearer → 写入 workbuddy2api/.env
//
// 原理（2026-10-01 用真实 Chrome 端到端验证）：
//   Chromium 的 `--log-net-log=<file> --net-log-capture-mode=IncludeSensitive`
//   会把请求头（含 Authorization）完整记录进 netlog JSON。
//   相比 CDP 挂 target，netlog 覆盖整个 Chromium 网络栈（主进程 net / renderer / iframe / webview），
//   不依赖「挂对 target」，也不需要装 CA 或代理。
//
// 前提：桌面端需以 netlog 参数启动（见 enable_cdp.sh，已内置这两个参数）。重启一次即可。
//
// 用法:
//   node get_token_netlog.mjs                 # 读取默认 netlog 路径并写 .env
//   node get_token_netlog.mjs --file <path>   # 解析指定 netlog（调试）
//   node get_token_netlog.mjs --verbose       # 打印命中的 URL 与候选
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HOME = os.homedir();
const RUNTIME = path.join(HOME, ".iskill-headroom-workbuddy");
const ENV_PATH = path.join(RUNTIME, "workbuddy2api", ".env");
const DEFAULT_NETLOG = path.join(RUNTIME, "netlog.json");

// 技能安装目录全路径（用于打印可直接复制的完整命令）：
// 优先用规范的 active 安装路径 ~/.workbuddy/skills/<skill>，否则回退到本脚本自身所在目录。
const SKILL_DIR = (() => {
  const installed = path.join(HOME, ".workbuddy", "skills", "iskill-headroom-workbuddy");
  try { if (fs.existsSync(installed)) return installed; } catch {}
  return path.dirname(path.dirname(fileURLToPath(import.meta.url)));
})();

function arg(name, def) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}
const VERBOSE = process.argv.includes("--verbose");
const FILE = arg("--file", null);

const HINTS = ["copilot", "tencent.com", "tencentai", "hunyuan", "workbuddy"];

function candidateFiles() {
  const out = [];
  if (FILE) out.push(FILE);
  out.push(DEFAULT_NETLOG, "/tmp/wb-netlog.json");
  for (const base of [
    path.join(HOME, "Library/Application Support/WorkBuddy"),
    path.join(HOME, "Library/Application Support/CodeBuddyExtension"),
  ]) {
    try {
      for (const f of fs.readdirSync(base)) if (f.endsWith(".netlog.json") || f.includes("netlog")) out.push(path.join(base, f));
    } catch {}
  }
  return out.filter((f, i, a) => fs.existsSync(f) && a.indexOf(f) === i);
}

function collectAuthHeaders(netlog) {
  const urlBySource = new Map();
  const hits = [];
  const events = netlog.events || [];
  for (const e of events) {
    const params = e?.params || {};
    const sid = e?.source?.id;
    if (e?.source?.type === "URL_REQUEST" && typeof params.url === "string" && sid !== undefined) {
      urlBySource.set(sid, params.url);
    }
    const h = params.headers;
    if (!h) continue;
    let lines = [];
    if (Array.isArray(h)) lines = h;
    else if (typeof h === "object") lines = Object.entries(h).map(([k, v]) => `${k}: ${v}`);
    else if (typeof h === "string") lines = h.split(/\r?\n/);
    for (const line of lines) {
      const m = String(line).match(/^\s*authorization\s*:\s*(.+)$/i);
      if (m && /^Bearer\s+\S+/i.test(m[1].trim())) {
        hits.push({ url: urlBySource.get(sid) || params.url || "", auth: m[1].trim(), event: e.type });
      }
    }
  }
  return hits;
}

const files = candidateFiles();
if (!files.length) {
  console.error("[✗] 未找到 netlog 文件。请先以 netlog 参数重启桌面端：");
  console.error("    bash " + SKILL_DIR + "/scripts/enable_cdp.sh");
  console.error("    然后在桌面端发一条消息，再重跑本脚本：");
  console.error("    node " + SKILL_DIR + "/scripts/get_token_netlog.mjs --verbose");
  process.exit(2);
}

// 容错解析：netlog 是流式写入，进程被强杀时会截断成不完整 JSON。
// 失败时回退到「截到最后一条完整事件 + 补 ]}」。
function parseNetlog(raw) {
  try { return JSON.parse(raw); } catch (e) {
    const pos = Number((String(e.message).match(/position (\d+)/) || [])[1]) || raw.length;
    let cut = raw.slice(0, pos).replace(/,\s*$/, "");
    const lastEnd = cut.lastIndexOf("}");
    if (lastEnd > 0) {
      cut = cut.slice(0, lastEnd + 1);
      try { return JSON.parse(cut + "]}"); } catch {}
    }
    return null;
  }
}

let all = [];
for (const f of files) {
  let netlog;
  try { netlog = parseNetlog(fs.readFileSync(f, "utf8")); }
  catch (e) { netlog = null; }
  if (!netlog) { console.error("[!] 解析失败 " + f); continue; }
  if (VERBOSE) console.log("[*] 解析 " + f + "（事件 " + (netlog.events ? netlog.events.length : 0) + "）");
  all = all.concat(collectAuthHeaders(netlog));
}

if (!all.length) {
  console.error("[✗] netlog 里没有找到任何 Authorization: Bearer。");
  console.error("    ① 确认桌面端是以 --log-net-log --net-log-capture-mode=IncludeSensitive 启动；");
  console.error("    ② 确认已在桌面端真实发过一条消息；");
  console.error("    ③ 若模型请求走 Node 扩展宿主（不经 Chromium 网络栈），netlog 抓不到 → 改用代理方案。");
  process.exit(1);
}

const preferred = all.find((x) => HINTS.some((h) => (x.url || "").toLowerCase().includes(h)));
const chosen = preferred || all[0];
const token = chosen.auth.replace(/^Bearer\s+/i, "");

if (VERBOSE) {
  const hosts = [...new Set(all.map((x) => { try { return new URL(x.url).host; } catch { return "(未知URL)"; } }))];
  console.log("[*] 命中鉴权端点: " + hosts.join(", "));
  console.log("[*] 选用: " + (preferred ? "命中白名单端点" : "兜底（任意 Bearer）") + "  URL=" + (chosen.url || "(未记录)"));
}

let content = "";
try { content = fs.readFileSync(ENV_PATH, "utf8"); } catch {}
if (process.argv.includes("--dry-run")) {
  console.log("[✓] 抓到 Authorization Bearer: " + token.slice(0, 12) + "…（--dry-run，不写文件）");
  process.exit(0);
}
if (content.includes("CODEBUDDY_AUTH_TOKEN=")) {
  content = content.replace(/^CODEBUDDY_AUTH_TOKEN=.*$/m, "CODEBUDDY_AUTH_TOKEN=" + token);
} else {
  content += "\nCODEBUDDY_AUTH_TOKEN=" + token + "\n";
}
fs.mkdirSync(path.dirname(ENV_PATH), { recursive: true });
fs.writeFileSync(ENV_PATH, content);

console.log("[✓] 抓到 Authorization Bearer: " + token.slice(0, 12) + "…");
console.log("==== 已写入 " + ENV_PATH + " 的 CODEBUDDY_AUTH_TOKEN ====");
console.log("现在可起服务: bash " + SKILL_DIR + "/scripts/start.sh  或仅重启 workbuddy2api: bash " + SKILL_DIR + "/scripts/token.sh");
