import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { getCurrentProfile } from "@/auth/session";
import { MfaEnrollment } from "./mfa-enrollment";
import { staffPortalHref } from "@/auth/portal-path";

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function StaffMfaPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const profile = await getCurrentProfile();
  if (!profile) redirect(staffPortalHref("/staff/login", locale));
  if (profile.role !== "moderator" && profile.role !== "super_admin") {
    redirect(`${staffPortalHref("/staff/login", locale)}?error=not_staff`);
  }
  // The password step comes first; sending someone to enrol a factor on an
  // account still holding a temporary password gets the order wrong.
  if (profile.must_change_password) redirect(staffPortalHref("/staff/onboarding/password", locale));

  const t = await getTranslations({ locale, namespace: "staffAuth.onboarding" });

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-[17px] font-semibold tracking-tight text-foreground">{t("mfaTitle")}</h1>
        <p className="mt-1.5 text-[13px] leading-relaxed text-muted">{t("mfaDescription")}</p>
      </div>
      <MfaEnrollment
        locale={locale}
        destination={staffPortalHref(profile.role === "super_admin" ? "/admin" : "/moderator")}
      />
    </div>
  );
}
