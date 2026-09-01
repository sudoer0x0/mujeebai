# Mujeeb AI

A multilingual AI workspace: streaming chat across multiple providers,
document and image understanding, image generation, plan-based usage
quotas, subscriptions, and separate consoles for administrators and
moderators.

Built so that no external service is load-bearing — the AI gateway,
storage, billing and email all sit behind adapters.

## Stack

Next.js 15 (App Router) · React 19 · TypeScript · Tailwind v4 ·
Supabase (Postgres, Auth, Storage) · next-intl (7 locales, full RTL) ·
OpenRouter · Cloudflare Workers AI · Resend · Paystack · Vercel.

## Getting started

```bash
npm install
cp .env.example .env.local     # then fill it in
npm run check-env              # tells you what is missing and what breaks
npm run dev
```

### Minimum configuration

| Variable | Why |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Everything past the marketing pages |
| `SUPABASE_SERVICE_ROLE_KEY` | Registration, quotas, admin actions, webhooks |
| `NEXT_PUBLIC_SITE_URL` | Builds the links inside auth emails |
| `RESEND_API_KEY`, `RESEND_FROM_EMAIL` | **Registration.** See below |
| `OPENROUTER_API_KEY` | Chat |

> **Resend is not optional in practice.** Supabase's built-in SMTP only
> delivers to addresses on your project team; when it refuses, sign-up
> returns HTTP 500 and the account is never created. Mujeeb AI sends its
> own verification, reset and magic-link mail through Resend instead. The
> sending domain must be verified in Resend first.

### Database

Apply the migrations in order, or run `supabase/all_migrations.sql` on a
fresh project. Then create a **private** storage bucket named
`mujeeb-files`.

Verify the checked-in types still match the live schema at any time:

```bash
npm run db:types:check
```

### First Super Admin

The first administrator is never created through the web app.

```bash
# generate a token, put it in .env.local as SUPER_ADMIN_SETUP_TOKEN
openssl rand -hex 32

npm run super-admin -- create --email you@example.com   # provision + grant
npm run super-admin -- grant  --email you@example.com   # existing account
npm run super-admin -- list
```

The token is prompted for and never echoed; passwords are never accepted
as command-line arguments. Rotate the token after use.

Locked out? `npm run super-admin -- recover --email you@example.com`
resets the password, clears MFA factors and restores the role. The
database refuses to remove the last active Super Admin.

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev` / `build` / `start` | Next.js |
| `npm run verify` | typecheck + lint + i18n + tests + build — the gate |
| `npm run check-env` | Which providers are configured, and what breaks without each |
| `npm run check-i18n` | Catalog completeness across all 7 locales |
| `npm run db:types:check` | `src/types/database.ts` vs the live schema |
| `npm run super-admin` | Bootstrap and recovery |

## Project structure

```
src/
  admin/          permission matrix, audit log, staff data + server actions
  ai/             gateway, model registry, provider adapters, turn runner
  app/[locale]/   (marketing) (auth) (app) admin/ moderator/
  app/api/        chat, conversations, files, images, models, auth, billing
  auth/           session guards, registration service
  billing/        plans, pricing (single source of truth), entitlements
  components/     ui/ (design system) chat/ staff/ billing/ marketing/
  files/          upload validation + per-type processors
  lib/            env (browser) / env.server (secrets), supabase, rate limit
  notifications/  email adapter + localized templates
  storage/        storage adapter
  usage/          quota engine, admin operations
messages/         en fr ar pt es ja zh
supabase/         migrations
```

`@/lib/env` is browser-safe. `@/lib/env.server` carries `server-only`, so
a Client Component that reaches for a secret fails the build.

## Deployment (Vercel)

1. Apply the migrations; create the private `mujeeb-files` bucket.
2. Set every variable from `.env.example`, scoped per environment.
3. Point the Paystack webhook at `https://<domain>/api/billing/webhook`.
4. In Supabase Auth, set the Site URL and allow-list
   `https://<domain>/api/auth/confirm` and `/api/auth/callback`.
5. Enable leaked-password protection (Authentication → Policies).
6. Grant the first Super Admin.
7. Smoke test: register a genuinely new address, sign in, send a message,
   open `/admin`.

## Documentation

- [`HANDOFF.md`](./HANDOFF.md) — current state, what is verified, known gaps
- [`ARCHITECTURE.md`](./ARCHITECTURE.md) — layers and design decisions
- [`SECURITY.md`](./SECURITY.md) — threat model and controls
- [`CHANGELOG.md`](./CHANGELOG.md) — what changed and why
- [`CONTRIBUTING.md`](./CONTRIBUTING.md) — conventions
