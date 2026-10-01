import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { useT } from "../i18n";
import type { Realm, StatusPayload } from "../types";
import { Button, Card, Pill } from "./ui";

/** 状态里只存「结构化信息 + 上游原文」，不存译文——否则切语言时旧消息不会更新 */
type Phase =
  | { kind: "idle" }
  | { kind: "starting"; realm: Realm }
  | { kind: "waiting"; realm: Realm; state: string; authUrl: string; detail?: string }
  | { kind: "done"; realm: Realm }
  | { kind: "failed"; detail?: string };

export function PoolCard({
  data,
  onChanged,
}: {
  data: StatusPayload | null;
  onChanged: () => void;
}) {
  const t = useT();
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [busy, setBusy] = useState(false);
  const pollTimer = useRef<number | null>(null);
  /** 授权页窗口句柄：登录一结束就把它关掉，用户视线自动回到控制台 */
  const authWin = useRef<Window | null>(null);

  /**
   * 打开授权页。注意**不能带 noopener** —— 带了 window.open 返回 null，
   * 就拿不到句柄、之后没法自动关闭。改为手动把 opener 置空，同样断掉反向引用。
   */
  function openAuth(url: string) {
    const w = window.open(url, "_blank");
    if (w) {
      try {
        w.opener = null;
      } catch {
        /* 跨源下忽略 */
      }
      authWin.current = w;
    }
    return w;
  }

  /** 关闭授权页（登录成功或取消后调用）；关不掉就算了，不影响主流程 */
  function closeAuth() {
    const w = authWin.current;
    authWin.current = null;
    if (!w) return;
    try {
      if (!w.closed) w.close();
    } catch {
      /* 跨源限制下忽略 */
    }
  }

  const realmLabel = (r: Realm) =>
    r === "intl" ? t("common.realm.intl") : t("common.realm.cn");

  const stopPolling = () => {
    if (pollTimer.current !== null) {
      window.clearTimeout(pollTimer.current);
      pollTimer.current = null;
    }
  };

  useEffect(
    () => () => {
      stopPolling();
      closeAuth();
    },
    [],
  );

  const health = data?.hub.health ?? {};
  const ready = health.accounts_ready ?? 0;
  const total = health.accounts ?? 0;

  async function start(realm: Realm) {
    stopPolling();
    setPhase({ kind: "starting", realm });
    try {
      const res = await api.loginStart(realm);
      if (!res.authUrl || !res.state) {
        setPhase({ kind: "failed", detail: res.error ?? res._error });
        return;
      }
      openAuth(res.authUrl);
      setPhase({ kind: "waiting", realm, state: res.state, authUrl: res.authUrl });
      poll(res.state, realm);
    } catch (e) {
      setPhase({ kind: "failed", detail: e instanceof Error ? e.message : String(e) });
    }
  }

  function poll(state: string, realm: Realm) {
    pollTimer.current = window.setTimeout(async () => {
      try {
        const res = await api.loginPoll(state);
        const status = res.status ?? "pending";
        if (status === "ok") {
          stopPolling();
          closeAuth(); // 授权页那句「返回 CLI」我们改不了，但可以替用户把页签收掉
          setPhase({ kind: "done", realm });
          onChanged();
          return;
        }
        if (status === "expired" || status === "error" || status === "unknown") {
          stopPolling();
          closeAuth();
          setPhase({ kind: "failed", detail: res.message ?? status });
          return;
        }
        setPhase((prev) =>
          prev.kind === "waiting" ? { ...prev, detail: res.message ?? undefined } : prev,
        );
        poll(state, realm);
      } catch (e) {
        stopPolling();
        setPhase({ kind: "failed", detail: e instanceof Error ? e.message : String(e) });
      }
    }, 2000);
  }

  async function cancel() {
    stopPolling();
    closeAuth();
    if (phase.kind === "waiting") {
      try {
        await api.loginCancel(phase.state);
      } catch {
        /* 取消失败无所谓 */
      }
    }
    setPhase({ kind: "idle" });
  }

  async function refreshAll() {
    setBusy(true);
    try {
      await api.refreshAccounts();
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title={t("pool.title")}>
      <dl className="grid grid-cols-[92px_1fr] items-center gap-x-2.5 gap-y-1.5">
        <dt className="text-[12.5px] text-ink-soft">{t("pool.readyTotal")}</dt>
        <dd>
          {data?.hub.reachable ? (
            <Pill tone={ready > 0 ? "ok" : "err"}>
              {ready} / {total}
            </Pill>
          ) : (
            <Pill tone="err">{t("common.hubOffline")}</Pill>
          )}
        </dd>
        <dt className="text-[12.5px] text-ink-soft">{t("pool.realm")}</dt>
        <dd className="text-[13px]">{health.realm ?? t("common.dash")}</dd>
        <dt className="text-[12.5px] text-ink-soft">{t("pool.auth")}</dt>
        <dd>
          {health.api_key_required ? (
            <Pill>{t("pool.keyRequired")}</Pill>
          ) : (
            <Pill tone="ok">{t("pool.keyOff")}</Pill>
          )}
        </dd>
      </dl>

      <div className="mt-3.5 flex flex-wrap items-center gap-2">
        <Button
          variant="primary"
          size="sm"
          disabled={phase.kind === "starting" || phase.kind === "waiting"}
          onClick={() => void start("intl")}
        >
          {t("pool.loginIntl")}
        </Button>
        <Button
          variant="primary"
          size="sm"
          disabled={phase.kind === "starting" || phase.kind === "waiting"}
          onClick={() => void start("cn")}
        >
          {t("pool.loginCn")}
        </Button>
        <Button size="sm" disabled={busy} onClick={() => void refreshAll()}>
          {busy ? t("pool.keeping") : t("pool.keepalive")}
        </Button>
      </div>

      {phase.kind !== "idle" && (
        <div className="mt-3 rounded-lg border border-dashed border-line-strong bg-sunken px-3 py-2.5 text-[12.5px]">
          {phase.kind === "starting" && <span className="text-ink-soft">{t("pool.starting")}</span>}

          {phase.kind === "waiting" && (
            <>
              <div className="text-ink-soft">
                {t("pool.waitingHint", { realm: realmLabel(phase.realm) })}
                <div className="mt-1">
                  {phase.detail
                    ? t("pool.waitingMsg2", { msg: phase.detail })
                    : t("pool.waitingMsg")}
                </div>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => openAuth(phase.authUrl)}
                >
                  {t("pool.openAuth")}
                </Button>
                <Button size="sm" onClick={() => void cancel()}>
                  {t("common.cancel")}
                </Button>
              </div>
            </>
          )}

          {phase.kind === "done" && (
            <span className="text-ok">{t("pool.done", { realm: realmLabel(phase.realm) })}</span>
          )}

          {phase.kind === "failed" && (
            <span className="text-err">
              {t("pool.failed", { msg: phase.detail ?? t("pool.errNoUrl") })}
            </span>
          )}

          {phase.kind === "done" && (
            <div className="mt-2">
              <Button size="sm" onClick={() => setPhase({ kind: "idle" })}>
                {t("pool.got")}
              </Button>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
