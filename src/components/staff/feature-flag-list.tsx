"use client";

import { ToggleRow } from "@/components/staff/toggle-row";
import { humanizeKey } from "@/admin/labels";
import { toggleFeatureFlagAction } from "@/app/[locale]/admin/feature-flags/actions";

export interface FeatureFlagRow {
  id: string;
  key: string;
  description: string | null;
  enabled: boolean;
}

/**
 * The feature-flag switches.
 *
 * This exists as a client component because the page that used to render
 * `ToggleRow` directly was a Server Component passing an inline
 * `onToggle={(enabled) => toggleFeatureFlagAction(...)}` closure across
 * the boundary. React refuses that — "Event handlers cannot be passed to
 * Client Component props" — and the whole page returned a 500. The
 * closure has to be created on the client, so the client owns the list.
 */
export function FeatureFlagList({ flags }: { flags: FeatureFlagRow[] }) {
  return (
    <>
      {flags.map((flag) => (
        <ToggleRow
          key={flag.id}
          id={`flag-${flag.id}`}
          // The readable name leads; the raw key stays as a muted hint
          // because it is what the code and docs refer to.
          label={humanizeKey(flag.key)}
          hint={flag.key}
          description={flag.description}
          initial={flag.enabled}
          onToggle={(enabled) => toggleFeatureFlagAction({ flagId: flag.id, enabled })}
        />
      ))}
    </>
  );
}
