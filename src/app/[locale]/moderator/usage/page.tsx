import { staffPortalHref } from "@/auth/portal-path";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { requireStaffPage } from "@/auth/session";
import { assertPermission } from "@/admin/permissions";
import { getUsageTotals, getPlatformUsageHistory } from "@/usage/admin";
import { PageHeader } from "@/components/ui/page-header";
import { StatTile } from "@/components/ui/card";
import { Table, TBody, TD, TH, THead, TR, TableEmpty, TableScroll } from "@/components/ui/table";
import { Link } from "@/i18n/navigation";

export default async function ModeratorUsagePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ date?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const staff = await requireStaffPage(locale);
  assertPermission(staff, "usage.view");

  const t = await getTranslations({ locale, namespace: "admin.usage" });
  const tc = await getTranslations({ locale, namespace: "admin.category" });
  const { date } = await searchParams;

  const periodKey = /^\d{4}-\d{2}-\d{2}$/.test(date ?? "") ? date! : new Date().toISOString().slice(0, 10);

  const [totals, history] = await Promise.all([
    getUsageTotals(periodKey),
    getPlatformUsageHistory(30),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t("title")}
        description={t("description")}
      />

      {/* Platform 30-day aggregate statistics */}
      <section className="flex flex-col gap-3">
        <h2 className="text-[13px] font-semibold text-foreground">{t("last30Days")}</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile
            label={t("colTotal")}
            value={history.totalsSummary.totalActions.toLocaleString(locale)}
            hint={t("last30Days")}
          />
          <StatTile
            label={t("colActiveUsers")}
            value={history.totalsSummary.activeUsers30d.toLocaleString(locale)}
            hint={`${history.totalsSummary.activeUsers7d.toLocaleString(locale)} ${t("last7Days").toLowerCase()}`}
          />
          <StatTile
            label={tc("messages" as never)}
            value={history.totalsSummary.totalMessages.toLocaleString(locale)}
            hint={t("last30Days")}
          />
          <StatTile
            label={tc("image_generations" as never)}
            value={history.totalsSummary.totalImages.toLocaleString(locale)}
            hint={t("last30Days")}
          />
        </div>
      </section>

      {/* Platform Daily Usage History Table */}
      <section className="flex flex-col gap-3">
        <div className="flex flex-col gap-0.5">
          <h2 className="text-[13px] font-semibold text-foreground">{t("platformHistory")}</h2>
          <p className="text-[12px] text-muted">{t("platformHistoryDescription")}</p>
        </div>

        <TableScroll maxHeight="380px">
          <Table>
            <THead>
              <TR>
                <TH>{t("colDate")}</TH>
                <TH className="text-end">{t("colActiveUsers")}</TH>
                <TH className="text-end">{tc("messages" as never)}</TH>
                <TH className="text-end">{tc("image_generations" as never)}</TH>
                <TH className="text-end">{tc("vision_requests" as never)}</TH>
                <TH className="text-end">{t("colTotal")}</TH>
                <TH className="text-end"></TH>
              </TR>
            </THead>
            <TBody>
              {history.days.length === 0 ? (
                <TableEmpty colSpan={7}>{t("noHistory")}</TableEmpty>
              ) : (
                history.days.map((d) => {
                  const isSelected = d.date === periodKey;
                  return (
                    <TR key={d.date} className={isSelected ? "bg-surface-raised font-medium" : undefined}>
                      <TD className="font-mono text-[12px]">
                        {d.date}
                        {isSelected ? (
                          <span className="ms-2 rounded-sm bg-accent/15 px-1.5 py-0.5 text-[10px] text-accent">
                            Selected
                          </span>
                        ) : null}
                      </TD>
                      <TD className="text-end tabular-nums text-muted">{d.activeUsers.toLocaleString(locale)}</TD>
                      <TD className="text-end tabular-nums text-muted">{(d.byCategory["messages"] ?? 0).toLocaleString(locale)}</TD>
                      <TD className="text-end tabular-nums text-muted">{(d.byCategory["image_generations"] ?? 0).toLocaleString(locale)}</TD>
                      <TD className="text-end tabular-nums text-muted">{(d.byCategory["vision_requests"] ?? 0).toLocaleString(locale)}</TD>
                      <TD className="text-end font-medium tabular-nums text-foreground">{d.totalUsage.toLocaleString(locale)}</TD>
                      <TD className="text-end text-[12px]">
                        {isSelected ? (
                          <span className="text-faint">Viewing</span>
                        ) : (
                          <Link href={`${staffPortalHref("/moderator/usage")}?date=${d.date}`} className="text-accent hover:underline">
                            {t("viewDate")}
                          </Link>
                        )}
                      </TD>
                    </TR>
                  );
                })
              )}
            </TBody>
          </Table>
        </TableScroll>
      </section>

      {/* Selected Day Details */}
      <section className="flex flex-col gap-3 pt-2">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-[13px] font-semibold text-foreground">{t("for", { date: periodKey })}</h2>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {totals.map((row) => (
            <StatTile
              key={row.category}
              label={tc(row.category as never)}
              value={row.total.toLocaleString(locale)}
              hint={`${row.users.toLocaleString(locale)} ${t("activeUsers").toLowerCase()}`}
            />
          ))}
        </div>
      </section>
    </div>
  );
}
