# HANDOFF — Mujeeb AI

**Last updated:** 2026-08-29
**Live Supabase project:** `igcoywqzlvcqjurblmwc`
**Production domain (planned):** `mujeebai.yungswag.xyz`

This is the living memory of the project. It describes what is actually
built and verified, not what is intended. Read it, `ARCHITECTURE.md` and
`SECURITY.md` before changing anything substantial.

---

## 1. What this is

A multilingual AI chat platform: streaming conversations over multiple AI
providers, document and image understanding, image generation, per-plan
usage quotas, Paystack subscriptions, and two separate staff consoles.

Every external service sits behind an adapter (AI gateway, storage,
billing, email) so it can be replaced without touching product code.

**Stack:** Next.js 15 (App Router) · React 19 · TypeScript · Tailwind v4 ·
Supabase (Postgres + Auth + Storage) · next-intl · OpenRouter ·
Cloudflare Workers AI · Resend · Paystack · Vercel.

---

## 2. Current status

| Area | State |
|---|---|
| Registration | **Working, verified end to end against the live project** |
| Sign-in, magic link, password reset | Working |
| Chat + streaming | **Working, verified in a real browser** (dev and production builds) |
| Model registry / selector | Working, data-driven |
| Usage + quotas | Working, atomically enforced, verified |
| Pricing ($10 Pro) | **Fixed**, sourced from the database |
| Paystack checkout | Implemented; **not verified against a live payment** |
| Paystack webhook | Rewritten; **not verified against live events** |
| `/admin` (Super Admin) | Working, verified |
| `/moderator` | **New**, working, verified |
| RBAC | Working, verified including escalation attempts |
| i18n (7 locales) | Complete — 558 keys, all locales in sync |
| Image generation | Implemented; **cannot be verified — no Cloudflare credentials set** |
| File upload + processing | Implemented; not re-verified this pass |
| PWA | Manifest + icons present; no service worker |

---

## 3. Verify in a browser, not with curl

Three fatal bugs survived a full server-side audit because `curl` does not
enforce CSP, does not run JavaScript, and does not hydrate. Every endpoint
returned 200 with correct HTML while the product was completely
non-interactive. **Any change touching CSP, headers, hydration or client
components must be checked in an actual browser with the console open.**
`npm run verify` cannot catch this class of bug.

The three: the CSP blocked Next's own inline RSC scripts so React never
hydrated; an ambiguous PostgREST embed made chat history always render
empty; and the error from that query was discarded rather than surfaced.
All three are written up in `CHANGELOG.md`.

## 4. The four bugs that mattered

### 4.1 Nobody could register (critical, fixed)

`supabase.auth.signUp()` returned **HTTP 500 "Error sending confirmation
email"** and GoTrue rolled the entire sign-up transaction back, so no
account was created. Supabase's built-in SMTP only delivers to addresses
on the project team and rate-limits hard — which is why the two owner
addresses worked and every other address failed.

Resend was configured with a verified `yungswag.xyz` domain and had **zero
imports anywhere in the codebase**.

**Fix.** Mujeeb AI now owns its auth mail (`src/auth/registration.ts`):

1. `admin.generateLink({ type: "signup" })` creates the user and returns a
   `hashed_token` **without sending anything**.
2. The profile's `display_name`/`locale` are written explicitly.
3. A branded, localized verification email goes out through the
   notification adapter (`src/notifications/`).
4. If delivery fails, the just-created auth user is **deleted** so the
   person can simply try again instead of being stuck as an unverified
   account whose address now reports "already registered".
5. `/api/auth/confirm` redeems the token with `verifyOtp` and establishes
   the session.

If no email provider is configured it falls back to `signUp()`, so a
deployment with working Supabase SMTP still behaves as before.

### 4.2 Pricing said $20, database said $10 (fixed)

`(marketing)/pricing/page.tsx` called `listActivePlans()` and **threw the
result away** — the whole card was hardcoded, including features that did
not exist ("Claude 3.5 Sonnet, GPT-4o", "unlimited conversations") beside
a plan whose rows said 500 messages/day.

**Fix.** `src/billing/pricing.ts` is the single source of truth. Prices,
plan names and every feature line are derived from `plans` /
`plan_entitlements`; checkout resolves its amount through the same
`resolveAmount()`. Replacing `$20` with `$10` would have been the same bug
with a friendlier number.

### 4.3 Every AI model was dead upstream (fixed)

All three seeded OpenRouter model ids had been retired
(`meta-llama/llama-3.3-70b-instruct:free` → 404 "unavailable for free",
etc.), so every chat request exhausted the fallback chain. Fixed in
migration `0010` with ids verified live. The gateway itself was correct
throughout — it tried each candidate and normalized the failure.

### 4.4 Moderators had the run of the admin console (fixed)

There was no `/moderator`. Moderators entered `/admin` and saw all twelve
sections, and `assertPermission` had no notion of *who an action targets* —
a moderator could suspend a Super Admin. See §6.

---

## 5. Registration — how it works now

```
register form
  └─ signUpAction (rate-limited, checks the `registration` feature flag)
       └─ registerUser()
            ├─ admin.generateLink({ type: "signup" })   → creates user, no mail
            ├─ profiles.update(display_name, locale)
            ├─ buildAuthEmail("verify")                 → localized, branded
            ├─ sendEmail() via Resend
            └─ on delivery failure → admin.deleteUser() (rollback)
                 ↓ user clicks the link
            /api/auth/confirm  → verifyOtp → session cookie → /{locale}/chat
                              → one-time welcome email
```

A new account gets: a profile row (trigger + explicit update), `user`
role, `active` status, the default **Mujeeb AI Free** plan (no
subscription row needed — `getUserActivePlan` falls back to the default
plan), and its entitlements. No manual database work is required.

**Verified** on the live project: account created → profile with correct
`display_name` → email delivered through Resend → token redeemed →
session → password sign-in → free plan resolved → quota consumed.

---

## 6. Authorization

`src/admin/permissions.ts` holds the whole matrix. Two rules:

- **`can` / `assertPermission`** — may this *role* do this action?
- **`assertCanActOn`** — may this *actor* do it *to this target*?

`assertCanActOn` encodes three things the matrix cannot:

1. A moderator may never act on staff. (Without it, "moderators may
   suspend users" lets a moderator suspend a Super Admin.)
2. Nobody may aim a destructive action at their own account.
3. A Super Admin's role cannot be changed from the console at all —
   that only happens through `scripts/super-admin.ts`, and the database
   additionally refuses to remove the last one.

### How to sign in to the staff portals

Staff have their own entrance. It is a different URL, a different form and
a different server action from the customer login — they share no UI.

| | Customers | Staff |
|---|---|---|
| Sign-in URL | `/en/login` | **`/en/staff/login`** |
| Sign-up | `/en/register` | none — roles are granted from the CLI |
| Rate limit | 15 attempts/min | 5 attempts/min |
| Audit log | failures | **every attempt, success or failure** |
| Indexed by search engines | yes | no (`noindex, nofollow`) |

**Two-factor authentication is mandatory for every staff account,
including super admins.** The first time you sign in after this change you
will be sent to enrol an authenticator app; the console is unreachable
until you do. Verified working end to end against the live project
(enrol → QR → verified code → session reaches `aal2`).

**To get in:**

1. Go to `http://localhost:3000/en/staff/login` (in production, your
   domain + `/en/staff/login`).
2. Sign in with an account that already holds a staff role.
3. Enrol an authenticator app (first time only), then enter a code.
4. You land on your own portal: `/en/admin` for a super admin,
   `/en/moderator` for a moderator. You are routed by role — you do not
   pick.

Losing the authenticator locks the account out by design. Recovery is
`npm run super-admin -- recover --email …` from a machine with server
access — see §7. For a moderator, a super admin can remove and re-invite
them from `/admin/moderators`.

The project owner's account already holds `super_admin` on the live
project. (Deliberately not named here: this file is intended to be
committable, and naming the one account that can do anything tells an
attacker exactly which address to target. `npm run super-admin -- list`
prints it from a machine that already has server access.) To grant the role to another account, or if you need to
reset your own password, use the CLI in §7 — there is deliberately no way
to mint a staff role through the web application.

Signing in there with an ordinary account authenticates you and then
immediately signs you back out, with a generic message. The page never
reveals which portals exist or who holds a role.

Requesting `/admin` or `/moderator` while signed out redirects to
`/staff/login`, not the customer form.

### Portals

| Route | Who | Enforcement |
|---|---|---|
| `/admin/**` | `super_admin` only | layout redirect + `requireSuperAdminPage` in every page + `assertPermission` in every action |
| `/moderator/**` | `moderator`, `super_admin` | same shape |

A moderator hitting `/admin` is redirected to `/moderator` — their own
console, not a dead end.

**Verified live** (fresh accounts of each role, real session cookies):

```
path                 anon         user          moderator      super_admin
/en/chat             →login       200           200            200
/en/settings         →login       200           200            200
/en/admin            →login       →/chat        →/moderator    200
/en/admin/users      →login       →/chat        →/moderator    200
/en/admin/plans      →login       →/chat        →/moderator    200
/en/moderator        →login       →/chat        200            200
/en/moderator/users  →login       →/chat        200            200
```

Also verified: self-promotion to `super_admin` refused by a database
trigger; reading another user's profile returns 0 rows; calling
`try_consume_usage` directly is refused.

---

## 7. Super Admin bootstrap

One script — `scripts/super-admin.ts` — replaces the three overlapping
ones that existed (`setup-`, `create-`, `reset-super-admin.ts`).

```bash
npm run super-admin -- grant   --email you@example.com   # existing account
npm run super-admin -- create  --email you@example.com   # provision + grant
npm run super-admin -- recover --email you@example.com   # password/MFA reset
npm run super-admin -- list
```

`SUPER_ADMIN_SETUP_TOKEN` is **mandatory** and compared in constant time.
Passwords are prompted for with echo off and are never accepted as
command-line arguments. Rotate the token after use.

The old scripts each had a real flaw: the token was only enforced *if* it
happened to be set; passwords were passed as `--password` (shell history,
process table) and echoed at the prompt; and `listUsers()` was unpaginated,
so past 50 accounts an existing user looked like a new one.

---

## 7b. What the super admin can change without touching code

Everything below is editable from the console. The intent is that a normal
operating week needs no deploy.

| Console page | Controls |
|---|---|
| `/admin/settings` | default chat model, default vision model, upload cap, **billing currency**, **default locale**, **support email**, **free plan slug**, **chat rate limit/min**, **max conversation messages**, enabled locales, announcement banner |
| `/admin/plans` | plan names, **price in every supported currency**, entitlements (message/image/vision/file quotas, premium & advanced model access), which plan is default, active/inactive |
| `/admin/models` | add, rename, retire, reorder models; tier and availability |
| `/admin/providers` | provider endpoints and priority |
| `/admin/feature-flags` | toggle features on and off platform-wide |
| `/admin/system-prompt` | the system prompt, versioned |
| `/admin/moderators` | **create a moderator by email** (temporary password sent to them, forced password change and mandatory authenticator before access), remove one |
| `/admin/security` | your two-factor state, session assurance level, last sign-in, sign out of this browser or everywhere |
| `/admin/users` | suspend, reactivate, change role, grant per-user quota overrides with an expiry |
| `/admin/audit-logs` | every staff action, append-only |

Settings are validated per key on the server — a key with no schema is
refused rather than written, so a typo cannot take chat down. Editing any
of them invalidates the cached registry immediately (`revalidateRegistry`),
so a change is live on the next request rather than after a TTL.

Two things still require code or CLI, on purpose:

- **Granting a staff role** — `npm run super-admin`. Any web endpoint that
  can mint an administrator can be abused into minting one.
- **Secrets** (API keys, service-role key) — environment variables, never
  the database, so a console compromise cannot read them.

---

## 7c. Pricing, currencies and the announcement

**Prices are per currency, not converted.** `/admin/plans` edits the amount
charged in each of the eight Paystack currencies as one saved unit. The
currency checkout is actually using is marked "Charging", and the editor
warns if that currency has no price — which is the state that silently
removes the buy button.

Switching `billing_currency` at `/admin/settings` therefore picks up a
figure someone chose, rather than converting at a rate that could move
between the moment a customer reads the price and the moment they are
charged.

A currency with no configured price is a real state: checkout refuses it
(409) and the pricing card says the price is unavailable. It deliberately
does **not** fall back to the USD number — doing that rendered a $5 plan
as "₦5".

This account's live Paystack profile supports **NGN only**; other
currencies return 403 "Currency not supported by merchant". The list in
`src/billing/currencies.ts` is what Paystack supports, not what this
account has enabled — that is account configuration the code cannot know.

**Announcements** are set at `/admin/settings` → `announcement` and appear
as a dismissable banner for every signed-in user. Dismissal is keyed to
the message text, so editing it shows it again to everyone.

---

## 7d. Default language by region

A visitor with no stored preference gets the language their **country**
uses online, which is not always its official language:

| Region | Locale | Why |
|---|---|---|
| Morocco, Algeria, Tunisia | `fr` | Arabic is official; French is the administrative and dominant online language |
| Egypt, Gulf, Levant | `ar` | |
| Francophone West/Central Africa | `fr` | |
| Brazil, Portugal, Angola, Mozambique | `pt` | |
| Spain, Latin America | `es` | |
| Japan | `ja` | |
| China, Taiwan, Hong Kong, Macau | `zh` | Singapore excluded — English dominant |
| Everything else | `en` | Fallback, never a near-miss |

Order: country header (`x-vercel-ip-country` / `cf-ipcountry`) →
`Accept-Language` → English. There is no geo header in local development,
so it falls through to `Accept-Language` there.

**A chosen language wins permanently.** Picking one writes next-intl's
`MUJEEB_LOCALE` cookie, and while it exists none of the above runs.

Map and resolver: `src/i18n/region-locale.ts`, nine unit tests.

---

## 8. Layout

```
src/
  admin/          permissions matrix, audit log, staff data + server actions
  ai/             gateway, registry, provider adapters, run-turn, capabilities
  app/[locale]/   (marketing) (auth) (app) admin/ moderator/
  app/api/        chat, chat/edit, chat/regenerate, conversations, files,
                  images, models, assets, auth, billing
  auth/           session guards, registration service
  billing/        plans, pricing (single source of truth), entitlements, paystack
  components/     ui/ (design system) chat/ staff/ billing/ marketing/ auth/
  files/          validation + per-type processors
  lib/            env (client) env.server, supabase clients, rate limit,
                  streaming, safe-redirect, logger
  notifications/  email adapter + localized templates
  storage/        storage adapter (Supabase today)
  usage/          quota engine, admin operations, shared category vocabulary
```

**Boundary that matters:** `@/lib/env` is browser-safe and reads only
`NEXT_PUBLIC_*`. `@/lib/env.server` carries `import "server-only"`, so any
Client Component that reaches a secret fails the build.

---

## 9. Database

Migrations `0001`–`0011` in `supabase/migrations/`, all applied to the live
project. `supabase/all_migrations.sql` is the concatenation.

**The repo had drifted from the database.** The deployed
`handle_new_auth_user` was an older version that only inserted
`(id, email)` — so every account since launch had a null `display_name`.
`0008` restores it and backfills.

Recent migrations:

- **0008** — profile provisioning repair + backfill; `search_path` pinned
  on helpers; last-Super-Admin guard (database-level); `admin_audit_logs`
  made append-only by trigger; trigram + role/status/period indexes.
- **0009** — **fixes a regression 0008 introduced.** 0008 revoked EXECUTE
  on `public.is_admin()` to close it as an RPC, which broke the sixteen RLS
  policies that call it — every one failed with "permission denied", making
  `plans`, `profiles`, `conversations` and more unreadable. 0009 moves the
  helpers into a `private` schema PostgREST does not expose, so they stay
  callable from policies and unreachable as RPCs.
- **0010** — model registry refreshed with live ids.
- **0011** — `pg_trgm` moved out of `public`.

`npm run db:types:check` diffs `src/types/database.ts` against the live
schema and fails on drift. It currently passes.

### Supabase advisors

Down from 13 warnings to 3, all benign or outside the app:

- `rls_auto_enable` — a Supabase platform event-trigger function. Returns
  `event_trigger`, so it cannot actually be invoked over RPC.
- **Leaked password protection is disabled.** Turn it on:
  Dashboard → Authentication → Policies. Recommended before launch.

---

## 10. Design system

`src/app/globals.css` defines the whole token layer: one neutral ramp, one
accent, four radii, three elevation steps. The previous
glassmorphism/glow/gradient tokens are gone (master spec #60).

`src/components/ui/` is the vocabulary — `Button`, `Input`/`Field`,
`Table`, `Alert`, `Dialog`, `ConfirmDialog`, `EmptyState`, `PageHeader`,
`Badge`/`StatusDot`, `Card`/`StatTile`. There is one of each. `GlassCard`
and `GlowCard` were three ways to draw the same box; they are gone.

`ConfirmDialog` replaces `window.confirm` for destructive actions and
supports a typed confirmation phrase (`DELETE`, `RESET`) for the
highest-risk ones.

---

## 11. Internationalization

7 locales × 558 keys, all in sync. `npm run check-i18n` resolves each
`t("…")` against the namespace its `useTranslations` call declared and
fails on a missing or drifted key. Run it before shipping — a missing key
throws `MISSING_MESSAGE` and can take a whole page down.

Arabic is a real RTL layout: components use logical properties
(`ms-`/`me-`/`ps-`/`pe-`/`start-`/`end-`), not mirrored `left`/`right`.

---

## 12. Known gaps

**Not verified because credentials are absent:**

- **Image generation** — `CLOUDFLARE_ACCOUNT_ID` / `CLOUDFLARE_API_TOKEN`
  are empty in `.env.local`. The code path is complete and the composer
  hides the control when the flag or credentials are missing.
- **Live payments** — checkout builds a correct Paystack transaction and
  the webhook verifies signatures, but no real payment has been put
  through. Before launch: run a Paystack test charge and confirm
  `charge.success` activates the subscription.

**Deliberately incomplete:**

- **Conversation branching** — the data model supports it
  (`message_variants`, `active_variant_id`); there is no branch-navigation
  UI. Editing a message deletes the messages after it, which is the
  honest behaviour given no branch UI exists.
- **Audio/video processing** — feature flags exist and are off. No
  pipeline.
- **PWA** — manifest and icons only; no service worker, so no offline.
- **Rate limiting is per-instance.** `src/lib/rate-limit.ts` is an
  in-memory map. On Vercel each lambda has its own, so the effective limit
  is `limit × instances`. Quotas (database-backed, atomic) are the real
  control; the rate limiter is burst protection. Move it to a shared store
  before it needs to be exact.
- **`checkQuota` before `consumeQuota`** in the chat routes is a cheap
  pre-check, not the gate. `consumeQuota`'s `try_consume_usage` RPC is
  atomic and is what actually enforces.

**Worth doing next:**

1. Enable leaked-password protection in Supabase Auth.
2. Configure Cloudflare credentials and verify image generation.
3. Run a Paystack test payment end to end.
4. Add integration tests for the webhook handler (idempotency, renewal
   without metadata, `subscription.create` arriving first).
5. Consider virtualizing the message list — untested past a few hundred
   messages.

---

## 13. Commands

```bash
npm run dev              # development
npm run dev:clean        # development, after clearing the dev build cache
npm run verify           # typecheck + lint + i18n + tests + build
npm run check-env        # which providers are configured, and what breaks
npm run check-i18n       # catalog completeness across all 7 locales
npm run db:types:check   # src/types/database.ts vs the live schema
npm run super-admin      # bootstrap / recovery
```

### When `npm run dev:clean` is the answer

Two dev-only failures look like broken code and are not:

**`Cannot find module './vendor-chunks/<something>.js'`** — the chunk is
usually sitting on disk; `webpack-runtime.js` is holding a manifest that
disagrees with it. Next's dev cache can drift out of step after a long run
of hot reloads, especially across large refactors, and the
`static-paths-worker` in the stack trace is the giveaway. `dev:clean`
rebuilds it.

**`Server Action "…" was not found`** — the browser is holding a page from
before a restart and is posting an action id the server no longer knows.
A hard reload of the tab fixes it; clearing the cache is what *causes* it,
so use plain `npm run dev` unless you actually need the clean rebuild.

Note that dev and production write to **different** directories
(`.next-dev` and `.next`, set by `distDir` in `next.config.ts`), so
building while the dev server runs is safe and neither command disturbs
the other.

`npm run verify` is the gate. All of it passes as of this handoff:
typecheck clean, lint clean, 7/7 catalogs in sync, 34/34 tests passing,
production build succeeds (193 static pages).

---

## 14. Deployment

1. Apply `supabase/migrations/*.sql` in order (or
   `supabase/all_migrations.sql` on a fresh project).
2. Create the private `mujeeb-files` storage bucket.
3. Set every variable in `.env.example` in Vercel, scoped per environment.
   `RESEND_API_KEY` is required for registration to work.
4. Point Paystack's webhook at `https://<domain>/api/billing/webhook`.
5. Set the Supabase Auth **Site URL** and add
   `https://<domain>/api/auth/confirm` and `/api/auth/callback` to the
   redirect allow-list.
6. `npm run super-admin -- grant --email you@example.com`.
7. Enable leaked-password protection.
8. Verify: register a genuinely new address, sign in, send a message,
   open `/admin`, confirm `/pricing` shows $10.
