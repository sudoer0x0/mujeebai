import { getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import { humanizeKey, isKnownAuditAction } from "@/admin/labels";
import type { ActivityEntry } from "@/admin/user-activity";

/**
 * An account's history as a single vertical timeline.
 *
 * A server component: the entries never change without a navigation, and
 * shipping a client bundle to render static rows would be waste.
 *
 * Labels come from the catalog and fall back to `humanizeKey`, for the
 * same reason the audit log does — a newly audited action must degrade to
 * "Sessions revoked" rather than to a raw `admin.sessions_revoked`.
 */
export async function UserActivityList({
  entries,
  locale,
}: {
  entries: ActivityEntry[];
  locale: string;
}) {
  const t = await getTranslations({ locale, namespace: "admin.users.activity" });
  const ta = await getTranslations({ locale, namespace: "admin.auditAction" });
  const tm = await getTranslations({ locale, namespace: "admin.moderationAction" });

  if (entries.length === 0) {
    return <p className="px-4 py-6 text-center text-[13px] text-muted">{t("empty")}</p>;
  }

  const formatter = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" });

  function label(entry: ActivityEntry): string {
    if (entry.source === "moderation") {
      // The moderation vocabulary is a small closed set, so a missing
      // translation here is a catalog bug rather than an unknown action.
      return tm.has(entry.action as never) ? tm(entry.action as never) : humanizeKey(entry.action);
    }
    return isKnownAuditAction(entry.action) ? ta(entry.action as never) : humanizeKey(entry.action);
  }

  return (
    <ol className="flex flex-col">
      {entries.map((entry, index) => (
        <li
          key={entry.id}
          className="relative flex gap-3 px-4 py-3 first:pt-4 last:pb-4"
        >
          {/* The rail is drawn per-row and stopped on the last one, so the
              line connects entries rather than trailing into empty space. */}
          <div className="flex flex-col items-center">
            <span
              aria-hidden
              className={`mt-1.5 size-2 shrink-0 rounded-full ${
                entry.result === "failure"
                  ? "bg-danger"
                  : entry.source === "moderation"
                    ? "bg-warning"
                    : "bg-accent"
              }`}
            />
            {index < entries.length - 1 ? (
              <span aria-hidden className="mt-1 w-px flex-1 bg-line" />
            ) : null}
          </div>

          <div className="flex min-w-0 flex-1 flex-col gap-1 pb-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="text-[13px] font-medium text-foreground">{label(entry)}</span>
              {entry.result === "failure" ? (
                <Badge variant="danger">{t("failed")}</Badge>
              ) : null}
            </div>

            {entry.reason ? (
              <p className="whitespace-pre-wrap break-words text-[12px] text-muted">{entry.reason}</p>
            ) : null}

            <p className="text-[11px] text-muted">
              {entry.actorName ? t("by", { name: entry.actorName }) : t("bySystem")}
              {" · "}
              <time dateTime={entry.createdAt}>{formatter.format(new Date(entry.createdAt))}</time>
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}
