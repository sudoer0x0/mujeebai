/**
 * Template values that both the server and the browser need.
 *
 * Deliberately free of any server import. The editor is a Client
 * Component and needs the kind list, the placeholder list and the
 * "is anything actually overridden" rule; the store that reads and writes
 * the database is `server-only`, and pulling it in for three constants
 * dragged the service-role client toward the browser bundle. The build
 * caught it, which is what that marker is for.
 *
 * Nothing here touches the database or the environment.
 */

export const TEMPLATE_KINDS = [
  "verify",
  "reset",
  "magicLink",
  "welcome",
  "staffInvite",
  "invite",
  "vipInvite",
] as const;

export type TemplateKind = (typeof TEMPLATE_KINDS)[number];

export function isTemplateKind(value: string): value is TemplateKind {
  return (TEMPLATE_KINDS as readonly string[]).includes(value);
}

/** The fields an operator may edit. Blank means "use the built-in copy". */
export interface TemplateFields {
  subject: string;
  preview: string;
  heading: string;
  body: string;
  actionLabel: string;
  footnote: string;
}

/**
 * Placeholders a template may use.
 *
 * A closed set on purpose: anything an operator types ends up in an email
 * sent from this domain, so substitution must not be able to reach
 * arbitrary data.
 */
export const TEMPLATE_PLACEHOLDERS = ["name", "appName", "email"] as const;
export type TemplatePlaceholder = (typeof TEMPLATE_PLACEHOLDERS)[number];

/**
 * Substitutes `{name}`-style placeholders.
 *
 * Unknown placeholders are left exactly as written rather than blanked,
 * so a typo shows up in the preview instead of silently deleting text.
 *
 * The result is not escaped here — that is the caller's job, and escaping
 * before substitution would double-escape a value escaped again later.
 */
export function interpolate(text: string, values: Partial<Record<TemplatePlaceholder, string>>): string {
  return text.replace(/\{(\w+)\}/g, (whole, key: string) =>
    (TEMPLATE_PLACEHOLDERS as readonly string[]).includes(key) && values[key as TemplatePlaceholder] !== undefined
      ? (values[key as TemplatePlaceholder] as string)
      : whole,
  );
}

/** True when a stored row actually overrides anything. */
export function isConfigured(fields: TemplateFields): boolean {
  return Object.values(fields).some((value) => value.trim().length > 0);
}
