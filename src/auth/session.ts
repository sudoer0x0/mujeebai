import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getUserContext } from "@/auth/user-context";
import { requireStaffGate, assertStaffGate } from "@/auth/staff-gate";
import { UnauthorizedError, ForbiddenError } from "@/auth/errors";
import type { Tables } from "@/types/database";
import type { Role } from "@/admin/permissions";
import { staffPortalHref } from "@/auth/portal-path";

export type Profile = Tables<"profiles">;

export interface SessionUser {
  id: string;
  email: string | null;
}

/**
 * Current authenticated user, cached for the lifetime of the request.
 *
 * Verification is **cryptographic, not trusting the cookie**: `getClaims()`
 * checks the JWT's signature against the project's published JWKS and
 * rejects anything expired or tampered with. What it does not do is call
 * the auth server — and that call was measured at ~165ms against this
 * project, paid on every authenticated request, sometimes several times.
 * Local verification is ~1ms.
 *
 * The trade-off is revocation latency: a session invalidated server-side
 * stays usable until its access token expires (one hour). That is
 * acceptable here because every entry point that does real work also
 * reads `profiles.status`, so a suspended or disabled account is refused
 * on the next request regardless of what its token says.
 *
 * `getSession()` remains off-limits — it decodes the cookie with no
 * verification at all, which is a different thing entirely.
 */
export const getCurrentUser = cache(async (): Promise<SessionUser | null> => {
  const supabase = await createServerSupabaseClient();

  try {
    const { data, error } = await supabase.auth.getClaims();
    if (!error && data?.claims?.sub) {
      const claims = data.claims as { sub: string; email?: string };
      return { id: claims.sub, email: claims.email ?? null };
    }
  } catch {
    // Fall through — an older Supabase project without asymmetric signing
    // keys cannot verify locally, and must use the network path.
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user ? { id: user.id, email: user.email ?? null } : null;
});

/** Current user's profile row — the authority on role and account state. */
export const getCurrentProfile = cache(async (): Promise<Profile | null> => {
  const user = await getCurrentUser();
  if (!user) return null;

  // Shares the single user-scoped round trip with the plan and
  // entitlement loaders — see src/auth/user-context.ts.
  const { profile } = await getUserContext(user.id);
  return profile;
});

// Defined in @/auth/errors so the permission matrix can throw them
// without importing this module's Supabase and environment dependencies.
export { UnauthorizedError, ForbiddenError };

/** Throws UnauthorizedError if there is no session. */
export async function requireUser() {
  const user = await getCurrentUser();
  if (!user) throw new UnauthorizedError();
  return user;
}

/**
 * Requires a signed-in user whose account is in good standing.
 *
 * Suspended and disabled accounts keep a technically valid JWT until it
 * expires, so every entry point that does real work has to re-check the
 * profile's status rather than trusting that sign-in refused them.
 */
export async function requireActiveProfile(): Promise<Profile> {
  const profile = await getCurrentProfile();
  if (!profile) throw new UnauthorizedError();
  if (profile.status !== "active") {
    throw new ForbiddenError(`Account status is '${profile.status}'`);
  }
  return profile;
}

/** Requires one of the given roles, and an active account. */
export async function requireRole(...roles: Role[]): Promise<Profile> {
  const profile = await requireActiveProfile();
  if (!roles.includes(profile.role as Role)) throw new ForbiddenError();
  return profile;
}

/** Moderator or super admin — i.e. anyone who may reach a staff portal. */
/**
 * A staff member, verified for a privileged operation.
 *
 * The MFA gate runs here as well as on the pages. It used to run *only* on
 * pages, which meant an authenticated-but-not-stepped-up staff session was
 * redirected by the console yet could still POST directly to any admin
 * server action — suspend an account, change a price, grant a plan. The
 * redirect looked like enforcement and was not.
 */
export async function requireStaff(): Promise<Profile> {
  const profile = await requireRole("moderator", "super_admin");
  await assertStaffGate(profile);
  return profile;
}

/**
 * @deprecated Prefer `requireStaff()` (staff portals) or
 * `requireSuperAdmin()` (privileged operations). Kept as an alias so the
 * intent at each call site has to be stated explicitly.
 */
export const requireAdmin = requireStaff;

export async function requireSuperAdmin(): Promise<Profile> {
  const profile = await requireRole("super_admin");
  await assertStaffGate(profile);
  return profile;
}

export async function requireModerator(): Promise<Profile> {
  return requireRole("moderator", "super_admin");
}

/**
 * Page-level guards that redirect instead of throwing.
 *
 * Next renders a layout and its page concurrently, so a page that *throws*
 * ForbiddenError can produce a 500 before the layout's `redirect()` wins
 * the race. For a rendered page the correct outcome is a redirect, every
 * time — so pages use these and let the throwing variants stay where an
 * exception is the right answer: route handlers and server actions, which
 * are APIs and must return a status code, not a redirect.
 *
 * These are still real checks, not decoration: each one re-reads the
 * profile from the database rather than trusting the layout ran.
 */
export async function requireSuperAdminPage(locale: string): Promise<Profile> {
  const profile = await getCurrentProfile();
  // Unauthenticated and non-staff callers both go to the staff entrance,
  // never the customer login — the consoles are a separate front door.
  if (!profile) redirect(staffPortalHref("/staff/login", locale));
  if (profile.status !== "active") redirect(`${staffPortalHref("/staff/login", locale)}?error=not_staff`);
  if (profile.role === "moderator") redirect(staffPortalHref("/moderator", locale));
  if (profile.role !== "super_admin") redirect(`${staffPortalHref("/staff/login", locale)}?error=not_staff`);
  // Temporary password replaced, authenticator enrolled, and this session
  // actually stepped up to aal2 — see src/auth/staff-gate.ts.
  await requireStaffGate(profile, locale);
  return profile;
}

export async function requireStaffPage(locale: string): Promise<Profile> {
  const profile = await getCurrentProfile();
  if (!profile) redirect(staffPortalHref("/staff/login", locale));
  if (profile.status !== "active") redirect(`${staffPortalHref("/staff/login", locale)}?error=not_staff`);
  if (profile.role !== "moderator" && profile.role !== "super_admin") {
    redirect(`${staffPortalHref("/staff/login", locale)}?error=not_staff`);
  }
  await requireStaffGate(profile, locale);
  return profile;
}
