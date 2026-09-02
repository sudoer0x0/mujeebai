import type { Metadata } from "next";
import type * as React from "react";
import { Reveal } from "@/components/marketing/reveal";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { ArrowRight, MessagesSquare, FileText, Eye, Globe, ImageIcon, ShieldCheck } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { getCurrentUser } from "@/auth/session";
import { listPlansWithEntitlements, formatPrice, resolveAmount } from "@/billing/pricing";
import { getBillingCurrency } from "@/lib/settings";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "metadata" });
  return { title: t("title"), description: t("description") };
}

const FEATURES = [
  { key: "chat", icon: MessagesSquare },
  { key: "files", icon: FileText },
  { key: "vision", icon: Eye },
  { key: "images", icon: ImageIcon },
  { key: "global", icon: Globe },
  { key: "privacy", icon: ShieldCheck },
] as const;

export default async function LandingPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations({ locale, namespace: "landing" });
  const tb = await getTranslations({ locale, namespace: "billing.pricing" });
  const user = await getCurrentUser();

  // Even the landing page's price comes from the plan row, so there is
  // exactly one place in the product where a price is defined.
  const plans = await listPlansWithEntitlements();
  const paidPlan = plans.find((plan) => plan.priceUsd > 0);
  const currency = await getBillingCurrency();
  const paidPrice = paidPlan ? resolveAmount(paidPlan, currency) : null;

  return (
    <div className="mx-auto w-full max-w-[76rem] px-5 sm:px-8">
      {/* Hero. Type is fluid (see the scale in globals.css) so the headline
          is ~34px on a phone and ~60px on a wide monitor without a jump at
          any breakpoint, and the copy is capped to a readable measure
          rather than running the full width of a large screen. */}
      {/* No glow on a true-black ground.
          A radial accent wash reads as a grey smudge against #000 rather
          than as light, and on an OLED screen it is the one thing keeping
          the panel lit. The hero carries itself on type instead. */}
      <section className="relative isolate py-20 sm:py-28 lg:py-36">
        <div className="mx-auto max-w-4xl text-center">
          <h1
            className="hero-step text-display text-balance font-bold leading-[1.02] tracking-[-0.03em] text-foreground"
            style={{ "--hero-delay": "0ms" } as React.CSSProperties}
          >
            {t("hero.title")}
          </h1>

          <p
            className="hero-step measure-wide mx-auto mt-6 text-pretty text-lead leading-relaxed text-muted sm:mt-7"
            style={{ "--hero-delay": "80ms" } as React.CSSProperties}
          >
            {t("hero.subtitle")}
          </p>

          <div
            className="hero-step mt-9 flex flex-col items-center justify-center gap-3 sm:mt-11"
            style={{ "--hero-delay": "160ms" } as React.CSSProperties}
          >
            {/* White on black for the one action that matters, outlined
                for the secondary. Stacked on phones and kept stacked: two
                full-width targets are easier to hit than a side-by-side
                pair squeezed onto a narrow screen. */}
            <Button
              size="lg"
              asChild
              className="h-[52px] w-full max-w-xs gap-2 rounded-full bg-foreground px-7 text-[15px] font-semibold text-canvas hover:bg-foreground/90"
            >
              <Link href={user ? "/chat" : "/register"}>
                {user ? t("cta.continue") : t("cta.start")}
                <ArrowRight className="size-4 rtl:rotate-180" aria-hidden />
              </Link>
            </Button>
            <Button
              size="lg"
              variant="outline"
              asChild
              className="h-[52px] w-full max-w-xs rounded-full border-line-strong px-7 text-[15px]"
            >
              <Link href="/pricing">{t("cta.pricing")}</Link>
            </Button>
          </div>

          <p className="hero-step mt-5 text-[13px] text-faint" style={{ "--hero-delay": "270ms" } as React.CSSProperties}>
            {paidPrice
              ? t("hero.priceNote", {
                  price: formatPrice(paidPrice.major, paidPrice.currency, locale),
                  plan: paidPlan!.name,
                })
              : tb("noCard")}
          </p>
        </div>
      </section>

      <section className="py-16 sm:py-20">
        <Reveal>
          <h2 className="text-heading text-center font-semibold text-foreground">{t("features.title")}</h2>
        </Reveal>

        {/* One column on phones, two on tablets, three on desktop — the
            cards carry prose, and three across on a narrow screen would
            leave each one a few words wide. */}
        {/* Spaced cards rather than a ruled grid. The previous version
            used `gap-px` over a `bg-line` parent, which draws a hairline
            between every cell — precise, but it fenced the page into a
            table and made the section read as heavier than the content in
            it. Separation now comes from space. */}
        <div className="mt-8 grid gap-3 sm:mt-10 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3">
          {FEATURES.map((feature, index) => (
            <Reveal key={feature.key} delay={index * 60}>
              <div className="lift h-full rounded-xl bg-surface p-5 sm:p-6">
                <feature.icon className="size-5 text-muted" aria-hidden />
                <h3 className="mt-3.5 text-[17px] font-semibold text-foreground">
                  {t(`features.${feature.key}.title` as never)}
                </h3>
                <p className="mt-1.5 text-body text-muted">{t(`features.${feature.key}.body` as never)}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      <Reveal>
      <section className="py-16 text-center sm:py-24">
        <h2 className="text-title font-semibold text-foreground">{t("closing.title")}</h2>
        <p className="measure mx-auto mt-3 text-pretty text-body text-muted">{t("closing.body")}</p>
        <Button size="lg" asChild className="mt-7 h-12 px-6 text-[15px]">
          <Link href={user ? "/chat" : "/register"}>{user ? t("cta.continue") : t("cta.start")}</Link>
        </Button>
      </section>
      </Reveal>
    </div>
  );
}
