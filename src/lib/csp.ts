/**
 * Content Security Policy, built per request with a nonce.
 *
 * ## Why this cannot be a static header
 *
 * The App Router streams its RSC payload to the browser as a series of
 * inline `<script>self.__next_f.push(...)</script>` tags. That is not
 * incidental — it is how the client receives the component tree at all.
 *
 * A policy of `script-src 'self'` therefore blocks the framework itself:
 * the flight stream is truncated, React reports "Connection closed", and
 * **nothing on the page ever renders or hydrates**. Every button, form,
 * dialog and link silently does nothing. This app shipped with exactly
 * that policy and was, as a result, completely non-interactive in a real
 * browser — while still returning a perfectly healthy 200 and full HTML
 * to `curl`, which does not enforce CSP.
 *
 * The fix is a nonce rather than `'unsafe-inline'`. Next reads the nonce
 * back out of the *request's* CSP header and stamps it onto the scripts
 * it emits, so its own inline scripts run and an injected one still does
 * not. `'unsafe-inline'` would also have fixed the symptom, at the cost of
 * making script-src meaningless.
 *
 * ## Trade-off
 *
 * A per-request nonce means pages carrying it cannot be served from the
 * static prerender cache — they render per request. That is the right
 * trade here: nearly every page already reads cookies for the session and
 * is dynamic regardless.
 */

/** Generates a fresh base64 nonce. Web Crypto so it works on the edge. */
/**
 * Paystack's inline checkout.
 *
 * Deliberately narrow: one script origin and the two origins their modal
 * loads from. This is the documented integration, and it is the reason the
 * card form is an iframe served by Paystack rather than inputs in this
 * app — a payment page that collects card fields itself is a PCI scope
 * nobody here wants.
 */
const PAYSTACK_SCRIPT = "https://js.paystack.co";
const PAYSTACK_FRAME = "'self' https://checkout.paystack.com https://js.paystack.co";

export function generateNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}

export function buildContentSecurityPolicy(nonce: string, isDev: boolean): string {
  return [
    "default-src 'self'",

    // `'self'` covers same-origin `<script src>` — Next's chunks and
    // /theme-init.js — while the nonce covers the inline scripts Next
    // emits for the RSC payload. Deliberately NOT `'strict-dynamic'`:
    // that directive makes browsers ignore `'self'`, which would require
    // every external script to carry the nonce too. A per-request nonce
    // rendered into the component tree is a guaranteed hydration mismatch
    // (the server's value and the client's re-render never agree), so
    // keeping `'self'` lets external scripts stay nonce-free.
    //
    // `'unsafe-eval'` is development-only: Next's React Refresh runtime
    // evaluates its hot-reload payload with `eval`, and without it the dev
    // bundle refuses to load. Production builds contain no eval, so the
    // deployed policy stays strict.
    isDev
      ? `script-src 'self' 'nonce-${nonce}' 'unsafe-eval' ${PAYSTACK_SCRIPT}`
      : `script-src 'self' 'nonce-${nonce}' ${PAYSTACK_SCRIPT}`,

    // React's `style={{...}}` prop and several Radix primitives set inline
    // style attributes at runtime. A materially lower-risk allowance than
    // the script-src equivalent, and one there is no nonce path for.
    "style-src 'self' 'unsafe-inline'",

    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",

    // ws:/wss: is the dev server's hot-reload socket.
    isDev
      ? "connect-src 'self' ws: wss: https://*.supabase.co https://openrouter.ai https://api.cloudflare.com https://api.paystack.co"
      : "connect-src 'self' https://*.supabase.co https://openrouter.ai https://api.cloudflare.com https://api.paystack.co",

    // Paystack's checkout runs in their iframe, which is what keeps card
    // details out of this application's DOM entirely — the app never sees
    // a card number, so it never has to be trusted with one. Only their
    // origins are allowed to frame in.
    `frame-src ${PAYSTACK_FRAME}`,
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join("; ");
}
