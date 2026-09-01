"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Alert } from "@/components/ui/alert";
import { Spinner } from "@/components/ui/spinner";

/**
 * Confirmation for a destructive or irreversible action.
 *
 * This replaces the `window.confirm()` calls the admin console used to
 * rely on. `window.confirm` cannot be styled, cannot explain
 * consequences, is trivially dismissed by muscle memory, and is blocked
 * outright by some browsers — none of which is acceptable for "delete
 * this user permanently".
 *
 * For the highest-risk actions pass `confirmPhrase`: the confirm button
 * stays disabled until the operator types that exact word, which is the
 * pattern the master spec calls for (#129) and which makes an accidental
 * double-click physically impossible.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  consequences,
  confirmLabel,
  cancelLabel,
  confirmPhrase,
  confirmPhraseHint,
  tone = "danger",
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  /** Bullet list of what will actually happen. */
  consequences?: string[];
  confirmLabel: string;
  cancelLabel: string;
  confirmPhrase?: string;
  confirmPhraseHint?: string;
  tone?: "danger" | "primary";
  onConfirm: () => void | Promise<void>;
}) {
  const [typed, setTyped] = React.useState("");
  const [pending, setPending] = React.useState(false);
  const inputId = React.useId();

  // Reset the typed phrase whenever the dialog closes, so reopening it
  // never starts out already-confirmable.
  React.useEffect(() => {
    if (!open) {
      setTyped("");
      setPending(false);
    }
  }, [open]);

  const phraseSatisfied = !confirmPhrase || typed.trim() === confirmPhrase;

  async function handleConfirm() {
    if (!phraseSatisfied || pending) return;
    setPending(true);
    try {
      await onConfirm();
      onOpenChange(false);
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        {consequences && consequences.length > 0 ? (
          <Alert tone="warning">
            <ul className="list-disc space-y-0.5 ps-4">
              {consequences.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </Alert>
        ) : null}

        {confirmPhrase ? (
          <div className="flex flex-col gap-1.5">
            <label htmlFor={inputId} className="text-[12px] font-medium text-foreground">
              {confirmPhraseHint ?? `Type ${confirmPhrase} to confirm.`}
            </label>
            <Input
              id={inputId}
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              autoComplete="off"
              spellCheck={false}
              placeholder={confirmPhrase}
            />
          </div>
        ) : null}

        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={pending}>
            {cancelLabel}
          </Button>
          <Button
            variant={tone === "danger" ? "danger" : "primary"}
            onClick={handleConfirm}
            disabled={!phraseSatisfied || pending}
          >
            {pending ? <Spinner /> : null}
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
