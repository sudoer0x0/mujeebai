"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { Check } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/components/ui/toast";
import { updateModelAction } from "@/app/[locale]/admin/models/actions";

type Availability = "available" | "locked" | "disabled" | "maintenance" | "deprecated";
type Tier = "free" | "pro" | "premium" | "experimental";

const AVAILABILITY: Availability[] = ["available", "locked", "disabled", "maintenance", "deprecated"];
const TIERS: Tier[] = ["free", "pro", "premium", "experimental"];

/**
 * Availability and tier controls for one model.
 *
 * Both are the model registry's own vocabulary rather than a translated
 * label: an operator changing `availability` needs to see the value that
 * will actually be written to the row and matched by the gateway.
 */
const REASONING_MODES = ["auto", "exclude", "require"] as const;

export function ModelControls({
  modelId,
  availability,
  tier,
  providerModelId,
  reasoningMode,
}: {
  modelId: string;
  availability: string;
  tier: string;
  providerModelId: string;
  reasoningMode: string;
}) {
  const t = useTranslations("admin");
  const [pending, setPending] = React.useState(false);
  const [current, setCurrent] = React.useState({ availability, tier, reasoningMode });
  const [modelIdDraft, setModelIdDraft] = React.useState(providerModelId);
  const [savingId, setSavingId] = React.useState(false);
  const [savedId, setSavedId] = React.useState(false);

  /** Commits the provider model id, on blur or Enter. */
  async function commitModelId() {
    const next = modelIdDraft.trim();
    if (!next || next === providerModelId) {
      setModelIdDraft(providerModelId);
      return;
    }
    setSavingId(true);
    try {
      const result = await updateModelAction({ modelId, providerModelId: next });
      if (result.ok) {
        setSavedId(true);
        setTimeout(() => setSavedId(false), 1600);
      } else {
        setModelIdDraft(providerModelId);
        toast.error(t("common.actionFailed"));
      }
    } finally {
      setSavingId(false);
    }
  }

  async function update(updates: { availability?: Availability; tier?: Tier; reasoningMode?: string }) {
    const previous = current;
    setCurrent({ ...current, ...updates });
    setPending(true);
    try {
      const result = await updateModelAction({ modelId, ...updates });
      if (result.ok) {
        toast.success(t("models.updated"));
      } else {
        setCurrent(previous);
        toast.error(t("common.actionFailed"));
      }
    } catch {
      setCurrent(previous);
      toast.error(t("common.actionFailed"));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center justify-end gap-1.5">
      {/* The provider's own model id. Editable because a router like
          `openrouter/free` picks a different model each call, and pinning
          a specific id is the only way to get a consistent answer. */}
      <div className="relative flex items-center">
        <Input
          value={modelIdDraft}
          onChange={(event) => setModelIdDraft(event.target.value)}
          onBlur={commitModelId}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
            if (event.key === "Escape") setModelIdDraft(providerModelId);
          }}
          disabled={savingId}
          spellCheck={false}
          aria-label={t("models.colProviderModel")}
          placeholder="provider/model-id"
          className="h-8 w-56 pe-6 font-mono text-[11px]"
        />
        {savedId ? (
          <Check className="pointer-events-none absolute end-1.5 size-3.5 text-success" aria-hidden />
        ) : null}
      </div>

      {/* Whether this slot shows chain-of-thought. Enforced twice — asked
          of the provider and applied to the stream — because asking alone
          is not reliable through a router. */}
      <Select
        disabled={pending}
        value={current.reasoningMode}
        onValueChange={(value) => update({ reasoningMode: value })}
      >
        <SelectTrigger className="w-36" aria-label={t("models.colThinking")}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {REASONING_MODES.map((option) => (
            <SelectItem key={option} value={option}>
              {t(`models.thinking.${option}` as never)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        disabled={pending}
        value={current.tier}
        onValueChange={(value) => update({ tier: value as Tier })}
      >
        <SelectTrigger className="w-32" aria-label={t("models.colTier")}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {TIERS.map((option) => (
            <SelectItem key={option} value={option}>
              {option}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        disabled={pending}
        value={current.availability}
        onValueChange={(value) => update({ availability: value as Availability })}
      >
        <SelectTrigger className="w-36" aria-label={t("models.colAvailability")}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {AVAILABILITY.map((option) => (
            <SelectItem key={option} value={option}>
              {option}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {pending ? <Spinner /> : null}
    </div>
  );
}
