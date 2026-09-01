import { getTranslations, setRequestLocale } from "next-intl/server";
import { requireStaffPage } from "@/auth/session";
import { PageHeader } from "@/components/ui/page-header";
import { StaffSecurity } from "@/components/staff/staff-security";

export default async function ModeratorSecurityPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const profile = await requireStaffPage(locale);

  const t = await getTranslations({ locale, namespace: "admin.security" });

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title={t("title")} description={t("description")} />
      <StaffSecurity profile={profile} locale={locale} />
    </div>
  );
}
