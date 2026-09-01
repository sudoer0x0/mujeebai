"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input, Field } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/components/ui/toast";
import { grantPlanAccessAction } from "@/admin/grant-actions";

/** Durations an operator reaches for most, so the common case is one click. */
const PRESETS = [7, 14, 30, 90] as const;

/**
 * Grants complimentary access for a chosen number of days.
 *
 * The duration used to be hardcoded at 30. A trial, an apology for an
 * outage and a partner arrangement are not the same length, and an
 * operator working around a fixed number ends up granting 30 days and
 * revoking it early — which is a worse record of what was actually
 * intended.
 *
 * The reason is optional but recorded in the audit entry, because "why
 * does this account have Pro?" is asked months later, by someone else.
 */
export function GrantPlanDialog({
  open,
  onOpenChange,
  userId,
  userLabel,
  planSlug = "pro",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userId: string;
  userLabel: string;
  planSlug?: string;
}) {
  const t = useTranslations("admin.grants");
  const router = useRouter();
  const [days, setDays] = React.useState<number>(30);
  const [reason, setReason] = React.useState("");
  const [pending, setPending] = React.useState(false);

  async function submit() {
    setPending(true);
    try {
      const result = await grantPlanAccessAction({
        userId,
        planSlug,
        days,
        reason: reason.trim() || undefined,
      });

      if (result.ok) {
        toast.success(t("grantedFor", { days }));
        onOpenChange(false);
        setReason("");
        router.refresh();
      } else {
        toast.error(t((result.message?.split(".").pop() ?? "failed") as never));
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("dialogTitle", { user: userLabel })}</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <p className="text-[13px] font-medium text-foreground">{t("duration")}</p>
            <div className="flex flex-wrap gap-1.5">
              {PRESETS.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => setDays(preset)}
                  aria-pressed={days === preset}
                  className={
                    days === preset
                      ? "rounded-full border border-accent bg-accent-soft px-3 py-1 text-[12px] text-foreground"
                      : "rounded-full border border-line px-3 py-1 text-[12px] text-muted transition-colors hover:border-line-strong hover:text-foreground"
                  }
                >
                  {t("days", { days: preset })}
                </button>
              ))}
            </div>
          </div>

          <Field id="grant-days" label={t("customDays")} description={t("customDaysHint")}>
            <Input
              type="number"
              min={1}
              max={365}
              value={days}
              onChange={(event) => {
                const next = Number(event.target.value);
                // Clamped here as well as in the action: a number input
                // still accepts anything typed, and the operator should
                // see the bound rather than a rejection on save.
                setDays(Number.isFinite(next) ? Math.min(365, Math.max(1, Math.round(next))) : 1);
              }}
              className="w-32"
            />
          </Field>

          <Field id="grant-reason" label={t("reason")} description={t("reasonHint")}>
            <Input
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              maxLength={300}
              placeholder={t("reasonPlaceholder")}
            />
          </Field>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}>
            {t("cancel")}
          </Button>
          <Button onClick={submit} disabled={pending}>
            {pending ? <Spinner /> : null}
            {t("confirm", { days })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
