/**
 * Reader-selectable font stacks.
 *
 * ## Why this is safe
 *
 * The user picks an **identifier**, never a font name. The identifier is
 * validated against this list in the server action and again by a CHECK
 * constraint in the database, then rendered into `data-font` on <html>,
 * where `globals.css` maps it to a stack. At no point does user input
 * become part of a `font-family` declaration, so there is nothing to
 * inject into.
 *
 * Every stack is composed of fonts that already exist on the device.
 * Nothing is downloaded, which matters for two reasons beyond speed: a
 * webfont request would expose the reader's IP address to whoever serves
 * it, and it would require loosening `font-src 'self' data:` in the CSP.
 */

export const FONT_CHOICES = [
  "system",
  "grotesk",
  "humanist",
  "geometric",
  "rounded",
  "serif",
  "slab",
  "mono",
  "reading",
] as const;

export type FontChoice = (typeof FONT_CHOICES)[number];

export const DEFAULT_FONT: FontChoice = "system";

/**
 * Cookie the render path reads.
 *
 * The database column remains the source of truth; this is a hint the
 * browser can act on before first paint. It is written whenever the
 * preference is saved and refreshed at sign-in, so the choice follows the
 * account onto a new device on its first visit after signing in.
 *
 * Not httpOnly — /theme-init.js reads it in the browser, which is the
 * whole point. That is safe because the value is validated against
 * FONT_CHOICES on both sides and only ever selects a CSS rule.
 */
export const FONT_COOKIE = "MUJEEB_FONT";
export const FONT_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export function isFontChoice(value: unknown): value is FontChoice {
  return typeof value === "string" && (FONT_CHOICES as readonly string[]).includes(value);
}

/** Normalises anything read back out of the database. */
export function toFontChoice(value: unknown): FontChoice {
  return isFontChoice(value) ? value : DEFAULT_FONT;
}
