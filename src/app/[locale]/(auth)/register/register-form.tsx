"use client";

import * as React from "react";
import { useActionState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { Mail, Check } from "lucide-react";
import { signUpAction, resendVerificationEmailAction, type ActionResult } from "../actions";
import { Input, Field } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Button } from "@/components/ui/button";
import { GoogleButton } from "@/components/auth/google-button";
import { Spinner } from "@/components/ui/spinner";
import { AuthAlert } from "@/components/auth/auth-alert";
import { Link } from "@/i18n/navigation";

const initialState: ActionResult = { ok: false };

export function RegisterForm() {
  const t = useTranslations("auth");
  const tCommon = useTranslations("common");
  const locale = useLocale();
  const router = useRouter();
  const [state, action, pending] = useActionState(signUpAction, initialState);

  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [confirmPassword, setConfirmPassword] = React.useState("");
  const [resendMessage, setResendMessage] = React.useState<string | null>(null);
  const [isResending, startResend] = useTransition();

  // When Supabase is configured to skip email confirmation, sign-up hands
  // back a live session — go straight into the app instead of showing a
  // check-your-inbox screen for a mail that will never arrive.
  React.useEffect(() => {
    if (state.ok && state.sessionCreated) {
      router.replace("/chat");
      router.refresh();
    }
  }, [state.ok, state.sessionCreated, router]);

  const passwordTooShort = password.length > 0 && password.length < 8;
  const mismatch = confirmPassword.length > 0 && password !== confirmPassword;
  const matches = confirmPassword.length > 0 && password === confirmPassword;

  function handleResend() {
    startResend(async () => {
      const formData = new FormData();
      formData.append("email", email);
      formData.append("locale", locale);
      const result = await resendVerificationEmailAction(initialState, formData);
      setResendMessage(result.ok ? (result.message ?? "auth.verify.resendSuccess") : (result.error ?? "auth.errors.generic"));
    });
  }

  if (state.ok && !state.sessionCreated) {
    return (
      <div className="flex flex-col gap-5 text-center">
        <div className="mx-auto flex size-10 items-center justify-center rounded-md border border-line bg-surface-raised">
          <Mail className="size-4 text-muted" aria-hidden />
        </div>

        <div>
          <h1 className="text-[17px] font-semibold tracking-tight text-foreground">{t("verify.title")}</h1>
          <p className="mt-1.5 text-[13px] leading-relaxed text-muted">{t("verify.instruction")}</p>
          {email ? <p className="mt-2 text-[13px] font-medium text-foreground">{email}</p> : null}
        </div>

        {resendMessage ? (
          <AuthAlert i18nKey={resendMessage} tone={resendMessage.includes("errors") ? "danger" : "success"} />
        ) : null}

        <div className="flex flex-col gap-2">
          <Button variant="outline" onClick={handleResend} disabled={isResending || !email}>
            {isResending ? <Spinner /> : null}
            {isResending ? t("verify.resending") : t("verify.resend")}
          </Button>
          <Button variant="ghost" asChild>
            <Link href="/login">{t("backToLogin")}</Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-[17px] font-semibold tracking-tight text-foreground">{t("register.title")}</h1>
        <p className="mt-1 text-[13px] text-muted">{t("register.subtitle")}</p>
      </div>

      <form action={action} className="flex flex-col gap-3.5" noValidate>
        <input type="hidden" name="locale" value={locale} />
        {state.error ? <AuthAlert i18nKey={state.error} /> : null}

        <div className="grid gap-3 sm:grid-cols-2">
          <Field id="firstName" label={t("firstName.label")} required>
            <Input name="firstName" placeholder={t("firstName.placeholder")} autoComplete="given-name" maxLength={100} />
          </Field>
          <Field id="lastName" label={t("lastName.label")} required>
            <Input name="lastName" placeholder={t("lastName.placeholder")} autoComplete="family-name" maxLength={100} />
          </Field>
        </div>

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

        <Field
          id="password"
          label={t("password.label")}
          description={t("password.hint")}
          error={passwordTooShort ? t("errors.weakPassword") : null}
          required
        >
          <PasswordInput
            name="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder={t("password.placeholder")}
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
            placeholder={t("confirmPassword.placeholder")}
            autoComplete="new-password"
            minLength={8}
            showLabel={t("showPassword")}
            hideLabel={t("hidePassword")}
          />
        </Field>

        {matches ? (
          <p className="flex items-center gap-1.5 text-[12px] text-success">
            <Check className="size-3.5" aria-hidden />
            {t("passwordsMatch")}
          </p>
        ) : null}

        <Button type="submit" size="lg" disabled={pending} className="mt-1 w-full">
          {pending ? <Spinner label={tCommon("loading")} /> : null}
          {t("register.submit")}
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
        {t("register.haveAccount")}{" "}
        <Link href="/login" className="font-medium text-accent hover:underline">
          {t("login.submit")}
        </Link>
      </p>
    </div>
  );
}
