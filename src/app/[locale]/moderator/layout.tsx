import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getCurrentProfile } from "@/auth/session";
import { StaffShell, type StaffNavSection } from "@/components/staff/staff-shell";
import { staffPortalHref } from "@/auth/portal-path";

const SECTIONS: StaffNavSection[] = [
  {
    items: [
      { href: "/moderator", labelKey: "nav.dashboard", icon: "dashboard" },
      { href: "/moderator/users", labelKey: "nav.users", icon: "users" },
      { href: "/moderator/moderation", labelKey: "nav.moderation", icon: "moderation" },
      { href: "/moderator/activity", labelKey: "nav.activity", icon: "auditLogs" },
      { href: "/moderator/security", labelKey: "nav.security", icon: "security" },
    ],
  },
];

/**
 * Moderator portal shell.
 *
 * Deliberately a separate route tree from `/admin` rather than the same
 * console with items hidden. Hiding a nav link is a presentation choice;
 * a separate tree with its own guard means a moderator who types
 * `/admin/plans` is refused by the server, and there is no admin-only
 * action reachable from anything rendered here.
 *
 * Super admins may enter — reviewing moderation is part of their job —
 * but the reverse is not true.
 */
export default async function ModeratorLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const profile = await getCurrentProfile();

  if (!profile) redirect(staffPortalHref("/staff/login", locale));
  if (profile.status !== "active") redirect(`${staffPortalHref("/staff/login", locale)}?error=not_staff`);
  if (profile.role !== "moderator" && profile.role !== "super_admin") redirect(`${staffPortalHref("/staff/login", locale)}?error=not_staff`);

  // Nav hrefs carry the secret portal prefix when one is configured.
  // Prefixing here — in a Server Component — is what keeps the slug out
  // of the browser bundle: the links arrive already-formed, and no client
  // code ever has to know what the prefix is.
  const sections = SECTIONS.map((section) => ({
    ...section,
    items: section.items.map((item) => ({ ...item, href: staffPortalHref(item.href) })),
  }));

  const t = await getTranslations({ locale, namespace: "moderator" });

  return (
    <StaffShell
      sections={sections}
      namespace="moderator"
      rootHref={staffPortalHref("/moderator")}
      variant="moderator"
      locale={locale}
      portalTitle={t("portalTitle")}
      roleLabel={t(profile.role === "super_admin" ? "roleLabelAdmin" : "roleLabel")}
    >
      {children}
    </StaffShell>
  );
}
