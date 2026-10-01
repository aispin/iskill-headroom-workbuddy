import type { StatusPayload } from "../types";
import { useT } from "../i18n";
import { Card } from "./ui";

const fmt = (n: number | undefined) => (n ?? 0).toLocaleString("en-US");

/**
 * 未压缩原因 → 文案键。
 *
 * 这些键来自 Headroom `/stats` 的 `summary.uncompressed_requests`，
 * 是它自己给出的分类（见 headroom/proxy/cost.py 的 uncompressed_reasons）。
 * 写死映射而不是拼模板字符串，是因为 `t()` 的入参是 `keyof Dict`，
 * 拼出来的键会让 TS 失去校验、也容易在漏译文时静默显示成键名。
 */
const REASON_KEYS = {
  prefix_frozen: "savings.reason.prefix_frozen",
  too_small: "savings.reason.too_small",
  no_compressible_content: "savings.reason.no_compressible_content",
  passthrough: "savings.reason.passthrough",
  unknown_token_accounting: "savings.reason.unknown_token_accounting",
} as const;

export function SavingsCard({ data }: { data: StatusPayload | null }) {
  const t = useT();
  const reachable = data?.headroom.reachable ?? false;
  const stats = data?.headroom.stats ?? {};
  const req = stats.requests ?? {};
  const tok = stats.tokens ?? {};
  const summary = stats.summary ?? {};
  const comp = summary.compression ?? {};

  const compressed = comp.requests_compressed ?? 0;
  const total = summary.api_requests ?? req.total;
  const saved = comp.total_tokens_saved_all_layers ?? tok.saved;
  const ratio = comp.avg_compression_pct ?? tok.savings_percent;
  const mode = summary.mode ?? "";

  const reasons = Object.entries(summary.uncompressed_requests ?? {})
    .filter(([, n]) => (n ?? 0) > 0)
    .map(([key, n]) => {
      const label = REASON_KEYS[key as keyof typeof REASON_KEYS];
      return label ? t(label, { n }) : `${key} ×${n}`;
    })
    .join("、");

  const modeLabel =
    mode === "cache"
      ? t("savings.mode.cache")
      : mode === "token"
        ? t("savings.mode.token")
        : mode || t("common.dash");

  // 结论按「压到了没有 + 现在什么模式」二分，直接把「为什么是 0」讲清楚
  const note = !reachable
    ? ""
    : compressed > 0
      ? t("savings.note.ok")
      : mode === "token"
        ? t("savings.note.token")
        : t("savings.note.cache");

  return (
    <Card title={t("savings.title")}>
      <dl className="grid grid-cols-[92px_1fr] items-center gap-x-2.5 gap-y-1.5">
        <dt className="text-[12.5px] text-ink-soft">{t("savings.mode")}</dt>
        <dd className="text-[13px]">{reachable ? modeLabel : t("common.dash")}</dd>
        <dt className="text-[12.5px] text-ink-soft">{t("savings.requests")}</dt>
        <dd className="text-[13px]">
          {reachable
            ? t("savings.requestsValue", { total: fmt(total), compressed: fmt(compressed) })
            : t("savings.offline")}
        </dd>
        <dt className="text-[12.5px] text-ink-soft">{t("savings.saved")}</dt>
        <dd className="text-[13px] font-medium">{reachable ? fmt(saved) : t("common.dash")}</dd>
        <dt className="text-[12.5px] text-ink-soft">{t("savings.ratio")}</dt>
        <dd className="text-[13px] font-medium">
          {reachable ? `${(ratio ?? 0).toFixed(1)}%` : t("common.dash")}
        </dd>
        {reachable && reasons && (
          <>
            <dt className="text-[12.5px] text-ink-soft">{t("savings.reasons")}</dt>
            <dd className="text-[13px] text-ink-soft">{reasons}</dd>
          </>
        )}
      </dl>
      {note && (
        <p className="mt-3 rounded-lg border border-dashed border-line-strong bg-sunken px-3 py-2.5 text-[12.5px] text-ink-soft">
          {note}
        </p>
      )}
      <p className="mt-1.5 font-mono text-[11.5px] text-ink-soft">{t("savings.verify")}</p>
    </Card>
  );
}
