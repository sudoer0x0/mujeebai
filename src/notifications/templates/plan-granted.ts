import "server-only";
import { escapeHtml, renderEmailLayout, renderEmailText } from "@/notifications/templates/layout";
import { isRtlLocale } from "@/lib/utils";
import { clientEnv } from "@/lib/env";
import type { EmailMessage } from "@/notifications/types";

export interface PlanGrantedEmailParams {
  to: string;
  locale: string;
  displayName?: string;
  planName: string;
  days: number;
  expiresAt: string;
  reason?: string | null;
}

export function buildPlanGrantedEmail(params: PlanGrantedEmailParams): EmailMessage {
  const dir = isRtlLocale(params.locale) ? "rtl" : "ltr";
  const name = params.displayName?.trim() || params.to.split("@")[0];
  const appName = clientEnv.NEXT_PUBLIC_APP_NAME;
  const siteUrl = clientEnv.NEXT_PUBLIC_SITE_URL;
  const actionUrl = `${siteUrl}/${params.locale}/chat`;

  const expiryFormatted = new Date(params.expiresAt).toLocaleDateString(params.locale, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const subject = `You've been granted ${params.planName} access on ${appName}`;
  const preview = `Complimentary ${params.planName} subscription for ${params.days} days`;
  const heading = `Complimentary Access Granted`;

  const bodyParagraphs = [
    `Hello ${name},`,
    `You have been granted complimentary access to <strong>${escapeHtml(params.planName)}</strong> on ${escapeHtml(appName)} for <strong>${params.days} days</strong> (active until ${escapeHtml(expiryFormatted)}).`,
    ...(params.reason ? [`<em>Note from staff: ${escapeHtml(params.reason)}</em>`] : []),
    `You can now enjoy higher limits, premium reasoning models, vision capabilities, and extended file uploads.`,
  ];

  const bodyHtml = bodyParagraphs
    .map((p) => `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#374151;">${p}</p>`)
    .join("\n");

  const footnote = `This subscription was granted by the ${appName} team. No payment is required.`;

  const html = renderEmailLayout({
    preview,
    heading,
    bodyHtml,
    action: {
      label: "Start Chatting",
      url: actionUrl,
    },
    footnote,
    dir,
  });

  const textBody = [
    `Hello ${name},`,
    "",
    `You have been granted complimentary access to ${params.planName} on ${appName} for ${params.days} days (active until ${expiryFormatted}).`,
    ...(params.reason ? [`Note from staff: ${params.reason}`, ""] : [""]),
    `You can now enjoy higher limits, premium reasoning models, vision capabilities, and extended file uploads.`,
  ];

  const text = renderEmailText({
    heading,
    body: textBody,
    action: {
      label: "Start Chatting",
      url: actionUrl,
    },
    footnote,
  });

  return {
    to: params.to,
    subject,
    html,
    text,
    tag: "plan_granted",
  };
}
