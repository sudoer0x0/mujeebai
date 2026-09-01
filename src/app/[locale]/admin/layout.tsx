import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getCurrentProfile } from "@/auth/session";
import { StaffShell, type StaffNavSection } from "@/components/staff/staff-shell";
import { staffPortalHref } from "@/auth/portal-path";

const SECTIONS: StaffNavSection[] = [
  {
    items: [
      { href: "/admin", labelKey: "nav.dashboard", icon: "dashboard" },
      { href: "/admin/status", labelKey: "nav.status", icon: "status" },
    ],
  },
  {
    titleKey: "section.people",
    items: [
      { href: "/admin/users", labelKey: "nav.users", icon: "users" },
      { href: "/admin/moderators", labelKey: "nav.moderators", icon: "moderators" },
      { href: "/admin/moderation", labelKey: "nav.moderation", icon: "moderation" },
      { href: "/admin/usage", labelKey: "nav.usage", icon: "usage" },
    ],
  },
  {
    titleKey: "section.billing",
    items: [
      { href: "/admin/plans", labelKey: "nav.plans", icon: "plans" },
      { href: "/admin/subscriptions", labelKey: "nav.subscriptions", icon: "subscriptions" },
    ],
  },
  {
    titleKey: "section.ai",
    items: [
      { href: "/admin/models", labelKey: "nav.models", icon: "models" },
      { href: "/admin/providers", labelKey: "nav.providers", icon: "providers" },
      { href: "/admin/system-prompt", labelKey: "nav.systemPrompt", icon: "systemPrompt" },
    ],
  },
  {
    titleKey: "section.platform",
    items: [
      { href: "/admin/announcements", labelKey: "nav.announcements", icon: "announcements" },
      { href: "/admin/email-templates", labelKey: "nav.emailTemplates", icon: "emailTemplates" },
      { href: "/admin/feature-flags", labelKey: "nav.featureFlags", icon: "featureFlags" },
      { href: "/admin/settings", labelKey: "nav.settings", icon: "settings" },
      { href: "/admin/audit-logs", labelKey: "nav.auditLogs", icon: "auditLogs" },
      { href: "/admin/security", labelKey: "nav.security", icon: "security" },
    ],
  },
];

/**
 * Super Admin portal shell.
 *
 * The guard here is the *outer* boundary, not the only one: every server
 * action and route handler underneath re-checks its own permission, so a
 * direct POST to an admin action is refused even though it never renders
 * this layout. Moderators are redirected to their own portal rather than
 * being shown a dead end.
 */
export default async function AdminLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const profile = await getCurrentProfile();

  if (!profile) redirect(staffPortalHref("/staff/login", locale));
  if (profile.role === "moderator") redirect(staffPortalHref("/moderator", locale));
  if (profile.role !== "super_admin" || profile.status !== "active") redirect(`${staffPortalHref("/staff/login", locale)}?error=not_staff`);

  // Nav hrefs carry the secret portal prefix when one is configured.
  // Prefixing here — in a Server Component — is what keeps the slug out
  // of the browser bundle: the links arrive already-formed, and no client
  // code ever has to know what the prefix is.
  const sections = SECTIONS.map((section) => ({
    ...section,
    items: section.items.map((item) => ({ ...item, href: staffPortalHref(item.href) })),
  }));

  const t = await getTranslations({ locale, namespace: "admin" });

  return (
    <StaffShell
      sections={sections}
      namespace="admin"
      rootHref={staffPortalHref("/admin")}
      variant="admin"
      locale={locale}
      portalTitle={t("portalTitle")}
      roleLabel={t("roleLabel")}
    >
      {children}
    </StaffShell>
  );
}
