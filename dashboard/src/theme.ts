import { useCallback, useEffect, useState } from "react";

export type ThemeMode = "system" | "light" | "dark";

const THEME_KEY = "iskill-dashboard-theme";
const DARK_BG = "#0d1117";
const LIGHT_BG = "#f5f6f8";

/** URL 覆盖：?theme=dark —— 只对本次加载生效，不写 localStorage（方便出图/分享直达） */
function fromQuery(): ThemeMode | null {
  try {
    const v = new URLSearchParams(window.location.search).get("theme");
    if (v === "light" || v === "dark" || v === "system") return v;
  } catch {
    /* 忽略 */
  }
  return null;
}

/** 默认主题：URL 参数 > localStorage > 跟随系统。 */
export function detectTheme(): ThemeMode {
  const q = fromQuery();
  if (q) return q;
  try {
    const v = localStorage.getItem(THEME_KEY);
    if (v === "light" || v === "dark" || v === "system") return v;
  } catch {
    /* 忽略 */
  }
  return "system";
}

function prefersDark(): boolean {
  return typeof window.matchMedia === "function"
    ? window.matchMedia("(prefers-color-scheme: dark)").matches
    : false;
}

export function isDark(mode: ThemeMode): boolean {
  return mode === "dark" || (mode === "system" && prefersDark());
}

/** 把主题落到 DOM：<html class="dark"> + 状态栏 theme-color */
export function applyTheme(mode: ThemeMode): void {
  if (typeof document === "undefined") return;
  const dark = isDark(mode);
  document.documentElement.classList.toggle("dark", dark);

  let meta = document.querySelector('meta[name="theme-color"]');
  if (!meta) {
    meta = document.createElement("meta");
    meta.setAttribute("name", "theme-color");
    document.head.appendChild(meta);
  }
  meta.setAttribute("content", dark ? DARK_BG : LIGHT_BG);
}

export function useTheme() {
  const [mode, setModeState] = useState<ThemeMode>(detectTheme);

  const setMode = useCallback((m: ThemeMode) => {
    setModeState(m);
    try {
      localStorage.setItem(THEME_KEY, m);
    } catch {
      /* 忽略 */
    }
  }, []);

  useEffect(() => {
    applyTheme(mode);
    if (mode !== "system") return;
    // 选了「跟随系统」时，系统主题一变立刻跟上
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyTheme("system");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [mode]);

  return { mode, setMode };
}
