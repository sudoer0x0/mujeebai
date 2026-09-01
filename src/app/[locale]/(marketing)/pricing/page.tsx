import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { listPlansWithEntitlements } from "@/billing/pricing";
import { enabledCurrencies, resolveRequestCurrency } from "@/billing/currency-preference";
import { CurrencySwitcher } from "@/components/billing/currency-switcher";
import { getCurrentUser } from "@/auth/session";
import { getUserActivePlan } from "@/billing/plans";
import { PlanCard } from "@/components/billing/plan-card";
import { UpgradeButton } from "@/components/billing/upgrade-button";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { Link } from "@/i18n/navigation";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "billing.pricing" });
  return { title: t("title") };
}

export default async function PricingPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations({ locale, namespace: "billing.pricing" });
  const tf = await getTranslations({ locale, namespace: "billing.faq" });

  // Plans, prices and feature lists all come from the database. Nothing on
  // this page is a hardcoded number — see src/billing/pricing.ts.
  const plans = await listPlansWithEntitlements();
  const available = enabledCurrencies(plans);
  const currency = await resolveRequestCurrency(available);
  const user = await getCurrentUser();
  const currentPlan = user ? await getUserActivePlan(user.id) : null;

  const faqs = [
    { q: tf("cancel.q"), a: tf("cancel.a") },
    { q: tf("payment.q"), a: tf("payment.a") },
    { q: tf("limits.q"), a: tf("limits.a") },
  ];

  return (
    <div className="mx-auto w-full max-w-4xl px-5 py-14 sm:px-6 sm:py-20">
      <header className="mx-auto max-w-2xl text-center">
        <h1 className="text-title text-balance font-semibold text-foreground">{t("title")}</h1>
        <p className="measure mx-auto mt-3.5 text-body text-muted">{t("subtitle")}</p>

        {/* Centred under the subtitle rather than tucked in a corner: on a
            pricing page the currency is part of reading the price, not a
            setting to go hunting for. Renders nothing when there is only
            one currency to offer. */}
        {available.length > 1 ? (
          <div className="mt-5 flex justify-center">
            <CurrencySwitcher current={currency} available={available} />
          </div>
        ) : null}
      </header>

      {plans.length === 0 ? (
        <Alert tone="warning" className="mt-10">
          {t("unavailable")}
        </Alert>
      ) : (
        <div className="mt-10 grid gap-4 sm:grid-cols-2">
          {plans.map((plan, index) => {
            const isCurrent = currentPlan?.slug === plan.slug;
            const isFree = plan.priceUsd === 0;
            const previous = index > 0 ? plans[index - 1] : null;

            return (
              <PlanCard
                key={plan.id}
                plan={plan}
                locale={locale}
                currency={currency}
                featured={!isFree}
                comparedTo={previous}
                action={
                  isCurrent ? (
                    <Button variant="secondary" className="w-full" disabled>
                      {t("currentPlan")}
                    </Button>
                  ) : isFree ? (
                    <Button variant="outline" asChild className="w-full">
                      <Link href={user ? "/chat" : "/register"}>{t("getStarted")}</Link>
                    </Button>
                  ) : user ? (
                    <UpgradeButton planSlug={plan.slug} label={t("upgradeTo", { plan: plan.name })} />
                  ) : (
                    <Button asChild className="w-full">
                      <Link href="/register">{t("upgradeTo", { plan: plan.name })}</Link>
                    </Button>
                  )
                }
              />
            );
          })}
        </div>
      )}

      <section className="mx-auto mt-16 max-w-2xl border-t border-line pt-12">
        <h2 className="text-heading text-center font-semibold text-foreground">{tf("title")}</h2>
        <dl className="mt-6 divide-y divide-line">
          {faqs.map((faq) => (
            <div key={faq.q} className="py-4">
              <dt className="text-[15px] font-semibold text-foreground">{faq.q}</dt>
              <dd className="mt-1.5 text-body text-muted">{faq.a}</dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  );
}
