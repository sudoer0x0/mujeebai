import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Check, Sparkles } from "lucide-react";
import { getCurrentUser } from "@/auth/session";
import { getUserActivePlan } from "@/billing/plans";
import { listPlansWithEntitlements, formatPrice, resolveAmount, quotaOf, QUOTA_FEATURE_KEYS } from "@/billing/pricing";
import { enabledCurrencies, resolveRequestCurrency } from "@/billing/currency-preference";
import { CurrencySwitcher } from "@/components/billing/currency-switcher";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { UpgradeButton } from "@/components/billing/upgrade-button";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "billing.upgradePage" });
  return { title: t("title") };
}

/**
 * Upgrading, without leaving the app.
 *
 * The pricing page is marketing and lives outside the shell; this is the
 * same decision made from inside it, with the sidebar and the current plan
 * still in view. Clicking through used to navigate straight to Paystack's
 * hosted page — the customer left the product to buy the product, and came
 * back through a redirect. Payment still happens in Paystack's iframe
 * (their form, their PCI scope), but it now opens over this page.
 */
export default async function UpgradePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations({ locale, namespace: "billing.upgradePage" });
  const tb = await getTranslations({ locale, namespace: "billing.pricing" });
  const tf = await getTranslations({ locale, namespace: "admin.feature" });

  const user = await getCurrentUser();
  if (!user) return null;

  const [plans, current] = await Promise.all([
    listPlansWithEntitlements(),
    getUserActivePlan(user.id),
  ]);

  // Which currencies this deployment can actually sell in, and which of
  // them this visitor has asked for. Both are derived from stored prices,
  // so the switcher can never offer a currency that would then render as
  // "unavailable".
  const available = enabledCurrencies(plans);
  const currency = await resolveRequestCurrency(available);

  const paid = plans.filter((plan) => plan.priceUsd > 0).sort((a, b) => a.sortOrder - b.sortOrder);
  const free = plans.find((plan) => plan.priceUsd === 0) ?? null;
  const alreadyPaid = Number(current.price_usd) > 0;

  return (
    <div className="scroll-area flex-1 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 p-4 sm:p-6">
        <PageHeader
          title={t("title")}
          description={t("description")}
          actions={<CurrencySwitcher current={currency} available={available} />}
        />

        {alreadyPaid ? <Alert tone="success">{t("alreadyOnPlan", { plan: current.name })}</Alert> : null}

        <div className="grid gap-4 sm:grid-cols-2">
          {free ? (
            <PlanPanel
              name={free.name}
              priceLabel={tb("free")}
              features={featureLines(free, tf)}
              current={current.slug === free.slug}
              currentLabel={t("yourPlan")}
              action={null}
            />
          ) : null}

          {paid.map((plan) => {
            const amount = resolveAmount(plan, currency);
            return (
              <PlanPanel
                key={plan.id}
                name={plan.name}
                featured
                priceLabel={
                  amount
                    ? `${formatPrice(amount.major, amount.currency, locale)} ${
                        plan.billingInterval === "year" ? tb("perYear") : tb("perMonth")
                      }`
                    : tb("priceUnavailable")
                }
                features={featureLines(plan, tf)}
                current={current.slug === plan.slug}
                currentLabel={t("yourPlan")}
                action={
                  current.slug === plan.slug || !amount ? null : (
                    <UpgradeButton planSlug={plan.slug} label={t("upgradeTo", { plan: plan.name })} />
                  )
                }
              />
            );
          })}
        </div>

        <p className="text-center text-[12px] leading-relaxed text-faint">{t("securityNote")}</p>
      </div>
    </div>
  );
}

function featureLines(
  plan: Awaited<ReturnType<typeof listPlansWithEntitlements>>[number],
  tf: Awaited<ReturnType<typeof getTranslations>>,
): string[] {
  return QUOTA_FEATURE_KEYS.map((key) => {
    const quota = quotaOf(plan, key);
    if (quota === null) return null;
    const label = tf(key as never);
    return quota === "unlimited" ? `${label}: ∞` : `${label}: ${quota}`;
  }).filter((line): line is string => Boolean(line));
}

function PlanPanel({
  name,
  priceLabel,
  features,
  current,
  currentLabel,
  action,
  featured,
}: {
  name: string;
  priceLabel: string;
  features: string[];
  current: boolean;
  currentLabel: string;
  action: React.ReactNode;
  featured?: boolean;
}) {
  return (
    <Card className={featured ? "border-accent/40" : undefined}>
      <CardContent className="flex h-full flex-col gap-4 p-5">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h2 className="flex items-center gap-1.5 text-[15px] font-semibold text-foreground">
              {featured ? <Sparkles className="size-4 text-accent" aria-hidden /> : null}
              {name}
            </h2>
            <p className="mt-1 text-[13px] text-muted">{priceLabel}</p>
          </div>
          {current ? <Badge variant="success">{currentLabel}</Badge> : null}
        </div>

        <ul className="flex flex-1 flex-col gap-1.5">
          {features.map((line) => (
            <li key={line} className="flex items-start gap-2 text-[13px] text-muted">
              <Check className="mt-0.5 size-3.5 shrink-0 text-success" aria-hidden />
              {line}
            </li>
          ))}
        </ul>

        {action}
      </CardContent>
    </Card>
  );
}
