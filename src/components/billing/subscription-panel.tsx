"use client";

import * as React from "react";
import { useTranslations, useLocale } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { UpgradeButton } from "@/components/billing/upgrade-button";
import { toast } from "@/components/ui/toast";
import { useRouter } from "@/i18n/navigation";

/**
 * The user's current plan, and the one action they can take on it.
 *
 * Cancellation goes through a confirmation that states what actually
 * happens — access continues to the end of the period already paid for —
 * rather than a bare "are you sure?" that leaves people assuming they
 * just threw away the rest of the month.
 */
export function SubscriptionPanel({
  planName,
  priceLabel,
  isFree,
  status,
  currentPeriodStart,
  currentPeriodEnd,
  cancelAtPeriodEnd,
  isGrant,
}: {
  planName: string;
  priceLabel: string | null;
  isFree: boolean;
  status: string | null;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  /** Complimentary access granted by staff, rather than a paid plan. */
  isGrant: boolean;
}) {
  const t = useTranslations("billing");
  const locale = useLocale();
  const router = useRouter();
  const [confirming, setConfirming] = React.useState(false);

  const dateFormat: Intl.DateTimeFormatOptions = { day: "numeric", month: "long", year: "numeric" };
  const endsOn = currentPeriodEnd ? new Date(currentPeriodEnd).toLocaleDateString(locale, dateFormat) : null;
  const startedOn = currentPeriodStart
    ? new Date(currentPeriodStart).toLocaleDateString(locale, dateFormat)
    : null;

  // Days left, so "renews in 3 days" is legible without doing arithmetic
  // against today's date.
  const daysLeft = currentPeriodEnd
    ? Math.max(0, Math.ceil((new Date(currentPeriodEnd).getTime() - Date.now()) / 86_400_000))
    : null;

  async function cancel() {
    const response = await fetch("/api/billing/cancel", { method: "POST" });
    if (!response.ok) {
      toast.error(t("cancelError"));
      return;
    }
    toast.success(t("cancelled"));
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[14px] font-semibold text-foreground">{planName}</span>
            {status === "past_due" ? <Badge variant="warning">{status}</Badge> : null}
            {status && status !== "past_due" && !isFree ? <Badge variant="success">{status}</Badge> : null}
          </div>
          <p className="mt-0.5 text-[13px] text-muted">{priceLabel ?? t("pricing.free")}</p>
        </div>

        <div className="shrink-0">
          {isFree ? (
            <UpgradeButton className="" />
          ) : cancelAtPeriodEnd || isGrant ? null : (
            <Button variant="outline" onClick={() => setConfirming(true)}>
              {t("cancel")}
            </Button>
          )}
        </div>
      </div>

      {/* The billing cycle, stated plainly and always — not only when
          something is wrong. "When am I next charged?" was previously
          unanswerable from this page unless you had already cancelled. */}
      {!isFree && endsOn ? (
        <dl className="flex flex-col gap-2 rounded-md border border-line bg-surface-sunken p-3 text-[13px]">
          {startedOn ? (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <dt className="text-muted">{t("cycle.started")}</dt>
              <dd className="font-medium text-foreground">{startedOn}</dd>
            </div>
          ) : null}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <dt className="text-muted">
              {isGrant ? t("cycle.accessEnds") : cancelAtPeriodEnd ? t("cycle.accessEnds") : t("cycle.renews")}
            </dt>
            <dd className="font-medium text-foreground">
              {endsOn}
              {daysLeft !== null ? (
                <span className="ms-1.5 font-normal text-muted">{t("cycle.daysLeft", { count: daysLeft })}</span>
              ) : null}
            </dd>
          </div>
          {isGrant ? (
            <p className="text-[12px] leading-relaxed text-muted">{t("cycle.grantNote")}</p>
          ) : null}
        </dl>
      ) : null}

      {cancelAtPeriodEnd && endsOn ? (
        <Alert tone="warning">{t("cancelAtPeriodEnd", { date: endsOn })}</Alert>
      ) : null}

      {status === "past_due" ? <Alert tone="danger">{t("pastDue")}</Alert> : null}

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={t("cancelConfirm.title")}
        description={t("cancelConfirm.body", { plan: t("plan.free.name") })}
        confirmLabel={t("cancelConfirm.confirm")}
        cancelLabel={t("pricing.currentPlan")}
        onConfirm={cancel}
      />
    </div>
  );
}
