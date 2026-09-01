"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { Check } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/components/ui/toast";
import {
  updatePlanPriceAction,
  updatePlanCurrencyPricesAction,
  updateEntitlementAction,
  updatePaystackPlanCodeAction,
} from "@/app/[locale]/admin/plans/actions";
import { SUPPORTED_CURRENCIES, CURRENCY_LABELS } from "@/billing/currencies";

const BOOLEAN_KEYS = new Set(["premium_models", "advanced_models"]);

export interface PlanEditorPlan {
  id: string;
  slug: string;
  name: string;
  priceUsd: number;
  billingInterval: string;
  paystackPlanCode: string;
  /** Currency code -> price in that currency's major unit. */
  currencyPrices: Record<string, number>;
}

/**
 * Plan and entitlement editor.
 *
 * Two deliberate changes from what this replaced:
 *
 *  - Entitlements are typed controls (a number input, or a switch for
 *    access flags) rather than a raw JSON textbox. Asking an operator to
 *    hand-write `"false"` into a field whose parse failure was reported as
 *    a toast is a way to produce a plan whose limits do not mean what the
 *    console shows.
 *  - Saving is explicit. The old fields saved on blur, so tabbing through
 *    a card wrote every value it passed, and clicking away mid-edit
 *    committed a half-typed number to the plan every customer is billed
 *    against.
 */
export function PlanEditor({
  plan,
  entitlements,
  billingCurrency,
}: {
  plan: PlanEditorPlan;
  entitlements: Array<{ featureKey: string; value: unknown }>;
  /** The currency checkout is currently charging in, highlighted below. */
  billingCurrency: string;
}) {
  const t = useTranslations("admin.plans");
  const tf = useTranslations("admin.feature");

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-2">
        <CardTitle>{plan.name}</CardTitle>
        <Badge variant="neutral">{plan.slug}</Badge>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <NumberSetting
          label={t("price", { interval: plan.billingInterval })}
          initial={plan.priceUsd}
          step="0.01"
          min={0}
          onSave={(value) => updatePlanPriceAction({ planId: plan.id, priceUsd: value })}
        />

        <CurrencyPrices
          planId={plan.id}
          billingCurrency={billingCurrency}
          initial={plan.currencyPrices}
        />

        <div className="flex flex-col gap-2 border-t border-line pt-4">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-faint">{t("entitlements")}</p>
          {entitlements.map((entitlement) =>
            BOOLEAN_KEYS.has(entitlement.featureKey) ? (
              <BooleanSetting
                key={entitlement.featureKey}
                label={tf(entitlement.featureKey as never)}
                initial={Boolean(entitlement.value)}
                onSave={(value) =>
                  updateEntitlementAction({ planId: plan.id, featureKey: entitlement.featureKey, value })
                }
              />
            ) : (
              <NumberSetting
                key={entitlement.featureKey}
                label={tf(entitlement.featureKey as never)}
                initial={Number(entitlement.value)}
                inline
                min={-1}
                onSave={(value) =>
                  updateEntitlementAction({ planId: plan.id, featureKey: entitlement.featureKey, value })
                }
              />
            ),
          )}
        </div>

        <div className="border-t border-line pt-4">
          <TextSetting
            label={t("paystackCode")}
            hint={t("paystackCodeHint")}
            initial={plan.paystackPlanCode}
            onSave={(value) => updatePaystackPlanCodeAction({ planId: plan.id, planCode: value })}
          />
        </div>
      </CardContent>
    </Card>
  );
}

type SaveResult = { ok: boolean; message?: string };

function useSaver(onSave: (value: never) => Promise<SaveResult>) {
  const t = useTranslations("admin.plans");
  const [pending, setPending] = React.useState(false);
  const [saved, setSaved] = React.useState(false);

  const save = React.useCallback(
    async (value: unknown) => {
      setPending(true);
      try {
        const result = await onSave(value as never);
        if (result.ok) {
          setSaved(true);
          // A short-lived inline tick is quieter than a toast for a field
          // an operator may edit several of in a row.
          setTimeout(() => setSaved(false), 1800);
        } else {
          toast.error(t("saveFailed"));
        }
      } catch {
        toast.error(t("saveFailed"));
      } finally {
        setPending(false);
      }
    },
    [onSave, t],
  );

  return { pending, saved, save };
}

function NumberSetting({
  label,
  initial,
  onSave,
  step = "1",
  min,
  inline,
}: {
  label: string;
  initial: number;
  onSave: (value: number) => Promise<SaveResult>;
  step?: string;
  min?: number;
  inline?: boolean;
}) {
  const t = useTranslations("admin.common");
  const id = React.useId();
  const [value, setValue] = React.useState(String(initial));
  const { pending, saved, save } = useSaver(onSave as (value: never) => Promise<SaveResult>);

  const parsed = Number(value);
  const dirty = value !== String(initial) && Number.isFinite(parsed);

  return (
    <div className={inline ? "flex items-center justify-between gap-3" : "flex flex-col gap-1.5"}>
      <label htmlFor={id} className="text-[12px] text-foreground">
        {label}
      </label>
      <div className="flex items-center gap-1.5">
        <Input
          id={id}
          type="number"
          inputMode="decimal"
          step={step}
          min={min}
          value={value}
          disabled={pending}
          onChange={(event) => setValue(event.target.value)}
          className="h-8 w-28 text-end tabular-nums"
        />
        {saved ? <Check className="size-3.5 text-success" aria-label={t("save")} /> : null}
        <Button size="sm" variant="secondary" disabled={!dirty || pending} onClick={() => save(parsed)}>
          {pending ? <Spinner /> : null}
          {pending ? t("saving") : t("save")}
        </Button>
      </div>
    </div>
  );
}

function BooleanSetting({
  label,
  initial,
  onSave,
}: {
  label: string;
  initial: boolean;
  onSave: (value: boolean) => Promise<SaveResult>;
}) {
  const id = React.useId();
  const [checked, setChecked] = React.useState(initial);
  const { pending, save } = useSaver(onSave as (value: never) => Promise<SaveResult>);

  return (
    <div className="flex items-center justify-between gap-3">
      <label htmlFor={id} className="text-[12px] text-foreground">
        {label}
      </label>
      <Switch
        id={id}
        checked={checked}
        disabled={pending}
        onCheckedChange={(next) => {
          // Optimistic, then reconciled: a toggle that does not move until
          // a round trip completes feels broken.
          setChecked(next);
          void save(next).then(() => undefined);
        }}
      />
    </div>
  );
}

function TextSetting({
  label,
  hint,
  initial,
  onSave,
}: {
  label: string;
  hint?: string;
  initial: string;
  onSave: (value: string) => Promise<SaveResult>;
}) {
  const t = useTranslations("admin.common");
  const id = React.useId();
  const [value, setValue] = React.useState(initial);
  const { pending, saved, save } = useSaver(onSave as (value: never) => Promise<SaveResult>);

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-[12px] font-medium text-foreground">
        {label}
      </label>
      {hint ? (
        <p id={`${id}-hint`} className="text-[12px] text-muted">
          {hint}
        </p>
      ) : null}
      <div className="flex items-center gap-1.5">
        <Input
          id={id}
          aria-describedby={hint ? `${id}-hint` : undefined}
          value={value}
          disabled={pending}
          onChange={(event) => setValue(event.target.value)}
          placeholder="PLN_xxxxxxxx"
          className="h-8 font-mono text-[12px]"
        />
        {saved ? <Check className="size-3.5 shrink-0 text-success" /> : null}
        <Button size="sm" variant="secondary" disabled={value === initial || pending} onClick={() => save(value)}>
          {pending ? <Spinner /> : null}
          {t("save")}
        </Button>
      </div>
    </div>
  );
}


/**
 * Price in every supported currency, edited and saved as one unit.
 *
 * Saving the whole set together rather than field-by-field is deliberate:
 * these values are only meaningful in relation to each other, and a
 * half-saved set (Naira updated, Cedi not) is a pricing inconsistency that
 * an operator has no way to see. One save, one audit entry, one snapshot.
 *
 * A blank field means "no price in this currency" — a real state that
 * makes checkout refuse rather than charge the wrong number. The currency
 * currently being charged is marked, because leaving *that* one blank is
 * the mistake that takes the buy button off the pricing page.
 */
function CurrencyPrices({
  planId,
  billingCurrency,
  initial,
}: {
  planId: string;
  billingCurrency: string;
  initial: Record<string, number>;
}) {
  const t = useTranslations("admin.plans");
  const [values, setValues] = React.useState<Record<string, string>>(() =>
    Object.fromEntries(
      SUPPORTED_CURRENCIES.map((code) => [code, initial[code] !== undefined ? String(initial[code]) : ""]),
    ),
  );
  const [pending, setPending] = React.useState(false);
  const [saved, setSaved] = React.useState(false);

  const baseline = React.useMemo(
    () =>
      Object.fromEntries(
        SUPPORTED_CURRENCIES.map((code) => [code, initial[code] !== undefined ? String(initial[code]) : ""]),
      ),
    [initial],
  );
  const dirty = SUPPORTED_CURRENCIES.some((code) => values[code] !== baseline[code]);
  const missingCharging = values[billingCurrency]?.trim() === "";

  async function save() {
    setPending(true);
    try {
      const prices: Record<string, number | null> = {};
      for (const code of SUPPORTED_CURRENCIES) {
        const raw = values[code]?.trim() ?? "";
        if (raw === "") {
          prices[code] = null;
          continue;
        }
        const parsed = Number(raw);
        if (!Number.isFinite(parsed) || parsed < 0) {
          toast.error(t("saveFailed"));
          return;
        }
        prices[code] = parsed;
      }

      const result = await updatePlanCurrencyPricesAction({ planId, prices });
      if (result.ok) {
        setSaved(true);
        setTimeout(() => setSaved(false), 1800);
      } else {
        toast.error(t("saveFailed"));
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-2 border-t border-line pt-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-faint">{t("currencyPrices")}</p>
        {saved ? <Check className="size-3.5 text-success" aria-hidden /> : null}
      </div>
      <p className="text-[12px] leading-relaxed text-muted">{t("currencyPricesHint")}</p>

      <div className="mt-1 grid gap-2 sm:grid-cols-2">
        {SUPPORTED_CURRENCIES.map((code) => (
          <label key={code} className="flex items-center justify-between gap-2">
            <span className="min-w-0 text-[12px] text-muted">
              <span className="font-mono font-medium text-foreground">{code}</span>
              {code === billingCurrency ? (
                <Badge variant="accent" className="ml-1.5 align-middle">
                  {t("charging")}
                </Badge>
              ) : null}
              <span className="sr-only"> — {CURRENCY_LABELS[code]}</span>
            </span>
            <Input
              type="number"
              min={0}
              step="0.01"
              inputMode="decimal"
              aria-label={`${code} — ${CURRENCY_LABELS[code]}`}
              value={values[code] ?? ""}
              disabled={pending}
              placeholder="—"
              onChange={(event) => setValues((prev) => ({ ...prev, [code]: event.target.value }))}
              className="h-8 w-28 text-right font-mono text-[12px] tabular-nums"
            />
          </label>
        ))}
      </div>

      {missingCharging ? (
        <p className="text-[12px] text-warning">{t("missingChargingCurrency", { currency: billingCurrency })}</p>
      ) : null}

      <div className="flex justify-end">
        <Button size="sm" variant="secondary" disabled={!dirty || pending} onClick={save}>
          {pending ? <Spinner /> : null}
          {t("save")}
        </Button>
      </div>
    </div>
  );
}
