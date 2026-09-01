# Contributing

Conventions for anyone — human or AI agent — working on this codebase. Read `ARCHITECTURE.md` and `HANDOFF.md` first; this document is about *how* to work in the repo, not what it contains.

## Before you start

1. Run `npm install`.
2. Copy `.env.example` to `.env.local` and fill in at least the two required Supabase variables (see `README.md`).
3. Run `npm run check-env` to confirm your local configuration.
4. Read `HANDOFF.md`'s "known gaps" section so you don't rediscover a documented limitation and treat it as a surprise bug.

## Core conventions

### Never bypass the adapter pattern

If you're adding or modifying anything that talks to an external provider (an AI model provider, a storage backend, a payment processor, an email sender), it goes behind the existing interface in `src/ai/types.ts`, `src/storage/types.ts`, or as an isolated module like `src/billing/paystack.ts` — never called directly from a route, Server Action, or component. See `ARCHITECTURE.md`'s "Guiding principle" section. If you're adding a genuinely new *kind* of external dependency with no existing interface, define a small interface for it first, in its own `types.ts`, before writing the first adapter against it.

### Default to the RLS-scoped Supabase client

Use `createServerSupabaseClient()` unless you have a specific reason the operation must bypass RLS (cross-user reads, admin actions, webhooks with no session, the usage-counter RPC). If you do need `createServiceRoleClient()`, write the query as if RLS were still enforced anyway (explicit `.eq("user_id", ...)` filters, not "the client will handle it") — the service-role client will not save you from a missing filter, it will just silently return everyone's rows.

### All admin mutations follow the same shape

```ts
const admin = await requireAdmin();
assertPermission(admin, "some.action");
const supabase = createServiceRoleClient();
// ...perform the mutation...
await recordAuditEvent({ actorId: admin.id, action: "admin.some_action", targetType: "...", targetId: "...", result: error ? "failure" : "success" });
revalidatePath(...);
```

If you add a new admin action, add its permission requirement to `ADMIN_ACTIONS` in `src/admin/permissions.ts` in the same change — don't leave an admin mutation unlisted there (it will be treated as forbidden to everyone, which is the safe failure mode, but it means the feature won't work at all until the matrix is updated).

### Server Actions re-check authorization; middleware is not the security boundary

`src/middleware.ts`'s `PROTECTED_SEGMENTS` redirect is a UX convenience. Every Server Action and API route must independently call `requireUser()`/`requireAdmin()`/`requireSuperAdmin()` — never assume a request reaching a handler has already been authorized just because the route is nominally "protected."

### i18n: touch all 7 locale files together

If you add or change any user-facing string, update `messages/en.json`, `fr.json`, `es.json`, `pt.json`, `ar.json`, `ja.json`, and `zh.json` in the same change, even if the non-English values are placeholder/machine-translated pending a real translation pass — a missing key in one locale file will surface as a raw key string or a next-intl error for users on that locale. When adding UI near Arabic, check that spacing/positioning uses logical properties so it doesn't visually break under `dir="rtl"`.

### Database changes are migrations, forward-only

Add a new numbered file in `supabase/migrations/` (`000N_description.sql`) — never edit an already-numbered migration that could plausibly have been applied somewhere already. Update `src/types/database.ts` to match in the same change (see `HANDOFF.md`'s note that this is currently hand-maintained, not generated — be precise). If the change affects access control, add/update the corresponding RLS policy in the same change, not as a follow-up — a new table with RLS enabled but no policies is inaccessible to everyone including its owner, and a new table without RLS enabled at all is a data leak.

### The system prompt is not yours to write

Do not fill in `system_prompt_versions` with invented product-voice content. That value is the operator's to set through `/admin/system-prompt`. Code changes to *how* the system prompt is loaded/versioned are fine; changes to its *content* are not something to do unprompted.

## Code style

- TypeScript everywhere; avoid `any` — if the Supabase-generated shape doesn't fit, extend `src/types/database.ts`'s helper types (`Tables<T>`, `InsertOf<T>`, `UpdateOf<T>`) rather than casting.
- Validate all external input (form submissions, API request bodies, webhook payloads) with Zod before use.
- Prefer Server Components and Server Actions over client-side data fetching; reach for a Client Component only where interactivity requires it.
- Keep provider-specific error handling in the adapter, translated to the shared `GatewayError`/equivalent shape before it reaches UI code, so UI code never needs to know which provider is in play.
- Run `npm run lint` and `npm run typecheck` before considering a change complete.

## Testing

There is no test suite yet (see `HANDOFF.md`) — this is the most valuable place for new contributions to focus. If you add tests, prioritize in this order: RLS policies (cross-user data isolation), the admin permission matrix, usage/quota RPC concurrency safety, and Paystack webhook signature verification + idempotency. Until a test runner is chosen and wired into `package.json`, raise that as its own change rather than mixing test-infrastructure setup into an unrelated feature change.

## Commit / change hygiene

Keep changes scoped to one concern at a time (one feature, one fix, one doc update) so `admin_audit_logs`-style reasoning about "what changed and why" stays possible for the humans operating this in production. When a change touches a security-relevant boundary (RLS, admin permissions, webhook verification, secret handling), call that out explicitly in the change description — don't bury it in an unrelated refactor.
