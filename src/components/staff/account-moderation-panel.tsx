"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { toast } from "@/components/ui/toast";
import { addModerationNoteAction } from "@/admin/user-actions";
import { revokePlanGrantAction } from "@/admin/grant-actions";

/**
 * The two account controls that had a server action but no way to reach it.
 *
 * Both were fully implemented, permission-gated and audited, and neither
 * was rendered anywhere — so a moderator could not leave a note explaining
 * why they acted, and nobody could end a complimentary grant that had been
 * given by mistake. A grant is not reversible through the audit undo
 * either (it is not in the undoable set), so before this the only way out
 * was the database.
 */
export function AccountModerationPanel({
  userId,
  canNote,
  canRevokeGrant,
}: {
  userId: string;
  canNote: boolean;
  canRevokeGrant: boolean;
}) {
  const t = useTranslations("admin.users.moderation");
  const tc = useTranslations("admin.common");
  const router = useRouter();

  const [note, setNote] = React.useState("");
  const [savingNote, setSavingNote] = React.useState(false);
  const [confirmRevoke, setConfirmRevoke] = React.useState(false);
  const [revoking, setRevoking] = React.useState(false);

  async function saveNote(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = note.trim();
    if (!trimmed) return;
    setSavingNote(true);
    try {
      const result = await addModerationNoteAction(userId, trimmed);
      if (result.ok) {
        toast.success(t("noteSaved"));
        setNote("");
        router.refresh();
      } else {
        toast.error(tc("actionFailed"));
      }
    } finally {
      setSavingNote(false);
    }
  }

  async function revoke() {
    setRevoking(true);
    try {
      const result = await revokePlanGrantAction({ userId });
      if (result.ok) {
        toast.success(t("grantRevoked"));
        router.refresh();
      } else {
        toast.error(tc("actionFailed"));
      }
      setConfirmRevoke(false);
    } finally {
      setRevoking(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {canNote ? (
        <form onSubmit={saveNote} className="flex flex-col gap-2">
          <label htmlFor="account-note" className="text-[12px] font-medium text-foreground">
            {t("noteLabel")}
          </label>
          <textarea
            id="account-note"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            rows={3}
            maxLength={1000}
            placeholder={t("notePlaceholder")}
            className="w-full resize-y rounded-md border border-line bg-surface p-2.5 text-[13px] text-foreground placeholder:text-faint"
          />
          <p className="text-[12px] text-muted">{t("noteHint")}</p>
          <div>
            <Button type="submit" size="sm" variant="secondary" disabled={!note.trim() || savingNote}>
              {savingNote ? <Spinner /> : null}
              {t("addNote")}
            </Button>
          </div>
        </form>
      ) : null}

      {canRevokeGrant ? (
        <div className="flex flex-col gap-2 border-t border-line pt-4">
          <p className="text-[13px] text-muted">{t("grantExplainer")}</p>
          <div>
            <Button size="sm" variant="danger" disabled={revoking} onClick={() => setConfirmRevoke(true)}>
              {revoking ? <Spinner /> : null}
              {t("revokeGrant")}
            </Button>
          </div>

          <ConfirmDialog
            open={confirmRevoke}
            onOpenChange={(next) => (revoking ? undefined : setConfirmRevoke(next))}
            title={t("revokeGrant")}
            description={t("revokeGrantConfirm")}
            consequences={[t("revokeConsequenceAccess"), t("revokeConsequenceNoRefund")]}
            confirmLabel={t("revokeGrant")}
            cancelLabel={tc("cancel")}
            tone="danger"
            onConfirm={revoke}
          />
        </div>
      ) : null}
    </div>
  );
}
