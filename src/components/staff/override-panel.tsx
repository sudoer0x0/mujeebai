"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Field } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TBody, TD, TH, THead, TR, TableEmpty, TableScroll } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/components/ui/toast";
import { OVERRIDABLE_FEATURE_KEYS, BOOLEAN_FEATURE_KEYS } from "@/usage/categories";
import { setUserOverrideAction, removeUserOverrideAction } from "@/admin/user-actions";

const BOOLEAN_KEYS = new Set(BOOLEAN_FEATURE_KEYS);

export interface OverrideRow {
  featureKey: string;
  value: unknown;
  expiresAt: string | null;
  reason: string | null;
}

/**
 * Per-account entitlement overrides.
 *
 * An override is the sanctioned way to give one account a different limit
 * from its plan: it is explicit, attributable, reversible, and recorded
 * in the audit log with the previous value. Editing the plan itself to
 * accommodate one user is how every other account silently gets the same
 * change.
 */
export function OverridePanel({ userId, overrides }: { userId: string; overrides: OverrideRow[] }) {
  const t = useTranslations("admin");
  const tf = useTranslations("admin.feature");
  const [open, setOpen] = React.useState(false);
  const [featureKey, setFeatureKey] = React.useState<string>(OVERRIDABLE_FEATURE_KEYS[0]);
  const [value, setValue] = React.useState("");
  const [reason, setReason] = React.useState("");
  const [pending, setPending] = React.useState(false);
  const [removing, setRemoving] = React.useState<string | null>(null);

  const isBoolean = BOOLEAN_KEYS.has(featureKey);

  async function save() {
    setPending(true);
    try {
      const parsedValue = isBoolean ? value === "true" : Number.parseInt(value, 10);
      if (!isBoolean && !Number.isFinite(parsedValue as number)) {
        toast.error(t("common.actionFailed"));
        return;
      }

      const result = await setUserOverrideAction({
        userId,
        featureKey,
        value: parsedValue,
        reason: reason.trim() || undefined,
      });

      if (result.ok) {
        toast.success(t("usage.overrideSaved"));
        setOpen(false);
        setValue("");
        setReason("");
      } else {
        toast.error(t("common.actionFailed"));
      }
    } finally {
      setPending(false);
    }
  }

  async function remove(key: string) {
    setRemoving(key);
    try {
      const result = await removeUserOverrideAction(userId, key);
      if (result.ok) toast.success(t("usage.overrideRemoved"));
      else toast.error(t("common.actionFailed"));
    } finally {
      setRemoving(null);
    }
  }

  function formatValue(raw: unknown) {
    if (typeof raw === "boolean") return raw ? t("common.enabled") : t("common.disabled");
    const numeric = Number(raw);
    if (Number.isFinite(numeric)) return numeric < 0 ? t("common.unlimited") : numeric.toLocaleString();
    return String(raw);
  }

  return (
    <div className="flex flex-col gap-3">
      {overrides.length === 0 ? (
        <p className="text-[13px] text-muted">{t("users.detail.noOverrides")}</p>
      ) : (
        <TableScroll>
          <Table>
            <THead>
              <TR>
                <TH>{t("usage.overrideFeature")}</TH>
                <TH>{t("usage.overrideValue")}</TH>
                <TH>{t("usage.overrideReason")}</TH>
                <TH className="w-10">
                  <span className="sr-only">{t("users.detail.removeOverride")}</span>
                </TH>
              </TR>
            </THead>
            <TBody>
              {overrides.length === 0 ? <TableEmpty colSpan={4}>{t("users.detail.noOverrides")}</TableEmpty> : null}
              {overrides.map((row) => (
                <TR key={row.featureKey}>
                  <TD>{tf(row.featureKey as never)}</TD>
                  <TD className="tabular-nums">{formatValue(row.value)}</TD>
                  <TD className="text-muted">{row.reason ?? "—"}</TD>
                  <TD className="text-end">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => remove(row.featureKey)}
                      disabled={removing === row.featureKey}
                      aria-label={`${t("users.detail.removeOverride")} — ${tf(row.featureKey as never)}`}
                    >
                      {removing === row.featureKey ? <Spinner /> : <X />}
                    </Button>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </TableScroll>
      )}

      <div>
        <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
          <Plus />
          {t("users.detail.addOverride")}
        </Button>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("usage.overrideTitle")}</DialogTitle>
            <DialogDescription>{t("usage.overrideBody")}</DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="override-feature" className="text-[12px] font-medium text-foreground">
              {t("usage.overrideFeature")}
            </label>
            <Select value={featureKey} onValueChange={setFeatureKey}>
              <SelectTrigger id="override-feature">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {OVERRIDABLE_FEATURE_KEYS.map((key) => (
                  <SelectItem key={key} value={key}>
                    {tf(key as never)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {isBoolean ? (
            <div className="flex flex-col gap-1.5">
              <label htmlFor="override-bool" className="text-[12px] font-medium text-foreground">
                {t("usage.overrideValue")}
              </label>
              <Select value={value || "true"} onValueChange={setValue}>
                <SelectTrigger id="override-bool">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="true">{t("common.enabled")}</SelectItem>
                  <SelectItem value="false">{t("common.disabled")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          ) : (
            <Field
              id="override-value"
              label={t("usage.overrideValue")}
              description={t("usage.overrideValueHint")}
              required
            >
              <Input
                type="number"
                inputMode="numeric"
                min={-1}
                value={value}
                onChange={(event) => setValue(event.target.value)}
                placeholder="500"
              />
            </Field>
          )}

          <Field id="override-reason" label={t("usage.overrideReason")} description={t("usage.overrideReasonHint")}>
            <Input value={reason} onChange={(event) => setReason(event.target.value)} maxLength={500} />
          </Field>

          <DialogFooter>
            <Button variant="secondary" onClick={() => setOpen(false)} disabled={pending}>
              {t("common.cancel")}
            </Button>
            <Button onClick={save} disabled={pending || (!isBoolean && value.trim() === "")}>
              {pending ? <Spinner /> : null}
              {t("usage.overrideSave")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
