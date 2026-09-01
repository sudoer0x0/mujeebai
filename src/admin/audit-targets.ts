import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/server";

/**
 * Resolves audit-log targets into names a person can read.
 *
 * The log stores `target_type` plus an opaque `target_id`, which rendered
 * as `user:3f9c1a0e-…` — technically complete and unreadable. An operator
 * scanning for "who suspended Amina" cannot match a UUID by eye.
 *
 * ## One query per type, not one per row
 *
 * A page shows 200 entries. Resolving each individually would be 200 round
 * trips; instead the ids are grouped by type and each type is fetched once
 * with an `in` filter, then looked up from the map.
 *
 * ## Why the id survives
 *
 * The name is what gets shown, but the caller keeps the id available as a
 * title/secondary line — a display name can change or repeat, and during
 * an incident the id is the thing that identifies a row uniquely.
 */

export interface ResolvedTarget {
  /** Human label, or null when the target no longer exists. */
  label: string | null;
  /** Type label for context, e.g. "Account", "Plan". */
  typeKey: string;
}

export type TargetMap = Record<string, ResolvedTarget>;

/** Key used in the returned map. */
function key(type: string | null, id: string | null): string {
  return `${type ?? ""}:${id ?? ""}`;
}

export async function resolveAuditTargets(
  entries: Array<{ target_type: string | null; target_id: string | null }>,
): Promise<TargetMap> {
  const byType = new Map<string, Set<string>>();
  for (const entry of entries) {
    if (!entry.target_type || !entry.target_id) continue;
    const set = byType.get(entry.target_type) ?? new Set<string>();
    set.add(entry.target_id);
    byType.set(entry.target_type, set);
  }

  const map: TargetMap = {};
  if (byType.size === 0) return map;

  const supabase = createServiceRoleClient();

  const lookups = Array.from(byType.entries()).map(async ([type, ids]) => {
    const list = Array.from(ids);

    switch (type) {
      case "user": {
        const { data } = await supabase.from("profiles").select("id, email, display_name").in("id", list);
        for (const row of data ?? []) {
          map[key(type, row.id)] = { label: row.display_name || row.email || null, typeKey: "user" };
        }
        break;
      }
      case "plan": {
        const { data } = await supabase.from("plans").select("id, name").in("id", list);
        for (const row of data ?? []) map[key(type, row.id)] = { label: row.name, typeKey: "plan" };
        break;
      }
      case "model": {
        const { data } = await supabase.from("models").select("id, display_name").in("id", list);
        for (const row of data ?? []) map[key(type, row.id)] = { label: row.display_name, typeKey: "model" };
        break;
      }
      case "provider": {
        const { data } = await supabase.from("providers").select("id, name").in("id", list);
        for (const row of data ?? []) map[key(type, row.id)] = { label: row.name, typeKey: "provider" };
        break;
      }
      case "feature_flag": {
        const { data } = await supabase.from("feature_flags").select("id, key").in("id", list);
        for (const row of data ?? []) map[key(type, row.id)] = { label: row.key, typeKey: "feature_flag" };
        break;
      }
      default:
        // `system_setting` and `email` already carry a readable id (the
        // setting key, the address), and `platform` has none. Nothing to
        // look up — the caller falls back to the id itself.
        break;
    }
  });

  await Promise.all(lookups);
  return map;
}

/** The label to render for one entry, with the id as the fallback. */
export function targetLabel(
  map: TargetMap,
  type: string | null,
  id: string | null,
  humanize: (value: string) => string,
): string {
  if (!type) return "—";
  if (!id) return humanize(type);

  const resolved = map[key(type, id)];
  if (resolved?.label) return resolved.label;

  // A setting key or an email address reads fine on its own; a UUID does
  // not, and one whose row is gone is better shown as "deleted" than as a
  // string of hex an operator will try to look up and fail to find.
  if (type === "system_setting") return humanize(id);
  if (type === "email") return id;
  if (/^[0-9a-f-]{36}$/i.test(id)) return "";
  return id;
}
