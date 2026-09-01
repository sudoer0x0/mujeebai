import { staffPortalHref } from "@/auth/portal-path";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { requireSuperAdminPage } from "@/auth/session";
import { getUsageTotals, getTopConsumers } from "@/usage/admin";
import { USAGE_CATEGORIES } from "@/usage/quota";
import { PageHeader } from "@/components/ui/page-header";
import { StatTile } from "@/components/ui/card";
import { Table, TBody, TD, TH, THead, TR, TableEmpty, TableScroll } from "@/components/ui/table";
import { Link } from "@/i18n/navigation";

export default async function AdminUsagePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ date?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireSuperAdminPage(locale);

  const t = await getTranslations({ locale, namespace: "admin.usage" });
  const tc = await getTranslations({ locale, namespace: "admin.category" });
  const { date } = await searchParams;

  // Only accept a well-formed date; anything else falls back to today
  // rather than reaching the query with whatever the URL contained.
  const periodKey = /^\d{4}-\d{2}-\d{2}$/.test(date ?? "") ? date! : new Date().toISOString().slice(0, 10);

  const totals = await getUsageTotals(periodKey);

  // Only fetch leaderboards for categories that actually saw traffic —
  // six empty tables is noise, and six extra queries for nothing.
  const activeCategories = USAGE_CATEGORIES.filter(
    (category) => (totals.find((row) => row.category === category)?.total ?? 0) > 0,
  );
  const leaderboards = await Promise.all(
    activeCategories.map(async (category) => ({
      category,
      rows: await getTopConsumers(category, periodKey),
    })),
  );

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={t("title")}
        description={t("description")}
      />

      <p className="text-[12px] text-faint">{t("for", { date: periodKey })}</p>

      <section className="flex flex-col gap-3">
        <h2 className="text-[13px] font-semibold text-foreground">{t("totals")}</h2>
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

      <section className="flex flex-col gap-3">
        <h2 className="text-[13px] font-semibold text-foreground">{t("topConsumers")}</h2>

        {leaderboards.length === 0 ? (
          <p className="rounded-lg border border-line bg-surface px-4 py-8 text-center text-[13px] text-muted">
            {t("noUsage")}
          </p>
        ) : (
          leaderboards.map(({ category, rows }) => (
            <div key={category} className="flex flex-col gap-1.5">
              <h3 className="text-[12px] font-medium text-muted">{tc(category as never)}</h3>
              <TableScroll>
                <Table>
                  <THead>
                    <TR>
                      <TH>{t("category")}</TH>
                      <TH className="text-end">{t("used")}</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {rows.length === 0 ? <TableEmpty colSpan={2}>{t("noUsage")}</TableEmpty> : null}
                    {rows.map((row) => (
                      <TR key={row.userId}>
                        <TD>
                          <Link
                            href={`${staffPortalHref("/admin/users")}/${row.userId}`}
                            className="text-accent hover:underline"
                          >
                            {row.displayName || row.email || row.userId}
                          </Link>
                        </TD>
                        <TD className="text-end tabular-nums">{row.total.toLocaleString(locale)}</TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </TableScroll>
            </div>
          ))
        )}
      </section>
    </div>
  );
}
