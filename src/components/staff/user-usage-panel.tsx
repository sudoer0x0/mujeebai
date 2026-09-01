"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { resetUserUsageAction } from "@/admin/user-actions";

export interface UsageRow {
  category: string;
  used: number;
  limit: number;
}

/**
 * Per-account usage with a per-category reset.
 *
 * Shows used *against the effective limit* and renders the bar with an
 * explicit percentage label — a bar alone communicates "nearly full"
 * through width and colour only, which is the one thing an accessible
 * meter must not do.
 */
export function UserUsagePanel({ userId, usage }: { userId: string; usage: UsageRow[] }) {
  const t = useTranslations("admin");
  const tc = useTranslations("admin.category");
  const [pending, setPending] = React.useState<string | null>(null);

  async function reset(category?: string) {
    setPending(category ?? "all");
    try {
      const result = await resetUserUsageAction(userId, category);
      if (result.ok) toast.success(t("usage.resetUserDone"));
      else toast.error(t("common.actionFailed"));
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex justify-end">
        <Button variant="outline" size="sm" onClick={() => reset()} disabled={pending !== null}>
          <RotateCcw />
          {t("users.resetUsage")}
        </Button>
      </div>

      <ul className="flex flex-col divide-y divide-line">
        {usage.map((row) => {
          const unlimited = row.limit < 0;
          const percent = unlimited || row.limit === 0 ? 0 : Math.min(100, Math.round((row.used / row.limit) * 100));
          const tone = percent >= 90 ? "bg-danger" : percent >= 70 ? "bg-warning" : "bg-accent";

          return (
            <li key={row.category} className="flex flex-col gap-1.5 py-2.5 first:pt-0 last:pb-0">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-[13px] text-foreground">{tc(row.category as never)}</span>
                <span className="text-[12px] tabular-nums text-muted">
                  {row.used.toLocaleString()} / {unlimited ? t("common.unlimited") : row.limit.toLocaleString()}
                  {!unlimited && row.limit > 0 ? <span className="ms-1.5 text-faint">({percent}%)</span> : null}
                </span>
              </div>
              {!unlimited && row.limit > 0 ? (
                <div
                  className="h-1 w-full overflow-hidden rounded-full bg-surface-raised"
                  role="meter"
                  aria-valuenow={row.used}
                  aria-valuemin={0}
                  aria-valuemax={row.limit}
                  aria-label={tc(row.category as never)}
                >
                  <div className={`h-full rounded-full ${tone}`} style={{ width: `${percent}%` }} />
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
