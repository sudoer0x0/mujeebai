import { getTranslations, setRequestLocale } from "next-intl/server";
import { requireSuperAdminPage } from "@/auth/session";
import { getPlatformStatus, type ServiceState } from "@/admin/platform-status";
import { PageHeader } from "@/components/ui/page-header";
import { Table, TBody, TD, TH, THead, TR, TableScroll } from "@/components/ui/table";
import { Badge, StatusDot } from "@/components/ui/badge";

// Health is a live measurement; caching it would report a stale provider
// as healthy for as long as the cache lasts.
export const dynamic = "force-dynamic";

const TONE: Record<ServiceState, "success" | "warning" | "danger" | "neutral"> = {
  operational: "success",
  degraded: "warning",
  not_configured: "neutral",
  error: "danger",
};

const LABEL: Record<ServiceState, string> = {
  operational: "operational",
  degraded: "degraded",
  not_configured: "notConfigured",
  error: "error",
};

export default async function AdminStatusPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireSuperAdminPage(locale);

  const t = await getTranslations({ locale, namespace: "admin.status" });
  const services = await getPlatformStatus();
  const checkedAt = new Date();

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title={t("title")} description={t("description")} />

      <TableScroll>
        <Table>
          <THead>
            <TR>
              <TH>{t("service")}</TH>
              <TH>{t("state")}</TH>
              <TH>{t("detail")}</TH>
            </TR>
          </THead>
          <TBody>
            {services.map((service) => (
              <TR key={service.slug}>
                <TD className="font-medium">{service.name}</TD>
                <TD>
                  <span className="inline-flex items-center gap-1.5">
                    <StatusDot variant={TONE[service.state]} />
                    <Badge variant={TONE[service.state]}>{t(LABEL[service.state] as never)}</Badge>
                  </span>
                </TD>
                <TD className="max-w-md text-[12px] text-muted">{service.detail}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </TableScroll>

      <p className="text-[12px] text-faint tabular-nums">
        {t("checkedAt", { time: checkedAt.toLocaleTimeString(locale) })}
      </p>
    </div>
  );
}
