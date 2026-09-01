import { getTranslations, setRequestLocale } from "next-intl/server";
import { requireSuperAdminPage } from "@/auth/session";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { FeatureFlagList } from "@/components/staff/feature-flag-list";

export default async function AdminFeatureFlagsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireSuperAdminPage(locale);

  const t = await getTranslations({ locale, namespace: "admin.featureFlags" });
  const supabase = createServiceRoleClient();
  const { data: flags } = await supabase.from("feature_flags").select("*").order("key");

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title={t("title")} description={t("description")} />
      <Card>
        <CardContent className="divide-y divide-line py-0">
          <FeatureFlagList
            flags={(flags ?? []).map((flag) => ({
              id: flag.id,
              key: flag.key,
              description: flag.description,
              enabled: flag.enabled,
            }))}
          />
        </CardContent>
      </Card>
    </div>
  );
}
