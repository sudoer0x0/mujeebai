"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Undo2, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/components/ui/toast";
import { undoAuditActionAction } from "@/admin/undo-actions";

/**
 * Reverses one audited action.
 *
 * Three states, because "no button" and "already undone" mean different
 * things to an operator scanning the log: an entry that was reversed shows
 * as reversed, and one that was never reversible shows nothing at all
 * rather than a disabled control inviting a click that cannot work.
 *
 * Confirmation is deliberate but lightweight — a second click on the same
 * button rather than a modal. Undo is a recoverable operation (it is
 * itself audited, and the forward action can simply be redone), so a
 * blocking dialog would cost more than the mistake it prevents.
 */
export function UndoButton({
  auditId,
  state,
}: {
  auditId: string;
  state: "undoable" | "undone" | "no";
}) {
  const t = useTranslations("admin.undo");
  const router = useRouter();
  const [confirming, setConfirming] = React.useState(false);
  const [pending, setPending] = React.useState(false);

  // Drop out of the confirm state if the operator moves on without
  // clicking, so a stray second click much later is not treated as intent.
  React.useEffect(() => {
    if (!confirming) return;
    const timer = setTimeout(() => setConfirming(false), 5000);
    return () => clearTimeout(timer);
  }, [confirming]);

  if (state === "no") return null;

  if (state === "undone") {
    return (
      <span className="inline-flex items-center gap-1 text-[12px] text-muted">
        <Check className="size-3" aria-hidden />
        {t("undoneBadge")}
      </span>
    );
  }

  async function run() {
    setPending(true);
    try {
      const result = await undoAuditActionAction({ auditId });
      if (result.ok) {
        toast.success(t("done"));
        router.refresh();
      } else {
        toast.error(t((result.message?.split(".").pop() ?? "failed") as never));
        setConfirming(false);
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <Button
      size="sm"
      variant={confirming ? "danger" : "ghost"}
      disabled={pending}
      onClick={() => (confirming ? run() : setConfirming(true))}
    >
      {pending ? <Spinner /> : <Undo2 className="size-3.5" aria-hidden />}
      {confirming ? t("confirm") : t("action")}
    </Button>
  );
}
