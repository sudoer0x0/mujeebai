"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { RotateCcw, Calendar, History, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { resetUserUsageAction } from "@/admin/user-actions";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Table, TBody, TD, TH, THead, TR, TableEmpty, TableScroll } from "@/components/ui/table";
import type { UserPastUsageHistory } from "@/usage/admin";

export interface UsageRow {
  category: string;
  used: number;
  limit: number;
}

/**
 * Per-account usage with today's meters, past 30 days history, and recent activity logs.
 */
export function UserUsagePanel({
  userId,
  usage,
  pastUsage,
  showReset = true,
}: {
  userId: string;
  usage: UsageRow[];
  pastUsage?: UserPastUsageHistory;
  showReset?: boolean;
}) {
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
    <Tabs defaultValue="today" className="w-full">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-3">
        <TabsList>
          <TabsTrigger value="today" className="gap-1.5">
            <Calendar className="size-3.5" />
            {t("usage.tabToday")}
          </TabsTrigger>
          <TabsTrigger value="history" className="gap-1.5">
            <History className="size-3.5" />
            {t("usage.tabHistory")}
            {pastUsage && pastUsage.days.length > 0 ? (
              <span className="ms-1 rounded-full bg-surface px-1.5 py-0.2 text-[11px] text-faint">
                {pastUsage.days.length}
              </span>
            ) : null}
          </TabsTrigger>
          <TabsTrigger value="events" className="gap-1.5">
            <Clock className="size-3.5" />
            {t("usage.tabEvents")}
            {pastUsage && pastUsage.recentEvents.length > 0 ? (
              <span className="ms-1 rounded-full bg-surface px-1.5 py-0.2 text-[11px] text-faint">
                {pastUsage.recentEvents.length}
              </span>
            ) : null}
          </TabsTrigger>
        </TabsList>

        {showReset ? (
          <Button variant="outline" size="sm" onClick={() => reset()} disabled={pending !== null}>
            <RotateCcw className="size-3.5" />
            {t("users.resetUsage")}
          </Button>
        ) : null}
      </div>

      <TabsContent value="today" className="mt-4">
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
      </TabsContent>

      <TabsContent value="history" className="mt-4">
        <div className="flex flex-col gap-3">
          {pastUsage && pastUsage.totalsSummary ? (
            <div className="grid grid-cols-2 gap-2 text-[12px]">
              <div className="rounded border border-line bg-surface-raised p-2.5">
                <span className="text-muted">{t("usage.last30Days")}</span>
                <p className="mt-0.5 text-base font-semibold tabular-nums text-foreground">
                  {pastUsage.totalsSummary.totalActions30d.toLocaleString()} {t("usage.colTotal").toLowerCase()}
                </p>
              </div>
              <div className="rounded border border-line bg-surface-raised p-2.5">
                <span className="text-muted">{tc("messages" as never)}</span>
                <p className="mt-0.5 text-base font-semibold tabular-nums text-foreground">
                  {pastUsage.totalsSummary.totalMessages30d.toLocaleString()}
                </p>
              </div>
            </div>
          ) : null}

          <TableScroll maxHeight="320px">
            <Table>
              <THead>
                <TR>
                  <TH>{t("usage.colDate")}</TH>
                  <TH className="text-end">{tc("messages" as never)}</TH>
                  <TH className="text-end">{tc("image_generations" as never)}</TH>
                  <TH className="text-end">{tc("vision_requests" as never)}</TH>
                  <TH className="text-end">{t("usage.colTotal")}</TH>
                </TR>
              </THead>
              <TBody>
                {!pastUsage || pastUsage.days.length === 0 ? (
                  <TableEmpty colSpan={5}>{t("usage.noHistory")}</TableEmpty>
                ) : (
                  pastUsage.days.map((day) => (
                    <TR key={day.date}>
                      <TD className="font-mono text-[12px]">{day.date}</TD>
                      <TD className="text-end tabular-nums text-muted">
                        {(day.byCategory["messages"] ?? 0).toLocaleString()}
                      </TD>
                      <TD className="text-end tabular-nums text-muted">
                        {(day.byCategory["image_generations"] ?? 0).toLocaleString()}
                      </TD>
                      <TD className="text-end tabular-nums text-muted">
                        {(day.byCategory["vision_requests"] ?? 0).toLocaleString()}
                      </TD>
                      <TD className="text-end font-medium tabular-nums text-foreground">
                        {day.totalUsage.toLocaleString()}
                      </TD>
                    </TR>
                  ))
                )}
              </TBody>
            </Table>
          </TableScroll>
        </div>
      </TabsContent>

      <TabsContent value="events" className="mt-4">
        <TableScroll maxHeight="320px">
          <Table>
            <THead>
              <TR>
                <TH>{t("auditLogs.colTime")}</TH>
                <TH>{t("usage.category")}</TH>
                <TH className="text-end">{t("usage.used")}</TH>
              </TR>
            </THead>
            <TBody>
              {!pastUsage || pastUsage.recentEvents.length === 0 ? (
                <TableEmpty colSpan={3}>{t("usage.noEvents")}</TableEmpty>
              ) : (
                pastUsage.recentEvents.map((evt) => (
                  <TR key={evt.id}>
                    <TD className="text-[12px] text-muted">
                      {new Date(evt.createdAt).toLocaleString(undefined, {
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                        second: "2-digit",
                      })}
                    </TD>
                    <TD className="text-[13px]">{tc(evt.category as never)}</TD>
                    <TD className="text-end font-mono tabular-nums">+{evt.quantity}</TD>
                  </TR>
                ))
              )}
            </TBody>
          </Table>
        </TableScroll>
      </TabsContent>
    </Tabs>
  );
}
