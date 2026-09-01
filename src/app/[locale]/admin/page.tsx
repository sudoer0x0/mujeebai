import { staffPortalHref } from "@/auth/portal-path";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { requireSuperAdminPage } from "@/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { logger } from "@/lib/logger";
import { Alert } from "@/components/ui/alert";
import { PageHeader } from "@/components/ui/page-header";
import { StatTile, Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TBody, TD, TH, THead, TR, TableEmpty, TableScroll } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Link } from "@/i18n/navigation";
import { humanizeKey, isKnownAuditAction } from "@/admin/labels";

interface AdminSnapshot {
  total_users: number;
  new_users_7d: number;
  active_subscriptions: number;
  usage_totals: { category: string; total: number; users: number }[];
  recent_signups: { id: string; email: string | null; display_name: string | null; created_at: string; status: string }[];
  recent_audit: {
    id: string;
    action: string;
    result: string;
    created_at: string;
    actor_id: string | null;
    actor_name: string | null;
  }[];
}

export default async function AdminDashboard({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireSuperAdminPage(locale);

  const t = await getTranslations({ locale, namespace: "admin.dashboard" });
  const ta = await getTranslations({ locale, namespace: "admin" });
  const tAction = await getTranslations({ locale, namespace: "admin.auditAction" });

  // Falls back to a humanized key so a newly-audited action is never
  // rendered as a bare identifier while its translation catches up.
  const auditLabel = (action: string) =>
    isKnownAuditAction(action) ? tAction(action as never) : humanizeKey(action);

  // One RPC, one round trip. The counting, the roll-up and the actor-name
  // join all happen inside Postgres — see migration 0014 for why eight
  // parallel PostgREST requests were slower than one function call.
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("admin_dashboard_snapshot");

  if (error) {
    // The layout already proved this caller is a super admin, so a failure
    // here is an infrastructure problem, not an authorization one. Say so
    // rather than rendering a dashboard of confident zeroes.
    logger.error("admin_dashboard_snapshot_failed", { error: error.message });
    return (
      <div className="flex flex-col gap-5">
        <PageHeader title={t("title")} description={t("description")} />
        <Alert tone="danger">{ta("common.actionFailed")}</Alert>
      </div>
    );
  }

  const snapshot = (data ?? {}) as unknown as AdminSnapshot;
  const totals = snapshot.usage_totals ?? [];
  const signups = snapshot.recent_signups ?? [];
  const audit = snapshot.recent_audit ?? [];

  const messagesToday = totals.find((row) => row.category === "messages")?.total ?? 0;
  const imagesToday = totals.find((row) => row.category === "image_generations")?.total ?? 0;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title={t("title")} description={t("description")} />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <StatTile label={t("totalUsers")} value={(snapshot.total_users ?? 0).toLocaleString(locale)} />
        <StatTile label={t("newUsers7d")} value={(snapshot.new_users_7d ?? 0).toLocaleString(locale)} />
        <StatTile label={t("activeSubscriptions")} value={(snapshot.active_subscriptions ?? 0).toLocaleString(locale)} />
        <StatTile label={t("messagesToday")} value={messagesToday.toLocaleString(locale)} />
        <StatTile label={t("imagesToday")} value={imagesToday.toLocaleString(locale)} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t("recentSignups")}</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <TableScroll className="rounded-none border-0">
              <Table>
                <THead>
                  <TR>
                    <TH>{ta("users.colUser")}</TH>
                    <TH>{ta("users.colStatus")}</TH>
                    <TH>{ta("users.colJoined")}</TH>
                  </TR>
                </THead>
                <TBody>
                  {signups.length === 0 ? (
                    <TableEmpty colSpan={3}>{t("noSignups")}</TableEmpty>
                  ) : null}
                  {signups.map((user) => (
                    <TR key={user.id}>
                      <TD className="max-w-52">
                        <Link href={`${staffPortalHref("/admin/users")}/${user.id}`} className="truncate text-accent hover:underline">
                          {user.display_name || user.email || user.id}
                        </Link>
                      </TD>
                      <TD>
                        <Badge variant={user.status === "active" ? "success" : "warning"}>
                          {ta(`status_.${user.status}` as never)}
                        </Badge>
                      </TD>
                      <TD className="whitespace-nowrap text-[12px] text-muted tabular-nums">
                        {new Date(user.created_at).toLocaleDateString(locale)}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </TableScroll>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("recentAudit")}</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <TableScroll className="rounded-none border-0">
              <Table>
                <THead>
                  <TR>
                    <TH>{ta("auditLogs.colAction")}</TH>
                    <TH>{ta("auditLogs.colActor")}</TH>
                    <TH>{ta("auditLogs.colTime")}</TH>
                  </TR>
                </THead>
                <TBody>
                  {audit.length === 0 ? (
                    <TableEmpty colSpan={3}>{t("noActivity")}</TableEmpty>
                  ) : null}
                  {audit.map((entry) => (
                    <TR key={entry.id}>
                      {/* The readable label, same as the audit log page.
                          This table was still printing the raw key. */}
                      <TD>{auditLabel(entry.action)}</TD>
                      <TD className="max-w-40 truncate text-muted">
                        {entry.actor_name ?? ta("auditLogs.system")}
                      </TD>
                      <TD className="whitespace-nowrap text-[12px] text-muted tabular-nums">
                        {new Date(entry.created_at).toLocaleString(locale)}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </TableScroll>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
