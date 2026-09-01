/**
 * Per-account accent colours.
 *
 * ## Why identifiers rather than colour values
 *
 * A preference is a *choice from a list*, never a colour string. The
 * stored value only ever selects a `[data-accent="…"]` rule that already
 * exists in the stylesheet, so nothing a person can set ends up inside a
 * `style` attribute or a CSS custom property. A free-form colour field
 * would be a CSS injection surface for the sake of a nicer picker.
 *
 * The same value is guarded three times over — this list, a zod enum on
 * the update action, and a CHECK constraint on the column — because each
 * one catches a different class of mistake.
 *
 * ## Why these particular colours
 *
 * Each one is defined for light and dark separately rather than being
 * lightened programmatically: the same hue needs more chroma on a dark
 * ground to read as the same colour, and `accent-text` has to flip
 * between white and near-black to stay legible on the accent itself.
 * Every pair was chosen to clear 4.5:1 against its own text colour.
 */

export const ACCENT_CHOICES = [
  "default",
  "violet",
  "emerald",
  "amber",
  "rose",
  "cyan",
  "slate",
] as const;

export type AccentChoice = (typeof ACCENT_CHOICES)[number];

export const ACCENT_COOKIE = "MUJEEB_ACCENT";
export const ACCENT_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export function toAccentChoice(value: unknown): AccentChoice {
  return typeof value === "string" && (ACCENT_CHOICES as readonly string[]).includes(value)
    ? (value as AccentChoice)
    : "default";
}

/** Swatch colours for the picker itself, light-theme values. */
export const ACCENT_SWATCHES: Record<AccentChoice, string> = {
  default: "#2f5cff",
  violet: "#7c3aed",
  emerald: "#059669",
  amber: "#b45309",
  rose: "#e11d48",
  cyan: "#0891b2",
  slate: "#475569",
};
