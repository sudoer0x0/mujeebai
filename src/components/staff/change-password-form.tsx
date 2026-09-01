"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Spinner } from "@/components/ui/spinner";
import { Alert } from "@/components/ui/alert";
import { toast } from "@/components/ui/toast";
import { changeStaffPasswordAction } from "@/admin/account-actions";

const MIN_LENGTH = 12;

/**
 * Changing your own staff password.
 *
 * The current password is asked for because possession of the session
 * must not be enough to replace the credential — see the server action.
 * The confirmation field is checked here only to save a round trip; the
 * server validates length independently.
 */
export function ChangePasswordForm() {
  const t = useTranslations("admin.security");
  const [current, setCurrent] = React.useState("");
  const [next, setNext] = React.useState("");
  const [confirm, setConfirm] = React.useState("");
  const [pending, setPending] = React.useState(false);
  const [done, setDone] = React.useState(false);

  const tooShort = next.length > 0 && next.length < MIN_LENGTH;
  const mismatch = confirm.length > 0 && confirm !== next;
  const ready = current.length > 0 && next.length >= MIN_LENGTH && confirm === next;

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!ready) return;
    setPending(true);
    setDone(false);
    try {
      const result = await changeStaffPasswordAction({ currentPassword: current, newPassword: next });
      if (result.ok) {
        setDone(true);
        setCurrent("");
        setNext("");
        setConfirm("");
      } else {
        toast.error(t((result.message?.split(".").pop() ?? "passwordFailed") as never));
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      {done ? <Alert tone="success">{t("passwordChanged")}</Alert> : null}

      <Field id="staff-current-password" label={t("currentPassword")} required>
        <PasswordInput
          value={current}
          onChange={(event) => setCurrent(event.target.value)}
          autoComplete="current-password"
          required
        />
      </Field>

      <Field
        id="staff-new-password"
        label={t("newPassword")}
        description={t("passwordHint", { min: MIN_LENGTH })}
        error={tooShort ? t("passwordTooShort", { min: MIN_LENGTH }) : undefined}
        required
      >
        <PasswordInput
          value={next}
          onChange={(event) => setNext(event.target.value)}
          autoComplete="new-password"
          required
        />
      </Field>

      <Field
        id="staff-confirm-password"
        label={t("confirmPassword")}
        error={mismatch ? t("passwordMismatch") : undefined}
        required
      >
        <PasswordInput
          value={confirm}
          onChange={(event) => setConfirm(event.target.value)}
          autoComplete="new-password"
          required
        />
      </Field>

      <div>
        <Button type="submit" disabled={!ready || pending}>
          {pending ? <Spinner /> : null}
          {t("changePassword")}
        </Button>
      </div>
    </form>
  );
}
