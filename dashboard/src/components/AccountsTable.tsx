import type { ReactNode } from "react";
import { useT } from "../i18n";
import type { Account, StatusPayload } from "../types";
import { Card, Pill } from "./ui";

export function AccountsTable({ data }: { data: StatusPayload | null }) {
  const t = useT();
  const accounts = data?.hub.accounts ?? [];
  const err = data?.hub.accounts_error;

  const fmt = (n: number | undefined) => (n ?? 0).toLocaleString("en-US");

  // hub 的 credits 是对象 {remain, used, size, packages, updated_at, updated_iso}
  // （wb_accounts.fetch_credits）；直接渲染对象会触发 React #31「对象不能作为子节点」。
  // 这里归一成「剩余 / 总量」文本，数字/字符串旧形态保持原样输出。
  const creditCell = (a: Account): ReactNode => {
    const c = a.credits;
    if (c === null || c === undefined) return t("common.dash");
    if (typeof c === "object") {
      const remain = typeof c.remain === "number" ? c.remain : undefined;
      const size = typeof c.size === "number" ? c.size : undefined;
      if (remain === undefined && size === undefined) return t("common.dash");
      const text = size ? `${fmt(remain ?? 0)} / ${fmt(size)}` : fmt(remain ?? 0);
      return <span title={c.updated_iso || undefined}>{text}</span>;
    }
    return String(c);
  };

  const realmLabel = (r?: string) =>
    r === "intl"
      ? t("common.realm.intl")
      : r === "cn"
        ? t("common.realm.cn")
        : r || t("common.dash");

  const statusOf = (a: Account): { tone: "ok" | "warn" | "err"; text: string } => {
    if (a.enabled === false) return { tone: "err", text: t("accounts.status.disabled") };
    if (a.inCooldown) return { tone: "warn", text: t("accounts.status.cooldown") };
    if (a.reserveBlocked) return { tone: "warn", text: t("accounts.status.reserve") };
    return { tone: "ok", text: t("accounts.status.ok") };
  };

  const headers = [
    t("accounts.col.nickname"),
    t("accounts.col.realm"),
    t("accounts.col.status"),
    t("accounts.col.credits"),
    t("accounts.col.expires"),
    t("accounts.col.refresh"),
    t("accounts.col.source"),
  ];

  let body: ReactNode;
  if (err) {
    body = (
      <tr>
        <td colSpan={7} className="py-3 text-ink-soft">
          {t("accounts.loadError", { err })}
        </td>
      </tr>
    );
  } else if (!data?.hub.reachable) {
    body = (
      <tr>
        <td colSpan={7} className="py-3 text-ink-soft">
          {t("common.hubOffline")}
        </td>
      </tr>
    );
  } else if (!accounts.length) {
    body = (
      <tr>
        <td colSpan={7} className="py-3 text-ink-soft">
          {t("accounts.empty")}
        </td>
      </tr>
    );
  } else {
    body = accounts.map((a) => {
      const s = statusOf(a);
      return (
        <tr key={a.uid} className="border-b border-line last:border-0">
          <td className="px-2.5 py-1.5">{a.nickname || a.uid?.slice(0, 8)}</td>
          <td className="px-2.5 py-1.5">{realmLabel(a.realm)}</td>
          <td className="px-2.5 py-1.5">
            <Pill tone={s.tone}>{s.text}</Pill>
          </td>
          <td className="px-2.5 py-1.5">{creditCell(a)}</td>
          <td className="px-2.5 py-1.5">{a.expiresIn ?? t("common.dash")}</td>
          <td className="px-2.5 py-1.5">
            {a.hasRefreshToken ? t("accounts.yes") : <span className="text-ink-soft">{t("accounts.no")}</span>}
          </td>
          <td className="px-2.5 py-1.5 text-ink-soft">{a.source ?? t("common.dash")}</td>
        </tr>
      );
    });
  }

  return (
    <Card title={t("accounts.title")}>
      <div className="thin-scroll overflow-x-auto">
        <table className="w-full border-collapse text-[12.5px]">
          <thead>
            <tr className="bg-sunken text-[12px] text-ink-soft">
              {headers.map((h) => (
                <th key={h} className="whitespace-nowrap px-2.5 py-1.5 text-left font-medium">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="whitespace-nowrap">{body}</tbody>
        </table>
      </div>
    </Card>
  );
}
