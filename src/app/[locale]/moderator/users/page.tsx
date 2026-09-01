import { staffPortalHref } from "@/auth/portal-path";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { requireStaffPage } from "@/auth/session";
import { listUsers, type AccountStatus } from "@/admin/users";
import { PageHeader } from "@/components/ui/page-header";
import { UserFilters } from "@/components/staff/user-filters";
import { UserTable } from "@/components/staff/user-table";
import { Pagination } from "@/components/staff/pagination";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { InviteUserForm } from "@/components/staff/invite-user-form";
import { can } from "@/admin/permissions";

const STATUSES: AccountStatus[] = ["active", "suspended", "disabled", "pending_verification", "deleted"];

export default async function ModeratorUsersPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ q?: string; status?: string; page?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const moderator = await requireStaffPage(locale);
  const t = await getTranslations({ locale, namespace: "moderator.users" });
  const query = await searchParams;

  const status = STATUSES.includes(query.status as AccountStatus) ? (query.status as AccountStatus) : "all";
  const page = Number.parseInt(query.page ?? "1", 10);

  // Moderators only ever see ordinary accounts. This is a convenience —
  // `assertCanActOn` would refuse an action against staff regardless —
  // but it also means a moderator never sees the administrator roster.
  const result = await listUsers({
    query: query.q,
    role: "user",
    status,
    page: Number.isFinite(page) ? page : 1,
  });

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title={t("title")} description={t("description")} />
      {can(moderator, "users.invite") ? (
        <Card>
          <CardHeader>
            <CardTitle>{t("inviteTitle")}</CardTitle>
          </CardHeader>
          <CardContent>
            <InviteUserForm locale={locale} />
          </CardContent>
        </Card>
      ) : null}

      <UserFilters showRoleFilter={false} />
      <UserTable
        users={result.users}
        currentUserId={moderator.id}
        detailBasePath={staffPortalHref("/moderator/users")}
        capabilities={["view_detail", "suspend", "restore", "reset_password", "verification", "grant_plan"]}
        emptyTitle={t("title")}
      />
      <Pagination page={result.page} pageSize={result.pageSize} total={result.total} />
    </div>
  );
}
