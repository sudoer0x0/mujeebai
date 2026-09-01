"use client";

import * as React from "react";
import { FONT_CHOICES, FONT_COOKIE, DEFAULT_FONT, isFontChoice } from "@/lib/fonts";
import { toAccentChoice } from "@/lib/accents";

/**
 * Keeps `<html data-font>` in step with the font cookie.
 *
 * `/theme-init.js` applies the font before first paint, which is what
 * avoids a flash — but it only runs on a **full page load**. Signing in is
 * a client-side transition, so the attribute set for the *previous*
 * account survived it: sign out, sign in as someone else, and you kept
 * their reading font until the next hard refresh. On a shared browser that
 * is one person's preference leaking into another's session.
 *
 * This runs on mount and whenever the server tells the tree to re-render,
 * so a sign-in, a sign-out or a preference change all land immediately.
 *
 * The value is validated against the same nine-item allowlist as
 * everywhere else, so a hand-edited cookie still can only ever select a
 * CSS rule that exists.
 */
export function FontSync() {
  React.useEffect(() => {
    try {
      const match = document.cookie.match(/(?:^|;\s*)MUJEEB_FONT=([^;]*)/);
      const raw = match ? decodeURIComponent(match[1]) : null;
      const font = isFontChoice(raw) ? raw : DEFAULT_FONT;

      if (document.documentElement.getAttribute("data-font") !== font) {
        document.documentElement.setAttribute("data-font", font);
      }
      // The accent needs the same treatment and for the same reason:
      // /theme-init.js only runs on a full load, so without this a
      // sign-in on a shared browser keeps the previous account's colour.
      const accentMatch = document.cookie.match(/(?:^|;\s*)MUJEEB_ACCENT=([^;]*)/);
      const rawAccent = accentMatch ? decodeURIComponent(accentMatch[1]) : null;
      const accent = toAccentChoice(rawAccent);

      if (accent === "default") {
        document.documentElement.removeAttribute("data-accent");
      } else if (document.documentElement.getAttribute("data-accent") !== accent) {
        document.documentElement.setAttribute("data-accent", accent);
      }
    } catch {
      // A stale font or colour is cosmetic; never let it break a render.
    }
  });

  return null;
}

/** Re-exported so the allowlist has exactly one definition. */
export { FONT_CHOICES, FONT_COOKIE };
