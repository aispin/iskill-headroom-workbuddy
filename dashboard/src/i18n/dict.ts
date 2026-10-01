/**
 * 控制台文案字典。
 * 零依赖：不用 i18next 之类，一个 Record 就够。
 * 新增 key 时只需改 zh，en 会由 TS 强制补齐（Dict 类型即 zh 的键集合）。
 */

const zh = {
  // ── 顶栏 ──
  "app.title": "ISKILL-HEADROOM-WORKBUDDY 控制台",
  "app.desc":
    "把 WorkBuddy 桌面端内置模型接成人人可用的 OpenAI 兼容 API —— hub 让它「用得上」（协议转换 / 看板 OAuth 加账号 / 多账号调度），headroom 让它「跑得远」（守住上游缓存 + 只压最新增量）。",
  "app.updatedAt": "更新于 {now} · 运行时 {runtime}",
  "app.statusError": "读取状态失败：{error}",
  "app.loading": "加载中…",
  "app.hubPanel": "hub 面板 ↗",
  "app.hubPanelTitle": "打开 hub 原生看板：{url}",
  "app.autoOn": "自动刷新：开",
  "app.autoOff": "自动刷新：关",
  // 页脚拆三段，中间那段是超链接
  "app.footer.pre":
    "本控制台只监听 127.0.0.1，仅供本机使用。深度管理（API Key 增删、模型限制、每日限额、签到任务）请用 ",
  "app.footer.panel": "hub 原生看板",
  "app.footer.post": "。",

  // ── 顶栏控件 ──
  "app.theme.aria": "主题",
  "app.theme.system": "跟随系统",
  "app.theme.light": "浅色",
  "app.theme.dark": "深色",
  "app.lang.aria": "语言",

  // ── 横幅 ──
  "app.banner.hubDown": "hub 未响应 —— 服务没起来或已停止。用下方「启动服务」。",
  "app.banner.poolEmpty":
    "账号池为空，现在还调用不了模型。点「登录国际版 / 国内版」完成一次 OAuth 授权即可。",
  "app.banner.ready": "链路就绪：{total} 个账号，{ready} 个可用。",
  "app.banner.headroomDown": "Headroom 未响应 —— 压缩这一跳没起来，客户端会连不上。",
  "app.banner.realmMismatch":
    "出口区域是「{realm}」，但池里 {total} 个账号都不属于该区域 —— 调用会直接 503。请到 hub 看板切换出口区域，或补一个该区域的账号。",

  // ── 通用 ──
  "common.refresh": "刷新",
  "common.refreshing": "刷新中…",
  "common.copy": "复制",
  "common.copied": "已复制",
  "common.copyFailed": "复制失败",
  "common.show": "显示",
  "common.hide": "隐藏",
  "common.copyFailedHint": "浏览器拒绝了剪贴板写入。文本已选中，请按 ⌘C / Ctrl+C 手动复制。",
  "common.cancel": "取消",
  "common.hubOffline": "hub 离线",
  "common.dash": "—",
  "common.realm.intl": "国际版",
  "common.realm.cn": "国内版",

  // ── 请求链路 ──
  "chain.title": "请求链路",
  "chain.client.title": "WorkBuddy 客户端",
  "chain.client.desc": "自定义模型",
  "chain.headroom.desc": ":{port} 缓存守护 + 压增量{pid}",
  "chain.hub.desc": ":{port} 协议转换 / 多账号{pid}",
  "chain.pid": "　PID {pid}",
  "chain.model.title": "官方内置模型",
  "chain.model.desc": "{realm}（{domain}）",
  "chain.model.default": "copilot / workbuddy.ai",

  // ── 账号池 ──
  "pool.title": "账号池",
  "pool.readyTotal": "可用 / 总数",
  "pool.realm": "出口区域",
  "pool.auth": "/v1 鉴权",
  "pool.keyRequired": "需要 API Key",
  "pool.keyOff": "关闭",
  "pool.loginIntl": "登录国际版",
  "pool.loginCn": "登录国内版",
  "pool.keepalive": "手动保活",
  "pool.keeping": "保活中…",
  "pool.starting": "正在向上游申请授权地址…",
  "pool.waitingHint": "已生成授权链接（{realm}）。完成登录后本页会自动检测回调。",
  "pool.waitingMsg": "等待浏览器完成授权…",
  "pool.waitingMsg2": "等待授权…（{msg}）",
  "pool.openAuth": "打开授权页面",
  "pool.done": "{realm}账号已入库，可以直接用了。",
  "pool.failed": "失败：{msg}",
  "pool.got": "知道了",
  "pool.errNoUrl": "上游没有返回授权地址",

  // ── Headroom 省流 ──
  "savings.title": "Headroom 省流",
  "savings.mode": "运行模式",
  "savings.mode.cache": "cache · 保上游缓存",
  "savings.mode.token": "token · 压历史",
  "savings.requests": "请求数",
  "savings.requestsValue": "{total} 条（压缩 {compressed} 次）",
  "savings.offline": "Headroom 离线",
  "savings.saved": "已省 token",
  "savings.ratio": "省流比例",
  "savings.reasons": "未压缩原因",
  "savings.reason.prefix_frozen": "历史前缀冻结 ×{n}",
  "savings.reason.too_small": "内容太小 ×{n}",
  "savings.reason.no_compressible_content": "无可压内容 ×{n}",
  "savings.reason.passthrough": "直通 ×{n}",
  "savings.reason.unknown_token_accounting": "计数缺失 ×{n}",
  "savings.note.cache":
    "当前 cache 模式：历史前缀按字节原样回放以守住上游缓存（命中单价仅为未命中的 2%），同时只压缩最新那条增量 —— 所以这里多数时候是 0，不代表压缩坏了。想连历史一起压，用 HEADROOM_MODE=token 重启。",
  "savings.note.token":
    "token 模式已开启，但还没压到东西：压缩只作用于工具输出、日志这类大块内容；普通聊天消息被视为「要保持缓存命中」的稳定内容，不会被压。",
  "savings.note.ok":
    "压缩只发生在 Headroom 这一跳；hub 只做协议转换与账号调度，本身不再压缩。",
  "savings.verify": "自检：bash scripts/test-compression.sh",

  // ── 客户端配置 ──
  "client.title": "客户端配置",
  "client.path": "WorkBuddy → 设置 → 模型 → 添加模型 → 自定义/Custom",
  "client.chatUrl": "接口地址",
  "client.apiKey": "API Key",
  "client.model": "模型名称",
  "client.noModels": "（读不到模型列表）",
  "client.keySource": "当前 Key 来源：",
  "client.keySource.panel": "hub 看板设置的 API Key（优先于命令行）",
  "client.keySource.launcher": "本技能生成（存于 hub.env）",
  "client.keySource.tail": "。若在看板里新增了 Key，以看板里的为准。",

  // ── 账号明细 ──
  "accounts.title": "账号明细",
  "accounts.col.nickname": "昵称",
  "accounts.col.realm": "区域",
  "accounts.col.status": "状态",
  "accounts.col.credits": "积分",
  "accounts.col.expires": "凭证有效期",
  "accounts.col.refresh": "刷新令牌",
  "accounts.col.source": "来源",
  "accounts.status.disabled": "已停用",
  "accounts.status.cooldown": "冷却中",
  "accounts.status.reserve": "积分保护",
  "accounts.status.ok": "可用",
  "accounts.loadError": "读取失败：{err}",
  "accounts.empty": "还没有账号 —— 用上面的 OAuth 按钮加一个",
  "accounts.yes": "有",
  "accounts.no": "无",

  // ── 日志与服务 ──
  "logs.title": "日志与服务",
  "logs.action.start": "启动服务",
  "logs.action.stop": "停止服务",
  "logs.action.restart": "重启服务",
  "logs.confirm": "确认{action}？",
  "logs.confirmStop": "（客户端会断线）",
  "logs.running": "正在执行{action}…",
  "logs.busy": "执行中…",
  "logs.noOutput": "(无输出)",
  "logs.readError": "读取日志失败：{msg}",
  "logs.readErrorShort": "读取日志失败",
  "logs.tab.hub": "hub 日志",
  "logs.tab.headroom": "Headroom 日志",
  "logs.refresh": "刷新",
  "logs.panelLink": "打开 hub 原生看板（账号 / Key / 用量 / 签到）",
  "logs.panelPassword": "面板密码：{pw}",
};

export type Dict = Record<keyof typeof zh, string>;

const en: Dict = {
  // ── Header ──
  "app.title": "ISKILL-HEADROOM-WORKBUDDY Console",
  "app.desc":
    "Turns WorkBuddy's built-in models into an OpenAI-compatible API anyone can use — the hub makes them usable (protocol translation / dashboard OAuth / multi-account scheduling), Headroom makes them last (cache-warm prefix + delta-only compression).",
  "app.updatedAt": "Updated {now} · runtime {runtime}",
  "app.statusError": "Failed to read status: {error}",
  "app.loading": "Loading…",
  "app.hubPanel": "hub panel ↗",
  "app.hubPanelTitle": "Open the native hub dashboard: {url}",
  "app.autoOn": "Auto-refresh: on",
  "app.autoOff": "Auto-refresh: off",
  "app.footer.pre":
    "This console listens on 127.0.0.1 only and is for local use. For deep management (API keys, model limits, daily quotas, check-in tasks) use the ",
  "app.footer.panel": "native hub dashboard",
  "app.footer.post": ".",

  // ── Header controls ──
  "app.theme.aria": "Theme",
  "app.theme.system": "System",
  "app.theme.light": "Light",
  "app.theme.dark": "Dark",
  "app.lang.aria": "Language",

  // ── Banners ──
  "app.banner.hubDown": "hub is not responding — the service is down or stopped. Use “Start” below.",
  "app.banner.poolEmpty":
    "The account pool is empty, so models can’t be called yet. Click “Sign in (Intl / CN)” and finish the OAuth flow.",
  "app.banner.ready": "Chain ready: {total} account(s), {ready} usable.",
  "app.banner.headroomDown":
    "Headroom is not responding — the compression hop is down and clients won’t connect.",
  "app.banner.realmMismatch":
    "The exit realm is “{realm}”, but none of the {total} pooled account(s) belong to it — calls will fail with 503. Switch the exit realm in the hub panel, or add an account for that realm.",

  // ── Common ──
  "common.refresh": "Refresh",
  "common.refreshing": "Refreshing…",
  "common.copy": "Copy",
  "common.copied": "Copied",
  "common.copyFailed": "Copy failed",
  "common.show": "Show",
  "common.hide": "Hide",
  "common.copyFailedHint":
    "The browser blocked clipboard access. The text is selected — press ⌘C / Ctrl+C to copy it manually.",
  "common.cancel": "Cancel",
  "common.hubOffline": "hub offline",
  "common.dash": "—",
  "common.realm.intl": "Intl",
  "common.realm.cn": "CN",

  // ── Request chain ──
  "chain.title": "Request chain",
  "chain.client.title": "WorkBuddy client",
  "chain.client.desc": "custom model",
  "chain.headroom.desc": ":{port} cache-warm + delta compression{pid}",
  "chain.hub.desc": ":{port} protocol translation / multi-account{pid}",
  "chain.pid": "　PID {pid}",
  "chain.model.title": "built-in models",
  "chain.model.desc": "{realm} ({domain})",
  "chain.model.default": "copilot / workbuddy.ai",

  // ── Account pool ──
  "pool.title": "Account pool",
  "pool.readyTotal": "Ready / total",
  "pool.realm": "Egress realm",
  "pool.auth": "/v1 auth",
  "pool.keyRequired": "API key required",
  "pool.keyOff": "off",
  "pool.loginIntl": "Sign in (Intl)",
  "pool.loginCn": "Sign in (CN)",
  "pool.keepalive": "Keep-alive now",
  "pool.keeping": "Keeping alive…",
  "pool.starting": "Requesting an authorization URL from upstream…",
  "pool.waitingHint":
    "Authorization link generated ({realm}). This page will detect the callback automatically once you finish signing in.",
  "pool.waitingMsg": "Waiting for the browser to finish signing in…",
  "pool.waitingMsg2": "Waiting for authorization… ({msg})",
  "pool.openAuth": "Open authorization page",
  "pool.done": "{realm} account added — ready to use.",
  "pool.failed": "Failed: {msg}",
  "pool.got": "Got it",
  "pool.errNoUrl": "Upstream did not return an authorization URL",

  // ── Headroom savings ──
  "savings.title": "Headroom savings",
  "savings.mode": "Mode",
  "savings.mode.cache": "cache · keeps provider cache",
  "savings.mode.token": "token · compresses history",
  "savings.requests": "Requests",
  "savings.requestsValue": "{total} ({compressed} compressed)",
  "savings.offline": "Headroom offline",
  "savings.saved": "Tokens saved",
  "savings.ratio": "Savings rate",
  "savings.reasons": "Not compressed",
  "savings.reason.prefix_frozen": "prefix frozen ×{n}",
  "savings.reason.too_small": "too small ×{n}",
  "savings.reason.no_compressible_content": "nothing compressible ×{n}",
  "savings.reason.passthrough": "passthrough ×{n}",
  "savings.reason.unknown_token_accounting": "no token accounting ×{n}",
  "savings.note.cache":
    "Running in cache mode: the history prefix is replayed byte-for-byte to keep the upstream prompt cache warm (a cache hit costs 2% of a miss), while only the newest delta gets compressed — so a 0 here is expected, not a fault. To compress history as well, restart with HEADROOM_MODE=token.",
  "savings.note.token":
    "token mode is on but nothing has been compressed yet: compression only targets large tool-output / log blocks; plain chat messages count as stable content that must keep the cache warm.",
  "savings.note.ok":
    "Compression happens only in the Headroom hop; the hub only does protocol translation and account scheduling — it does not compress.",
  "savings.verify": "Self-check: bash scripts/test-compression.sh",

  // ── Client setup ──
  "client.title": "Client setup",
  "client.path": "WorkBuddy → Settings → Models → Add model → Custom",
  "client.chatUrl": "Endpoint",
  "client.apiKey": "API key",
  "client.model": "Model name",
  "client.noModels": "(model list unavailable)",
  "client.keySource": "Current key source: ",
  "client.keySource.panel": "API key set in the hub dashboard (takes precedence over the CLI)",
  "client.keySource.launcher": "generated by this skill (stored in hub.env)",
  "client.keySource.tail": ". If you add a key in the dashboard, that one wins.",

  // ── Accounts ──
  "accounts.title": "Accounts",
  "accounts.col.nickname": "Nickname",
  "accounts.col.realm": "Realm",
  "accounts.col.status": "Status",
  "accounts.col.credits": "Credits",
  "accounts.col.expires": "Expires in",
  "accounts.col.refresh": "Refresh token",
  "accounts.col.source": "Source",
  "accounts.status.disabled": "disabled",
  "accounts.status.cooldown": "cooling down",
  "accounts.status.reserve": "credits protected",
  "accounts.status.ok": "ready",
  "accounts.loadError": "Failed to load: {err}",
  "accounts.empty": "No accounts yet — add one with the OAuth buttons above",
  "accounts.yes": "yes",
  "accounts.no": "no",

  // ── Logs & services ──
  "logs.title": "Logs & services",
  "logs.action.start": "Start services",
  "logs.action.stop": "Stop services",
  "logs.action.restart": "Restart services",
  "logs.confirm": "Confirm: {action}",
  "logs.confirmStop": " (clients will disconnect)",
  "logs.running": "Running: {action}…",
  "logs.busy": "Working…",
  "logs.noOutput": "(no output)",
  "logs.readError": "Failed to read logs: {msg}",
  "logs.readErrorShort": "Failed to read logs",
  "logs.tab.hub": "hub log",
  "logs.tab.headroom": "Headroom log",
  "logs.refresh": "Refresh",
  "logs.panelLink": "Open the native hub dashboard (accounts / keys / usage / check-in)",
  "logs.panelPassword": "Panel password: {pw}",
};

export const dicts = { zh, en } as const;
export type Lang = keyof typeof dicts;
