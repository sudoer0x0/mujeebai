import { getTranslations, setRequestLocale } from "next-intl/server";
import { requireSuperAdminPage } from "@/auth/session";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { SettingRow } from "@/components/staff/setting-row";

export default async function AdminSettingsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireSuperAdminPage(locale);

  const t = await getTranslations({ locale, namespace: "admin.settings" });
  const supabase = createServiceRoleClient();
  const { data: settings } = await supabase.from("system_settings").select("*").order("key");

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title={t("title")} description={t("description")} />
      <Card>
        <CardContent className="divide-y divide-line py-0">
          {(settings ?? []).map((setting) => (
            <SettingRow
              key={setting.id}
              settingKey={setting.key}
              description={setting.description}
              initialValue={setting.value}
            />
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
