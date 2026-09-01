import "server-only";

/**
 * The staff portals' public URL prefixes.
 *
 * ## What this is for
 *
 * `/admin` is the first path anyone probes. Moving the consoles behind
 * unguessable segments does not *authenticate* anyone, and is not
 * pretending to: the role checks, the MFA gate and the per-action
 * permission matrix are the security boundary and none of them change
 * here. What it buys is that the consoles are not enumerable, which is
 * what makes putting Cloudflare Access in front of the same paths worth
 * doing.
 *
 * ## Two slugs, not one
 *
 * The super admin console and the moderator console get **separate**
 * secrets, so that knowing one does not reveal the other. A moderator
 * necessarily learns their own URL by using it; without this split that
 * would hand them the administrator console's address too, and the whole
 * point of the split portals is that a moderator is not a junior super
 * admin.
 *
 *   ADMIN_PORTAL_SLUG -> /{adminSlug}/admin      and /{adminSlug}/staff/*
 *   STAFF_PORTAL_SLUG -> /{staffSlug}/moderator  and /{staffSlug}/staff/*
 *
 * Sign-in lives under both, because both roles have to get in somewhere;
 * which console you are then sent to is decided server-side from your
 * role, so a moderator signing in never receives the admin slug.
 *
 * If only `STAFF_PORTAL_SLUG` is set it covers both, which keeps existing
 * single-slug deployments working unchanged.
 *
 * ## Why read from the environment
 *
 * A leaked slug (a screenshot, a shoulder, a shared browser history)
 * should cost one environment variable, not a code change. Verified
 * against a production build: the compiled middleware references these
 * names, and neither value appears anywhere in `.next`, so they are read
 * at runtime and never shipped to a browser.
 *
 * ## Why they never reach the browser bundle
 *
 * There is deliberately no `NEXT_PUBLIC_` variant. That would inline the
 * value into JavaScript served to *every* visitor, including anyone who
 * opens the marketing homepage — publishing the secret to exactly the
 * people it is hidden from. Server code reads it here; client code
 * derives the prefix from the URL it is already on (`useStaffBase`).
 */

/** Segments that make up the staff surface. Kept in one place. */
export const STAFF_SEGMENTS = ["admin", "moderator", "staff"] as const;

/** Which secret guards a given staff segment. */
export type PortalArea = "admin" | "staff";

function normalize(raw: string | undefined): string {
  const value = (raw ?? "").trim().replace(/^\/+|\/+$/g, "");
  // A slug has to be a single, boring path segment. Anything with a
  // slash, a dot or a space would either break the matcher or let the
  // value itself smuggle in path traversal.
  if (!value || !/^[A-Za-z0-9_-]{1,64}$/.test(value)) return "";
  // A slug colliding with a real segment is not a secret, and the 404
  // rule would make the console unreachable.
  if ((STAFF_SEGMENTS as readonly string[]).includes(value.toLowerCase())) return "";
  return value;
}

/** The super admin console's slug. Falls back to the staff slug. */
export function adminPortalSlug(): string {
  return normalize(process.env.ADMIN_PORTAL_SLUG) || normalize(process.env.STAFF_PORTAL_SLUG);
}

/** The moderator console's slug. */
export function staffPortalSlug(): string {
  return normalize(process.env.STAFF_PORTAL_SLUG);
}

/** Which area a locale-stripped path belongs to, or null if not staff. */
export function areaForPath(pathWithoutLocale: string): PortalArea | null {
  const segment = pathWithoutLocale.split("/").filter(Boolean)[0];
  if (segment === "admin") return "admin";
  if (segment === "moderator" || segment === "staff") return "staff";
  return null;
}

/** `""` or `"/slug"` for one area, ready to concatenate. */
export function portalPrefix(area: PortalArea): string {
  const slug = area === "admin" ? adminPortalSlug() : staffPortalSlug();
  return slug ? `/${slug}` : "";
}

/**
 * Turns an internal staff path into the one a browser should be sent to.
 *
 * `staffPortalHref("/admin/users", "en")` -> `/en/{adminSlug}/admin/users`
 *
 * Every server-side redirect into a console goes through this. A redirect
 * that skipped it would land on the internal path, which the middleware
 * answers with 404 — so forgetting it fails loudly rather than quietly
 * exposing the unprefixed route.
 *
 * `/staff/*` is ambiguous on its own — both roles sign in there — so it
 * takes the staff slug unless the caller says otherwise. The sign-in
 * redirect for a super admin passes `area: "admin"` explicitly.
 */
export function staffPortalHref(path: string, locale?: string, area?: PortalArea): string {
  const clean = path.startsWith("/") ? path : `/${path}`;
  const resolved = area ?? areaForPath(clean) ?? "staff";
  const prefixed = `${portalPrefix(resolved)}${clean}`;
  return locale ? `/${locale}${prefixed}` : prefixed;
}

/** True when a locale-stripped path addresses the staff surface. */
export function isStaffSegment(pathWithoutLocale: string): boolean {
  return STAFF_SEGMENTS.some(
    (segment) => pathWithoutLocale === `/${segment}` || pathWithoutLocale.startsWith(`/${segment}/`),
  );
}

/**
 * Resolves an incoming public path to the internal route it addresses.
 *
 * Returns the internal path when `prefix` is a slug that is allowed to
 * reach `inner`, and `null` when it is not — which the middleware turns
 * into a 404. The asymmetry matters: the moderator slug must not reach
 * `/admin`, or the second secret would be pointless.
 */
export function resolveInternalPath(prefix: string, inner: string): string | null {
  const area = areaForPath(inner);
  if (!area) return null;

  const admin = adminPortalSlug();
  const staff = staffPortalSlug();

  if (area === "admin") return prefix === admin ? inner : null;
  // `/moderator` and `/staff` are reachable from either slug: a super
  // admin holding only the admin secret still has to be able to sign in
  // and to open the moderation queue.
  if (prefix === staff || prefix === admin) return inner;
  return null;
}
