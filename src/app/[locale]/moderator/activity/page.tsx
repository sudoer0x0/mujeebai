import { getTranslations, setRequestLocale } from "next-intl/server";
import { requireStaffPage } from "@/auth/session";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import { Table, TBody, TD, TH, THead, TR, TableEmpty, TableScroll } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { UndoButton } from "@/components/staff/undo-button";
import { getUndoState } from "@/admin/undo-actions";
import { UNDOABLE } from "@/admin/undo";
import { can } from "@/admin/permissions";
import { humanizeKey, isKnownAuditAction } from "@/admin/labels";

/**
 * A moderator's own recent actions, with undo.
 *
 * Scoped two ways on purpose:
 *
 *  - to **their own** entries, because a moderator has no reason to audit
 *    colleagues; that view belongs to the super admin console, and
 *  - to actions a moderator is actually permitted to reverse, so the page
 *    never shows an undo control that the server would refuse.
 *
 * The undo action re-checks both facts server-side — this filtering is for
 * the operator's benefit, not the boundary.
 */
export default async function ModeratorActivityPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const profile = await requireStaffPage(locale);

  const t = await getTranslations({ locale, namespace: "moderator.activity" });
  const ta = await getTranslations({ locale, namespace: "admin.auditAction" });
  const tl = await getTranslations({ locale, namespace: "admin.auditLogs" });

  const reversible = Object.entries(UNDOABLE)
    .filter(([, spec]) => can(profile, spec.permission))
    .map(([action]) => action);

  const supabase = createServiceRoleClient();
  const { data: entries } = await supabase
    .from("admin_audit_logs")
    .select("id, action, target_id, target_type, result, created_at")
    .eq("actor_id", profile.id)
    .in("action", reversible.length > 0 ? reversible : ["__none__"])
    .order("created_at", { ascending: false })
    .limit(50);

  const undoState = await getUndoState(
    (entries ?? []).map((entry) => ({ id: entry.id, action: entry.action, result: entry.result })),
  );

  const targetIds = Array.from(
    new Set((entries ?? []).map((entry) => entry.target_id).filter(Boolean) as string[]),
  );
  const { data: targets } = targetIds.length
    ? await supabase.from("profiles").select("id, email, display_name").in("id", targetIds)
    : { data: [] };
  const nameOf = new Map((targets ?? []).map((row) => [row.id, row.display_name || row.email || row.id]));

  const label = (action: string) =>
    isKnownAuditAction(action) ? ta(action as never) : humanizeKey(action);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title={t("title")} description={t("description")} />

      <TableScroll maxHeight="calc(100dvh - 13rem)">
        <Table>
          <THead>
            <TR>
              <TH>{tl("colTime")}</TH>
              <TH>{tl("colAction")}</TH>
              <TH>{tl("colTarget")}</TH>
              <TH>{tl("colResult")}</TH>
              <TH className="text-end">{tl("colUndo")}</TH>
            </TR>
          </THead>
          <TBody>
            {(entries ?? []).length === 0 ? <TableEmpty colSpan={5}>{t("empty")}</TableEmpty> : null}
            {(entries ?? []).map((entry) => (
              <TR key={entry.id}>
                <TD className="whitespace-nowrap text-[12px] text-muted tabular-nums">
                  {new Date(entry.created_at).toLocaleString(locale)}
                </TD>
                <TD>{label(entry.action)}</TD>
                <TD className="max-w-52 truncate text-muted">
                  {entry.target_id ? (nameOf.get(entry.target_id) ?? entry.target_id) : "—"}
                </TD>
                <TD>
                  <Badge variant={entry.result === "success" ? "success" : "danger"}>
                    {tl(entry.result === "success" ? "resultSuccess" : "resultFailure")}
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
