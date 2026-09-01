import { getTranslations } from "next-intl/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { Table, TBody, TD, TH, THead, TR, TableEmpty, TableScroll } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";

const ACTION_TONE: Record<string, "warning" | "success" | "danger" | "neutral"> = {
  warned: "warning",
  suspended: "warning",
  restored: "success",
  disabled: "danger",
  deleted: "danger",
  note: "neutral",
};

/**
 * The moderation log, shared by both portals.
 *
 * Joins the acting staff member and the affected account in one query
 * rather than looking each up per row — a 200-row log was previously
 * capable of issuing 400 follow-up queries.
 */
export async function ModerationLog({ locale, limit = 200 }: { locale: string; limit?: number }) {
  const t = await getTranslations({ locale, namespace: "moderator.moderation" });
  const supabase = createServiceRoleClient();

  const { data: records } = await supabase
    .from("moderation_records")
    .select("id, action, reason, created_at, user_id, performed_by")
    .order("created_at", { ascending: false })
    .limit(limit);

  const ids = Array.from(
    new Set((records ?? []).flatMap((r) => [r.user_id, r.performed_by].filter(Boolean) as string[])),
  );

  const { data: people } = ids.length
    ? await supabase.from("profiles").select("id, email, display_name").in("id", ids)
    : { data: [] };

  const nameOf = new Map((people ?? []).map((p) => [p.id, p.display_name || p.email || p.id]));

  return (
    <TableScroll>
      <Table>
        <THead>
          <TR>
            <TH>{t("colTime")}</TH>
            <TH>{t("colUser")}</TH>
            <TH>{t("colAction")}</TH>
            <TH>{t("colBy")}</TH>
            <TH>{t("colReason")}</TH>
          </TR>
        </THead>
        <TBody>
          {(records ?? []).length === 0 ? <TableEmpty colSpan={5}>{t("empty")}</TableEmpty> : null}
          {(records ?? []).map((record) => (
            <TR key={record.id}>
              <TD className="whitespace-nowrap text-[12px] text-muted tabular-nums">
                {new Date(record.created_at).toLocaleString(locale)}
              </TD>
              <TD className="max-w-52 truncate">{nameOf.get(record.user_id) ?? record.user_id}</TD>
              <TD>
                <Badge variant={ACTION_TONE[record.action] ?? "neutral"}>
                  {t(`action.${record.action}` as never)}
                </Badge>
              </TD>
              <TD className="max-w-52 truncate text-muted">
                {record.performed_by ? (nameOf.get(record.performed_by) ?? record.performed_by) : "—"}
              </TD>
              <TD className="max-w-80 text-muted">{record.reason ?? "—"}</TD>
            </TR>
          ))}
        </TBody>
      </Table>
    </TableScroll>
  );
}
