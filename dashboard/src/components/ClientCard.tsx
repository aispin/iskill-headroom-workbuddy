import { useEffect, useState } from "react";
import { useT } from "../i18n";
import type { StatusPayload } from "../types";
import { Button, Card, CopyBox, SteadyLabel, useCopyFeedback } from "./ui";
import { copyText } from "../lib/clipboard";

export function ClientCard({ data }: { data: StatusPayload | null }) {
  const t = useT();
  const [model, setModel] = useState("");
  const modelCopy = useCopyFeedback();

  const models = data?.hub.models ?? [];
  const client = data?.client;
  const key = client?.api_key ?? "";

  useEffect(() => {
    if (models.length && !models.includes(model)) setModel(models[0]);
    if (!models.length) setModel("");
  }, [models, model]);

  return (
    <Card title={t("client.title")}>
      <p className="-mt-1 mb-3 text-[12.5px] text-ink-soft">{t("client.path")}</p>

      <dl className="grid grid-cols-[76px_1fr] items-center gap-x-2.5 gap-y-2.5">
        <dt className="text-[12.5px] text-ink-soft">{t("client.chatUrl")}</dt>
        <dd>
          <CopyBox value={client?.chat_url ?? ""} />
        </dd>

        <dt className="text-[12.5px] text-ink-soft">{t("client.apiKey")}</dt>
        <dd className="min-w-0">
          <CopyBox value={key} secret />
        </dd>

        <dt className="text-[12.5px] text-ink-soft">{t("client.model")}</dt>
        <dd className="flex flex-wrap items-center gap-1.5">
          <select
            className="max-w-[260px] rounded-lg border border-line-strong bg-surface px-2 py-1.5 text-[13px]"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            disabled={!models.length}
          >
            {models.length ? (
              models.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))
            ) : (
              <option value="">{t("client.noModels")}</option>
            )}
          </select>
          <Button
            size="sm"
            disabled={!model}
            title={modelCopy.title}
            onClick={async () => {
              modelCopy.flash(await copyText(model));
            }}
          >
            <SteadyLabel options={modelCopy.labels} active={modelCopy.active} />
          </Button>
        </dd>
      </dl>

      <p className="mt-3 text-[12.5px] text-ink-soft">
        {t("client.keySource")}
        {client?.api_key_source === "panel"
          ? t("client.keySource.panel")
          : t("client.keySource.launcher")}
        {t("client.keySource.tail")}
      </p>
    </Card>
  );
}
