# Security

This document describes the security architecture and threat model for Mujeeb AI, and what to do if something goes wrong. It complements `ARCHITECTURE.md` (which explains the *design*) by focusing specifically on the *security* reasoning behind that design, and on operational/incident-response guidance.

## Reporting a vulnerability

If you find a security issue in this codebase before it's in production, open an issue or contact the project owner directly rather than filing it publicly. Once deployed, add a real disclosure contact (email or a security.txt) here — this template does not ship with one because no production domain/contact existed at build time.

## Threat model summary

Assets to protect: user account credentials and sessions, user conversation content (which may include uploaded documents), payment/subscription state, admin privileges, and the AI provider/service credentials themselves. Primary adversaries considered: an unauthenticated attacker probing the public app; an authenticated regular user attempting to access another user's data or to escalate privileges; a malicious or compromised file upload attempting to inject instructions into the AI or exfiltrate data; a third party attempting to forge a payment webhook; and an attacker who gains read access to the repository or environment (the "no load-bearing secret in git" concern).

## Authentication

Authentication is delegated entirely to Supabase Auth rather than hand-rolled — password hashing, session token issuance/rotation, and email verification are Supabase's responsibility, not this codebase's. The app's job is: correctly read/write the session cookie (`@supabase/ssr`), correctly refresh it on every request (`updateSupabaseSession()` in `src/middleware.ts`), and never trust client-supplied identity claims.

- Sessions are cookie-based (not localStorage tokens), reducing exposure to XSS-based token theft.
- `src/auth/session.ts`'s `requireUser()`/`requireAdmin()`/`requireSuperAdmin()` are the only sanctioned way for server code to assert "who is calling this," and they re-derive identity from the Supabase session on the server on every call — no request ever carries a trusted "I am user X" claim from the client.
- Password reset and magic-link flows go through Supabase Auth's own token issuance (`supabase.auth.admin.generateLink`), not custom token generation.

## Authorization

Two layers, both enforced server-side:

1. **Row Level Security (RLS)** in Postgres (`supabase/migrations/0002_row_level_security.sql`) is the last line of defense: even if application code has a bug that forgets a `.eq("user_id", ...)` filter, the database itself refuses to return or modify another user's rows for a non-service-role connection. Every user-data table has RLS enabled. `private.is_admin()`/`private.is_super_admin()` centralize the admin check used across policies. They live in a `private` schema, **not** `public`: PostgREST only exposes configured schemas, so a helper placed there is callable from inside a policy but unreachable as `/rest/v1/rpc/is_admin`. (Migration `0008` first tried to close that RPC by revoking EXECUTE instead — which broke all sixteen policies that call it, since policy evaluation needs the grant too. `0009` is the correct fix. Placement, not permission.)
2. **Application-level authorization** re-checks the same thing in every server action/route handler (`requireUser`/`requireStaff`/`requireSuperAdmin`, and for privileged actions, `assertPermission()` against the `ADMIN_ACTIONS` matrix plus `assertCanActOn()` for *who the action targets*).

   `assertCanActOn` covers three rules the role matrix cannot express: a moderator may never act on a staff account (without it, "moderators may suspend users" lets a moderator suspend a Super Admin); nobody may aim a destructive action at their own account; and a Super Admin's role cannot be changed from the console at all.

   Server Actions are POST endpoints with stable ids, reachable by anyone who can read the page bundle — so conditionally rendering a menu item is a UI nicety and these checks are the boundary. This is intentionally redundant with RLS — middleware-level route protection is a UX convenience (redirect to `/login`), never the actual security boundary, since middleware can be misconfigured or bypassed by directly hitting an API route.

**The `profiles.role` and `profiles.status` columns cannot be written by a normal user connection at all** — a database trigger (`profiles_guard_privileged_fields`, in `0001_core_schema.sql`) rejects any attempt to change those fields except from the service-role connection. Role changes only happen through `admin_roles` table inserts (which themselves require `users.modify_role`/`moderators.create` permission and are audit-logged), and a trigger (`sync_profile_role_from_admin_roles`) keeps `profiles.role` in sync from there. This means there is no code path — buggy or otherwise — where a user can PATCH their own row into `role: "super_admin"`.

## The Super Admin bootstrap

The first Super Admin is deliberately **not** creatable through any web UI or public API (master spec #29). `scripts/super-admin.ts` is the only path, and it requires both `SUPER_ADMIN_SETUP_TOKEN` — a secret the operator generates, held only in environment variables — and the Supabase service-role key.

The three scripts this replaced each had a real weakness, worth recording so they are not reintroduced. The token was only enforced *if it happened to be set* (`if (expectedToken && token !== expectedToken)`), so on a deployment that never configured one, anybody able to run the script could mint themselves an administrator with no secret at all. Passwords were accepted as `--password`, putting them in shell history and in every other process's view of the process table, and the interactive prompt echoed them. And `listUsers()` was unpaginated, so past 50 accounts an existing operator looked like a new one and the script took the wrong branch.

The token is now mandatory, compared with `crypto.timingSafeEqual`, passwords are read only from a prompt with echo disabled, and user lookup pages through every result. The action is audit-logged (`admin.super_admin_bootstrap`) with `actor_id: null` to distinguish it from a normal admin-granted-by-another-admin event. **Rotate `SUPER_ADMIN_SETUP_TOKEN` after using it** — the script reminds the operator to do this on success.

## Admin security

Every admin mutation passes through `assertPermission()` before touching data, and every admin mutation — success or failure — is written to `admin_audit_logs` via `recordAuditEvent()` (actor, action, target type/id, result, metadata, timestamp). Destructive user-moderation actions (suspend/restore/disable) additionally write to `moderation_records`. The audit log is append-only, enforced by a database trigger rather than by RLS — the service role bypasses RLS, so a policy would not have held, and an audit log an administrator can quietly edit is not an audit log.

A database trigger also refuses to remove the last active Super Admin, so the platform cannot be locked out of its own administration through the console, a script, or a manual SQL edit.

The permission matrix (`ADMIN_ACTIONS` in `src/admin/permissions.ts`) distinguishes `moderator` from `super_admin` for exactly the actions the master spec calls out as higher-risk (creating other moderators, deleting users, modifying billing plans) — moderators get user-moderation and content-review actions; only super admins can create other admins or change platform-wide settings/plans/system prompt.

## Secrets handling

- Configuration is split across **two modules**, so the boundary is enforced by the build rather than by discipline. `src/lib/env.ts` is browser-safe and reads only `NEXT_PUBLIC_*` through explicit member accesses; `src/lib/env.server.ts` carries `import "server-only"`, so a Client Component that imports a secret — directly or through a chain of imports — fails the build. The previous single module handed the entire `process.env` object to a schema that listed every secret by name; it did not leak (Next only inlines literal member accesses) but nothing about it was structurally safe.
- `.env.example` documents every variable and what it unlocks, but contains no real values. `.gitignore` excludes `.env*` except `.env.example` explicitly (`!.env.example`).
- `SUPABASE_SERVICE_ROLE_KEY` is the single most sensitive value in this codebase — it bypasses RLS entirely. It is used only in `createServiceRoleClient()` call sites (admin actions, the usage RPC, webhooks, the bootstrap script) and the codebase deliberately minimizes those call sites (see `ARCHITECTURE.md`'s RLS-vs-service-role section) so that an audit of "everywhere RLS can be bypassed" stays a short list.
- `npm run check-env` reports which optional providers are configured without ever printing a secret value, so operators can verify configuration in logs/CI without secret exposure.
- The structured logger (`src/lib/logger.ts`) redacts keys matching common secret-name patterns (`password`, `token`, `secret`, `key`, etc.) before writing any log line, as defense in depth against accidentally logging a payload that contains a credential.

## File upload security

`src/files/validate.ts` enforces file type and size limits before any processing occurs. `classifyFile()` requires the extension and the client-declared MIME type to *agree* when both are present (an earlier version accepted either signal alone, which meant a `.pdf` filename with a spoofed declared type could still validate) — a mismatch is rejected outright, the same as an unrecognized type. The function also returns a server-chosen canonical MIME type, and that — never the client's raw declared `file.type` — is what's actually written to Supabase Storage's object metadata and the `attachments.mime_type` column, so a spoofed declared type can't cause a later direct fetch of the object to be interpreted as something more dangerous than its validated kind. Filenames are sanitized (path separators and control characters stripped) *before* an extension is ever derived from them, so a crafted filename can't produce an extension containing unexpected characters. `src/app/api/files/route.ts` also rejects an obviously-oversized request by its `Content-Length` header before parsing the multipart body into memory at all, in addition to the authoritative size check once the file's actual size is known.

Per-format processors (`src/files/processors/`) parse PDF/DOCX/XLSX/PPTX/CSV/plain-text content using dedicated libraries (`pdf-parse`, `mammoth`, `xlsx`, `jszip`) rather than executing anything from the uploaded file — there is no code path that evaluates or executes content extracted from a user file. A processing failure is logged server-side with full detail and returns only a generic, translatable error to the client — the underlying library's raw error message (which can include internal detail) is never returned directly (see "Error handling" below). Files are stored in a private Supabase Storage bucket (not public), accessed only via short-lived signed URLs (`storage/supabase-storage.ts`'s `getSignedUrl`), never a permanent public link.

Known residual gap: there's no magic-byte/content-sniffing check (the file's actual bytes are never inspected against its claimed type, only the extension+declared-MIME pair), and ZIP-based formats (`.pptx`/`.xlsx`) have no decompression-size bound — a crafted archive within the upload size limit could still decompress to something much larger in memory. Both are documented here rather than fixed, given the size of the change either would need relative to its risk today.

## Prompt injection protection

Text extracted from user-uploaded documents is treated as untrusted data, not as instructions, when it's included in a model's context. The extraction pipeline wraps document content (`wrapUntrustedDocument()` in `src/files/processors/index.ts`, called from `src/app/api/chat/route.ts`) with explicit framing that tells the model the enclosed text is untrusted document content supplied by the user, not a system or developer instruction — this is a mitigation, not a guarantee, since prompt injection cannot be fully solved by framing alone; treat any future "the AI took an unexpected action based on document content" report as a priority security bug. Known residual gap: the wrapper's begin/end markers are static text, so a sufficiently crafted document could in principle embed a fake end-marker followed by injected instruction text to try to "escape" the framing — a nonce-based or otherwise unpredictable delimiter would raise the bar further; not implemented yet.

## Payment / webhook security

`src/billing/paystack.ts`'s `verifyWebhookSignature()` validates every incoming Paystack webhook using HMAC-SHA512 against `PAYSTACK_WEBHOOK_SECRET`, using a constant-time comparison, before any webhook payload is trusted or acted upon (`src/app/api/billing/webhook/route.ts`). Past signature verification, the payload is also validated against a Zod schema — a signature proves the payload came from Paystack, not that it's shaped the way the handler expects, and a malformed-but-validly-signed (or unexpectedly-shaped, e.g. after a future Paystack API change) payload is rejected with a 400 rather than risking a partial/bad write; `metadata.userId`/`metadata.planId` specifically are validated as UUIDs. Webhook processing is written to be idempotent (safe to receive the same event twice) since webhook delivery is at-least-once by design on Paystack's side, not exactly-once. See `HANDOFF.md` for the one known incomplete piece of the billing flow (subscription cancellation's `email_token` requirement) — that gap is a functionality gap, not a signature-verification gap; the webhook verification itself is complete.

## Rate limiting and abuse prevention

`src/lib/rate-limit.ts` provides a best-effort, in-memory, fixed-window limiter, explicitly documented in its own file as non-global (it does not coordinate across multiple serverless instances or regions) — before real launch, replace it with a distributed limiter (e.g. Upstash Redis, or a Vercel/Cloudflare edge-level rate limit). It's wired into every cost- or abuse-sensitive endpoint: the auth server actions (`signUpAction`/`signInAction`/`magicLinkAction`/`requestPasswordResetAction` in `src/app/[locale]/(auth)/actions.ts`, keyed by client IP via `src/lib/request-ip.ts`), and the chat, regenerate, image-generation, file-upload, and billing-checkout routes (keyed by user id, since those are all behind auth already). A dedicated security review found this limiter had been built but never actually called from any route — the gap was "no rate limiting exists in practice," not "the rate limiting isn't distributed" — before it was wired in as described here.

The entitlement/usage-quota engine (`src/usage/quota.ts`) is a separate, complementary control — it prevents cost abuse via legitimate accounts exceeding their plan's allowance. `consumeQuota()` calls `try_consume_usage` (`0006_security_hardening.sql`), an atomic Postgres RPC restricted to the service role that performs the "is this under the limit" check and the increment (or reverts it if that would exceed the limit) as one statement, so concurrent requests from the same user can't all pass a read-based check before any of them writes. An earlier version of `consumeQuota` called a separate read-only pre-check and only then incremented via a plain atomic-increment RPC (`increment_usage_counter`) — the increment itself was atomic, but the check-then-increment *pattern* around it wasn't, which is exactly the race this function exists to close.

## Security headers / transport security

`next.config.ts` sets `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, a strict `Referrer-Policy`, and a `Permissions-Policy` that denies camera/microphone/geolocation. API routes get `default-src 'none'` so a response can never be interpreted as an executable page.

### Content Security Policy — read this before changing it

The page CSP is **not** a static header. It is built per request in `src/middleware.ts` from `src/lib/csp.ts`, with a fresh nonce.

This is not incidental complexity. A previous version set `script-src 'self'` with no nonce and no `unsafe-inline`, under a comment asserting that the app contains no inline scripts. The Next.js App Router streams its RSC payload to the browser as inline `<script>self.__next_f.push(...)</script>` tags — that is *how* the client receives the component tree. Every one was blocked, the flight stream truncated, and React never hydrated on any page: the application was completely non-interactive in a browser while still returning healthy 200s and full HTML to `curl`.

The current policy:

- **`script-src 'self' 'nonce-<per-request>'`** — `'self'` admits same-origin `<script src>` (Next's chunks, `/theme-init.js`); the nonce admits Next's own inline scripts and nothing else. No `'unsafe-inline'`.
- **No `'strict-dynamic'`.** It makes browsers ignore `'self'`, which would force a nonce onto external scripts too — and a per-request nonce rendered into the React tree can never match on re-render, producing a hydration mismatch.
- **`'unsafe-eval'` in development only.** Next's React Refresh runtime evaluates its hot-reload payload with `eval`. Production builds contain no `eval` and the deployed policy stays strict. `buildContentSecurityPolicy()` takes `isDev` explicitly so this cannot leak into production by accident.
- **`style-src` keeps `'unsafe-inline'`** in both modes: React's `style={{...}}` prop and several Radix primitives set inline style attributes at runtime, and there is no nonce path for those. A materially lower-risk allowance than the script-src equivalent.

Any change here must be verified in a real browser with the console open. `npm run verify` passes regardless — it never executes the page.

## Error handling / information leakage

`src/app/global-error.tsx` and the locale-scoped `not-found.tsx` pages show a generic message rather than a stack trace to end users. API routes that touch the database use `dbErrorResponse()` (`src/lib/api-errors.ts`) rather than returning a raw Postgres/Supabase `error.message` to the client — the real error is logged server-side (via `src/lib/logger.ts`, with redaction, see below) and the client gets a generic, translatable key. File-processing failures follow the same pattern (`src/files/processors/index.ts`): the underlying library's raw error (which can include internal detail) is logged, never returned. A dedicated security review found several routes returning `error.message` directly before this pattern was applied consistently — any *new* route handler should use `dbErrorResponse()` (or the same pattern) rather than reintroducing that.

## Known security-relevant gaps

- **Rate limiting is per-instance.** `src/lib/rate-limit.ts` is an in-memory map, so on Vercel each lambda keeps its own and the effective limit is `limit x instances`. Usage quotas — database-backed and atomic via `try_consume_usage` — are the real control; the rate limiter is burst protection in front of it. Move it to a shared store before it needs to be exact.
- **Leaked-password protection is disabled** in Supabase Auth. Enable it (Dashboard -> Authentication -> Policies) before launch; it checks new passwords against HaveIBeenPwned.
- **Payments have not been exercised end to end.** Signature verification, idempotency and the state machine are implemented and reviewed, but no live Paystack charge has been put through this deployment. Do that before taking real money.
- **`xlsx` (SheetJS) is pinned at 0.18.5 with two unpatched high-severity advisories** — prototype pollution (GHSA-4r6h-8v6p-xvw6) and ReDoS (GHSA-5pgg-2g8v-p4x9) — and it parses files that any authenticated user uploads. SheetJS stopped publishing to the npm registry after 0.18.5, which is why `npm audit` says "no fix available".

  **Mitigated, not fixed.** The parse runs in a worker thread (`src/files/processors/xlsx-worker.ts`), a separate V8 isolate: prototype pollution corrupts the worker's own `Object.prototype` and is destroyed with it, and a 15-second kill bounds a ReDoS input. The kill is only possible off-thread — `XLSX.read` is synchronous, so an in-process timeout could never fire. The worker also runs with `env: {}`, so a compromised parser cannot read `SUPABASE_SERVICE_ROLE_KEY`.

  **To actually fix it**, upgrade from the vendor's own distribution:

  ```bash
  npm install https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz
  ```

  This is SheetJS's documented remediation, but it makes `xlsx` a non-registry dependency: your CI must be able to reach `cdn.sheetjs.com` for `npm ci` to succeed. Keep the worker isolation afterwards — it is good practice regardless of version.

- **`rls_auto_enable`** is flagged by Supabase's linter as an anon-executable SECURITY DEFINER function. It is a Supabase platform event-trigger function that returns `event_trigger`, so it cannot actually be invoked over RPC, and it is not ours to modify. Migration 0016 revokes EXECUTE from `anon`/`authenticated` anyway.
- **Admins can read conversation content** through RLS admin-select policies on `messages`/`conversations`. The consoles never surface it, but the grant exists. Master spec #92 asks for a tighter boundary here; narrowing those policies is the follow-up.

## Audit findings, 2026-08-29

A full pass over every server action, route handler, RLS policy and the
usual injection surfaces. Conclusions were tested, not assumed.

**Verified by test:**

| Check | Result |
|---|---|
| Server actions with an auth guard | 13/13 modules (6 delegate to a guarded helper) |
| API routes guarded | all except auth callbacks and the signed webhook |
| Cross-tenant reads as an ordinary user | 0 rows from 12 tables |
| Trigger/helper functions callable over RPC | all refused |
| `admin_dashboard_snapshot` called by a non-admin | refused, 42501 |
| Storage: anon + authenticated list/download/sign/upload | all refused |
| Public storage URL guess | 400 |
| IDOR on conversations, attachments, assets | all refused; victim row unchanged |
| Audit log UPDATE/DELETE | refused (append-only trigger) |
| Webhook signature | HMAC-SHA512 over raw body, `timingSafeEqual` |

**Fixed in this pass:** xlsx worker isolation; EXECUTE revoked on two
SECURITY DEFINER trigger functions (migration 0016); `DELETE
/api/conversations/[id]` no longer reports success when it deleted
nothing; HSTS added; `X-Powered-By` disabled.

**Still open:** the two items under "Known security-relevant gaps" that
need action outside this repo — the `xlsx` upgrade and leaked-password
protection.

---

## Incident response / recovery

If a credential is suspected compromised: rotate it immediately in the provider's dashboard (Supabase, OpenRouter, Cloudflare, Resend, Paystack all support key rotation without downtime if done in the right order — issue the new key, deploy the new env var, then revoke the old key), and check `admin_audit_logs` for any admin action taken in the affected window. If `SUPABASE_SERVICE_ROLE_KEY` specifically is suspected compromised, treat it as a full data-access incident (it bypasses RLS) — rotate it in the Supabase dashboard immediately, redeploy, and audit `admin_audit_logs` plus Supabase's own database logs for the affected window. If `SUPER_ADMIN_SETUP_TOKEN` is suspected compromised, rotate it immediately (it is only read from the environment at script-run time, so rotating the env var is sufficient — no re-deploy of the running app is required) and check `admin_roles` for any unexpected super-admin grant. There is no automated alerting wired up yet for any of this — monitoring `admin_audit_logs` for anomalies is currently a manual/periodic task for whoever operates this in production, and is a good candidate for early automation.

## The staff portal's secret path

`STAFF_PORTAL_SLUG` moves the console off `/admin`. With it set, the
console answers only at `/{locale}/{slug}/admin/...`; the canonical path
returns **404**, not a redirect — a redirect would hand the secret to
whoever probed for `/admin`.

This is obscurity and is not treated as a control. The boundary remains
the role matrix, the MFA gate and the per-action permission checks, none
of which change when the slug is set or unset. What it buys is that the
console is not enumerable, which is what makes putting Cloudflare Access
in front of the same path worth doing.

Three properties worth keeping true:

- **The slug never reaches the browser.** There is no `NEXT_PUBLIC_`
  variant — that would inline it into JavaScript served to every visitor,
  including the marketing homepage. Server code imports it from
  `src/auth/portal-path.ts` (which is `server-only`); client code derives
  the prefix from the URL it is already on (`useStaffBase`). Verified
  against a production build: the value appears nowhere in `.next`, and
  the middleware references the variable by name, so it is read at
  runtime.
- **The prefix is not a general mount point.** Only `/admin`,
  `/moderator` and `/staff` are reachable through it; `/{slug}/chat` is
  404, or the slug would become a second unlisted copy of the whole site.
- **Redirects are re-prefixed on the way out.** next-intl adding a locale
  would otherwise send the browser to the internal path, which the next
  request would 404.

An invalid slug (containing a slash, a dot, a space, over 64 characters,
or colliding with a real segment) is ignored rather than half-applied, so
a typo leaves the console reachable at `/admin` instead of bricking it.

