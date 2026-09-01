"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Sparkles, Gift, X } from "lucide-react";
import { dismissPlanNoticeAction, type PlanNotice as Notice } from "@/app/[locale]/(app)/plan-notice-actions";

/**
 * Confirms a plan the account just gained.
 *
 * Two shapes, because the two are not the same news. A purchase is a
 * receipt — the thing you paid for is now active. A grant is a gift with
 * an end date, and saying so plainly is what stops it reading as a
 * billing error later when it lapses.
 *
 * Dismissal marks the notification read server-side rather than writing
 * to browser storage, so confirming on a phone does not leave it waiting
 * on a laptop.
 */
export function PlanNotice({ notice, locale }: { notice: Notice; locale: string }) {
  const t = useTranslations("billing.notice");
  const router = useRouter();
  const [leaving, setLeaving] = React.useState(false);

  const granted = notice.kind === "granted";
  const expires = notice.expiresAt ? new Date(notice.expiresAt).toLocaleDateString(locale, {
    day: "numeric",
    month: "long",
  }) : null;

  function dismiss() {
    // Play the exit, then persist. The row is marked read either way, so
    // a reload mid-animation still counts as dismissed.
    setLeaving(true);
    void dismissPlanNoticeAction({ id: notice.id }).then(() => router.refresh());
  }

  return (
    <div className="plan-notice" data-state={leaving ? "leaving" : "entered"} role="status">
      <div className="flex items-start gap-3 border-b border-line/60 bg-accent-soft px-4 py-3 sm:px-6">
        <span className="plan-notice-badge mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent">
          {granted ? <Gift className="size-4" aria-hidden /> : <Sparkles className="size-4" aria-hidden />}
        </span>

        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-medium text-foreground">
            {granted ? t("grantedTitle", { plan: notice.planName }) : t("purchasedTitle", { plan: notice.planName })}
          </p>
          <p className="mt-0.5 text-[12px] leading-relaxed text-muted">
            {granted
              ? notice.days !== null && expires
                ? t("grantedBodyDays", { days: notice.days, date: expires })
                : t("grantedBody")
              : expires
                ? t("purchasedBody", { date: expires })
                : t("purchasedBodyPlain")}
          </p>
        </div>

        <button
          type="button"
          onClick={dismiss}
          aria-label={t("dismiss")}
          className="-me-1 rounded p-1 text-muted transition-colors hover:bg-surface-raised hover:text-foreground"
        >
          <X className="size-3.5" aria-hidden />
        </button>
      </div>
    </div>
  );
}
