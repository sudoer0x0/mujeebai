import { staffPortalHref } from "@/auth/portal-path";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { requireSuperAdminPage } from "@/auth/session";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import { Table, TBody, TD, TH, THead, TR, TableEmpty, TableScroll } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Link } from "@/i18n/navigation";

const STATUS_TONE: Record<string, "success" | "warning" | "danger" | "neutral"> = {
  active: "success",
  trialing: "success",
  past_due: "warning",
  canceled: "neutral",
  expired: "danger",
};

export default async function AdminSubscriptionsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireSuperAdminPage(locale);

  const t = await getTranslations({ locale, namespace: "admin.subscriptions" });
  const supabase = createServiceRoleClient();

  const { data: subscriptions } = await supabase
    .from("subscriptions")
    .select("id, user_id, plan_id, status, currency, current_period_end, cancel_at_period_end, created_at")
    .order("created_at", { ascending: false })
    .limit(200);

  // Resolve users and plans in two lookups rather than per row.
  const userIds = Array.from(new Set((subscriptions ?? []).map((s) => s.user_id)));
  const planIds = Array.from(new Set((subscriptions ?? []).map((s) => s.plan_id)));

  const [{ data: users }, { data: plans }] = await Promise.all([
    userIds.length
      ? supabase.from("profiles").select("id, email, display_name").in("id", userIds)
      : Promise.resolve({ data: [] as Array<{ id: string; email: string | null; display_name: string | null }> }),
    planIds.length
      ? supabase.from("plans").select("id, name").in("id", planIds)
      : Promise.resolve({ data: [] as Array<{ id: string; name: string }> }),
  ]);

  const userName = new Map((users ?? []).map((u) => [u.id, u.display_name || u.email || u.id]));
  const planName = new Map((plans ?? []).map((p) => [p.id, p.name]));

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title={t("title")} description={t("description")} />

      <TableScroll>
        <Table>
          <THead>
            <TR>
              <TH>{t("colUser")}</TH>
              <TH>{t("colPlan")}</TH>
              <TH>{t("colStatus")}</TH>
              <TH>{t("colRenews")}</TH>
              <TH>{t("colStarted")}</TH>
            </TR>
          </THead>
          <TBody>
            {(subscriptions ?? []).length === 0 ? <TableEmpty colSpan={5}>{t("empty")}</TableEmpty> : null}
            {(subscriptions ?? []).map((subscription) => (
              <TR key={subscription.id}>
                <TD className="max-w-52">
                  <Link href={`${staffPortalHref("/admin/users")}/${subscription.user_id}`} className="truncate text-accent hover:underline">
                    {userName.get(subscription.user_id) ?? subscription.user_id}
                  </Link>
                </TD>
                <TD>{planName.get(subscription.plan_id) ?? "—"}</TD>
                <TD>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge variant={STATUS_TONE[subscription.status] ?? "neutral"}>{subscription.status}</Badge>
                    {subscription.cancel_at_period_end ? (
                      <Badge variant="warning">{t("cancelAtPeriodEnd")}</Badge>
                    ) : null}
                  </div>
                </TD>
                <TD className="whitespace-nowrap text-[12px] text-muted tabular-nums">
                  {subscription.current_period_end
                    ? new Date(subscription.current_period_end).toLocaleDateString(locale)
                    : "—"}
                </TD>
                <TD className="whitespace-nowrap text-[12px] text-muted tabular-nums">
                  {new Date(subscription.created_at).toLocaleDateString(locale)}
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </TableScroll>
    </div>
  );
}
