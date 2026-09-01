/**
 * Idle timeout for the staff consoles.
 *
 * A console left open on an unattended machine is the most ordinary way
 * an administrative session gets used by someone it does not belong to —
 * no exploit required, just a walk past a desk. Customer sessions are
 * deliberately not subject to this: signing someone out of their own chat
 * because they read something slowly is hostile, and the blast radius is
 * their own account.
 *
 * Enforced in two places, and it needs both:
 *
 *   - **Middleware**, from an httpOnly cookie timestamp. This is the
 *     actual control: it holds even with JavaScript disabled, and against
 *     someone replaying a stolen session cookie.
 *   - **The page**, via a heartbeat while there is real interaction. This
 *     is not security — it is what stops the server-side rule from
 *     logging out an operator who is reading rather than clicking.
 *
 * No `server-only`: the timeout constant is read by the client guard too,
 * and a duration is not a secret. The cookie it governs is httpOnly, so
 * the page can never write its own "still here".
 */

export const STAFF_SEEN_COOKIE = "MUJEEB_STAFF_SEEN";

/** Five minutes, as specified. */
export const STAFF_IDLE_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * How often the page reports activity.
 *
 * A third of the timeout: frequent enough that a normally-active operator
 * never trips the cut-off, rare enough that it is not a request per
 * mousemove. Activity is coalesced into this interval rather than sent
 * per event.
 */
export const STAFF_HEARTBEAT_MS = 90 * 1000;

/** True when `seen` is older than the timeout. Absent counts as fresh. */
export function isStaffSessionIdle(seen: string | undefined, now = Date.now()): boolean {
  if (!seen) return false;
  const at = Number(seen);
  // A malformed cookie is treated as fresh rather than as expired: a
  // corrupted value must not become a way to force other people out.
  if (!Number.isFinite(at) || at <= 0) return false;
  // A timestamp in the future is nonsense (clock skew, or tampering that
  // got past httpOnly) — treat it as "now" rather than trusting it.
  if (at > now) return false;
  return now - at > STAFF_IDLE_TIMEOUT_MS;
}
