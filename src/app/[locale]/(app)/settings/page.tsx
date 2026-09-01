import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { getCurrentProfile, getCurrentUser } from "@/auth/session";
import { getUserActivePlan } from "@/billing/plans";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { checkQuota } from "@/usage/quota";
import { formatPrice } from "@/billing/pricing";
import { getBillingCurrency } from "@/lib/settings";
import { toFontChoice } from "@/lib/fonts";
import { toAccentChoice } from "@/lib/accents";
import { listDeviceSessions } from "@/auth/device-sessions";
import { DeviceList } from "@/components/app/device-list";
import { ProfileForm } from "./profile-form";
import { SubscriptionPanel } from "@/components/billing/subscription-panel";
import { UsageSummary } from "@/components/billing/usage-summary";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "settings" });
  return { title: t("title") };
}

export default async function SettingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ billing?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations({ locale, namespace: "settings" });
  const tb = await getTranslations({ locale, namespace: "billing" });

  const profile = await getCurrentProfile();
  const user = await getCurrentUser();
  if (!profile || !user) return null;

  const { billing } = await searchParams;

  const plan = await getUserActivePlan(user.id);
  const isFree = Number(plan.price_usd) === 0;
  const currency = await getBillingCurrency();
  const planAmount = ((plan.currency_prices ?? {}) as Record<string, number>)[currency] ?? Number(plan.price_usd);

  const supabase = await createServerSupabaseClient();
  const { data: subscription } = await supabase
    .from("subscriptions")
    .select("status, current_period_start, current_period_end, cancel_at_period_end, billing_provider")
    .eq("user_id", user.id)
    .in("status", ["active", "trialing", "past_due"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  // The quotas that are actually metered for a user's own view. Fetched in
  // parallel — each is an independent read and awaiting them in sequence
  // made Settings the slowest page in the app.
  const devices = await listDeviceSessions(user.id);

  const [messages, images, vision, files] = await Promise.all([
    checkQuota(user.id, "messages"),
    checkQuota(user.id, "image_generations"),
    checkQuota(user.id, "vision_requests"),
    checkQuota(user.id, "file_processing"),
  ]);

  return (
    <div className="scroll-area flex-1 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-5 p-4 sm:p-6">
        <PageHeader title={t("title")} description={t("description")} />

        {billing === "success" ? <Alert tone="success">{tb("success")}</Alert> : null}
        {billing === "pending" ? <Alert tone="info">{tb("pending")}</Alert> : null}

        <Card>
          <CardHeader>
            <CardTitle>{t("profile")}</CardTitle>
          </CardHeader>
          <CardContent>
            <ProfileForm
              initialDisplayName={profile.display_name ?? ""}
              email={profile.email ?? ""}
              initialTheme={profile.theme}
              initialFont={toFontChoice(profile.font_preference)}
              initialAccent={toAccentChoice(profile.accent_preference)}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("subscription")}</CardTitle>
          </CardHeader>
          <CardContent>
            <SubscriptionPanel
              planName={plan.name}
              priceLabel={
                isFree
                  ? null
                  : `${formatPrice(planAmount, currency, locale)} · ${
                      plan.billing_interval === "year" ? tb("pricing.perYear") : tb("pricing.perMonth")
                    }`
              }
              isFree={isFree}
              status={subscription?.status ?? null}
              currentPeriodStart={subscription?.current_period_start ?? null}
              currentPeriodEnd={subscription?.current_period_end ?? null}
              cancelAtPeriodEnd={subscription?.cancel_at_period_end ?? false}
              isGrant={subscription?.billing_provider === "manual"}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("devices.title")}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <p className="text-[13px] leading-relaxed text-muted">{t("devices.description")}</p>
            <DeviceList sessions={devices} locale={locale} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("usage")}</CardTitle>
          </CardHeader>
          <CardContent>
            <UsageSummary
              rows={[
                { key: "messages", ...messages },
                { key: "image_generations", ...images },
                { key: "vision_requests", ...vision },
                { key: "file_processing", ...files },
              ]}
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
