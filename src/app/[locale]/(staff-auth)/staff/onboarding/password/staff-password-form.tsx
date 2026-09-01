"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useStaffBase } from "@/components/staff/use-staff-base";
import { Field } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Alert } from "@/components/ui/alert";
import { PasswordInput } from "@/components/ui/password-input";
import { setStaffPasswordAction } from "../actions";

export function StaffPasswordForm({ locale }: { locale: string }) {
  const t = useTranslations("staffAuth.onboarding");
  const tAuth = useTranslations("auth");
  const router = useRouter();
  const base = useStaffBase();
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const password = String(form.get("password") ?? "");
    const confirm = String(form.get("confirm") ?? "");

    if (password !== confirm) {
      setError(t("passwordMismatch"));
      return;
    }
    if (password.length < 12) {
      setError(t("passwordTooShort"));
      return;
    }

    setError(null);
    startTransition(async () => {
      const result = await setStaffPasswordAction({ password, confirm });
      if (result.ok) {
        // Straight into enrolment — the two steps are one onboarding.
        router.replace(`/${locale}${base}/staff/onboarding/mfa`);
      } else {
        setError(t(result.message.split(".").pop() as never));
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3" noValidate>
      {error ? <Alert tone="danger">{error}</Alert> : null}

      <Field id="staff-new-password" label={t("newPassword")} required>
        <PasswordInput
          name="password"
          autoComplete="new-password"
          required
          minLength={12}
          showLabel={tAuth("showPassword")}
          hideLabel={tAuth("hidePassword")}
        />
      </Field>

      <Field id="staff-confirm-password" label={t("confirmPassword")} required>
        <PasswordInput
          name="confirm"
          autoComplete="new-password"
          required
          minLength={12}
          showLabel={tAuth("showPassword")}
          hideLabel={tAuth("hidePassword")}
        />
      </Field>

      <p className="text-[12px] leading-relaxed text-faint">{t("passwordHint")}</p>

      <Button type="submit" disabled={pending}>
        {pending ? <Spinner /> : null}
        {t("passwordSubmit")}
      </Button>
    </form>
  );
}
