import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { dicts, type Dict, type Lang } from "./dict";

const LANG_KEY = "iskill-dashboard-lang";

/** URL 覆盖：?lang=en —— 只对本次加载生效，不写 localStorage */
function fromQuery(): Lang | null {
  try {
    const v = new URLSearchParams(window.location.search).get("lang");
    if (v === "zh" || v === "en") return v;
  } catch {
    /* 忽略 */
  }
  return null;
}

/** 默认语言：URL 参数 > localStorage > 跟随系统（zh* → 中文，其余 → 英文）。 */
export function detectLang(): Lang {
  const q = fromQuery();
  if (q) return q;
  try {
    const saved = localStorage.getItem(LANG_KEY);
    if (saved === "zh" || saved === "en") return saved;
  } catch {
    /* 隐私模式下 localStorage 可能不可用 */
  }
  const nav = (navigator.language || "zh").toLowerCase();
  return nav.startsWith("zh") ? "zh" : "en";
}

type Vars = Record<string, string | number>;

interface I18nCtxValue {
  lang: Lang;
  setLang: (l: Lang) => void;
  /** t("pool.done", { realm: "国际版" }) —— {name} 占位符做字符串插值 */
  t: (key: keyof Dict, vars?: Vars) => string;
}

const I18nCtx = createContext<I18nCtxValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(detectLang);

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    try {
      localStorage.setItem(LANG_KEY, l);
    } catch {
      /* 忽略 */
    }
  }, []);

  useEffect(() => {
    document.documentElement.lang = lang === "zh" ? "zh-CN" : "en";
  }, [lang]);

  const value = useMemo<I18nCtxValue>(() => {
    const dict = dicts[lang] as Dict;
    const t = (key: keyof Dict, vars?: Vars) => {
      let s: string = dict[key] ?? String(key);
      if (vars) {
        for (const k of Object.keys(vars)) {
          s = s.split(`{${k}}`).join(String(vars[k]));
        }
      }
      return s;
    };
    return { lang, setLang, t };
  }, [lang, setLang]);

  return <I18nCtx.Provider value={value}>{children}</I18nCtx.Provider>;
}

export function useI18n(): I18nCtxValue {
  const ctx = useContext(I18nCtx);
  if (!ctx) throw new Error("useI18n 必须在 <I18nProvider> 内使用");
  return ctx;
}

/** 只要翻译函数时的快捷写法 */
export function useT() {
  return useI18n().t;
}
