"use client";

import * as React from "react";
import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { useRouter, Link } from "@/i18n/navigation";
import { updatePasswordAction, type ActionResult } from "../actions";
import { PasswordInput } from "@/components/ui/password-input";
import { Field } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { AuthAlert } from "@/components/auth/auth-alert";

const initialState: ActionResult = { ok: false };

export function UpdatePasswordForm() {
  const t = useTranslations("auth");
  const router = useRouter();
  const [state, action, pending] = useActionState(updatePasswordAction, initialState);
  const [password, setPassword] = React.useState("");
  const [confirmPassword, setConfirmPassword] = React.useState("");

  React.useEffect(() => {
    if (state.ok) {
      // Short pause so the confirmation is actually readable before the
      // redirect, rather than a flash the user never sees.
      const timeout = setTimeout(() => {
        router.replace("/chat");
        router.refresh();
      }, 1200);
      return () => clearTimeout(timeout);
    }
  }, [state.ok, router]);

  const tooShort = password.length > 0 && password.length < 8;
  const mismatch = confirmPassword.length > 0 && password !== confirmPassword;

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-[17px] font-semibold tracking-tight text-foreground">{t("updatePassword.title")}</h1>
        <p className="mt-1 text-[13px] text-muted">{t("updatePassword.subtitle")}</p>
      </div>

      {state.ok ? (
        <AuthAlert i18nKey={state.message ?? "auth.updatePassword.success"} tone="success" />
      ) : (
        <form action={action} className="flex flex-col gap-3.5" noValidate>
          {state.error ? <AuthAlert i18nKey={state.error} /> : null}

          <Field
            id="password"
            label={t("password.label")}
            description={t("password.hint")}
            error={tooShort ? t("errors.weakPassword") : null}
            required
          >
            <PasswordInput
              name="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="new-password"
              minLength={8}
              showLabel={t("showPassword")}
              hideLabel={t("hidePassword")}
            />
          </Field>

          <Field
            id="confirmPassword"
            label={t("confirmPassword.label")}
            error={mismatch ? t("errors.passwordMismatch") : null}
            required
          >
            <PasswordInput
              name="confirmPassword"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              autoComplete="new-password"
              minLength={8}
              showLabel={t("showPassword")}
              hideLabel={t("hidePassword")}
            />
          </Field>

          <Button
            type="submit"
            size="lg"
            disabled={pending || password.length < 8 || mismatch}
            className="mt-1 w-full"
          >
            {pending ? <Spinner /> : null}
            {t("updatePassword.submit")}
          </Button>

          <Button variant="link" asChild className="mx-auto text-[12px]">
            <Link href="/login">{t("backToLogin")}</Link>
          </Button>
        </form>
      )}
    </div>
  );
}
