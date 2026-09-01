import "server-only";
import { headers } from "next/headers";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { logger } from "@/lib/logger";

/**
 * Records where a session signed in from.
 *
 * Called once, immediately after a successful sign-in. The place comes
 * from the hosting platform's own geo headers — Cloudflare's
 * `cf-ipcountry`, Vercel's `x-vercel-ip-*` — which are attached upstream
 * of the app and cannot be set by the browser.
 *
 * There is deliberately no IP-to-location lookup: that would send a user's
 * address to a third party on every settings render, and put a network
 * call on a page that should not need one.
 *
 * Failure is silent by design. A missing location makes a row read
 * "Unknown location"; it must never be the reason a sign-in fails.
 */
export async function recordSessionLocation(userId: string, accessToken: string): Promise<void> {
  try {
    const sessionId = sessionIdFromToken(accessToken);
    if (!sessionId) return;

    const h = await headers();
    const country = h.get("cf-ipcountry") ?? h.get("x-vercel-ip-country");
    const region = h.get("x-vercel-ip-country-region");
    const city = decodeHeader(h.get("x-vercel-ip-city"));

    // No geo headers at all (local development, or a platform that does
    // not provide them) — nothing worth storing.
    if (!country && !region && !city) return;

    const admin = createServiceRoleClient();
    await admin.from("session_locations").upsert(
      {
        session_id: sessionId,
        user_id: userId,
        country: country && country !== "XX" ? country.toUpperCase() : null,
        region: region ?? null,
        city: city ?? null,
      },
      { onConflict: "session_id" },
    );
  } catch (error) {
    logger.warn("session_location_record_failed", { error: String(error) });
  }
}

/**
 * Reads the `session_id` claim without verifying the signature.
 *
 * Safe here because the token was just returned by Supabase to this
 * server, over TLS, in response to this request's own sign-in — it is not
 * attacker-supplied. The claim is used only as a key for a row this
 * function writes; nothing is authorized on the basis of it.
 */
function sessionIdFromToken(accessToken: string): string | null {
  try {
    const [, payload] = accessToken.split(".");
    if (!payload) return null;
    const json = Buffer.from(payload.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
    const claims = JSON.parse(json) as { session_id?: string };
    return claims.session_id ?? null;
  } catch {
    return null;
  }
}

/** Vercel percent-encodes city names, which can contain spaces and accents. */
function decodeHeader(value: string | null): string | null {
  if (!value) return null;
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
