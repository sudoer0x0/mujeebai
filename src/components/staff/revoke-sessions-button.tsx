"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/components/ui/toast";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { revokeUserSessionsAction } from "@/admin/user-actions";

/**
 * Ends every session for an account, from the staff device list.
 *
 * Behind a confirmation because it signs the person out mid-use — not
 * destructive, but rude to do by accident from a hover menu.
 */
export function RevokeSessionsButton({ userId, disabled }: { userId: string; disabled?: boolean }) {
  const t = useTranslations("admin.users");
  const tc = useTranslations("admin.common");
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [pending, setPending] = React.useState(false);

  async function confirm() {
    setPending(true);
    try {
      const result = await revokeUserSessionsAction(userId);
      if (result.ok) {
        toast.success(t("sessionsRevoked"));
        router.refresh();
      } else {
        toast.error(tc("actionFailed"));
      }
      setOpen(false);
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)} disabled={disabled || pending}>
        {pending ? <Spinner /> : <LogOut className="size-3.5" aria-hidden />}
        {t("revokeSessions")}
      </Button>

      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={t("revokeSessions")}
        description={t("revokeSessionsConfirm")}
        confirmLabel={t("revokeSessions")}
        cancelLabel={tc("cancel")}
        tone="primary"
        onConfirm={confirm}
      />
    </>
  );
}
