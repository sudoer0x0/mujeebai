"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/input";
import { Alert } from "@/components/ui/alert";
import { Spinner } from "@/components/ui/spinner";

/**
 * Confirmation that also captures *why*.
 *
 * Suspending or disabling an account without a recorded reason produces a
 * moderation log nobody can act on six weeks later — "suspended by
 * someone, at some time, for something". The reason is required, and it
 * is what gets written to `moderation_records.reason`.
 */
export function ReasonDialog({
  open,
  onOpenChange,
  title,
  description,
  consequences,
  confirmLabel,
  cancelLabel,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  consequences?: string[];
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: (reason: string) => void | Promise<void>;
}) {
  const t = useTranslations("moderator");
  const [reason, setReason] = React.useState("");
  const [pending, setPending] = React.useState(false);
  const [touched, setTouched] = React.useState(false);
  const fieldId = React.useId();

  React.useEffect(() => {
    if (!open) {
      setReason("");
      setPending(false);
      setTouched(false);
    }
  }, [open]);

  const invalid = touched && reason.trim().length === 0;

  async function handleConfirm() {
    setTouched(true);
    if (reason.trim().length === 0 || pending) return;
    setPending(true);
    try {
      await onConfirm(reason.trim());
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

        <div className="flex flex-col gap-1.5">
          <label htmlFor={fieldId} className="text-[12px] font-medium text-foreground">
            {t("reason.label")}
          </label>
          <Textarea
            id={fieldId}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            onBlur={() => setTouched(true)}
            placeholder={t("reason.placeholder")}
            maxLength={500}
            invalid={invalid}
            aria-describedby={invalid ? `${fieldId}-error` : undefined}
          />
          <p id={`${fieldId}-error`} role="alert" className={invalid ? "text-[12px] text-danger" : "sr-only"}>
            {invalid ? t("reason.required") : ""}
          </p>
        </div>

        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={pending}>
            {cancelLabel}
          </Button>
          <Button variant="danger" onClick={handleConfirm} disabled={pending}>
            {pending ? <Spinner /> : null}
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
