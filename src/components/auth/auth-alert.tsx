"use client";

import { useTranslations } from "next-intl";
import { Alert } from "@/components/ui/alert";

/**
 * Renders a translated message from a server action's `error`/`message`
 * key (e.g. "auth.errors.invalidCredentials").
 *
 * Server actions deliberately return catalog keys rather than prose, so
 * the message is rendered in the viewer's language and no provider
 * wording ever reaches the browser.
 */
export function AuthAlert({ i18nKey, tone = "danger" }: { i18nKey?: string; tone?: "danger" | "success" | "info" }) {
  const t = useTranslations();
  if (!i18nKey) return null;

  let text = i18nKey;
  try {
    text = t(i18nKey as never);
  } catch {
    // An unrecognized key is a bug, not something to show the user raw.
    text = t("common.error");
  }

  return <Alert tone={tone}>{text}</Alert>;
}
