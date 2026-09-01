import "server-only";
import { getTranslations } from "next-intl/server";
import { escapeHtml, renderEmailLayout, renderEmailText } from "@/notifications/templates/layout";
import { isRtlLocale } from "@/lib/utils";
import { getTemplateOverride, interpolate } from "@/notifications/templates/store";
import { clientEnv } from "@/lib/env";
import type { EmailMessage } from "@/notifications/types";

export type AuthEmailKind =
  | "verify"
  | "reset"
  | "magicLink"
  | "welcome"
  | "staffInvite"
  | "invite"
  | "vipInvite";

interface AuthEmailParams {
  to: string;
  locale: string;
  actionUrl?: string;
  displayName?: string;
  /**
   * A one-time secret shown in a monospace block, used by the staff
   * invite to deliver a temporary password.
   *
   * Sending a password by email is not ideal, and it is only acceptable
   * here because of what surrounds it: the password is single-use in
   * practice — the account cannot do anything until it has been changed —
   * and the very next step forces TOTP enrolment. The alternative, an
   * operator messaging a password over chat, is strictly worse.
   */
  secret?: { label: string; value: string };
}

/**
 * Builds a localized transactional auth email.
 *
 * All copy comes from the message catalogs (`emails.*`), so adding a
 * locale is a translation change and not a code change — master spec #65.
 */
export async function buildAuthEmail(kind: AuthEmailKind, params: AuthEmailParams): Promise<EmailMessage> {
  const t = await getTranslations({ locale: params.locale, namespace: `emails.${kind}` });
  const tc = await getTranslations({ locale: params.locale, namespace: "emails.common" });

  const name = params.displayName?.trim() || params.to.split("@")[0];

  // An operator-configured override, if one exists for this exact
  // (kind, locale). The catalog stays the default for everything else —
  // see src/notifications/templates/store.ts for why overriding rather
  // than replacing is the safe shape. A blank field is "not overridden",
  // never an intentionally empty subject.
  const override = await getTemplateOverride(kind, params.locale);
  const values = { name, appName: clientEnv.NEXT_PUBLIC_APP_NAME, email: params.to };
  const pick = (field: string | undefined, fallback: string) =>
    field && field.trim() ? interpolate(field, values) : fallback;

  // `name` is passed to every catalog lookup, not just the ones that use
  // it today. These are ICU messages: a template containing `{name}` with
  // no value supplied throws at render time, and an email that fails to
  // build is an email nobody receives. Extra values are ignored, so this
  // costs nothing and means adding a placeholder to a translation never
  // needs a matching code change.
  const greeting = tc("greeting", { name });
  const heading = pick(override?.heading, t("heading", { name }));
  const bodyLines = override?.body?.trim()
    ? [interpolate(override.body, values)]
    : [greeting, t("body", { name })];
  const footnote = pick(override?.footnote, t("footnote", { name }));
  const actionLabel = pick(override?.actionLabel, kind === "welcome" ? tc("openApp") : t("action", { name }));

  const action = params.actionUrl ? { label: actionLabel, url: params.actionUrl } : undefined;

  const secretHtml = params.secret
    ? `<p style="margin:0 0 6px;font-size:13px;color:#6b7280;">${escapeHtml(params.secret.label)}</p>` +
      `<p style="margin:0 0 16px;padding:12px 14px;background:#f3f4f6;border-radius:6px;` +
      `font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:16px;letter-spacing:0.5px;` +
      `word-break:break-all;color:#111827;">${escapeHtml(params.secret.value)}</p>`
    : "";

  return {
    to: params.to,
    subject: pick(override?.subject, t("subject", { name })),
    tag: `auth-${kind}`,
    html: renderEmailLayout({
      preview: pick(override?.preview, t("preview", { name })),
      heading,
      dir: isRtlLocale(params.locale) ? "rtl" : "ltr",
      bodyHtml: bodyLines.map((line) => `<p style="margin:0 0 12px;">${escapeHtml(line)}</p>`).join("") + secretHtml,
      action,
      footnote,
    }),
    text: renderEmailText({
      heading,
      body: params.secret ? [...bodyLines, `${params.secret.label} ${params.secret.value}`] : bodyLines,
      action,
      footnote,
    }),
  };
}
