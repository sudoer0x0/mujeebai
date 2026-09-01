import { getTranslations, setRequestLocale } from "next-intl/server";
import { requireSuperAdminPage } from "@/auth/session";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CreateModeratorForm } from "@/components/staff/create-moderator-form";
import { ModeratorList } from "@/components/staff/moderator-list";

export default async function AdminModeratorsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireSuperAdminPage(locale);

  const t = await getTranslations({ locale, namespace: "admin.moderators" });

  const supabase = createServiceRoleClient();
  const { data: moderators } = await supabase
    .from("profiles")
    .select("id, email, display_name, status, created_at, must_change_password, mfa_enrolled_at, invited_at")
    .eq("role", "moderator")
    .order("created_at", { ascending: false });

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title={t("title")} description={t("description")} />

      <Card>
        <CardHeader>
          <CardTitle>{t("createTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          <CreateModeratorForm locale={locale} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("listTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <ModeratorList
            moderators={(moderators ?? []).map((moderator) => ({
              id: moderator.id,
              email: moderator.email,
              displayName: moderator.display_name,
              status: moderator.status,
              mustChangePassword: moderator.must_change_password,
              mfaEnrolled: Boolean(moderator.mfa_enrolled_at),
              invitedAt: moderator.invited_at,
            }))}
            locale={locale}
          />
        </CardContent>
      </Card>
    </div>
  );
}
