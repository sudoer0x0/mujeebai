import { getTranslations, setRequestLocale } from "next-intl/server";
import { requireStaffPage } from "@/auth/session";
import { PageHeader } from "@/components/ui/page-header";
import { ModerationLog } from "@/components/staff/moderation-log";

export default async function ModeratorModerationPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireStaffPage(locale);

  const t = await getTranslations({ locale, namespace: "moderator.moderation" });

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title={t("title")} description={t("description")} />
      <ModerationLog locale={locale} />
    </div>
  );
}
