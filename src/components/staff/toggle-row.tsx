"use client";

import * as React from "react";
import { Switch } from "@/components/ui/switch";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/components/ui/toast";
import { useTranslations } from "next-intl";

/**
 * A labelled switch that persists through a server action.
 *
 * Optimistic, then reconciled: the switch moves immediately and rolls
 * back if the server refuses, so an operator never sits watching a
 * control that appears not to respond, and never walks away believing a
 * change landed when it did not.
 */
export function ToggleRow({
  id,
  label,
  hint,
  description,
  initial,
  disabled,
  disabledReason,
  onToggle,
}: {
  id: string;
  label: string;
  /** Raw identifier shown small and muted under the label, if useful. */
  hint?: string | null;
  description?: string | null;
  initial: boolean;
  disabled?: boolean;
  disabledReason?: string;
  onToggle: (enabled: boolean) => Promise<{ ok: boolean; message?: string }>;
}) {
  const t = useTranslations("admin.common");
  const [checked, setChecked] = React.useState(initial);
  const [pending, setPending] = React.useState(false);
  const descriptionId = description || disabledReason ? `${id}-description` : undefined;

  async function handleChange(next: boolean) {
    setChecked(next);
    setPending(true);
    try {
      const result = await onToggle(next);
      if (!result.ok) {
        setChecked(!next);
        toast.error(t("actionFailed"));
      }
    } catch {
      setChecked(!next);
      toast.error(t("actionFailed"));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex items-start justify-between gap-4 py-3">
      <div className="min-w-0">
        <label htmlFor={id} className="text-[13px] font-medium text-foreground">
          {label}
        </label>
        {hint ? <p className="font-mono text-[11px] text-faint">{hint}</p> : null}
        {description || disabledReason ? (
          <p id={descriptionId} className="mt-0.5 text-[12px] leading-relaxed text-muted">
            {disabled && disabledReason ? disabledReason : description}
          </p>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-2 pt-0.5">
        {pending ? <Spinner /> : null}
        <Switch
          id={id}
          checked={checked}
          disabled={disabled || pending}
          aria-describedby={descriptionId}
          onCheckedChange={handleChange}
        />
      </div>
    </div>
  );
}
