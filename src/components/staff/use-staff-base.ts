"use client";

import { usePathname } from "@/i18n/navigation";

/**
 * The secret portal prefix, recovered from the URL rather than the build.
 *
 * Client code needs to build staff links (a redirect after sign-in, a
 * bounce back to the login page) but must not be *told* the secret — a
 * `NEXT_PUBLIC_` variable is inlined into the JavaScript every visitor
 * downloads, marketing homepage included, which would publish it to
 * exactly the people it is hidden from.
 *
 * So it is derived instead: any staff page is, by definition, already
 * being served at the prefixed URL, so the browser already has it. This
 * returns `""` or `"/slug"` — everything before the first staff segment.
 *
 * `usePathname` here is next-intl's, which has already stripped the
 * locale, so the prefix is whatever precedes `/admin`, `/moderator` or
 * `/staff`.
 */
export function useStaffBase(): string {
  const pathname = usePathname();
  const match = pathname.match(/^(.*?)\/(?:admin|moderator|staff)(?:\/|$)/);
  return match?.[1] ?? "";
}
