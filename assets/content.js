/* ============================================================================
 * iskill-headroom-workbuddy · 落地页内容
 * 只改这个文件就能换掉整页文案（外加 index.html 顶部 8 行 meta）。
 * ==========================================================================*/
window.PROMO = {
  name: "ISKILL-HEADROOM-WORKBUDDY",
  brand: "#10c8a1",
  brand2: "#38bdf8",
  repo: "https://github.com/aispin/iskill-headroom-workbuddy",
  repoLabel: "aispin/iskill-headroom-workbuddy",

  /* ── 平台兼容性标签（Hero「AI 技能」右边那枚）───────────────────────────
   * 取值 "mac-windows" | "macos" | "windows" | "linux" | "all" | "" | {zh,en}
   * 判据：跑 sips/osascript/open/lsof//opt/homebrew 硬路径 = 仅 macOS；
   *       有 .ps1/taskkill/win32 分支 = 支持 Windows；纯提示词或纯 Node/Python = all。
   * 标错比不写更糟。详见 promo-page/references/design-guide.md §十。
   */
  platform: "mac-windows",
  lang: {
    /* ── 中文 ───────────────────────────────────────────────────────── */
    zh: {
      meta: {
        title: "ISKILL-HEADROOM-WORKBUDDY · 把内置模型变成本地 OpenAI 接口",
        description: "WorkBuddy 桌面端内置模型 → 人人可用的 OpenAI 兼容 API。hub 负责「能用」：协议转换、看板 OAuth 加账号、多账号双区域调度、每日保活；headroom 负责「耐用」：守住上游缓存并只压最新增量，让会话跑得更远。"
      },
      a11y: { skip: "跳到主要内容" },
      ui: { copy: "复制", copied: "已复制", failed: "复制失败" },
      nav: { features: "能力", shots: "控制台", how: "上手", faq: "问答" },

      hero: {
        badge: "AI 技能",
        titlePre: "把内置模型",
        titleAccent: "变成本地 OpenAI 接口",
        titlePost: "",
        sub: "hub 让内置模型「用得上」，headroom 让它「跑得远」：一条链路解决协议转换、账号调度与缓存守护。客户端 → Headroom(:8787) → workbuddy2api-hub(:8788) → 官方模型，前面还挂一个单端口控制台。",
        ctaPrimary: "复制安装提示词",
        ctaSecondary: "看源码",
        meta1: "本地运行",
        meta2: "macOS / Windows 双击即用",
        meta3: "看板 OAuth 加账号"
      },
      terminal: {
        title: "zsh — iskill-headroom-workbuddy",
        lines: [
          [{ t: "$ ", c: "p" }, { t: "bash scripts/start.sh", c: "k" }, { t: "   # macOS / Linux", c: "s" }],
          [{ t: "> ", c: "p" }, { t: "hwb.cmd", c: "k" }, { t: "                 # Windows · 双击也行", c: "s" }],
          [{ t: "✓ ", c: "p" }, { t: "hub :8788 + headroom :8787 已就绪", c: "s" }],
          [{ t: "→ ", c: "p" }, { t: "控制台 http://127.0.0.1:8786", c: "k" }]
        ]
      },

      stats: [
        { value: "1 : 12", label: "上游缓存的杠杆", note: "命中单价仅为未命中的 2%，实测前缀命中率 92–97%" },
        { value: "2", label: "个组件，各管一头", note: "hub 让它「用得上」 / headroom 让它「跑得远」" },
        { value: "0", label: "次抓包", note: "看板 OAuth 加账号，账号自动进池" },
        { value: "1", label: "个端口看全部", note: "控制台 :8786 单端口托管" }
      ],

      compare: {
        eyebrow: "对比",
        title: "以前 vs 现在",
        sub: "",
        before: {
          title: "自己抓 token 拼接口",
          items: ["netlog 抓包、密钥还解不开（AES-256-GCM 且密钥不落盘）", "多账号手工切换，区域不匹配时静默 503", "上下文一路涨，token 也跟着涨"]
        },
        after: {
          title: "一条命令，或双击一下",
          items: ["看板 OAuth 加账号，彻底告别抓包", "多账号双区域自动调度，区域不匹配控制台直接告警", "守住上游缓存（命中 2% 单价），压缩只动最新增量", "macOS / Windows / Linux 同一份实现，另配双击启动器"]
        }
      },

      features: {
        eyebrow: "能力",
        title: "这条链路替你干的活",
        sub: "",
        items: [
          { icon: "layers", title: "缓存守护 + 增量压缩", desc: "Headroom 在链路最前：默认 <code>cache</code> 模式冻结历史前缀、守住上游 prompt cache（命中单价仅为未命中的 2%），只压每轮最新到的工具输出——这才是本链路省钱的大头。要连历史一起压再切 <code>HEADROOM_MODE=token</code>。" },
          { icon: "users", title: "看板 OAuth 加账号", desc: "不再抓包。授权一次，服务端代持面板会话，账号自动进池。" },
          { icon: "branch", title: "多账号双区域调度", desc: "cn / intl 两个出口，账号池按区域过滤；不匹配时不再静默失败，控制台直接弹告警横幅。" },
          { icon: "refresh", title: "每日自动保活", desc: "每天 22:00 定时 refresh，账号不会自己掉线。" },
          { icon: "monitor", title: "单端口控制台", desc: "链路健康、账号池、省流统计、日志尾巴、启停服务，一页看完，运行时不需要 Node。" },
          { icon: "lang", title: "中英双语 + 深浅色", desc: "跟随系统设置，也可以 <code>?lang=en&amp;theme=dark</code> 直达，方便截图与分享。" }
        ]
      },

      showcase: {
        eyebrow: "控制台",
        title: "长这样",
        sub: "深浅两色由同一份代码渲染，主题与语言都跟随系统。",
        items: [
          { src: "assets/console-theme-light.png", alt: "控制台浅色版", caption: "控制台 · 浅色" },
          { src: "assets/console-theme-dark.png", alt: "控制台深色版", caption: "控制台 · 深色" }
        ]
      },

      steps: {
        eyebrow: "上手",
        title: "三步跑起来",
        sub: "",
        items: [
          {
            title: "交给 AI 装",
            desc: "把提示词粘给 AI，它会拉代码、读文档；运行时全部落在 ~/.iskill-headroom-workbuddy/。",
            codeKey: "install"
          },
          {
            title: "起服务（或直接双击）",
            desc: "首次启动会下载 Kompress ONNX 模型，给足 180 秒。macOS 双击 <code>hwb.command</code>、Windows 双击 <code>hwb.cmd</code> 会弹出菜单（启动 / 停止 / 重启 / 状态 / 控制台 / 加账号）；命令行里也能按动作调用。",
            codeName: "shell",
            code: "# macOS / Linux\nbash scripts/start.sh\n\n# Windows（PowerShell）\n.\\hwb.ps1 start        # 或双击 hwb.cmd 走菜单\n\n# 想连历史一起压（首请求要加载模型，约 32s）\nHEADROOM_MODE=token bash scripts/start.sh"
          },
          {
            title: "配客户端",
            desc: "在 WorkBuddy 里加一个自定义模型指向本地端点，API Key 从控制台那行复制。",
            codeName: "text",
            code: "# WorkBuddy → 设置 → 模型 → 添加模型 → 自定义/Custom\n# 接口地址  http://localhost:8787/v1/chat/completions\n# API Key   见控制台「客户端配置」一行（默认打码，点「显示」）"
          }
        ]
      },

      faq: {
        eyebrow: "问答",
        title: "常见问题",
        items: [
          { q: "Windows 上能用吗？", a: "能，而且不必装 Git Bash。启动器是一份跨平台 Python 实现（<code>scripts/hwb.py</code>）：Windows 上双击 <code>hwb.cmd</code> 出菜单，命令行则用 <code>.\\hwb.ps1 start</code>。只有「桌面端 CDP / netlog 抓包」那套排障脚本是 macOS 专属，属于可选手段，不影响主流程。" },
          { q: "能不能不用 AI，手动装？", a: "可以。clone 到技能目录（如 <code>~/.workbuddy/skills/</code>）后跑 <code>bash scripts/start.sh</code> 即可。" },
          { q: "为什么省流统计一直是 0？", a: "两点原因，都不是故障：①默认 <code>cache</code> 模式只压最新那条增量，历史前缀按字节回放以守住上游 prompt cache（命中单价仅为未命中的 2%），那部分省的是缓存折扣、不计入 <code>tokens_saved</code>；②纯聊天没有「活区」（活区边界 = 第一个未压缩的 tool_result），本来就压不动。所以显示 0 多数时候是正常的。真要连历史一起压，用 <code>HEADROOM_MODE=token</code> 重启。" },
          { q: "调用返回 503？", a: "多半是区域不匹配：账号档案的 realm 与 hub 出口区域不一致。控制台会直接弹告警横幅，一键切成对应区域即可。" },
          { q: "首次启动像是卡住了？", a: "在下载 Kompress ONNX 模型。8787 还不监听、日志是空的，都属于正常过程，等约 100 秒。" },
          { q: "会替代官方客户端吗？", a: "不会。它只是把内置模型暴露成 OpenAI 兼容端点，官方客户端照常使用，两者互不影响。" }
        ]
      },

      cta: {
        title: "现在就能用 curl 调它",
        desc: "一条命令（或双击一下）起完，控制台里复制 Key 就能跑。",
        primary: "去 GitHub 看看",
        secondary: "复制安装提示词"
      },
      footer: { license: "MIT 许可", madeWith: "由 iskill-promo-page 生成" }
    },

    /* ── English ────────────────────────────────────────────────────── */
    en: {
      meta: {
        title: "ISKILL-HEADROOM-WORKBUDDY · Your built-in models as a local OpenAI API",
        description: "WorkBuddy desktop models → an OpenAI-compatible API anyone can use. The hub makes them usable: protocol translation, dashboard OAuth for accounts, dual-region scheduling, daily keep-alive. Headroom makes them last: it keeps the upstream cache warm and compresses only the newest delta."
      },
      a11y: { skip: "Skip to content" },
      ui: { copy: "Copy", copied: "Copied", failed: "Copy failed" },
      nav: { features: "Features", shots: "Console", how: "Get started", faq: "FAQ" },

      hero: {
        badge: "AI skill",
        titlePre: "Your built-in models as ",
        titleAccent: "a local OpenAI API",
        titlePost: "",
        sub: "The hub makes built-in models usable; Headroom makes them last. One chain covers protocol translation, account scheduling and cache protection. Client → Headroom(:8787) → workbuddy2api-hub(:8788) → official models, with a single-port console in front.",
        ctaPrimary: "Copy install prompt",
        ctaSecondary: "View source",
        meta1: "Runs locally",
        meta2: "macOS / Windows · double-click",
        meta3: "Dashboard OAuth"
      },
      terminal: {
        title: "zsh — iskill-headroom-workbuddy",
        lines: [
          [{ t: "$ ", c: "p" }, { t: "bash scripts/start.sh", c: "k" }, { t: "   # macOS / Linux", c: "s" }],
          [{ t: "> ", c: "p" }, { t: "hwb.cmd", c: "k" }, { t: "                 # Windows · double-click", c: "s" }],
          [{ t: "✓ ", c: "p" }, { t: "hub :8788 + headroom :8787 ready", c: "s" }],
          [{ t: "→ ", c: "p" }, { t: "console http://127.0.0.1:8786", c: "k" }]
        ]
      },

      stats: [
        { value: "1 : 12", label: "the upstream cache lever", note: "a cache hit costs 2% of a miss; measured hit rate 92–97%" },
        { value: "2", label: "components, two jobs", note: "the hub makes them usable; Headroom makes them last" },
        { value: "0", label: "packet captures", note: "add accounts through dashboard OAuth" },
        { value: "1", label: "port for everything", note: "the console owns :8786" }
      ],

      compare: {
        eyebrow: "Comparison",
        title: "Before vs after",
        sub: "",
        before: {
          title: "Capture tokens, stitch an API",
          items: ["netlog packet capture, and the payload still won't decrypt", "Accounts switched by hand; a realm mismatch fails silently with 503", "Context grows, so does the bill"]
        },
        after: {
          title: "One command — or one double-click",
          items: ["Add accounts through dashboard OAuth — no packet capture at all", "Dual-region scheduling, with mismatches surfaced as a console banner", "Keeps the upstream cache warm (hits cost 2%), compressing only the newest delta", "One codebase for macOS / Windows / Linux, with double-click launchers"]
        }
      },

      features: {
        eyebrow: "Features",
        title: "What the chain does for you",
        sub: "",
        items: [
          { icon: "layers", title: "Cache protection + delta compression", desc: "Headroom sits first: default <code>cache</code> mode freezes the history prefix to keep the upstream prompt cache warm (a hit costs 2% of a miss) and compresses only the newest tool output — that is where the real savings come from. Switch to <code>HEADROOM_MODE=token</code> to compress history as well." },
          { icon: "users", title: "Dashboard OAuth", desc: "No more packet capture. Authorise once; the server holds the panel session and the account joins the pool." },
          { icon: "branch", title: "Dual-region scheduling", desc: "Two egress regions (cn / intl) with the pool filtered per region. Mismatches are no longer silent — the console shows a banner." },
          { icon: "refresh", title: "Daily keep-alive", desc: "A scheduled refresh at 22:00 keeps accounts from dropping out." },
          { icon: "monitor", title: "Single-port console", desc: "Chain health, account pool, savings stats, log tails and service control on one page — and it needs no Node at runtime." },
          { icon: "lang", title: "Bilingual, light and dark", desc: "Follows your system settings, or go straight there with <code>?lang=en&amp;theme=dark</code> — handy for screenshots and sharing." }
        ]
      },

      showcase: {
        eyebrow: "Console",
        title: "What it looks like",
        sub: "Light and dark come from the same code; both theme and language follow the system.",
        items: [
          { src: "assets/console-theme-light.png", alt: "Console, light theme", caption: "Console · light" },
          { src: "assets/console-theme-dark.png", alt: "Console, dark theme", caption: "Console · dark" }
        ]
      },

      steps: {
        eyebrow: "Get started",
        title: "Up and running in three steps",
        sub: "",
        items: [
          {
            title: "Let your agent install it",
            desc: "Paste the line into the chat — runtime data all lives in ~/.iskill-headroom-workbuddy/.",
            codeKey: "install"
          },
          {
            title: "Start the services (or just double-click)",
            desc: "The first launch downloads the Kompress ONNX model — give it 180 seconds. On macOS double-click <code>hwb.command</code>; on Windows double-click <code>hwb.cmd</code> for a menu (start / stop / restart / status / console / add account). Both also take an action argument.",
            codeName: "shell",
            code: "# macOS / Linux\nbash scripts/start.sh\n\n# Windows (PowerShell)\n.\\hwb.ps1 start        # or double-click hwb.cmd for the menu\n\n# want real compression? (rewrites already-sent prefixes)\nHEADROOM_MODE=token bash scripts/start.sh"
          },
          {
            title: "Point your client at it",
            desc: "Add a custom model in WorkBuddy and copy the key from the console.",
            codeName: "text",
            code: "# WorkBuddy → Settings → Models → Add model → Custom\n# Endpoint  http://localhost:8787/v1/chat/completions\n# API key   from the console's Client config row (masked by default)"
          }
        ]
      },

      faq: {
        eyebrow: "FAQ",
        title: "Frequently asked",
        items: [
          { q: "Does it work on Windows?", a: "Yes, and you do not need Git Bash. The launcher is one cross-platform Python program (<code>scripts/hwb.py</code>): on Windows double-click <code>hwb.cmd</code> for the menu, or run <code>.\\hwb.ps1 start</code> from PowerShell. Only the older desktop CDP / netlog capture troubleshooting scripts are macOS-only — they are optional and do not affect the main flow." },
          { q: "Can I install it without an agent?", a: "Sure. Clone it into your skills directory (e.g. <code>~/.workbuddy/skills/</code>) and run <code>bash scripts/start.sh</code>." },
          { q: "Why do savings always show 0?", a: "Two reasons, neither a fault: ① the default <code>cache</code> mode compresses only the newest delta — the history prefix is replayed byte-for-byte to keep the upstream prompt cache warm (a hit costs 2% of a miss), and those gains show up as a cache discount rather than in <code>tokens_saved</code>; ② plain chat has no \"live zone\" (the zone starts at the first uncompressed <code>tool_result</code>), so there is nothing to compress. A 0 is usually expected. Restart with <code>HEADROOM_MODE=token</code> to compress history as well." },
          { q: "Calls come back 503.", a: "Almost always a realm mismatch: the account's realm differs from the hub's egress region. The console raises a banner and offers a one-click switch." },
          { q: "The first start looks frozen.", a: "It is downloading the Kompress ONNX model. Port 8787 not listening and an empty log are both expected — give it about 100 seconds." },
          { q: "Does it replace the official client?", a: "No. It only exposes the built-in models as an OpenAI-compatible endpoint; the official client keeps working alongside it." }
        ]
      },

      cta: {
        title: "You can curl it in a minute",
        desc: "One command (or one double-click), then copy the key from the console.",
        primary: "Open on GitHub",
        secondary: "Copy install prompt"
      },
      footer: { license: "MIT licensed", madeWith: "Built with iskill-promo-page" }
    }
  }
};
