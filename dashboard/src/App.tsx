import { useEffect, useState, type ReactNode } from "react";
import { AccountsTable } from "./components/AccountsTable";
import { ChainCard } from "./components/ChainCard";
import { ClientCard } from "./components/ClientCard";
import { LogsCard } from "./components/LogsCard";
import { PoolCard } from "./components/PoolCard";
import { SavingsCard } from "./components/SavingsCard";
import { Button, IconMonitor, IconMoon, IconSun, Segmented, SteadyLabel } from "./components/ui";
import { useStatus } from "./hooks/useStatus";
import { useI18n } from "./i18n";
import { useTheme, type ThemeMode } from "./theme";

function Banner({ tone, children }: { tone: "ok" | "warn" | "err"; children: ReactNode }) {
  const cls = {
    ok: "border-ok/35 bg-ok-soft text-ok-ink",
    warn: "border-warn/35 bg-warn-soft text-warn-ink",
    err: "border-err/35 bg-err-soft text-err-ink",
  }[tone];
  return <div className={`rounded-lg border px-3.5 py-2.5 text-[13px] ${cls}`}>{children}</div>;
}

export default function App() {
  const { data, error, auto, setAuto, refresh, updatedAt, loading } = useStatus(5000);
  const { t, lang, setLang } = useI18n();
  const { mode: themeMode, setMode: setThemeMode } = useTheme();
  const [logTick, setLogTick] = useState(0);

  useEffect(() => {
    if (updatedAt) setLogTick((t) => t + 1);
  }, [updatedAt]);

  const ready = data?.hub.health.accounts_ready ?? 0;
  const total = data?.hub.health.accounts ?? 0;
  const hubUp = data?.hub.reachable ?? false;
  const hrUp = data?.headroom.reachable ?? false;
  // 出口区域 ≠ 账号所在区域 —— /health 的计数不分区域，于是「池里有账号」和
  // 「调用 503」会同时成立。判据：全局有账号，但当前区域的账号列表是空的。
  const realm = data?.hub.health.realm;
  const realmMismatch = hubUp && total > 0 && (data?.hub.accounts?.length ?? 0) === 0;

  const meta = data
    ? t("app.updatedAt", { now: data.now, runtime: data.runtime })
    : error
      ? t("app.statusError", { error })
      : t("app.loading");

  return (
    <div className="mx-auto max-w-[1100px] px-5 pt-5 pb-16">
      <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <img
            src={`${import.meta.env.BASE_URL}favicon.svg`}
            alt=""
            width={40}
            height={40}
            className="h-10 w-10 shrink-0"
          />
          <div className="min-w-0">
            <h1 className="m-0 text-[19px] font-semibold tracking-wide">{t("app.title")}</h1>
            <p className="mt-0.5 max-w-[640px] text-[12.5px] leading-relaxed text-ink-soft">
              {t("app.desc")}
            </p>
            <div className="mt-1 text-[12.5px] text-ink-soft">{meta}</div>
          </div>
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Segmented
            ariaLabel={t("app.lang.aria")}
            value={lang}
            onChange={setLang}
            items={[
              { value: "zh", label: "中", title: "中文" },
              { value: "en", label: "EN", title: "English" },
            ]}
          />
          <Segmented
            ariaLabel={t("app.theme.aria")}
            value={themeMode}
            onChange={(v: ThemeMode) => setThemeMode(v)}
            items={[
              { value: "system", label: <IconMonitor />, title: t("app.theme.system") },
              { value: "light", label: <IconSun />, title: t("app.theme.light") },
              { value: "dark", label: <IconMoon />, title: t("app.theme.dark") },
            ]}
          />
          {data?.client.panel_url && (
            <a
              href={data.client.panel_url}
              target="_blank"
              rel="noopener noreferrer"
              title={t("app.hubPanelTitle", { url: data.client.panel_url })}
              className="inline-flex h-7 items-center whitespace-nowrap rounded-lg border border-line-strong bg-surface px-2.5 text-[12.5px] transition-colors hover:bg-hover"
            >
              {t("app.hubPanel")}
            </a>
          )}
          <Button size="sm" disabled={loading} onClick={() => void refresh()}>
            <SteadyLabel
              active={loading ? 1 : 0}
              options={[t("common.refresh"), t("common.refreshing")]}
            />
          </Button>
          <Button size="sm" onClick={() => setAuto(!auto)}>
            <SteadyLabel
              active={auto ? 0 : 1}
              options={[t("app.autoOn"), t("app.autoOff")]}
            />
          </Button>
        </div>
      </header>

      <div className="mb-3.5 flex flex-col gap-2.5">
        {!hubUp && <Banner tone="err">{t("app.banner.hubDown")}</Banner>}
        {hubUp && realmMismatch && (
          <Banner tone="warn">
            {t("app.banner.realmMismatch", {
              realm: realm === "cn" ? t("common.realm.cn") : t("common.realm.intl"),
              total,
            })}
          </Banner>
        )}
        {hubUp && !realmMismatch && ready === 0 && (
          <Banner tone="warn">{t("app.banner.poolEmpty")}</Banner>
        )}
        {hubUp && !realmMismatch && ready > 0 && (
          <Banner tone="ok">{t("app.banner.ready", { total, ready })}</Banner>
        )}
        {hubUp && !hrUp && <Banner tone="warn">{t("app.banner.headroomDown")}</Banner>}
      </div>

      <div className="flex flex-col gap-3.5">
        <ChainCard data={data} />

        <div className="flex flex-wrap gap-3.5">
          <div className="min-w-[290px] flex-1">
            <PoolCard data={data} onChanged={() => void refresh()} />
          </div>
          <div className="min-w-[290px] flex-1">
            <SavingsCard data={data} />
          </div>
        </div>

        <ClientCard data={data} />
        <AccountsTable data={data} />
        <LogsCard data={data} onChanged={() => void refresh()} tick={logTick} />
      </div>

      <p className="mt-5 rounded-lg border border-dashed border-line-strong bg-sunken px-3 py-2.5 text-[12.5px] text-ink-soft">
        {t("app.footer.pre")}
        {data?.client.panel_url ? (
          <a
            href={data.client.panel_url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-brand underline underline-offset-2 hover:no-underline"
          >
            {t("app.footer.panel")}
          </a>
        ) : (
          t("app.footer.panel")
        )}
        {t("app.footer.post")}
      </p>
    </div>
  );
}
