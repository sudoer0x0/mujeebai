"use client";

import { useActionState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { requestPasswordResetAction, type ActionResult } from "../actions";
import { Input, Field } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { AuthAlert } from "@/components/auth/auth-alert";
import { Link } from "@/i18n/navigation";

const initialState: ActionResult = { ok: false };

export function ResetForm() {
  const t = useTranslations("auth");
  const locale = useLocale();
  const [state, action, pending] = useActionState(requestPasswordResetAction, initialState);

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-[17px] font-semibold tracking-tight text-foreground">{t("reset.title")}</h1>
        <p className="mt-1 text-[13px] text-muted">{t("reset.subtitle")}</p>
      </div>

      {state.ok ? (
        <>
          {/* Deliberately the same message whether or not an account
              exists, so this form cannot be used to test which addresses
              are registered. */}
          <AuthAlert i18nKey={state.message} tone="success" />
          <Button variant="outline" asChild>
            <Link href="/login">{t("backToLogin")}</Link>
          </Button>
        </>
      ) : (
        <form action={action} className="flex flex-col gap-3.5" noValidate>
          <input type="hidden" name="locale" value={locale} />
          {state.error ? <AuthAlert i18nKey={state.error} /> : null}

          <Field id="email" label={t("email.label")} required>
            <Input
              name="email"
              type="email"
              inputMode="email"
              placeholder={t("email.placeholder")}
              autoComplete="email"
            />
          </Field>

          <Button type="submit" size="lg" disabled={pending} className="mt-1 w-full">
            {pending ? <Spinner /> : null}
            {t("reset.submit")}
          </Button>

          <Button variant="link" asChild className="mx-auto text-[12px]">
            <Link href="/login">{t("backToLogin")}</Link>
          </Button>
        </form>
      )}
    </div>
  );
}
