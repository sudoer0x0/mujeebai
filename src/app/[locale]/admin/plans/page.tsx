import { getTranslations, setRequestLocale } from "next-intl/server";
import { requireSuperAdminPage } from "@/auth/session";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import { PlanEditor } from "@/components/staff/plan-editor";
import { Alert } from "@/components/ui/alert";
import { getBillingCurrency } from "@/lib/settings";

export default async function AdminPlansPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireSuperAdminPage(locale);

  const t = await getTranslations({ locale, namespace: "admin.plans" });

  const supabase = createServiceRoleClient();
  const [{ data: plans }, { data: entitlements }, billingCurrency] = await Promise.all([
    supabase.from("plans").select("*").order("sort_order"),
    supabase.from("plan_entitlements").select("plan_id, feature_key, value"),
    getBillingCurrency(),
  ]);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title={t("title")} description={t("description")} />

      {(plans ?? []).length === 0 ? (
        <Alert tone="warning">{t("saveFailed")}</Alert>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {(plans ?? []).map((plan) => (
            <PlanEditor
              key={plan.id}
              plan={{
                id: plan.id,
                slug: plan.slug,
                name: plan.name,
                priceUsd: Number(plan.price_usd),
                billingInterval: plan.billing_interval,
                paystackPlanCode:
                  ((plan.metadata as Record<string, unknown>)?.paystack_plan_code as string | undefined) ?? "",
                currencyPrices: (plan.currency_prices ?? {}) as Record<string, number>,
              }}
              billingCurrency={billingCurrency}
              entitlements={(entitlements ?? [])
                .filter((entitlement) => entitlement.plan_id === plan.id)
                .map((entitlement) => ({ featureKey: entitlement.feature_key, value: entitlement.value }))}
            />
          ))}
        </div>
      )}
    </div>
  );
}
