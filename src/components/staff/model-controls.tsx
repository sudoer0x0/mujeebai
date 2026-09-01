"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
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
export function ModelControls({
  modelId,
  availability,
  tier,
}: {
  modelId: string;
  availability: string;
  tier: string;
}) {
  const t = useTranslations("admin");
  const [pending, setPending] = React.useState(false);
  const [current, setCurrent] = React.useState({ availability, tier });

  async function update(updates: { availability?: Availability; tier?: Tier }) {
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
    <div className="flex items-center gap-1.5">
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
