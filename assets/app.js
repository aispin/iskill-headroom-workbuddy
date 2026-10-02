/* ============================================================================
 * iskill-promo-page · 运行时
 *
 * 四件事：① 主题（跟随系统 / 手动 / URL 参数）② 语言（中英）
 *        ③ 从 content.js 渲染卡片列表 ④ 滚动入场、复制、顶栏状态
 *
 * 用传统 <script>（非 ES module），这样 file:// 直接双击打开也能跑。
 * ==========================================================================*/
(function () {
  var P = window.PROMO || {};
  var ICONS = window.PROMO_ICONS || {};
  var html = document.documentElement;

  /* ── 工具 ─────────────────────────────────────────────────────────── */
  function qs(sel, root) { return (root || document).querySelector(sel); }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function icon(name) {
    var s = ICONS[name] || ICONS.check;
    return s || "";
  }
  function param(name) {
    try { return new URLSearchParams(location.search).get(name); } catch (e) { return null; }
  }
  function store(key, val) {
    try { if (val == null) return localStorage.getItem(key); localStorage.setItem(key, val); } catch (e) {}
    return null;
  }

  /* ── 安装方式：交给 agent，而不是让用户抄命令 ────────────────────────
   *
   * 一键复制的是「说给 AI 听的一句话」，不是 `git clone …`。原因：
   *  · 技能装在哪（~/.workbuddy/skills/、.claude/skills/…）取决于用户用哪个 agent，
   *    写死路径等于替用户做了错决定；
   *  · agent 装完能顺手读 SKILL.md 讲用法，比用户自己翻 README 快得多；
   *  · 手抄长 URL 容易错一个字符。
   *
   * 提示词默认由 repo 推导，逐技能可用 installPrompt:{zh,en} 覆盖；
   * 模板里可写 {repo} / {repoShort}（owner/name）/ {name} 占位符。
   */
  var PROMPT = {
    zh: "请帮我安装 Skill：{repo}，并告诉我它的用法",
    en: "Install this skill: {repo} and tell me how to use it"
  };
  function repoShort() {
    return (P.repoLabel ||
      String(P.repo || "").replace(/^https?:\/\/github\.com\//, "").replace(/\.git$/, "") || "GitHub");
  }
  function installPrompt(lang) {
    var ov = P.installPrompt;
    var tpl = (ov && (ov[lang] || ov.zh)) || PROMPT[lang] || PROMPT.zh;
    return String(tpl)
      .replace(/\{repo\}/g, P.repo || "")
      .replace(/\{repoShort\}/g, repoShort())
      .replace(/\{name\}/g, P.name || repoShort());
  }

  /* ── ① 主题 ───────────────────────────────────────────────────────── */
  var mql = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;
  function systemTheme() { return mql && mql.matches ? "dark" : "light"; }

  function detectTheme() {
    var q = param("theme");
    if (q === "dark" || q === "light") return { theme: q, persist: false };
    var saved = store("promo-theme");
    if (saved === "dark" || saved === "light") return { theme: saved, persist: true };
    return { theme: systemTheme(), persist: false };
  }
  function applyTheme(theme, persist) {
    html.classList.toggle("dark", theme === "dark");
    html.classList.toggle("light", theme === "light");
    if (persist) store("promo-theme", theme);
    var btn = qs("#theme-toggle");
    if (btn) {
      btn.innerHTML = icon(theme === "dark" ? "sun" : "moon") + '<span class="lbl">theme</span>';
      btn.setAttribute("aria-label", theme === "dark" ? "切换到浅色" : "切换到深色");
      btn.dataset.theme = theme;
    }
    /* 槽位里嵌的页面也要跟着换肤（走 postMessage，不重载 iframe） */
    syncSlotFrames();
  }

  /* ── ② 语言 ───────────────────────────────────────────────────────── */
  function detectLang() {
    var q = param("lang");
    if (q === "zh" || q === "en") return { lang: q, persist: false };
    var saved = store("promo-lang");
    if (saved === "zh" || saved === "en") return { lang: saved, persist: true };
    var nav = (navigator.language || "zh").toLowerCase();
    return { lang: nav.indexOf("zh") === 0 ? "zh" : "en", persist: false };
  }

  /* ── ③ 渲染 ───────────────────────────────────────────────────────── */
  function get(obj, path) {
    return path.split(".").reduce(function (o, k) { return o == null ? o : o[k]; }, obj);
  }

  function uiText(dict, key, fallback) {
    var v = get(dict, "ui." + key);
    return typeof v === "string" && v ? v : fallback;
  }

  function applyText(dict) {
    var nodes = document.querySelectorAll("[data-i18n]");
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      var v = get(dict, n.getAttribute("data-i18n"));
      if (typeof v === "string") n.textContent = v;
    }
  }

  function termLine(segs) {
    var line = el("div", "term-line");
    (Array.isArray(segs) ? segs : [{ t: String(segs) }]).forEach(function (s) {
      line.appendChild(el("span", s.c || "", s.t));
    });
    return line;
  }

  function renderTerminal(head, lines) {
    var bar = qs("#term-bar");
    var body = qs("#term-body");
    if (!body) return;
    if (bar) { bar.innerHTML = ""; ["", "", ""].forEach(function () { bar.appendChild(el("i")); }); bar.appendChild(el("b", null, head || "")); }
    body.innerHTML = "";
    var rows = lines || [];
    rows.forEach(function (segs, i) {
      var line = termLine(segs);
      body.appendChild(line);
      setTimeout(function () { line.classList.add("in"); }, 220 + i * 170);
    });
    var cursorLine = el("div", "term-line");
    cursorLine.appendChild(el("span", "term-cursor"));
    body.appendChild(cursorLine);
    setTimeout(function () { cursorLine.classList.add("in"); }, 220 + rows.length * 170);
  }

  function renderStats(list) {
    var box = qs("#stats .grid");
    if (!box) return;
    box.innerHTML = "";
    (list || []).forEach(function (s, i) {
      var c = el("div", "card stat reveal d" + Math.min(i, 3));
      c.appendChild(el("div", "v", s.value));
      c.appendChild(el("div", "k", s.label));
      if (s.note) c.appendChild(el("div", "n", s.note));
      box.appendChild(c);
    });
  }

  function renderCompare(data) {
    if (!data) return;
    var box = qs("#compare .grid");
    if (!box) return;
    box.innerHTML = "";
    [["before", data.before], ["after", data.after]].forEach(function (pair) {
      var kind = pair[0], d = pair[1] || {};
      var c = el("div", "card cmp " + kind);
      var h = el("h3");
      h.innerHTML = icon(kind === "before" ? "cross" : "check") + "<span>" + (d.title || "") + "</span>";
      c.appendChild(h);
      var ul = el("ul");
      (d.items || []).forEach(function (t) {
        var li = el("li");
        li.innerHTML = icon(kind === "before" ? "cross" : "check") + "<span>" + t + "</span>";
        ul.appendChild(li);
      });
      c.appendChild(ul);
      box.appendChild(c);
    });
  }

  function renderFeatures(data) {
    if (!data) return;
    var box = qs("#features .grid");
    if (!box) return;
    box.innerHTML = "";
    (data.items || []).forEach(function (f) {
      var c = el("div", "card feat reveal");
      var ic = el("div", "ic");
      ic.innerHTML = icon(f.icon);
      c.appendChild(ic);
      c.appendChild(el("h3", null, f.title));
      var p = el("p");
      p.innerHTML = f.desc || "";
      c.appendChild(p);
      box.appendChild(c);
    });
  }

  function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");
  }

  /* 复制按钮的文案（随语言变），由 render() 每次刷新 */
  var UI = { copy: "复制", copied: "已复制", failed: "复制失败" };
  /* 当前语言：槽位里的 iframe 在 load / 切主题时要拿它回推给子页 */
  var LANG = "zh";

  function renderSteps(data, lang) {
    if (!data) return;
    var box = qs("#how .list"); /* 注意：section 的 id 是 #how，别写成 #steps */
    if (!box) return;
    box.innerHTML = "";
    (data.items || []).forEach(function (s, i) {
      /* codeKey: "install" → 用推导出来的安装提示词，别在 content.js 里抄一遍 URL */
      var isPrompt = s.codeKey === "install";
      var codeText = isPrompt ? installPrompt(lang) : s.code;
      var wrap = el("div", "step reveal");
      var num = el("div", "num", String(i + 1));
      var body = el("div", "body");
      body.appendChild(el("h3", null, s.title));
      body.appendChild(el("p", null, s.desc));
      if (codeText) {
        var code = el("div", "code" + (isPrompt ? " code-prompt" : ""));
        var head = el("div", "code-head");
        head.appendChild(el("span", "name", s.codeName || (isPrompt ? "prompt" : "shell")));
        var btn = el("button", "code-copy");
        btn.type = "button";
        btn.dataset.copy = codeText;
        btn.innerHTML = icon("copy") + "<span>" + UI.copy + "</span>";
        head.appendChild(btn);
        code.appendChild(head);
        var pre = el("pre");
        if (isPrompt) {
          /* 提示词不是 shell：不做 # 注释着色（否则 URL 里出现 # 会被整段染色），
             长 URL 靠 CSS 换行而不是横向滚动 */
          pre.textContent = codeText;
        } else {
          pre.innerHTML = esc(codeText).replace(/(#[^\n]*)/g, '<span class="c">$1</span>');
        }
        code.appendChild(pre);
        body.appendChild(code);
      }
      wrap.appendChild(num);
      wrap.appendChild(body);
      box.appendChild(wrap);
    });
  }

  function renderFaq(data) {
    if (!data) return;
    var box = qs("#faq .list");
    if (!box) return;
    box.innerHTML = "";
    (data.items || []).forEach(function (f) {
      var d = el("details", "card");
      d.appendChild(el("summary", null, f.q));
      d.appendChild(el("div", "a", f.a));
      box.appendChild(d);
    });
  }

  function renderShowcase(data) {
    var sec = qs("#shots");
    if (!sec) return;
    var items = (data && data.items) || [];
    if (!items.length) { sec.style.display = "none"; return; }
    sec.style.display = "";
    var box = qs("#shots .grid");
    box.innerHTML = "";
    items.forEach(function (s) {
      var fig = el("figure", "card shot reveal");
      var img = el("img");
      img.src = s.src;
      img.alt = s.alt || "";
      img.loading = "lazy";
      fig.appendChild(img);
      if (s.caption) fig.appendChild(el("figcaption", null, s.caption));
      box.appendChild(fig);
    });
  }

  /* ── 槽位（可插拔扩展点） ──────────────────────────────────────────────
   *
   * 骨架里声明 <div class="slot" data-slot="名字">，这里按 content.js 的
   * slots[名字] 往里填。两种形态：
   *   html   —— 一段内联 HTML（可写成 {zh, en} 双语，切语言跟着换）
   *   iframe —— 嵌一个自包含页面（如 usage.html）
   *
   * 「跟随宿主」刻意分成两条通道，各管一段：
   *   · 首次加载 → 把当前 lang/theme 拼进 src 的 hash。hash 在子页自己的头脚本里
   *     **最先**被读到，没有「监听器还没绑上」的竞态（这套在
   *     iskill-generate-sponsors 的 index.html ↔ sponsors.html 之间已经踩过一遍）。
   *   · 之后切换 → postMessage 推给子页，**不重载 iframe** —— 重载会丢子页状态
   *     （用户可能已经切到某个 tab），还会闪一下。
   *   · 子页 load 完再推一次，兜住「切语言早于子页 boot」那一瞬。
   * 子页认不认这两条通道由它自己决定：不认只是不跟随，不会报错。
   */
  function slotText(v, lang) {
    if (v == null) return "";
    if (typeof v === "string") return v;
    return v[lang] || v.zh || v.en || "";
  }

  function currentTheme() { return html.classList.contains("dark") ? "dark" : "light"; }

  /* 子页若认这套协议，就能跟着宿主切主题/语言而不重载 */
  function syncSlot(f, lang) {
    if (!f || f.getAttribute("data-sync") === "off") return;
    try {
      f.contentWindow.postMessage({ promoSlotSync: { lang: lang, theme: currentTheme() } }, "*");
    } catch (e) { /* 跨源 / 子页已销毁：静默即可 */ }
  }
  function syncSlotFrames() {
    var fs = document.querySelectorAll("iframe.slot-frame");
    [].forEach.call(fs, function (f) { syncSlot(f, f.getAttribute("data-lang") || LANG); });
  }

  function renderSlots(lang) {
    var slots = P.slots || {};
    var hosts = document.querySelectorAll("[data-slot]");
    [].forEach.call(hosts, function (host) {
      var name = host.getAttribute("data-slot");
      var cfg = slots[name];

      /* 没配置：清空 → :empty 命中 display:none。整块消失，且不占网格行，
         所以「加了锚点但没配内容」的老页面视觉上零变化。 */
      if (!cfg) { if (host.firstChild) host.innerHTML = ""; return; }

      if (cfg.iframe) {
        var f = host.querySelector("iframe.slot-frame");
        if (!f) {
          host.innerHTML = "";
          f = el("iframe", "slot-frame");
          f.setAttribute("loading", "lazy");
          if (cfg.iframe.height) f.style.setProperty("--slot-h", cfg.iframe.height + "px");
          if (cfg.iframe.sync === false) f.setAttribute("data-sync", "off");
          f.addEventListener("load", function () { syncSlot(f, f.getAttribute("data-lang") || LANG); });
          /* 主题/语言走 hash：首帧就一致（postMessage 赶不上子页的头脚本） */
          var h = cfg.iframe.sync === false ? "" : "#lang=" + lang + "&theme=" + currentTheme();
          f.src = cfg.iframe.src + h;
          host.appendChild(f);
        } else {
          syncSlot(f, lang); /* 只推消息，不重载 */
        }
        f.setAttribute("data-lang", lang);
        f.setAttribute("title", slotText(cfg.iframe.title, lang) || name);
        return;
      }

      /* html 形态：双语时切语言会重渲染 */
      if (typeof cfg.html !== "undefined") {
        host.innerHTML = '<div class="slot-html">' + slotText(cfg.html, lang) + "</div>";
      }
    });
  }

  function paintLinks() {
    var repo = P.repo || "#";
    var label = repoShort();
    [["#repo-link", repo], ["#hero-repo", repo], ["#cta-repo", repo], ["#footer-repo", repo]]
      .forEach(function (p) { var n = qs(p[0]); if (n) n.href = p[1]; });
    var lb = qs("#repo-label");
    if (lb) lb.textContent = label;
    // 窄屏下仓库名会被 CSS 收起（只留图标）→ 用 aria-label 顶住可访问名称
    var rl = qs("#repo-link");
    if (rl) rl.setAttribute("aria-label", "GitHub · " + label);
    if (P.name) {
      var fn = qs("#footer-name");
      if (fn) fn.textContent = P.name;
    }
  }

  /* 复制目标是语言相关的（提示词要换语言），所以每次 render 都重刷一次 */
  function paintCopyTargets(lang) {
    var text = installPrompt(lang);
    [qs("#hero-copy"), qs("#cta-copy")].forEach(function (n) {
      if (n) n.setAttribute("data-copy", text);
    });
  }

  /* ── 平台兼容性标签（Hero 标题上方，「AI 技能」右边那枚）─────────────────
     为什么要有它：这些技能不少是「macOS 写脚本、Windows 跑不了」的，
     再不然就是依赖 ffmpeg / sips / 剪映 这类有明显平台差异的东西 ——
     用户扫一眼落地页就想知道「我这台机器能不能用」。这是**操作系统**兼容性，
     与「能装在哪家 agent」（Claude Code / Cursor…）是两码事，后者仍不进标签。 */
  var OS_LABEL = {
    "mac-windows": { zh: "macOS / Windows", en: "macOS / Windows" },
    "macos":       { zh: "仅 macOS",        en: "macOS only" },
    "windows":     { zh: "仅 Windows",      en: "Windows only" },
    "linux":       { zh: "仅 Linux",        en: "Linux only" },
    "all":         { zh: "全平台",          en: "All platforms" }
  };

  function renderPlatformBadge(lang) {
    var host = qs("#hero-os");
    if (!host) {
      /* 老页面：骨架里还没有这枚 badge（模板升级了、但那个页面的 index.html 没跟着换）。
         就地补一个 —— 这样「只同步 app.js / style.css」就能拿到平台标签，
         不用去动人家已经改过 meta 与品牌名的 index.html。 */
      var first = qs(".hero .badge");
      if (!first || !first.parentNode) return;
      var row = first.parentNode;
      if (!row.classList || !row.classList.contains("hero-kicker")) {
        row = document.createElement("div");
        row.className = "hero-kicker";
        first.parentNode.insertBefore(row, first);
        row.appendChild(first);
      }
      host = document.createElement("span");
      host.className = "badge badge-os";
      host.id = "hero-os";
      host.hidden = true;
      row.appendChild(host);
    }
    var p = P.platform, text = "";
    if (p && typeof p === "object") {
      text = slotText(p, lang);                       // { zh, en } 自定义
    } else if (p) {
      var hit = OS_LABEL[p];
      text = hit ? (hit[lang] || hit.zh) : String(p); // 未知键原样显示，便于作者自查
    }
    if (!text) { host.hidden = true; host.innerHTML = ""; return; }  // 不配 = 不显示
    var ic = (window.PROMO_ICONS || {}).monitor || "";
    host.innerHTML = ic + "<span></span>";
    host.querySelector("span").textContent = text;
    host.setAttribute("title", (lang === "en" ? "Verified on " : "已在以下系统验证：") + text);
    host.hidden = false;
  }

  function render(lang) {
    var dict = (P.lang && (P.lang[lang] || P.lang.zh)) || {};
    UI = {
      copy: uiText(dict, "copy", "复制"),
      copied: uiText(dict, "copied", "已复制"),
      failed: uiText(dict, "failed", "复制失败")
    };
    applyText(dict);
    renderPlatformBadge(lang);
    renderTerminal((dict.terminal || {}).title, (dict.terminal || {}).lines);
    renderStats(dict.stats);
    renderCompare(dict.compare);
    renderFeatures(dict.features);
    renderShowcase(dict.showcase);
    renderSteps(dict.steps, lang);
    renderFaq(dict.faq);
    LANG = lang;
    renderSlots(lang); /* 槽位跟着语言重渲染（iframe 只推消息、不重载） */
    paintCopyTargets(lang);
    html.setAttribute("lang", lang === "zh" ? "zh-CN" : "en");
    if (dict.meta) {
      document.title = dict.meta.title || document.title;
      var md = qs('meta[name="description"]');
      if (md && dict.meta.description) md.setAttribute("content", dict.meta.description);
    }
    var seg = qs("#lang-seg");
    if (seg) {
      [].forEach.call(seg.querySelectorAll("button"), function (b) {
        b.setAttribute("aria-pressed", String(b.dataset.lang === lang));
      });
    }
    observeReveals();
  }

  /* ── ④ 交互 ───────────────────────────────────────────────────────── */
  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text).then(function () { return true; }, function () { return legacyCopy(text); });
    }
    return Promise.resolve(legacyCopy(text));
  }
  function legacyCopy(text) {
    try {
      var ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.top = "-1000px";
      document.body.appendChild(ta);
      ta.select();
      var ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    } catch (e) { return false; }
  }

  function bindCopy() {
    document.addEventListener("click", function (e) {
      var btn = e.target.closest ? e.target.closest("[data-copy]") : null;
      if (!btn) return;
      var text = btn.getAttribute("data-copy");
      if (!text) return;
      var label = btn.querySelector("span");
      /* 先记住原文案再改成反馈 —— 否则「复制安装提示词」这类标签会被永久覆盖成「复制」 */
      var original = label ? label.textContent : "";
      copyText(text).then(function (ok) {
        var tmp = ok ? UI.copied : UI.failed;
        btn.classList.toggle("done", !!ok);
        if (label) label.textContent = tmp;
        setTimeout(function () {
          btn.classList.remove("done");
          /* 只在标签还停在反馈文案时才还原：期间切了语言的话，
             它已被 applyText 换成新语言的原文案，别再用旧语言盖回去 */
          if (label && label.textContent === tmp) label.textContent = original;
        }, 1600);
      });
    });
  }

  var io = null;
  function observeReveals() {
    var nodes = document.querySelectorAll(".reveal:not(.in)");
    /* 整页截图/打印/无 JS 场景：加 ?reveal=all 一次全亮，
       否则滚动入场会让「没滚到」的区块在截图里保持透明。 */
    if (param("reveal") === "all" || !("IntersectionObserver" in window)) {
      [].forEach.call(nodes, function (n) { n.classList.add("in"); });
      return;
    }
    if (!io) {
      io = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          if (en.isIntersecting) { en.target.classList.add("in"); io.unobserve(en.target); }
        });
      }, { rootMargin: "0px 0px -8% 0px", threshold: 0.08 });
    }
    [].forEach.call(nodes, function (n) { io.observe(n); });
  }

  function bindTopbar() {
    var bar = qs(".topbar");
    if (!bar) return;
    var onScroll = function () { bar.classList.toggle("scrolled", window.scrollY > 8); };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
  }

  function bindGlow() {
    document.addEventListener("pointermove", function (e) {
      var card = e.target.closest ? e.target.closest(".feat") : null;
      if (!card) return;
      var r = card.getBoundingClientRect();
      card.style.setProperty("--mx", (e.clientX - r.left) + "px");
      card.style.setProperty("--my", (e.clientY - r.top) + "px");
    }, { passive: true });
  }

  function paintBrand() {
    if (P.brand) html.style.setProperty("--brand", P.brand);
    if (P.brand2) html.style.setProperty("--brand2", P.brand2);
  }

  /* ── 启动 ─────────────────────────────────────────────────────────── */
  function boot() {
    paintBrand();
    paintLinks();

    /* 首帧的类已由 <head> 里的内联脚本打好，这里只做「确认 + 绑定按钮图标」，
       不再写 localStorage（URL 参数只作用于本次加载）。 */
    applyTheme(detectTheme().theme, false);

    var l = detectLang();
    render(l.lang);

    var tb = qs("#theme-toggle");
    if (tb) {
      tb.addEventListener("click", function () {
        var next = html.classList.contains("dark") ? "light" : "dark";
        applyTheme(next, true);
      });
    }
    var seg = qs("#lang-seg");
    if (seg) {
      seg.addEventListener("click", function (e) {
        var b = e.target.closest ? e.target.closest("button") : null;
        if (!b || !b.dataset.lang) return;
        store("promo-lang", b.dataset.lang);
        render(b.dataset.lang);
      });
    }
    /* URL 里带了 lang/theme 只作用于本次加载，不写 localStorage */
    if (mql && mql.addEventListener) {
      mql.addEventListener("change", function () {
        if (!store("promo-theme") && !param("theme")) applyTheme(systemTheme(), false);
      });
    }

    bindCopy();
    bindTopbar();
    bindGlow();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
