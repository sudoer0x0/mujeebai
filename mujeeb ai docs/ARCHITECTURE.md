# Architecture

This document describes how Mujeeb AI is put together: the application layers, the AI Gateway, the provider/storage/billing abstractions, the database model, the security boundaries, and the deployment shape. Read `HANDOFF.md` alongside this for what is actually implemented today versus scaffolded.

## Guiding principle: no single vendor is load-bearing

The master spec's central constraint is that Mujeeb AI must never be architecturally married to one AI provider, one storage backend, or one payment processor. Concretely, that means every external dependency sits behind a narrow TypeScript interface, and application code (routes, server actions, UI) only ever talks to the interface — never to a vendor SDK directly. Swapping OpenRouter for a direct Anthropic/OpenAI integration, or Supabase Storage for S3, or Paystack for Stripe, should mean writing one new adapter file and registering it, not touching chat, billing, or admin code.

```
route/server action
   -> registry / factory / gateway (chooses + orchestrates adapters)
      -> adapter (implements a small interface)
         -> vendor SDK / fetch call
```

## Application layers

```
src/
  app/                 Next.js App Router: [locale]-prefixed pages, admin console, API routes
  ai/                  AI Gateway: types, provider registry, orchestration, system prompt loading
  ai/providers/        Provider adapters (OpenRouter today; Cloudflare Workers AI for images)
  auth/                Session/authorization helpers used by every server action and route
  admin/               Admin permission matrix + audit logging, used by every admin mutation
  billing/             Plans, entitlements resolution, Paystack adapter
  storage/             Storage abstraction + Supabase Storage adapter
  files/               Upload validation + per-format text extraction (PDF/DOCX/XLSX/PPTX/CSV/plain text)
  usage/               Generic capability-based usage/quota engine
  components/          Design system (ui/) + feature components (chat/, staff/, auth/, billing/, marketing/)
  notifications/       Email adapter (Resend today) + localized transactional templates
  i18n/                next-intl routing/navigation/request configuration
  types/database.ts    Hand-maintained mirror of the Supabase schema (source of truth is the SQL migrations)
supabase/migrations/   SQL migrations, applied in numeric order
```

Next.js 15 (App Router) was chosen deliberately over the then-current Next 16 release: at scaffold time, Next 16 was mid-transition on `middleware.js` → `proxy.js` and introduced `next/root-params`, and the rest of the stack (`next-intl`, `@supabase/ssr`) was documented and battle-tested against Next 14/15 conventions. Fighting bleeding-edge framework churn was judged higher-risk than the one-major-version gap; this is a decision to revisit later, not a permanent one.

## Request flow (typical authenticated page)

1. `src/middleware.ts` runs first: it merges next-intl's locale-routing middleware with `updateSupabaseSession()` (which refreshes the Supabase auth cookie on every request) and enforces that `PROTECTED_SEGMENTS` (`chat`, `settings`, `admin`, `moderator`) redirect unauthenticated visitors to `/login`, preserving the intended destination through `safeNextPath()` so a crafted `?next=` cannot turn the post-login redirect into an off-site hop.
2. Server Components call `src/auth/session.ts` (`getCurrentUser`, `getCurrentProfile`, wrapped in React's `cache()` so a single request only hits Supabase once) to read the authenticated user and profile.
3. Mutating operations are Server Actions (`"use server"` files named `actions.ts` next to the page that uses them), which re-check authorization themselves (`requireUser`/`requireAdmin`/`requireSuperAdmin`) — the middleware redirect is a UX convenience, not the security boundary.
4. Admin mutations additionally call `assertPermission()` from `src/admin/permissions.ts` against the `ADMIN_ACTIONS` matrix, then `recordAuditEvent()` from `src/admin/audit.ts` to write an immutable row to `admin_audit_logs`, win or lose.

## The AI Gateway (`src/ai/`)

The gateway is the layer that makes "add a new model" or "add a new provider" a data-and-adapter change, not a code change scattered across the chat UI.

- **`types.ts`** — the contract. `TextProviderAdapter` (a `stream()` method yielding `StreamChunk`s) and `ImageProviderAdapter` are the only shapes a provider must implement. `GatewayError` is a typed error carrying a `code` (`rate_limited`, `provider_unavailable`, `invalid_request`, etc.) so the UI can react appropriately instead of showing a raw stack trace.
- **`providers/openrouter.ts`** — implements `TextProviderAdapter` against OpenRouter's OpenAI-compatible chat completions endpoint, hand-parsing the SSE stream (`parseSseStream()`) into `StreamChunk`s rather than depending on a heavyweight SDK.
- **`providers/cloudflare-image.ts`** — implements `ImageProviderAdapter` against Cloudflare Workers AI's REST API.
- **`registry.ts`** — the only place that knows which providers/models exist. Models and providers are rows in Postgres (`providers`, `models` tables), not hardcoded — `listModels()`, `getModelBySlug()`, `resolveFallbackChain()` and `getDefaultModel()` all read from the DB, so enabling/disabling a model is an admin-console toggle, not a deploy.
- **`system-prompt.ts`** — `getActiveSystemPrompt()` loads the active row from `system_prompt_versions`. This deliberately uses the service-role Supabase client (not the RLS-scoped one) because the table's only SELECT policy is admin-only by design (the system prompt is not something regular users should be able to read directly out of the database) — the gateway itself is a trusted server-side caller, not a user request.
- **`gateway.ts`** — `streamAssistantResponse()` orchestrates: resolve model -> resolve provider adapter -> stream -> on failure, walk `resolveFallbackChain()` to the next configured model rather than failing the whole turn.
- **`conversation.ts`** / **`run-turn.ts`** — persistence and framing around a turn: loading history, building multi-part user content (text + file attachments + images), deriving a conversation title from the first turn, and `runAssistantTurn()`, which both the initial chat route and the regenerate route call so the two code paths can't drift apart.

Streaming to the browser uses **NDJSON**, not SSE: `src/lib/streaming.ts`'s `streamChunksAsResponse()` writes one JSON object per line over a plain `ReadableStream` response body, and `readNdjsonStream()` on the client decodes it incrementally. NDJSON was chosen over SSE because it needs no special content-type ceremony or reconnect semantics for this use case, and pairs cleanly with `AbortController`-based client-side cancellation. Response headers (`X-Conversation-Id`, `X-Message-Id`, `X-Model-Slug`) are set before the body starts streaming, so the client learns the (possibly newly-created) conversation ID immediately rather than waiting for the stream to finish.

## Provider-independence in the other subsystems

The same adapter discipline is applied outside the AI Gateway:

- **Storage** (`src/storage/types.ts` + `supabase-storage.ts` + `factory.ts`): a `StorageAdapter` interface (`upload`, `getSignedUrl`, `delete`) with a Supabase Storage implementation. Swapping to S3/R2 means a new adapter behind `factory.ts`; nothing in `src/files/` or the chat UI touches Supabase Storage directly.
- **Billing** (`src/billing/paystack.ts`): all Paystack HTTP calls (`initializeTransaction`, `verifyTransaction`, `disableSubscription`, `verifyWebhookSignature`) are isolated in this one file. Routes and server actions call these functions, never the Paystack API directly, so a future Stripe adapter is additive.
- **Email** (Resend): isolated behind a thin sender used only where transactional email is triggered (password reset, magic link — mostly delegated to Supabase Auth's own email sending today; see `HANDOFF.md`).

## Entitlements and usage (`src/billing/entitlements.ts`, `src/usage/quota.ts`)

Two-layer model:

1. **Entitlements** answer "what is this user allowed to do at all" — resolved per feature key (e.g. `max_messages_per_day`, `image_generation`) by checking `user_entitlements` (a per-user override) first, falling back to `plan_entitlements` (the user's plan's defaults). `getEffectiveEntitlement()` / `getEffectiveNumber()` / `getEffectiveBoolean()` are the three read helpers everything else calls.
2. **Usage** answers "how much of that allowance is left right now" — `usage_events` records every billable action, `usage_counters` holds rolled-up per-period totals. `checkQuota()` is a cheap read-only pre-check (used to bail out early before doing other work); the actual gate is `consumeQuota()`, which calls `try_consume_usage` (`0006_security_hardening.sql`, callable only by the service role) — a single atomic statement that checks the limit and applies the increment (or reverts it if that would go over) in one transaction, so concurrent requests from the same user can't all pass a read-based check before any of them writes. An earlier version of this function called a separate read-then-increment pattern that had exactly that race; see `HANDOFF.md`'s security-hardening notes.

Both are generic and capability-keyed rather than hardcoded to "chat messages" — adding a new billable capability (e.g. a future "voice minutes" feature) means adding a `feature_key` and wiring `checkQuota`/`consumeQuota` calls at the relevant call site, not new tables.

## Database architecture (`supabase/migrations/`)

Migrations are applied in numeric order and are the actual source of truth; `src/types/database.ts` is a hand-maintained mirror kept in sync by convention (there is no codegen step wired up yet — see `HANDOFF.md`).

- **`0001_core_schema.sql`** — all tables (profiles, conversations, messages, providers, models, plans, plan_entitlements, user_entitlements, usage_events, usage_counters, subscriptions, admin_roles, admin_audit_logs, moderation_records, system_prompt_versions, feature_flags, system_settings, files, image_generations, and more), plus triggers: `set_updated_at` (generic `updated_at` maintenance), `profiles_guard_privileged_fields` (blocks a non-service-role connection from writing `role`/`status` directly on `profiles` — those fields only change through `admin_roles` inserts and admin actions), `handle_new_auth_user` (auto-creates a `profiles` row on Supabase Auth signup), `sync_profile_role_from_admin_roles` (keeps the denormalized `profiles.role` column in sync whenever `admin_roles` changes, so RLS policies can do a cheap single-table check instead of a join everywhere).
- **`0002_row_level_security.sql`** — enables RLS on every user-data table and defines policies. Two SQL helper functions, `is_admin()` and `is_super_admin()`, centralize the "is this JWT's user an admin" check so it isn't reimplemented per-policy.
- **`0003_seed_data.sql`** — seeds the initial providers/models/plans/entitlements/feature flags/system settings, and a placeholder system prompt row explicitly labeled `[PLACEHOLDER — replace with the real product system prompt from Admin -> System Prompt before production launch.]` (per master spec's explicit instruction that the real system prompt must never be invented by an AI agent).
- **`0004_usage_functions.sql`** — the original atomic usage-increment RPC (`increment_usage_counter`), grant restricted to `service_role`. Still present/used for the occasional fire-and-forget increment; superseded for quota *enforcement* by `try_consume_usage` (below).
- **`0005_plans_metadata.sql`** — adds a `metadata jsonb` column to `plans` for provider-agnostic plan display data.
- **`0006_security_hardening.sql`** — output of a dedicated security review pass (see `HANDOFF.md`): tightens the `message_attachments` RLS policy to also verify the attachment being linked belongs to the caller (not just the message), and adds `try_consume_usage`, the atomic check-and-consume RPC described above.

### Security boundary: RLS-scoped vs. service-role client

`src/lib/supabase/server.ts` exports two constructors:

- **`createServerSupabaseClient()`** — cookie-based, runs as the logged-in user, subject to RLS. Used wherever a policy already grants the needed access (e.g. a user reading their own subscription, their own conversations) — this is preferred by default because it keeps the service-role key out of code paths that don't strictly need it.
- **`createServiceRoleClient()`** — bypasses RLS entirely; throws immediately if `SUPABASE_SERVICE_ROLE_KEY` isn't configured. Used only for genuinely cross-user or privileged operations: admin console mutations, the usage-counter RPC, webhook handlers (which have no user session at all), and system-prompt loading (see above).

This split is enforced by convention, not by a lint rule — any new server-side data access should default to the RLS-scoped client and only reach for the service-role client with a specific justification, because every additional use of it is one more code path that must be independently reviewed for correctly-scoped queries (a service-role client + an unscoped `.eq()` filter that's missing is a full data leak, whereas the same mistake against the RLS-scoped client just gets rejected by Postgres).

## Staff consoles and the authorization model

There are **two** consoles, on separate route trees with separate guards:

| Route | Roles | Contains |
|---|---|---|
| `/admin/**` | `super_admin` | Everything: users, usage, plans, subscriptions, models, providers, system prompt, feature flags, settings, audit log, platform status |
| `/moderator/**` | `moderator`, `super_admin` | Accounts and the moderation log only |

Separate trees rather than one console with items conditionally hidden. Hiding a nav link is a presentation choice; a separate tree with its own guard means a moderator who types `/admin/plans` is refused by the server, and nothing rendered in their console links to an action they cannot perform. A moderator who lands on `/admin` is redirected to `/moderator` — their own console, not a dead end.

`src/admin/permissions.ts` holds the matrix and answers two different questions:

- **`can` / `assertPermission`** — may this *role* perform this action?
- **`assertCanActOn`** — may this *actor* perform it *against this target*?

The second exists because the matrix alone cannot express three rules that matter. A moderator may never act on staff (otherwise "moderators may suspend users" lets a moderator suspend a Super Admin, since an administrator is a row in the same table). Nobody may aim a destructive action at their own account. And a Super Admin's role cannot be changed from the console at all — that path runs through `scripts/super-admin.ts`, with a database trigger refusing to remove the last active one.

Guards come in two flavours by call site. Pages use `requireSuperAdminPage()` / `requireStaffPage()`, which **redirect**; route handlers and server actions use `requireSuperAdmin()` / `requireStaff()`, which **throw**. Next renders a layout and its page concurrently, so a page that throws can produce a 500 before the layout's `redirect()` wins the race — and for a rendered page the correct outcome is always a redirect, while for an API it is always a status code.

Every admin mutation — success or failure — is recorded via `recordAuditEvent()` to `admin_audit_logs` (actor, action, target, result, metadata, and the *previous* value where one existed, because "price changed to 10" is far less useful during an incident than "changed from 20 to 10"). Destructive moderation actions additionally write to `moderation_records`, with a required reason. `admin_audit_logs` is append-only, enforced by a trigger rather than by RLS — the service role bypasses RLS, so a policy would not have held.

## Pricing as a single source of truth

`src/billing/pricing.ts` is the only place a price or a plan feature is resolved. The marketing page, the settings card, the admin plan editor and the Paystack checkout amount all read through it, and it reads `plans` / `plan_entitlements`.

This exists because the pricing page previously fetched the plans and discarded the result, rendering a hardcoded `$20` beside a database that said `10.00` and a checkout that charged `10.00` — along with feature bullets describing models the platform does not have. A hardcoded `$10` would have been the same bug with a friendlier number: the defect was that the page was a second source of truth at all.

## Internationalization and RTL

`next-intl` handles locale routing via a `[locale]` dynamic segment (`localePrefix: "always"`, so every route including the default locale is explicitly prefixed — avoids ambiguity between "no locale set yet" and "default locale"). Arabic is a first-class RTL locale: `src/i18n/routing.ts` exports `rtlLocales`, `src/lib/utils.ts`'s `isRtlLocale()` is checked in the root layout to set `<html dir="rtl">`, and the design system's spacing/positioning utilities are written to respect logical properties rather than hardcoded left/right where it matters for RTL correctness.

## Deployment architecture

Target platform is Vercel. The app is a single Next.js deployment (no separate backend service) — all "backend" logic is Next.js Route Handlers and Server Actions running in Vercel's Node runtime, talking to Supabase (hosted Postgres/Auth/Storage) and outbound to OpenRouter/Cloudflare/Resend/Paystack. There is no queue/worker infrastructure yet; long-running work (AI generation, file processing) happens synchronously within the request/response or the streaming response lifetime — see `HANDOFF.md` for the scaling implications and what would need to change (background jobs, a queue) at higher volume.

Environment variables are validated at startup by Zod schemas split across **two modules**, not two schemas in one file: `src/lib/env.ts` is browser-safe and reads only `NEXT_PUBLIC_*` through explicit `process.env.NEXT_PUBLIC_X` member accesses (the form Next statically replaces at build time), while `src/lib/env.server.ts` carries `import "server-only"` so any Client Component that reaches a secret — directly or transitively — fails the build rather than leaking it. Nothing except the two required Supabase public variables is hard-required to boot — every optional provider's absence is checked at the call site via `providerStatus` and fails that one feature gracefully instead of crashing the app. This was a deliberate choice so the app is inspectable and runnable immediately after `npm install`, before any provider account has been created.
