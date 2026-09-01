import { clientEnv } from "@/lib/env";

/**
 * Escapes a value for interpolation into the HTML email body.
 *
 * Everything user-controlled that reaches a template (display names,
 * email addresses) goes through this. Email clients render HTML, so an
 * unescaped display name is an injection vector into every inbox we send
 * to — see SECURITY.md#Email.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export interface EmailLayoutOptions {
  /** Preheader text shown in the inbox preview line. */
  preview: string;
  heading: string;
  /** Already-escaped HTML paragraphs. */
  bodyHtml: string;
  action?: { label: string; url: string };
  footnote?: string;
  dir?: "ltr" | "rtl";
}

/**
 * Renders the shared branded email shell.
 *
 * Deliberately plain: table-free, inline-styled, no web fonts and no
 * images. That is what actually survives Outlook/Gmail clipping, and it
 * keeps the brand consistent with the in-app design system (same neutral
 * palette, same single accent) rather than reaching for the gradient
 * header every SaaS email uses.
 */
export function renderEmailLayout(options: EmailLayoutOptions): string {
  const dir = options.dir ?? "ltr";
  const align = dir === "rtl" ? "right" : "left";
  const appName = clientEnv.NEXT_PUBLIC_APP_NAME;
  const siteUrl = clientEnv.NEXT_PUBLIC_SITE_URL;

  const button = options.action
    ? `<a href="${escapeHtml(options.action.url)}" style="display:inline-block;background:#1a1a1a;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 22px;border-radius:8px;">${escapeHtml(options.action.label)}</a>`
    : "";

  // The readable destination under the button.
  //
  // I removed this once on the theory that a long URL in the body reads
  // as phishing. That was reasoning rather than evidence, and removing it
  // made delivery worse, not better — a message whose only link is hidden
  // behind a styled button gives a filter less to verify, and gives a
  // reader no way to see where they are being sent. It is also the
  // genuine fallback for clients that strip styled anchors.
  const fallbackLink = options.action
    ? `<p style="margin:24px 0 0;font-size:13px;line-height:1.6;color:#6b7280;">
         ${escapeHtml("If the button does not work, copy and paste this link into your browser:")}<br />
         <span style="word-break:break-all;color:#374151;">${escapeHtml(options.action.url)}</span>
       </p>`
    : "";

  const footnote = options.footnote
    ? `<p style="margin:24px 0 0;font-size:13px;line-height:1.6;color:#6b7280;">${escapeHtml(options.footnote)}</p>`
    : "";

  return `<!doctype html>
<html lang="en" dir="${dir}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>${escapeHtml(options.heading)}</title>
  </head>
  <body style="margin:0;padding:0;background:#f6f6f7;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(options.preview)}</div>
    <div style="padding:32px 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
      <div style="max-width:520px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;padding:32px;text-align:${align};">
        <div style="font-size:15px;font-weight:700;color:#111827;letter-spacing:-0.01em;">${escapeHtml(appName)}</div>
        <h1 style="margin:20px 0 0;font-size:21px;line-height:1.3;font-weight:700;color:#111827;letter-spacing:-0.02em;">${escapeHtml(options.heading)}</h1>
        <div style="margin:14px 0 0;font-size:15px;line-height:1.65;color:#374151;">${options.bodyHtml}</div>
        ${button ? `<div style="margin:28px 0 0;">${button}</div>` : ""}
        ${fallbackLink}
        ${footnote}
      </div>
      <p style="max-width:520px;margin:20px auto 0;font-size:12px;line-height:1.6;color:#9ca3af;text-align:center;">
        ${escapeHtml(appName)} · <a href="${escapeHtml(siteUrl)}" style="color:#9ca3af;">${escapeHtml(siteUrl.replace(/^https?:\/\//, ""))}</a>
      </p>
    </div>
  </body>
</html>`;
}

/** Builds the plain-text counterpart of a layout-rendered email. */
export function renderEmailText(parts: {
  heading: string;
  body: string[];
  action?: { label: string; url: string };
  footnote?: string;
}): string {
  const lines = [parts.heading, "", ...parts.body];
  if (parts.action) lines.push("", `${parts.action.label}: ${parts.action.url}`);
  if (parts.footnote) lines.push("", parts.footnote);
  lines.push("", clientEnv.NEXT_PUBLIC_APP_NAME, clientEnv.NEXT_PUBLIC_SITE_URL);
  return lines.join("\n");
}
