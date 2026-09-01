"use client";

import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { ToggleRow } from "@/components/staff/toggle-row";
import { toggleProviderAction } from "@/app/[locale]/admin/providers/actions";

export interface ProviderRow {
  id: string;
  slug: string;
  name: string;
  kind: string;
  enabled: boolean;
  /** Whether this deployment has credentials for the provider. */
  configured: boolean;
}

/**
 * Provider switches.
 *
 * A client component for the same reason the feature-flag list is one: the
 * page that rendered these was a Server Component handing an inline
 * `onToggle` closure to a Client Component, which React refuses outright —
 * "Event handlers cannot be passed to Client Component props" — and the
 * whole route answered 500. A closure has to be created on the client, so
 * the client owns the list.
 *
 * Only the `configured` boolean crosses over, never a credential.
 */
export function ProviderList({ providers }: { providers: ProviderRow[] }) {
  const t = useTranslations("admin.providers");

  return (
    <>
      {providers.map((provider) => (
        <div key={provider.id} className="flex flex-col gap-1 py-3">
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-medium text-foreground">{provider.name}</span>
            <Badge variant="neutral">{provider.kind}</Badge>
            <Badge variant={provider.configured ? "success" : "warning"}>
              {provider.configured ? t("configured") : t("missing")}
            </Badge>
          </div>
          <ToggleRow
            id={`provider-${provider.id}`}
            label={t("colEnabled")}
            hint={provider.slug}
            initial={provider.enabled}
            disabled={!provider.configured}
            disabledReason={t("missingHint")}
            onToggle={(enabled) => toggleProviderAction({ providerId: provider.id, enabled })}
          />
        </div>
      ))}
    </>
  );
}
