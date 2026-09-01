import { getTranslations, setRequestLocale } from "next-intl/server";
import { requireSuperAdminPage } from "@/auth/session";
import { listProviders } from "@/ai/registry";
import { providerStatus } from "@/lib/env.server";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { ProviderList } from "@/components/staff/provider-list";

/**
 * Whether each provider's *credentials* are present on this deployment.
 *
 * Only a boolean ever reaches this page — the keys themselves stay in
 * server environment variables and are never rendered, logged, or sent to
 * the browser (#71, #77).
 */
const CREDENTIALS_PRESENT: Record<string, boolean> = {
  openrouter: providerStatus.openrouter,
  "cloudflare-images": providerStatus.cloudflareImages,
};

export default async function AdminProvidersPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireSuperAdminPage(locale);

  const t = await getTranslations({ locale, namespace: "admin.providers" });
  const providers = await listProviders();

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title={t("title")} description={t("description")} />

      <Card>
        <CardContent className="divide-y divide-line py-0">
          <ProviderList
            providers={providers.map((provider) => ({
              id: provider.id,
              slug: provider.slug,
              name: provider.name,
              kind: provider.kind,
              enabled: provider.enabled,
              configured: CREDENTIALS_PRESENT[provider.slug] ?? false,
            }))}
          />
        </CardContent>
      </Card>

      <Alert tone="info">{t("description")}</Alert>
    </div>
  );
}
