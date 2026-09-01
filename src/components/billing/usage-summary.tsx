"use client";

import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

export interface UsageRow {
  key: string;
  used: number;
  limit: number;
  remaining: number;
}

/**
 * A user's own daily allowance.
 *
 * Every row states the numbers in text as well as drawing the bar: a
 * meter whose only signal is a coloured width tells a screen-reader user
 * and a colour-blind user nothing (WCAG 1.4.1). The `meter` role carries
 * the same values to assistive tech.
 */
export function UsageSummary({ rows }: { rows: UsageRow[] }) {
  const t = useTranslations("settings");
  const tc = useTranslations("admin.category");

  return (
    <div className="flex flex-col gap-3.5">
      <ul className="flex flex-col divide-y divide-line">
        {rows.map((row) => {
          const unlimited = row.limit < 0;
          const disabled = !unlimited && row.limit === 0;
          const percent = unlimited || row.limit <= 0 ? 0 : Math.min(100, Math.round((row.used / row.limit) * 100));
          const tone = percent >= 90 ? "bg-danger" : percent >= 70 ? "bg-warning" : "bg-accent";

          return (
            <li key={row.key} className="flex flex-col gap-1.5 py-2.5 first:pt-0 last:pb-0">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-[13px] text-foreground">{tc(row.key as never)}</span>
                <span className="text-[12px] tabular-nums text-muted">
                  {disabled
                    ? t("notIncluded")
                    : unlimited
                      ? t("unlimited")
                      : `${row.used.toLocaleString()} / ${row.limit.toLocaleString()}`}
                </span>
              </div>

              {!unlimited && !disabled ? (
                <div
                  role="meter"
                  aria-valuenow={row.used}
                  aria-valuemin={0}
                  aria-valuemax={row.limit}
                  aria-label={tc(row.key as never)}
                  className="h-1 w-full overflow-hidden rounded-full bg-surface-raised"
                >
                  <div className={cn("h-full rounded-full transition-all", tone)} style={{ width: `${percent}%` }} />
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>

      <p className="text-[12px] text-faint">{t("quotaResetNote")}</p>
    </div>
  );
}
