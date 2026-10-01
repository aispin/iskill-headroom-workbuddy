import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import { useT } from "../i18n";
import type { StatusPayload } from "../types";
import { Button, Card } from "./ui";

type LogName = "hub" | "headroom";
type Action = "start" | "stop" | "restart";

const ACTION_KEY: Record<Action, "logs.action.start" | "logs.action.stop" | "logs.action.restart"> = {
  start: "logs.action.start",
  stop: "logs.action.stop",
  restart: "logs.action.restart",
};

export function LogsCard({
  data,
  onChanged,
  tick,
}: {
  data: StatusPayload | null;
  onChanged: () => void;
  tick: number;
}) {
  const t = useT();
  const [tab, setTab] = useState<LogName>("hub");
  const [text, setText] = useState("—");
  const [busy, setBusy] = useState<Action | null>(null);

  const load = useCallback(
    async (name: LogName) => {
      try {
        const res = await api.logs(name, 150);
        setText(res.text || "—");
      } catch (e) {
        setText(
          e instanceof Error ? t("logs.readError", { msg: e.message }) : t("logs.readErrorShort"),
        );
      }
    },
    [t],
  );

  useEffect(() => {
    void load(tab);
  }, [tab, load, tick]);

  async function run(action: Action) {
    if (action !== "start") {
      const ok = window.confirm(
        t("logs.confirm", { action: t(ACTION_KEY[action]) }) +
          (action === "stop" ? t("logs.confirmStop") : ""),
      );
      if (!ok) return;
    }
    setBusy(action);
    setText(t("logs.running", { action: t(ACTION_KEY[action]) }));
    try {
      const res = await api.service(action);
      setText(res.output || res.error || t("logs.noOutput"));
    } catch (e) {
      setText(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
      onChanged();
    }
  }

  return (
    <Card
      title={t("logs.title")}
      action={
        <div className="flex flex-wrap items-center gap-1.5">
          {(["start", "restart", "stop"] as Action[]).map((a) => (
            <Button key={a} size="sm" disabled={busy !== null} onClick={() => void run(a)}>
              {busy === a ? t("logs.busy") : t(ACTION_KEY[a])}
            </Button>
          ))}
        </div>
      }
    >
      <div className="mb-2.5 flex gap-1">
        {(["hub", "headroom"] as LogName[]).map((n) => (
          <Button
            key={n}
            size="sm"
            variant={tab === n ? "primary" : "ghost"}
            onClick={() => setTab(n)}
          >
            {n === "hub" ? t("logs.tab.hub") : t("logs.tab.headroom")}
          </Button>
        ))}
        <Button size="sm" variant="ghost" onClick={() => void load(tab)}>
          {t("logs.refresh")}
        </Button>
      </div>

      <pre className="thin-scroll max-h-[300px] overflow-auto rounded-lg border border-line bg-sunken p-3 font-mono text-[12px] leading-relaxed whitespace-pre-wrap break-all">
        {text}
      </pre>

      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px]">
        <a
          className="text-brand hover:underline"
          href={data?.client.panel_url ?? "#"}
          target="_blank"
          rel="noopener noreferrer"
        >
          {t("logs.panelLink")}
        </a>
        <span className="text-ink-soft">
          {t("logs.panelPassword", { pw: data?.client.panel_password ?? t("common.dash") })}
        </span>
      </div>
    </Card>
  );
}
