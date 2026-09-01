import { getTranslations, setRequestLocale } from "next-intl/server";
import { requireSuperAdminPage } from "@/auth/session";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import { Table, TBody, TD, TH, THead, TR, TableEmpty, TableScroll } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { UndoButton } from "@/components/staff/undo-button";
import { getUndoState } from "@/admin/undo-actions";
import { humanizeKey, isKnownAuditAction } from "@/admin/labels";
import { resolveAuditTargets, targetLabel } from "@/admin/audit-targets";

export default async function AdminAuditLogsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ action?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireSuperAdminPage(locale);

  const t = await getTranslations({ locale, namespace: "admin.auditLogs" });
  const tr = t;
  const ta = await getTranslations({ locale, namespace: "admin.auditAction" });
  const ttRaw = await getTranslations({ locale, namespace: "admin.targetType" });

  // Falls back to a humanized type name if a new target type appears
  // before its label does.
  const tt = (typeKey: string, options?: { fallback?: string }) =>
    ttRaw.has(typeKey) ? ttRaw(typeKey as never) : humanizeKey(options?.fallback ?? typeKey);

  // A readable name for an audited action. Falls back to a humanized form
  // of the key so a newly-added action is never rendered as a bare
  // identifier while its translation catches up.
  const auditLabel = (action: string) =>
    isKnownAuditAction(action) ? ta(action as never) : humanizeKey(action);
  const { action } = await searchParams;

  const supabase = createServiceRoleClient();
  let query = supabase
    .from("admin_audit_logs")
    .select("id, actor_id, action, target_type, target_id, result, metadata, created_at")
    .order("created_at", { ascending: false })
    .limit(200);

  if (action) {
    const term = action.replace(/[%_\\]/g, (char) => `\\${char}`);
    query = query.ilike("action", `%${term}%`);
  }

  const { data: entries } = await query;

  // One lookup for every actor on the page rather than one per row.
  // One query for the whole page's undo state, not one per row.
  // Names for every target on the page — one query per target type, not
  // one per row. See src/admin/audit-targets.ts.
  const targets = await resolveAuditTargets(entries ?? []);

  const undoState = await getUndoState(
    (entries ?? []).map((entry) => ({ id: entry.id, action: entry.action, result: entry.result })),
  );

  const actorIds = Array.from(new Set((entries ?? []).map((e) => e.actor_id).filter(Boolean) as string[]));
  const { data: actors } = actorIds.length
    ? await supabase.from("profiles").select("id, email, display_name").in("id", actorIds)
    : { data: [] };
  const actorName = new Map((actors ?? []).map((a) => [a.id, a.display_name || a.email || a.id]));

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title={t("title")} description={t("description")} />

      <form className="flex gap-2">
        <input
          name="action"
          defaultValue={action}
          placeholder={t("filterAction")}
          aria-label={t("filterAction")}
          className="h-9 w-full max-w-xs rounded-md border border-line bg-surface px-2.5 text-[13px] placeholder:text-faint sm:w-64"
        />
      </form>

      <TableScroll maxHeight="calc(100dvh - 15rem)">
        <Table>
          <THead>
            <TR>
              <TH>{t("colTime")}</TH>
              <TH>{t("colActor")}</TH>
              <TH>{t("colAction")}</TH>
              <TH>{t("colTarget")}</TH>
              <TH>{t("colResult")}</TH>
              <TH className="text-end">{t("colUndo")}</TH>
            </TR>
          </THead>
          <TBody>
            {(entries ?? []).length === 0 ? <TableEmpty colSpan={6}>{t("empty")}</TableEmpty> : null}
            {(entries ?? []).map((entry) => (
              <TR key={entry.id}>
                <TD className="whitespace-nowrap text-[12px] text-muted tabular-nums">
                  {new Date(entry.created_at).toLocaleString(locale)}
                </TD>
                <TD className="max-w-44 truncate">
                  {entry.actor_id ? (actorName.get(entry.actor_id) ?? entry.actor_id) : t("system")}
                </TD>
                <TD>
                  {/* The readable label leads; the raw key stays as a
                      muted second line because operators do need it when
                      cross-referencing docs or filtering. */}
                  <p className="text-foreground">{auditLabel(entry.action)}</p>
                  <p className="font-mono text-[11px] text-faint">{entry.action}</p>
                </TD>
                <TD className="max-w-64">
                  {entry.target_type ? (
                    <>
                      <p className="truncate text-foreground" title={entry.target_id ?? undefined}>
                        {targetLabel(targets, entry.target_type, entry.target_id, humanizeKey) ||
                          tt("deleted")}
                      </p>
                      <p className="truncate text-[11px] text-faint">
                        {tt(entry.target_type as never, { fallback: entry.target_type })}
                      </p>
                    </>
                  ) : (
                    "—"
                  )}
                </TD>
                <TD>
                  <Badge variant={entry.result === "success" ? "success" : "danger"}>
                    {tr(entry.result === "success" ? "resultSuccess" : "resultFailure")}
                  </Badge>
                </TD>
                <TD className="text-end">
                  <UndoButton auditId={entry.id} state={undoState[entry.id] ?? "no"} />
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </TableScroll>
    </div>
  );
}
