"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Table, TBody, TD, TH, THead, TR, TableEmpty, TableScroll } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/components/ui/toast";
import { removeModeratorAction } from "@/admin/moderator-actions";

export interface ModeratorRow {
  id: string;
  email: string | null;
  displayName: string | null;
  status: string;
  mustChangePassword: boolean;
  mfaEnrolled: boolean;
  invitedAt: string | null;
}

export function ModeratorList({ moderators, locale }: { moderators: ModeratorRow[]; locale: string }) {
  const t = useTranslations("admin.moderators");
  const router = useRouter();
  const [busy, setBusy] = React.useState<string | null>(null);

  async function remove(id: string) {
    setBusy(id);
    try {
      const result = await removeModeratorAction({ userId: id });
      if (result.ok) {
        toast.success(t("removed"));
        router.refresh();
      } else {
        toast.error(t((result.message?.split(".").pop() ?? "removeFailed") as never));
      }
    } finally {
      setBusy(null);
    }
  }

  return (
    <TableScroll className="rounded-none border-0">
      <Table>
        <THead>
          <TR>
            <TH>{t("colModerator")}</TH>
            <TH>{t("colSetup")}</TH>
            <TH>{t("colInvited")}</TH>
            <TH className="text-end">{t("colActions")}</TH>
          </TR>
        </THead>
        <TBody>
          {moderators.length === 0 ? <TableEmpty colSpan={4}>{t("none")}</TableEmpty> : null}
          {moderators.map((moderator) => (
            <TR key={moderator.id}>
              <TD className="max-w-64">
                <p className="truncate text-foreground">{moderator.displayName || moderator.email}</p>
                {moderator.displayName ? (
                  <p className="truncate text-[12px] text-muted">{moderator.email}</p>
                ) : null}
              </TD>
              <TD>
                {/* Onboarding is two gates, and an operator needs to see
                    which one an invitee is stuck behind. */}
                <div className="flex flex-wrap gap-1.5">
                  {moderator.mustChangePassword ? (
                    <Badge variant="warning">{t("pendingPassword")}</Badge>
                  ) : null}
                  {!moderator.mfaEnrolled ? <Badge variant="warning">{t("pendingMfa")}</Badge> : null}
                  {!moderator.mustChangePassword && moderator.mfaEnrolled ? (
                    <Badge variant="success">{t("ready")}</Badge>
                  ) : null}
                </div>
              </TD>
              <TD className="whitespace-nowrap text-[12px] text-muted tabular-nums">
                {moderator.invitedAt ? new Date(moderator.invitedAt).toLocaleDateString(locale) : "—"}
              </TD>
              <TD className="text-end">
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy === moderator.id}
                  onClick={() => remove(moderator.id)}
                >
                  {busy === moderator.id ? <Spinner /> : null}
                  {t("remove")}
                </Button>
              </TD>
            </TR>
          ))}
        </TBody>
      </Table>
    </TableScroll>
  );
}
