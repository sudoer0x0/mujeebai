/**
 * Authorization errors.
 *
 * These live apart from `@/auth/session` on purpose. The permission matrix
 * needs to *throw* ForbiddenError, but it has no business loading a
 * Supabase client, validating environment variables, or reaching a
 * database — and importing the session module for one error class dragged
 * all of that in behind it. That coupling made the matrix untestable in
 * isolation: a unit test of "may a moderator change a price" had to
 * provide Supabase credentials to find out.
 *
 * `@/auth/session` re-exports both names, so existing imports keep working.
 */

export class UnauthorizedError extends Error {
  constructor(message = "Authentication required") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

export class ForbiddenError extends Error {
  constructor(message = "You do not have permission to perform this action") {
    super(message);
    this.name = "ForbiddenError";
  }
}
