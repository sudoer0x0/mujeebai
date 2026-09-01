import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getCurrentProfile, getCurrentUser } from "@/auth/session";
import { getUserActivePlan } from "@/billing/plans";
import { portalFor, type Role } from "@/admin/permissions";
import { Sidebar } from "@/components/chat/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AnnouncementBanner } from "@/components/app/announcement-banner";
import { getSetting } from "@/lib/settings";
import { PlanNotice } from "@/components/app/plan-notice";
import { FontSync } from "@/components/app/font-sync";
import { getPlanNotice } from "./plan-notice-actions";
import { staffPortalHref } from "@/auth/portal-path";

export default async function AppLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;

  // Independent reads — both are request-cached, so issuing them together
  // costs one round trip rather than two in series.
  const [profile, user] = await Promise.all([getCurrentProfile(), getCurrentUser()]);

  if (!profile || !user) redirect(`/${locale}/login?next=/chat`);

  // A suspended or disabled account keeps a valid JWT until it expires,
  // so the app shell has to refuse it rather than assume sign-in did.
  if (profile.status !== "active") redirect(`/${locale}/login?error=account_${profile.status}`);

  // Staff belong in their console, not the customer app. Sending them
  // here would put an administrator inside the same UI, sidebar and
  // session surface as an ordinary user, which is exactly the separation
  // the consoles exist to maintain.
  const portal = portalFor(profile.role as Role);
  if (portal) redirect(staffPortalHref(portal, locale));

  // The announcement is global config, so it comes from the cached
  // registry rather than costing this layout a query.
  const [plan, announcement, planNotice] = await Promise.all([
    getUserActivePlan(user.id),
    getSetting("announcement"),
    getPlanNotice(user.id),
  ]);
  const t = await getTranslations({ locale, namespace: "common" });

  return (
    <TooltipProvider delayDuration={300}>
      {/* Applies the signed-in account's reading font after a client-side
          navigation, which /theme-init.js cannot see. */}
      <FontSync />
      <a href="#main" className="skip-link">
        {t("skipToContent")}
      </a>
      <div className="flex h-dvh flex-col overflow-hidden md:flex-row">
        <Sidebar
          displayName={profile.display_name ?? ""}
          email={profile.email ?? ""}
          planName={plan.name}
          isFreePlan={Number(plan.price_usd) === 0}
        />
        <main id="main" className="flex min-h-0 min-w-0 flex-1 flex-col">
          {/* The plan notice comes first: it is about this account and is
              dismissed once, whereas the announcement is platform-wide. */}
          {planNotice ? <PlanNotice notice={planNotice} locale={locale} /> : null}
          {announcement?.trim() ? <AnnouncementBanner message={announcement} /> : null}
          {children}
        </main>
      </div>
    </TooltipProvider>
  );
}
