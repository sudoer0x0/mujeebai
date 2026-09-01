import { getTranslations, setRequestLocale } from "next-intl/server";
import { requireSuperAdminPage } from "@/auth/session";
import { getSetting } from "@/lib/settings";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AnnouncementEditor } from "@/components/staff/announcement-editor";

/**
 * The announcement, on its own page.
 *
 * It used to be one row among ten on the Settings page, edited as a plain
 * value with no way to see what it would look like. An announcement is the
 * one setting whose *appearance* matters — it is read by every signed-in
 * user — so it gets an editor and a live preview rather than a text field.
 */
export default async function AdminAnnouncementsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireSuperAdminPage(locale);

  const t = await getTranslations({ locale, namespace: "admin.announcements" });
  const current = await getSetting("announcement");

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title={t("title")} description={t("description")} />

      <Card>
        <CardHeader>
          <CardTitle>{t("editorTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          <AnnouncementEditor initial={current ?? ""} />
        </CardContent>
      </Card>
    </div>
  );
}
