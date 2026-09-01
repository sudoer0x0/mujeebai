"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { Check } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/components/ui/toast";
import { updateSystemSettingAction } from "@/app/[locale]/admin/settings/actions";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SUPPORTED_CURRENCIES, CURRENCY_LABELS } from "@/billing/currencies";
import { humanizeKey } from "@/admin/labels";
import type { Json } from "@/types/database";

/**
 * One platform setting.
 *
 * Values are edited in their natural form — a number as a number, a list
 * as comma-separated text — rather than as raw JSON. The server still
 * validates each key against its own schema, so a bad value is refused
 * there too; this just stops the console from being the thing that
 * produces one.
 */
export function SettingRow({
  settingKey,
  description,
  initialValue,
}: {
  settingKey: string;
  description: string | null;
  initialValue: Json;
}) {
  const t = useTranslations("admin");
  const tk = useTranslations("admin.settingKey");
  const id = React.useId();

  // Falls back to a humanized key so a setting added without a
  // translation still reads as words rather than as an identifier.
  const label = tk.has(settingKey) ? tk(settingKey as never) : humanizeKey(settingKey);

  // Settings whose value is one of a fixed set get a picker, not a text
  // box. `billing_currency` is the reason this exists: it is validated
  // server-side against an eight-value enum, so typing "ngn" or "Naira"
  // into a free-text field failed silently-looking validation and made it
  // seem as though the currency could not be changed from USD at all.
  // A control that cannot express an invalid value is the fix.
  const options = CHOICES[settingKey];
  const kind = options
    ? "choice"
    : typeof initialValue === "number"
      ? "number"
      : Array.isArray(initialValue)
        ? "list"
        : "text";
  const [value, setValue] = React.useState(() => serialize(initialValue));
  const [pending, setPending] = React.useState(false);
  const [saved, setSaved] = React.useState(false);

  const dirty = value !== serialize(initialValue);

  async function save() {
    setPending(true);
    try {
      const result = await updateSystemSettingAction({ key: settingKey, value: deserialize(value, kind) });
      if (result.ok) {
        setSaved(true);
        setTimeout(() => setSaved(false), 1800);
      } else {
        toast.error(t("common.actionFailed"));
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-2 py-3 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
      <div className="min-w-0 sm:flex-1">
        {/* The readable name leads. The raw key stays underneath in a
            muted mono line because it is what SECURITY.md, the migrations
            and support conversations actually refer to — but it is no
            longer the thing an operator reads first. */}
        <label htmlFor={id} className="text-[13px] font-medium text-foreground">
          {label}
        </label>
        <p className="font-mono text-[11px] text-faint">{settingKey}</p>
        {description ? (
          <p id={`${id}-hint`} className="mt-0.5 text-[12px] leading-relaxed text-muted">
            {description}
          </p>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        {options ? (
          <Select value={value} onValueChange={setValue} disabled={pending}>
            <SelectTrigger
              id={id}
              aria-describedby={description ? `${id}-hint` : undefined}
              className="h-8 w-48 text-[12px] sm:w-56"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {options.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <Input
            id={id}
            aria-describedby={description ? `${id}-hint` : undefined}
            type={kind === "number" ? "number" : "text"}
            value={value}
            disabled={pending}
            onChange={(event) => setValue(event.target.value)}
            className="h-8 w-48 font-mono text-[12px] sm:w-56"
          />
        )}
        {saved ? <Check className="size-3.5 text-success" aria-hidden /> : null}
        <Button size="sm" variant="secondary" disabled={!dirty || pending} onClick={save}>
          {pending ? <Spinner /> : null}
          {t("common.save")}
        </Button>
      </div>
    </div>
  );
}

function serialize(value: Json): string {
  if (value === null) return "";
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "string") return value;
  return String(value);
}

/**
 * Settings that are a choice from a fixed set, with the choices.
 *
 * Keyed by setting key so a new enum-valued setting is one entry here
 * rather than another bespoke control.
 */
const CHOICES: Record<string, Array<{ value: string; label: string }> | undefined> = {
  billing_currency: SUPPORTED_CURRENCIES.map((code) => ({
    value: code,
    label: `${code} — ${CURRENCY_LABELS[code]}`,
  })),
};

function deserialize(raw: string, kind: "number" | "list" | "text" | "choice"): Json {
  // A choice is always a plain string from a known set; never null it out.
  if (kind === "choice") return raw;
  if (kind === "number") return Number(raw);
  if (kind === "list") {
    return raw
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);
  }
  // An emptied text field means "unset", which for `announcement` is null
  // rather than an empty banner nobody can dismiss.
  return raw.trim() === "" ? null : raw;
}
