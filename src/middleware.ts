import createIntlMiddleware from "next-intl/middleware";
import { NextRequest, NextResponse } from "next/server";
import { routing } from "@/i18n/routing";
import { updateSupabaseSession } from "@/lib/supabase/middleware";
import { safeNextPath } from "@/lib/safe-redirect";
import { buildContentSecurityPolicy, generateNonce } from "@/lib/csp";
import { resolveInitialLocale } from "@/i18n/region-locale";
import { STAFF_SEEN_COOKIE, STAFF_IDLE_TIMEOUT_MS, isStaffSessionIdle } from "@/auth/staff-idle";
import { adminPortalSlug, staffPortalSlug, isStaffSegment, resolveInternalPath, areaForPath, portalPrefix } from "@/auth/portal-path";

const intlMiddleware = createIntlMiddleware(routing);

/**
 * Route segments that require a session.
 *
 * This is a UX redirect, not an authorization boundary — role checks
 * happen in each portal's layout *and* independently in every server
 * action and route handler underneath. Middleware runs on the edge with
 * no database access, so it can only answer "is there a session at all".
 */
// `staff` is absent on purpose: /staff/login must stay reachable to a
// signed-out operator. The consoles under /admin and /moderator do their
// own (stricter, role-aware) checks server-side.
const PROTECTED_SEGMENTS = ["chat", "settings", "admin", "moderator"];

/**
 * Segments whose sign-in page is the staff entrance, not the customer one.
 *
 * A signed-out operator opening their /admin bookmark must land on
 * /staff/login. Sending them to the customer form would put staff and
 * customers through the same door — the thing the separate entrance
 * exists to prevent — and would hand them a page offering "create an
 * account", which is meaningless for a role that can only be granted
 * from the CLI.
 */
const STAFF_SEGMENTS = ["admin", "moderator"];

function isStaffPath(pathname: string) {
  const withoutLocale = stripLocale(pathname);
  return STAFF_SEGMENTS.some(
    (segment) => withoutLocale === `/${segment}` || withoutLocale.startsWith(`/${segment}/`),
  );
}

function stripLocale(pathname: string) {
  return pathname.replace(/^\/[a-z]{2}(?=\/|$)/, "");
}

function isProtectedPath(pathname: string) {
  const withoutLocale = stripLocale(pathname);
  return PROTECTED_SEGMENTS.some(
    (segment) => withoutLocale === `/${segment}` || withoutLocale.startsWith(`/${segment}/`),
  );
}

export default async function middleware(request: NextRequest) {
  // API routes: refresh the session and nothing else.
  //
  // These used to be excluded from middleware entirely, which meant every
  // API route refreshed the Supabase session independently. Refresh
  // tokens are **single-use**, so two requests in flight together — a page
  // navigation and an <img src="/api/attachments/…">, say — would race:
  // one rotated the token, the other presented the now-spent one and got
  // a 401. It showed up as attachments and generated images
  // intermittently failing to load.
  //
  // Refreshing here means it happens once per request cycle, before the
  // handler runs. No locale rewriting and no redirect: an API must answer
  // with a status code, not bounce the caller to a login page.
  if (request.nextUrl.pathname.startsWith("/api/")) {
    const { response } = await updateSupabaseSession(request, NextResponse.next());
    return response;
  }

  // 0. The staff portals' secret prefixes.
  //
  // Two secrets: one for the super admin console, one for the moderator
  // console, so learning the moderator URL does not reveal the admin one.
  // `resolveInternalPath` enforces that asymmetry — the staff slug may
  // reach `/moderator` and `/staff`, but only the admin slug reaches
  // `/admin`.
  //
  // Three rules:
  //   - a prefixed URL is *rewritten* to the internal route, so the app's
  //     file-based routing is untouched;
  //   - the internal route, requested directly, is answered with 404 —
  //     not a redirect, which would hand the secret to whoever probed;
  //   - a slug used for an area it does not guard is also 404.
  //
  // The rewrite is applied to the request before anything else reads the
  // path, so next-intl, the session refresh and the auth check below all
  // reason about the internal route. Redirects those produce are
  // re-prefixed on the way out (see `toPublicPath`).
  const anySlug = Boolean(adminPortalSlug() || staffPortalSlug());
  let internalRequest = request;
  let portalRewrite = false;
  /**
   * Which console this request was addressed to.
   *
   * Derived from the *secret* the request arrived through, never from the
   * path: `/staff/login` is served under both entrances, so reading the
   * path always says "staff" and the super admin door labelled itself as
   * the moderator one.
   */
  let entranceArea: "admin" | "staff" | null = null;

  if (anySlug) {
    const pathname = request.nextUrl.pathname;
    const localeMatch = pathname.match(/^\/[a-z]{2}(?=\/|$)/);
    const localePart = localeMatch ? localeMatch[0] : "";
    const rest = pathname.slice(localePart.length) || "/";

    if (isStaffSegment(rest)) {
      // The canonical path while a secret one is configured. 404, so the
      // response is indistinguishable from a route that does not exist.
      return new NextResponse(null, { status: 404 });
    }

    const segments = rest.split("/").filter(Boolean);
    const candidate = segments[0] ?? "";
    const inner = `/${segments.slice(1).join("/")}`;

    if (candidate && isStaffSegment(inner)) {
      const internal = resolveInternalPath(candidate, inner);
      if (!internal) return new NextResponse(null, { status: 404 });

      entranceArea = candidate === adminPortalSlug() ? "admin" : "staff";

      const rewritten = request.nextUrl.clone();
      rewritten.pathname = `${localePart}${internal}`;
      internalRequest = new NextRequest(rewritten, request);
      portalRewrite = true;
    }
  }

  /** Puts the right secret prefix back onto a path the pipeline produced. */
  const toPublicPath = (pathname: string): string => {
    if (!anySlug) return pathname;
    const localeMatch = pathname.match(/^\/[a-z]{2}(?=\/|$)/);
    const localePart = localeMatch ? localeMatch[0] : "";
    const rest = pathname.slice(localePart.length) || "/";
    const area = areaForPath(rest);
    return area ? `${localePart}${portalPrefix(area)}${rest}` : pathname;
  };

  // 1. Mint a nonce and put the CSP on the *request* headers.
  //
  // Next reads the policy back off the request to discover the nonce and
  // stamps it onto the inline scripts it emits — including the ones
  // carrying the RSC payload. Without this the framework's own scripts are
  // blocked and the page never hydrates. See src/lib/csp.ts.
  const nonce = generateNonce();
  const csp = buildContentSecurityPolicy(nonce, process.env.NODE_ENV !== "production");

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("content-security-policy", csp);

  // Which console this request is addressed to, derived from the secret
  // it arrived through. Set on the *request* so Server Components and
  // Server Actions can read it with `headers()` — and deliberately not
  // sent to the browser, which must not be able to state its own area.
  // The header is stripped and re-set here on every request, so a client
  // that sends `x-portal-area` cannot smuggle one in.
  requestHeaders.delete("x-portal-area");
  // Set only when the request actually came through a secret entrance.
  //
  // With no secrets configured — local development — there is one shared
  // door and no area to report. Inferring one from the path would be
  // worse than saying nothing: `/staff/login` reads as "staff", so a
  // super admin signing in locally would be refused for using the "wrong"
  // entrance when no wrong entrance exists. Absent means "not applicable",
  // and both the label and the entrance rule treat it that way.
  if (entranceArea) requestHeaders.set("x-portal-area", entranceArea);

  // 1b. Pick the initial language from the visitor's region.
  //
  // Only for a visitor who has never chosen one: next-intl writes
  // MUJEEB_LOCALE when a language is picked, and while that cookie exists
  // it wins over everything here. That is what makes a chosen language
  // stick until it is changed again.
  //
  // The mechanism is to rewrite Accept-Language rather than to redirect
  // here directly, so next-intl keeps doing the routing, prefixing and
  // cookie-setting it already does correctly — this only changes the
  // preference it negotiates against. See src/i18n/region-locale.ts for
  // why country beats Accept-Language for the default.
  const hasLocalePrefix = /^\/[a-z]{2}(?=\/|$)/.test(internalRequest.nextUrl.pathname);
  const hasLocaleCookie = request.cookies.has("MUJEEB_LOCALE");

  if (!hasLocalePrefix && !hasLocaleCookie) {
    const initial = resolveInitialLocale(request.headers);
    requestHeaders.set("accept-language", `${initial};q=1.0`);
  }

  const requestWithNonce = new NextRequest(internalRequest, { headers: requestHeaders });

  // 2. Let next-intl resolve/rewrite the locale.
  const intlResponse = intlMiddleware(requestWithNonce);

  // 3. Refresh the Supabase session onto the response next-intl produced,
  // so both concerns land on the single response Next.js will send.
  const { response, user } = await updateSupabaseSession(internalRequest, intlResponse);

  const internalPathname = internalRequest.nextUrl.pathname;

  if (isProtectedPath(internalPathname) && !user) {
    const localeMatch = internalPathname.match(/^\/([a-z]{2})(?=\/|$)/);
    const locale = localeMatch ? localeMatch[1] : routing.defaultLocale;

    const staff = isStaffPath(internalPathname);

    // Send them to the entrance that matches where they were going.
    //
    // `/staff/login` is served under both secrets, and `toPublicPath`
    // alone would always pick the moderator one — so a super admin
    // opening their `/{adminSlug}/admin` bookmark was bounced to the
    // *moderator* entrance. They could still sign in, but the page then
    // had the wrong slug in its URL, and everything built from it was
    // wrong too.
    const area = areaForPath(stripLocale(internalPathname));
    const loginPath = staff
      ? `/${locale}${portalPrefix(area ?? "staff")}/staff/login`
      : `/${locale}/login`;
    const loginUrl = new URL(loginPath, request.url);
    // Preserve where they were headed, normalized so a crafted link can't
    // turn the post-login redirect into an off-site hop.
    loginUrl.searchParams.set(
      "next",
      safeNextPath(stripLocale(internalPathname), staff ? "/admin" : "/chat"),
    );
    return NextResponse.redirect(loginUrl);
  }

  // Idle cut-off for the consoles.
  //
  // Enforced here rather than only in the page, so it holds with
  // JavaScript disabled and against a replayed session cookie. The page's
  // heartbeat keeps this fresh while someone is actually present; see
  // src/auth/staff-idle.ts for why both halves are needed.
  //
  // Customer routes are deliberately exempt: ending someone's own chat
  // session because they read slowly is hostile, and the blast radius of
  // a customer session is their own account.
  const onStaffSurface = isStaffSegment(stripLocale(internalPathname));

  if (onStaffSurface && user) {
    const seen = request.cookies.get(STAFF_SEEN_COOKIE)?.value;

    if (isStaffSessionIdle(seen)) {
      const localeMatch = internalPathname.match(/^\/([a-z]{2})(?=\/|$)/);
      const locale = localeMatch ? localeMatch[1] : routing.defaultLocale;
      const timedOut = new URL(toPublicPath(`/${locale}/staff/login`), request.url);
      timedOut.searchParams.set("error", "idle");

      const bounce = NextResponse.redirect(timedOut);
      // Clear the marker so the next sign-in starts a fresh window. The
      // Supabase session itself is ended by the sign-out on the login
      // page; leaving the cookie would immediately re-trip this.
      bounce.cookies.delete(STAFF_SEEN_COOKIE);
      return bounce;
    }

    // Advance the marker on every staff navigation. This is what makes an
    // operator who is clicking around never see the timeout at all.
    response.cookies.set(STAFF_SEEN_COOKIE, String(Date.now()), {
      httpOnly: true,
      sameSite: "strict",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: Math.ceil(STAFF_IDLE_TIMEOUT_MS / 1000),
    });
  }

  // A redirect the pipeline produced (next-intl adding a locale prefix,
  // most often) points at the internal path. Send the browser to the
  // public one instead, or the very next request 404s.
  const location = response.headers.get("location");
  if (anySlug && location) {
    const target = new URL(location, request.url);
    if (target.origin === request.nextUrl.origin) {
      const publicPath = toPublicPath(target.pathname);
      if (publicPath !== target.pathname) {
        target.pathname = publicPath;
        response.headers.set("location", target.toString());
      }
    }
  }

  // Apply the rewrite last, carrying over every cookie and header the
  // pipeline set. Building a fresh response and copying would drop the
  // refreshed Supabase session cookies.
  if (portalRewrite) {
    response.headers.set("x-middleware-rewrite", internalRequest.nextUrl.toString());
  }

  // The response must carry the same policy the request advertised.
  response.headers.set("content-security-policy", csp);
  return response;
}

export const config = {
  matcher: [
    // Everything except static files and Next internals. API routes are
    // deliberately included — see the note at the top of the handler for
    // why excluding them broke session refresh.
    "/((?!_next|_vercel|.*\\..*).*)",
  ],
};
