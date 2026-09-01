import { staffPortalHref } from "@/auth/portal-path";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { requireSuperAdminPage } from "@/auth/session";
import { listUsers, type AccountStatus } from "@/admin/users";
import type { Role } from "@/admin/permissions";
import { PageHeader } from "@/components/ui/page-header";
import { UserFilters } from "@/components/staff/user-filters";
import { UserTable } from "@/components/staff/user-table";
import { Pagination } from "@/components/staff/pagination";
import { InviteUserForm } from "@/components/staff/invite-user-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const ROLES: Role[] = ["user", "moderator", "super_admin"];
const STATUSES: AccountStatus[] = ["active", "suspended", "disabled", "pending_verification", "deleted"];

export default async function AdminUsersPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ q?: string; role?: string; status?: string; page?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  // Re-checked here, not just in the layout: a page is its own entry point.
  const admin = await requireSuperAdminPage(locale);
  const t = await getTranslations({ locale, namespace: "admin.users" });
  const query = await searchParams;

  // Only accept filter values the model actually knows about — an
  // arbitrary `?status=` from the URL must never reach the query builder.
  const role = ROLES.includes(query.role as Role) ? (query.role as Role) : "all";
  const status = STATUSES.includes(query.status as AccountStatus) ? (query.status as AccountStatus) : "all";
  const page = Number.parseInt(query.page ?? "1", 10);

  const result = await listUsers({
    query: query.q,
    role,
    status,
    page: Number.isFinite(page) ? page : 1,
  });

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title={t("title")} description={t("description")} />

      <Card>
        <CardHeader>
          <CardTitle>{t("inviteTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          <InviteUserForm locale={locale} />
        </CardContent>
      </Card>

      <UserFilters />
      <UserTable
        users={result.users}
        currentUserId={admin.id}
        detailBasePath={staffPortalHref("/admin/users")}
        capabilities={[
          "view_detail",
          "suspend",
          "restore",
          "disable",
          "delete",
          "reset_password",
          "magic_link",
          "verification",
          "modify_role",
          "reset_usage",
          "grant_plan",
          "reset_staff",
        ]}
        emptyTitle={t("empty")}
        emptyHint={t("emptyHint")}
      />
      <Pagination page={result.page} pageSize={result.pageSize} total={result.total} />
    </div>
  );
}
