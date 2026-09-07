import { notFound } from "next/navigation";
import { staffPortalHref } from "@/auth/portal-path";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { ArrowLeft } from "lucide-react";
import { requireStaffPage } from "@/auth/session";
import { getUserDetail } from "@/admin/users";
import { getUserActivity } from "@/admin/user-activity";
import { can } from "@/admin/permissions";
import { USAGE_CATEGORIES, DAILY_FEATURE_KEY } from "@/usage/quota";
import { getEffectiveNumber } from "@/billing/entitlements";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent, CardHeader, CardTitle, StatTile } from "@/components/ui/card";
import { Badge, StatusDot } from "@/components/ui/badge";
import { Link } from "@/i18n/navigation";
import { UserUsagePanel } from "@/components/staff/user-usage-panel";
import { StaffDeviceList } from "@/components/staff/staff-device-list";
import { UserActivityList } from "@/components/staff/user-activity-list";
import { RevokeSessionsButton } from "@/components/staff/revoke-sessions-button";
import { AccountModerationPanel } from "@/components/staff/account-moderation-panel";
import { listDeviceSessions } from "@/auth/device-sessions";

/**
 * The moderator's view of one account.
 *
 * Deliberately narrower than the super admin's page rather than the same
 * page with buttons hidden:
 *
 *  - **Staff accounts are not viewable at all.** A moderator cannot act on
 *    staff, so letting them read an administrator's device list and
 *    history would be handing over reconnaissance for an action they can
 *    never take. `notFound()` rather than a permission error, because
 *    whether a given id is an administrator is itself something a
 *    moderator has no business confirming.
 *
 *  - **Usage is shown, not edited.** Resetting a counter needs
 *    `usage.reset_user`, which is super-admin-only, so the interactive
 *    panel would render a control the server refuses. Read-only tiles
 *    tell the moderator what they need for a support conversation
 *    without offering a lever that is not theirs.
 *
 *  - **No entitlement overrides.** Same reasoning, and quotas are
 *    billing-adjacent.
 */
export default async function ModeratorUserDetailPage({
  params,
}: {
  params: Promise<{ locale: string; userId: string }>;
}) {
  const { locale, userId } = await params;
  setRequestLocale(locale);
  const moderator = await requireStaffPage(locale);

  const t = await getTranslations({ locale, namespace: "admin" });
  const detail = await getUserDetail(userId);
  if (!detail) notFound();

  const targetIsStaff = detail.role === "moderator" || detail.role === "super_admin";
  if (targetIsStaff && moderator.role !== "super_admin") notFound();

  const [devices, activity] = await Promise.all([
    listDeviceSessions(detail.id),
    can(moderator, "users.view_activity") ? getUserActivity(detail.id) : Promise.resolve([]),
  ]);

  const usage = await Promise.all(
    USAGE_CATEGORIES.map(async (category) => ({
      category,
      used: detail.usageToday.find((row) => row.category === category)?.count ?? 0,
      limit: await getEffectiveNumber(userId, DAILY_FEATURE_KEY[category], 0),
    })),
  );

  const canNote = can(moderator, "moderation.note");
  const canRevokeGrant = can(moderator, "subscriptions.grant") && detail.isGrant;

  const name = detail.displayName || detail.email || detail.id;

  return (
    <div className="flex flex-col gap-5">
      <Link
        href={staffPortalHref("/moderator/users")}
        className="inline-flex w-fit items-center gap-1.5 text-[12px] text-muted transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-3.5 rtl:rotate-180" aria-hidden />
        {t("users.detail.back")}
      </Link>

      <PageHeader
        title={name}
        description={detail.email ?? undefined}
        actions={
          <>
            <Badge variant="neutral">{t(`role.${detail.role}` as never)}</Badge>
            <span className="inline-flex items-center gap-1.5 text-[12px] text-muted">
              <StatusDot
                variant={
                  detail.status === "active" ? "success" : detail.status === "suspended" ? "warning" : "danger"
                }
              />
              {t(`status_.${detail.status}` as never)}
            </span>
          </>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label={t("users.detail.conversations")} value={detail.conversationCount.toLocaleString(locale)} />
        <StatTile
          label={t("users.colPlan")}
          value={detail.planName ?? t("common.none")}
          hint={detail.subscriptionStatus ?? undefined}
        />
        <StatTile label={t("users.detail.joined")} value={new Date(detail.createdAt).toLocaleDateString(locale)} />
        <StatTile label={t("users.detail.locale")} value={detail.locale.toUpperCase()} />
      </div>

      <Card>
        <CardHeader className="flex-row items-center justify-between gap-3">
          <CardTitle>{t("users.detail.devices")}</CardTitle>
          {can(moderator, "users.revoke_sessions") && devices.length > 0 ? (
            <RevokeSessionsButton userId={detail.id} />
          ) : null}
        </CardHeader>
        <CardContent className="p-0">
          <StaffDeviceList sessions={devices} locale={locale} />
        </CardContent>
      </Card>

      {can(moderator, "users.view_activity") ? (
        <Card>
          <CardHeader>
            <CardTitle>{t("users.activity.title")}</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <UserActivityList entries={activity} locale={locale} />
          </CardContent>
        </Card>
      ) : null}


      {/* Both controls existed as audited server actions with no UI. */}
      {canNote || canRevokeGrant ? (
        <Card>
          <CardHeader>
            <CardTitle>{t("users.moderation.title")}</CardTitle>
          </CardHeader>
          <CardContent>
            <AccountModerationPanel userId={detail.id} canNote={canNote} canRevokeGrant={canRevokeGrant} />
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>{t("usage.title")}</CardTitle>
        </CardHeader>
        <CardContent>
          <UserUsagePanel userId={detail.id} usage={usage} pastUsage={detail.pastUsage} showReset={false} />
        </CardContent>
      </Card>
    </div>
  );
}
