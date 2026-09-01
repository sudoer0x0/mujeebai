import "server-only";
import { createServiceRoleClient, createServerSupabaseClient } from "@/lib/supabase/server";
import { logger } from "@/lib/logger";

/**
 * The devices an account is signed in on.
 *
 * ## Where this comes from
 *
 * GoTrue keeps one row per session in `auth.sessions`, carrying the
 * `user_agent` and `ip` recorded when the session was created, plus
 * `refreshed_at` — which advances every time that device exchanges its
 * refresh token, and is therefore a good proxy for "last active".
 *
 * That table is not exposed through PostgREST and there is no admin API
 * for it, so it is read here with the service role and **always** filtered
 * to the calling user's own id. The filter is applied server-side from the
 * session, never from anything the client sends.
 *
 * ## Revoking one device
 *
 * Deleting the session row is what revokes it: `auth.refresh_tokens` and
 * `auth.mfa_amr_claims` both cascade from it, so the device cannot mint a
 * new access token. Its current access token stays valid until it expires
 * (an hour at most) — that is inherent to stateless JWTs, and is why
 * "sign out everywhere" also exists for the case where minutes matter.
 */

export interface DeviceSession {
  id: string;
  /** "Chrome on macOS" — derived from the user agent, never trusted for anything. */
  label: string;
  ip: string | null;
  createdAt: string;
  lastActiveAt: string | null;
  /** Whether this row is the session making the request. */
  current: boolean;
  /** Second factor used on this session. */
  aal: string | null;
  /** Where the session signed in from, when the platform reported it. */
  location: string | null;
}

/**
 * Turns a user-agent string into something a person recognises.
 *
 * Deliberately small and approximate rather than a UA-parsing dependency:
 * the goal is "do I recognise this?", and the browser and platform names
 * are enough for that. Order matters — Edge and Chrome both claim to be
 * Safari, and Chromium-based Edge claims to be Chrome.
 */
export function describeUserAgent(userAgent: string | null): string {
  if (!userAgent?.trim()) return "Unknown device";

  const ua = userAgent;
  const browser =
    /Edg\//.test(ua) ? "Edge"
    : /OPR\/|Opera/.test(ua) ? "Opera"
    : /Firefox\//.test(ua) ? "Firefox"
    : /Chrome\//.test(ua) ? "Chrome"
    : /Safari\//.test(ua) ? "Safari"
    : /curl|node|undici|python|Go-http|axios/i.test(ua) ? "Script or API client"
    : null;

  const platform =
    /iPhone/.test(ua) ? "iPhone"
    : /iPad/.test(ua) ? "iPad"
    : /Android/.test(ua) ? "Android"
    : /Mac OS X|Macintosh/.test(ua) ? "macOS"
    : /Windows/.test(ua) ? "Windows"
    : /CrOS/.test(ua) ? "ChromeOS"
    : /Linux/.test(ua) ? "Linux"
    : null;

  if (browser && platform) return `${browser} on ${platform}`;
  if (browser) return browser;
  if (platform) return platform;
  // Next's own fetch identifies itself this way when a server-side call
  // creates a session. It should not appear now that the browser's agent
  // is forwarded (see createServerSupabaseClient), but older rows predate
  // that fix and should read as what they are rather than as a device.
  if (/next\.js/i.test(ua)) return "Server session (before device tracking)";

  // Keep something rather than nothing, but never the whole UA string —
  // it is long, and it is not useful to a person.
  return userAgent.slice(0, 40);
}

/** The id of the session making this request, from its own access token. */
async function currentSessionId(): Promise<string | null> {
  try {
    const supabase = await createServerSupabaseClient();
    const { data } = await supabase.auth.getClaims();
    const claims = data?.claims as { session_id?: string } | undefined;
    return claims?.session_id ?? null;
  } catch {
    return null;
  }
}

export async function listDeviceSessions(userId: string): Promise<DeviceSession[]> {
  const admin = createServiceRoleClient();

  // `auth` is not in PostgREST's exposed schemas, so this goes through a
  // helper function rather than a table select. See migration 0022.
  const { data, error } = await admin.rpc("list_user_sessions", { p_user_id: userId });

  if (error) {
    logger.error("list_sessions_failed", { error: error.message });
    return [];
  }

  const current = await currentSessionId();

  // Locations are ours, not GoTrue's — one query for the page.
  const { data: places } = await admin
    .from("session_locations")
    .select("session_id, country, region, city")
    .eq("user_id", userId);
  const placeById = new Map(
    (places ?? []).map((row) => [row.session_id, formatPlace(row.city, row.region, row.country)]),
  );

  const rows = (data ?? []) as Array<{
    id: string;
    created_at: string;
    refreshed_at: string | null;
    user_agent: string | null;
    ip: string | null;
    aal: string | null;
  }>;

  return rows
    .map((row) => ({
      id: row.id,
      label: describeUserAgent(row.user_agent),
      ip: row.ip,
      createdAt: row.created_at,
      lastActiveAt: row.refreshed_at,
      current: row.id === current,
      aal: row.aal,
      location: placeById.get(row.id) ?? null,
    }))
    // This device first, then most recently active.
    .sort((a, b) => {
      if (a.current !== b.current) return a.current ? -1 : 1;
      return (b.lastActiveAt ?? b.createdAt).localeCompare(a.lastActiveAt ?? a.createdAt);
    });
}

/**
 * Revokes one session, after confirming it belongs to the caller.
 *
 * The ownership check is the whole security of this function: a session id
 * is a UUID a client supplies, and without the check any signed-in user
 * could sign out any other. It is enforced in SQL (the function filters on
 * both id and user_id) as well as here.
 */
export async function revokeDeviceSession(userId: string, sessionId: string): Promise<boolean> {
  const admin = createServiceRoleClient();
  const { data, error } = await admin.rpc("revoke_user_session", {
    p_user_id: userId,
    p_session_id: sessionId,
  });

  if (error) {
    logger.error("revoke_session_failed", { error: error.message });
    return false;
  }
  return Boolean(data);
}

/**
 * "Lagos, NG" — the most specific parts the platform gave us.
 *
 * Region is skipped when a city is known: "Lagos, Lagos, NG" reads as a
 * bug rather than as precision.
 */
function formatPlace(city: string | null, region: string | null, country: string | null): string | null {
  const parts = [city || region, country].filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : null;
}
