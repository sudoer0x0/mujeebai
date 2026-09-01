import { getTranslations, setRequestLocale } from "next-intl/server";
import { requireSuperAdminPage } from "@/auth/session";
import { listModels, listProviders } from "@/ai/registry";
import { PageHeader } from "@/components/ui/page-header";
import { Table, TBody, TD, TH, THead, TR, TableScroll } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { ModelControls } from "@/components/staff/model-controls";

export default async function AdminModelsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireSuperAdminPage(locale);

  const t = await getTranslations({ locale, namespace: "admin.models" });
  const [models, providers] = await Promise.all([listModels(), listProviders()]);
  const providerName = new Map(providers.map((provider) => [provider.id, provider.name]));

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title={t("title")} description={t("description")} />

      <TableScroll>
        <Table>
          <THead>
            <TR>
              <TH>{t("colModel")}</TH>
              <TH>{t("colProvider")}</TH>
              <TH>{t("colTier")}</TH>
              <TH>{t("colAvailability")}</TH>
              <TH className="text-end">{t("colPriority")}</TH>
            </TR>
          </THead>
          <TBody>
            {models.map((model) => (
              <TR key={model.id}>
                <TD>
                  <div className="flex min-w-0 flex-col">
                    <span className="font-medium text-foreground">{model.display_name}</span>
                    <span className="font-mono text-[11px] text-faint">{model.slug}</span>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {model.capabilities.map((capability) => (
                        <Badge key={capability} variant="neutral">
                          {capability}
                        </Badge>
                      ))}
                    </div>
                  </div>
                </TD>
                <TD className="text-muted">{providerName.get(model.provider_id) ?? "—"}</TD>
                <TD colSpan={2}>
                  <ModelControls
                    modelId={model.id}
                    availability={model.availability}
                    tier={model.tier}
                  />
                </TD>
                <TD className="text-end tabular-nums text-muted">{model.priority}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </TableScroll>
    </div>
  );
}
