import { useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { useT } from "../i18n";
import { copyText, selectText } from "../lib/clipboard";

/**
 * 复制按钮的三态文案。
 * 用 SteadyLabel 叠放，宽度取最宽者——否则「复制 → 已复制 → 复制失败」
 * 会让整排控件左右跳动。
 */
export function useCopyFeedback(duration = 1400) {
  const t = useT();
  const [state, setState] = useState<"idle" | "ok" | "fail">("idle");
  const timer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (timer.current) window.clearTimeout(timer.current);
    },
    [],
  );

  const flash = (ok: boolean) => {
    setState(ok ? "ok" : "fail");
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setState("idle"), duration);
  };

  return {
    state,
    flash,
    /** 传给 SteadyLabel 的三个候选文案，顺序即 state 的 0/1/2 */
    labels: [t("common.copy"), t("common.copied"), t("common.copyFailed")],
    active: state === "idle" ? 0 : state === "ok" ? 1 : 2,
    title: state === "fail" ? t("common.copyFailedHint") : undefined,
  };
}

export function Card({
  title,
  action,
  children,
  className = "",
}: {
  title?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`rounded-xl border border-line bg-surface p-4 shadow-[0_1px_2px_rgba(16,24,40,.03)] ${className}`}
    >
      {(title || action) && (
        <header className="mb-3 flex items-center justify-between gap-3">
          {title && <h2 className="text-[14px] font-semibold">{title}</h2>}
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

type Tone = "neutral" | "ok" | "warn" | "err";

const toneClass: Record<Tone, string> = {
  neutral: "border-brand/35 bg-brand-soft text-brand",
  ok: "border-ok/35 bg-ok-soft text-ok",
  warn: "border-warn/35 bg-warn-soft text-warn",
  err: "border-err/35 bg-err-soft text-err",
};

export function Pill({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span
      className={`inline-block rounded-full border px-2 py-[1px] text-[11.5px] leading-5 ${toneClass[tone]}`}
    >
      {children}
    </span>
  );
}

export function Dot({ state }: { state: "on" | "off" | "idle" }) {
  const color = state === "on" ? "bg-ok" : state === "off" ? "bg-err" : "bg-muted";
  return <span className={`inline-block size-2 shrink-0 rounded-full ${color}`} />;
}

export function Button({
  variant = "default",
  size = "md",
  className = "",
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "default" | "primary" | "ghost";
  size?: "sm" | "md";
}) {
  // 高度显式给定，不用 py 撑——否则内容换成图标（撑不出文字行框）就会矮一截。
  // sm 与 Segmented、外链锚点共用 h-7，保证同一排控件基线齐平。
  const base =
    "inline-flex items-center justify-center rounded-lg border transition-colors disabled:cursor-not-allowed disabled:opacity-45 whitespace-nowrap";
  const sizes = { sm: "h-7 px-2.5 text-[12.5px]", md: "h-[34px] px-3.5 text-[13px]" }[size];
  const variants = {
    default: "border-line-strong bg-surface hover:bg-hover",
    primary: "border-brand bg-brand text-on-brand hover:brightness-110",
    ghost: "border-transparent bg-transparent text-brand hover:bg-brand-soft",
  }[variant];
  return <button className={`${base} ${sizes} ${variants} ${className}`} {...rest} />;
}

/**
 * 定宽文案：多个候选文案叠在同一网格格里，控件宽度取最宽者。
 * 用于「刷新 ⇄ 刷新中…」这类切换 —— 换文案时宽度不变，不会有跳动。
 * 相比写死像素宽度，好处是不用猜宽度、任何语言都不会被截断。
 */
export function SteadyLabel({ options, active }: { options: ReactNode[]; active: number }) {
  return (
    <span className="grid place-items-center">
      {options.map((o, i) => (
        <span
          key={i}
          aria-hidden={i === active ? undefined : true}
          className={`col-start-1 row-start-1 whitespace-nowrap ${i === active ? "" : "invisible"}`}
        >
          {o}
        </span>
      ))}
    </span>
  );
}

/** 顶栏用的分段选择器（语言 / 主题） */
export function Segmented<T extends string>({
  value,
  onChange,
  items,
  ariaLabel,
}: {
  value: T;
  onChange: (v: T) => void;
  items: { value: T; label: ReactNode; title?: string }[];
  ariaLabel?: string;
}) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className="flex h-7 overflow-hidden rounded-lg border border-line-strong bg-surface"
    >
      {items.map((it) => (
        <button
          key={it.value}
          type="button"
          title={it.title}
          aria-pressed={value === it.value}
          onClick={() => onChange(it.value)}
          className={`flex h-full items-center justify-center gap-1 px-2 text-[12.5px] transition-colors ${
            value === it.value
              ? "bg-brand text-on-brand"
              : "text-ink-soft hover:bg-hover hover:text-ink"
          }`}
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}

/* ── 主题图标：手绘内联 SVG，不用 emoji ── */

export function IconMonitor() {
  return (
    <svg viewBox="0 0 16 16" width="13" height="13" fill="none" aria-hidden="true">
      <rect x="1.6" y="2.6" width="12.8" height="8.6" rx="1.4" stroke="currentColor" strokeWidth="1.3" />
      <path d="M5.6 13.6h4.8M8 11.2v2.4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

export function IconSun() {
  return (
    <svg viewBox="0 0 16 16" width="13" height="13" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="3.1" stroke="currentColor" strokeWidth="1.3" />
      <path
        d="M8 1v1.7M8 13.3V15M15 8h-1.7M2.7 8H1M12.95 3.05l-1.2 1.2M4.25 11.75l-1.2 1.2M12.95 12.95l-1.2-1.2M4.25 4.25l-1.2-1.2"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function IconMoon() {
  return (
    <svg viewBox="0 0 16 16" width="13" height="13" fill="none" aria-hidden="true">
      <path
        d="M13.4 9.6A5.9 5.9 0 0 1 6.4 2.6 5.9 5.9 0 1 0 13.4 9.6Z"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * 密钥掩码：首 8 尾 4，中间打点。太短的串整体打点——
 * 短串露出首尾跟直接明文没区别。
 */
export function maskSecret(v: string): string {
  if (!v) return "";
  if (v.length <= 12) return "•".repeat(v.length);
  return `${v.slice(0, 8)}${"•".repeat(8)}${v.slice(-4)}`;
}

/**
 * 只读文本 + 复制按钮。
 *
 * `secret` 打开时默认打码，点「显示」就地换成明文——**复制始终复制明文**，
 * 跟当前显示状态无关。悬停 title 也只在明文时才给全量，否则打码状态下移上去
 * 就把密钥漏了（打码的意义就没了）。
 */
export function CopyBox({
  value,
  secret = false,
}: {
  value: string;
  secret?: boolean;
}) {
  const t = useT();
  const { flash, labels, active, title } = useCopyFeedback();
  const [reveal, setReveal] = useState(false);
  const codeRef = useRef<HTMLElement | null>(null);

  const masked = secret && !reveal;
  const shown = masked ? maskSecret(value) : value;

  return (
    <div className="flex min-w-0 items-center gap-1.5 rounded-lg border border-line bg-sunken px-2 py-1">
      <code ref={codeRef} className="min-w-0 flex-1 select-all truncate font-mono text-[12.5px]" title={shown}>
        {shown}
      </code>
      {secret && (
        <Button variant="ghost" size="sm" disabled={!value} onClick={() => setReveal((v) => !v)}>
          <SteadyLabel options={[t("common.show"), t("common.hide")]} active={reveal ? 1 : 0} />
        </Button>
      )}
      <Button
        variant="ghost"
        size="sm"
        title={title}
        disabled={!value}
        onClick={async () => {
          const ok = await copyText(value, masked ? null : codeRef.current);
          if (!ok) {
            // 没复制成功就得让用户能手动选中——打码状态下先把明文铺出来，否则选中的是掩码
            if (masked) {
              setReveal(true);
              requestAnimationFrame(() => codeRef.current && selectText(codeRef.current));
            } else if (codeRef.current) {
              selectText(codeRef.current);
            }
          }
          flash(ok);
        }}
      >
        <SteadyLabel options={labels} active={active} />
      </Button>
    </div>
  );
}

export function KeyRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-[12.5px] text-ink-soft">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </>
  );
}
