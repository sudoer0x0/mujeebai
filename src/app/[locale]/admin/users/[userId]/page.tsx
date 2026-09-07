import { notFound } from "next/navigation";
import { staffPortalHref } from "@/auth/portal-path";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { ArrowLeft } from "lucide-react";
import { requireSuperAdminPage } from "@/auth/session";
import { getUserDetail } from "@/admin/users";
import { USAGE_CATEGORIES, DAILY_FEATURE_KEY } from "@/usage/quota";
import { getEffectiveNumber } from "@/billing/entitlements";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent, CardHeader, CardTitle, StatTile } from "@/components/ui/card";
import { Badge, StatusDot } from "@/components/ui/badge";
import { Link } from "@/i18n/navigation";
import { OverridePanel } from "@/components/staff/override-panel";
import { UserUsagePanel } from "@/components/staff/user-usage-panel";
import { StaffDeviceList } from "@/components/staff/staff-device-list";
import { UserActivityList } from "@/components/staff/user-activity-list";
import { RevokeSessionsButton } from "@/components/staff/revoke-sessions-button";
import { AccountModerationPanel } from "@/components/staff/account-moderation-panel";
import { listDeviceSessions } from "@/auth/device-sessions";
import { getUserActivity } from "@/admin/user-activity";

export default async function AdminUserDetailPage({
  params,
}: {
  params: Promise<{ locale: string; userId: string }>;
}) {
  const { locale, userId } = await params;
  setRequestLocale(locale);
  await requireSuperAdminPage(locale);

  const t = await getTranslations({ locale, namespace: "admin" });
  const detail = await getUserDetail(userId);
  if (!detail) notFound();

  // Effective limits combine the plan entitlement with any per-user
  // override, which is exactly what the quota check will apply — showing
  // the plan limit alone would misreport an overridden account.
  const [devices, activity] = await Promise.all([
    listDeviceSessions(detail.id),
    getUserActivity(detail.id),
  ]);

  const usage = await Promise.all(
    USAGE_CATEGORIES.map(async (category) => ({
      category,
      used: detail.usageToday.find((row) => row.category === category)?.count ?? 0,
      limit: await getEffectiveNumber(userId, DAILY_FEATURE_KEY[category], 0),
    })),
  );

  // A super admin holds both permissions, so the only question is whether
  // this account is actually on a grant to revoke.
  const canNote = true;
  const canRevokeGrant = detail.isGrant;

  const name = detail.displayName || detail.email || detail.id;

  return (
    <div className="flex flex-col gap-5">
      <Link
        href={staffPortalHref("/admin/users")}
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
            <Badge variant={detail.role === "super_admin" ? "accent" : detail.role === "moderator" ? "warning" : "neutral"}>
              {t(`role.${detail.role}` as never)}
            </Badge>
            <span className="inline-flex items-center gap-1.5 text-[12px] text-muted">
              <StatusDot variant={detail.status === "active" ? "success" : detail.status === "suspended" ? "warning" : "danger"} />
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

      {/* The same device list the account holder sees, read-only here.
          Support gets asked "was that really me?", and the answer lives in
          the sessions rather than in the audit log. */}
      <Card>
        <CardHeader className="flex-row items-center justify-between gap-3">
          <CardTitle>{t("users.detail.devices")}</CardTitle>
          {devices.length > 0 ? <RevokeSessionsButton userId={detail.id} /> : null}
        </CardHeader>
        <CardContent className="p-0">
          <StaffDeviceList sessions={devices} locale={locale} />
        </CardContent>
      </Card>

      {/* The account's history: who acted on it, when, and why. Sits
          directly under the devices because together they answer the two
          questions support is actually asked — "was that me?" and "what
          happened to my account?". */}
      <Card>
        <CardHeader>
          <CardTitle>{t("users.activity.title")}</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <UserActivityList entries={activity} locale={locale} />
        </CardContent>
      </Card>


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
          <UserUsagePanel userId={detail.id} usage={usage} pastUsage={detail.pastUsage} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("users.detail.overrides")}</CardTitle>
        </CardHeader>
        <CardContent>
          <OverridePanel userId={detail.id} overrides={detail.overrides} />
        </CardContent>
      </Card>
    </div>
  );
}
