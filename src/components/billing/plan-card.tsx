import { Check, Minus } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  ACCESS_FEATURE_KEYS,
  QUOTA_FEATURE_KEYS,
  formatPrice,
  hasFeature,
  quotaOf,
  resolveAmount,
  type FeatureKey,
  type ResolvedPlan,
} from "@/billing/pricing";

/**
 * Maps an entitlement row to the sentence a customer reads.
 *
 * Every line on a plan card is derived from `plan_entitlements`, so the
 * marketing copy cannot drift from what the server will actually enforce
 * — the previous version listed "Unlimited daily conversations" and
 * "Claude 3.5 Sonnet, GPT-4o" beside a plan whose database rows said 500
 * messages/day and no such models.
 */
/**
 * The entitlement keys are data, not literals, so the translator is used
 * through a loosened signature here. Keeping the cast in one place beats
 * scattering `as never` across every lookup — and the keys themselves are
 * still constrained by `FeatureKey`.
 */
type LooseTranslator = (key: string, values?: Record<string, string | number>) => string;

async function featureLines(plan: ResolvedPlan, locale: string): Promise<string[]> {
  const t = (await getTranslations({ locale, namespace: "billing.features" })) as unknown as LooseTranslator;
  const lines: string[] = [];

  const unlimitedKey: Partial<Record<FeatureKey, string>> = {
    messages_per_day: "unlimitedMessages",
    image_generations_per_day: "unlimitedImages",
    vision_requests_per_day: "unlimitedVision",
    file_processing_per_day: "unlimitedFiles",
  };

  for (const key of QUOTA_FEATURE_KEYS) {
    const quota = quotaOf(plan, key);
    if (quota === null) continue;
    if (quota === "unlimited") {
      const alt = unlimitedKey[key];
      lines.push(alt ? t(alt) : t(key, { count: 0 }));
      continue;
    }
    // A zero allowance is a real state (the feature is off for this plan),
    // and the ICU `=0` branch renders it as such rather than "0 messages".
    lines.push(t(key, { count: quota }));
  }

  for (const key of ACCESS_FEATURE_KEYS) {
    if (hasFeature(plan, key)) lines.push(t(key));
  }

  return lines;
}

export async function PlanCard({
  plan,
  locale,
  currency,
  featured,
  comparedTo,
  action,
}: {
  plan: ResolvedPlan;
  locale: string;
  currency: string;
  featured?: boolean;
  /** When set, the feature list is framed as "Everything in X, plus". */
  comparedTo?: ResolvedPlan | null;
  action: React.ReactNode;
}) {
  const t = await getTranslations({ locale, namespace: "billing.pricing" });
  // null means this plan has no price configured in the charging
  // currency. Showing the USD number with a Naira symbol would be worse
  // than showing nothing, so the card says so and the buy button is not
  // offered — matching what checkout would do anyway.
  const amount = resolveAmount(plan, currency);
  const isFree = amount?.major === 0;
  const lines = await featureLines(plan, locale);
  const baseLines = comparedTo ? await featureLines(comparedTo, locale) : [];

  // When comparing against a lower plan, only show what is genuinely
  // different rather than repeating the entire list.
  const shownLines = comparedTo ? lines.filter((line) => !baseLines.includes(line)) : lines;

  return (
    <div
      className={cn(
        "flex flex-col rounded-lg border bg-surface p-5 sm:p-6",
        featured ? "border-accent shadow-sm" : "border-line",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-[17px] font-semibold tracking-tight text-foreground">{plan.name}</h2>
          {plan.description ? (
            <p className="mt-1.5 text-[14px] leading-relaxed text-muted">{plan.description}</p>
          ) : null}
        </div>
        {featured ? <Badge variant="accent">{t("mostPopular")}</Badge> : null}
      </div>

      <div className="mt-5 flex items-baseline gap-1.5">
        {amount ? (
          <>
            <span className="text-4xl font-semibold tracking-tight tabular-nums text-foreground">
              {formatPrice(amount.major, amount.currency, locale)}
            </span>
            <span className="text-[13px] text-muted">
              {isFree ? t("free") : plan.billingInterval === "year" ? t("perYear") : t("perMonth")}
            </span>
          </>
        ) : (
          <span className="text-[15px] font-medium text-muted">{t("priceUnavailable")}</span>
        )}
      </div>

      <p className="mt-1.5 text-[12px] text-faint">
        {!amount
          ? t("priceUnavailableHint", { currency })
          : isFree
            ? t("noCard")
            : t("billedIn", { currency: amount.currency })}
      </p>

      <div className="mt-5 border-t border-line pt-4">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-faint">
          {comparedTo ? t("everythingIn", { plan: comparedTo.name }) : t("included")}
        </p>
        <ul className="mt-3 flex flex-col gap-2">
          {shownLines.map((line) => (
            <li key={line} className="flex items-start gap-2.5 text-[14px] leading-relaxed text-foreground">
              <Check className="mt-[3px] size-4 shrink-0 text-success" aria-hidden />
              <span>{line}</span>
            </li>
          ))}
          {shownLines.length === 0 ? (
            <li className="flex items-start gap-2 text-[13px] text-muted">
              <Minus className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              <span>—</span>
            </li>
          ) : null}
        </ul>
      </div>

      <div className="mt-6 flex-1" />
      <div className="pt-4">{action}</div>
    </div>
  );
}
