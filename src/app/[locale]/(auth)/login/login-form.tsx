"use client";

import * as React from "react";
import { useActionState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { useRouter, Link } from "@/i18n/navigation";
import { signInAction, magicLinkAction, resendVerificationEmailAction, type ActionResult } from "../actions";
import { Input, Field } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Button } from "@/components/ui/button";
import { GoogleButton } from "@/components/auth/google-button";
import { Spinner } from "@/components/ui/spinner";
import { Alert } from "@/components/ui/alert";
import { AuthAlert } from "@/components/auth/auth-alert";
import { safeNextPath } from "@/lib/safe-redirect";

const initialState: ActionResult = { ok: false };

/** Errors the auth callback and app shell can hand back in the URL. */
const URL_ERRORS: Record<string, string> = {
  auth: "auth.errors.generic",
  invalid_link: "auth.errors.invalidLink",
  expired_link: "auth.errors.expiredLink",
  account_suspended: "auth.errors.accountSuspended",
  account_disabled: "auth.errors.accountDisabled",
  oauth: "auth.errors.oauth",
};

export function LoginForm() {
  const t = useTranslations("auth");
  const locale = useLocale();
  const router = useRouter();
  const params = useSearchParams();

  const [mode, setMode] = React.useState<"password" | "magic">("password");
  const [email, setEmail] = React.useState("");
  const [resendMessage, setResendMessage] = React.useState<string | null>(null);
  const [isResending, startResend] = useTransition();

  const [passwordState, passwordAction, passwordPending] = useActionState(signInAction, initialState);
  const [magicState, magicAction, magicPending] = useActionState(magicLinkAction, initialState);

  // Honour ?next= after a middleware redirect, but only same-origin paths.
  const next = safeNextPath(params.get("next"), "/chat");
  const urlError = URL_ERRORS[params.get("error") ?? ""];

  React.useEffect(() => {
    if (passwordState.ok) {
      router.replace(next);
      router.refresh();
    }
  }, [passwordState.ok, router, next]);

  const state = mode === "password" ? passwordState : magicState;
  const action = mode === "password" ? passwordAction : magicAction;
  const pending = mode === "password" ? passwordPending : magicPending;

  function handleResend() {
    startResend(async () => {
      const formData = new FormData();
      formData.append("email", email);
      formData.append("locale", locale);
      const result = await resendVerificationEmailAction(initialState, formData);
      setResendMessage(result.ok ? (result.message ?? "auth.verify.resendSuccess") : (result.error ?? "auth.errors.generic"));
    });
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-[17px] font-semibold tracking-tight text-foreground">{t("login.title")}</h1>
        <p className="mt-1 text-[13px] text-muted">{t("login.subtitle")}</p>
      </div>

      {urlError ? <AuthAlert i18nKey={urlError} /> : null}

      <form action={action} className="flex flex-col gap-3.5" noValidate>
        <input type="hidden" name="locale" value={locale} />
        {!state.ok && state.error ? <AuthAlert i18nKey={state.error} /> : null}
        {state.ok && state.message ? <AuthAlert i18nKey={state.message} tone="success" /> : null}

        {state.error === "auth.errors.emailNotConfirmed" ? (
          <Alert
            tone="warning"
            title={t("verify.title")}
            action={
              <Button variant="outline" size="sm" onClick={handleResend} disabled={isResending || !email}>
                {isResending ? <Spinner /> : null}
                {t("verify.resend")}
              </Button>
            }
          >
            {t("verify.instruction")}
          </Alert>
        ) : null}

        {resendMessage ? (
          <AuthAlert i18nKey={resendMessage} tone={resendMessage.includes("errors") ? "danger" : "success"} />
        ) : null}

        <Field id="email" label={t("email.label")} required>
          <Input
            name="email"
            type="email"
            inputMode="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder={t("email.placeholder")}
            autoComplete="email"
          />
        </Field>

        {mode === "password" ? (
          <div className="flex flex-col gap-1.5">
            <div className="flex items-baseline justify-between gap-2">
              <label htmlFor="password" className="text-[12px] font-medium text-foreground">
                {t("password.label")}
              </label>
              <Link href="/reset-password" className="text-[12px] text-accent hover:underline">
                {t("forgotPassword")}
              </Link>
            </div>
            <PasswordInput
              id="password"
              name="password"
              placeholder={t("password.placeholder")}
              autoComplete="current-password"
              showLabel={t("showPassword")}
              hideLabel={t("hidePassword")}
            />
          </div>
        ) : (
          <p className="text-[12px] leading-relaxed text-muted">{t("login.magicLinkHint")}</p>
        )}

        <Button type="submit" size="lg" disabled={pending} className="mt-1 w-full">
          {pending ? <Spinner /> : null}
          {mode === "password" ? t("login.submit") : t("login.magicLink")}
        </Button>

        <Button
          variant="link"
          className="mx-auto text-[12px]"
          onClick={() => setMode(mode === "password" ? "magic" : "password")}
        >
          {mode === "password" ? t("login.useMagicLink") : t("login.usePassword")}
        </Button>
      </form>

      {/* One control for sign-in and sign-up alike: an OAuth provider does
          not distinguish them, and two buttons doing the same thing is a
          decision the reader has to make for nothing. */}
      <div className="flex items-center gap-3" aria-hidden>
        <span className="h-px flex-1 bg-line" />
        <span className="text-[12px] text-faint">{t("or")}</span>
        <span className="h-px flex-1 bg-line" />
      </div>

      <GoogleButton />

      <p className="text-center text-[13px] text-muted">
        {t("login.noAccount")}{" "}
        <Link href="/register" className="font-medium text-accent hover:underline">
          {t("register.submit")}
        </Link>
      </p>
    </div>
  );
}
