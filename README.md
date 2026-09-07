# Mujeeb AI

An AI platform built for multi-model intelligence.

Mujeeb AI is a multi-model workspace and conversational platform built with Next.js 15, React 19, Supabase (PostgreSQL with Row Level Security), Tailwind CSS v4, and Radix UI. It provides streaming responses with reasoning token extraction, multimodal document and image processing, Flux-based image generation, localized multi-lingual support in 7 languages (including full RTL layout parity for Arabic), entitlement-driven quota management, Paystack subscription billing, and a dual-tier staff administration console.

---

## Table of Contents

- [Architectural Overview](#architectural-overview)
- [Key Features](#key-features)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Database Schema & Migrations](#database-schema--migrations)
- [Getting Started](#getting-started)
  - [Prerequisites](#prerequisites)
  - [Environment Configuration](#environment-configuration)
  - [Installation & Local Run](#installation--local-run)
  - [Bootstrapping Super Admin](#bootstrapping-super-admin)
- [Available Scripts](#available-scripts)
- [Security & Governance](#security--governance)
- [Internationalization (i18n)](#internationalization-i18n)
- [Deployment](#deployment)

---

## Architectural Overview

```
                           +-------------------------------------+
                           |            Next.js App              |
                           |   (Next.js 15, React 19, App Router)|
                           +-------------------------------------+
                                     /             \
                                    /               \
            +----------------------+                 +----------------------+
            |  Customer Application|                 |    Staff Consoles    |
            | (Chat, Vision, Docs) |                 | (Admin & Moderator)  |
            +----------------------+                 +----------------------+
                       |                                         |
                       +--------------------+--------------------+
                                            |
                         +--------------------------------------+
                         |            Middleware & API          |
                         |   (i18n routing, origin verification,|
                         |    CSRF, Auth session, Rate limiting)|
                         +--------------------------------------+
                               /            |            \
                              /             |             \
  +--------------------------+  +----------------------+  +---------------------+
  |   Supabase (PostgreSQL)  |  |   Model Gateways     |  |   Cloud Services    |
  |  - Row Level Security    |  |  - OpenRouter (LLMs) |  |  - Cloudflare AI    |
  |  - Service Role & Auth   |  |  - Fallback Chain    |  |    (Flux-1 Schnell) |
  |  - Storage Buckets       |  |  - Reasoning Parser  |  |  - Resend (Email)   |
  |  - Usage & Entitlements  |  |  - NDJSON Streaming  |  |  - Paystack (Billing)|
  +--------------------------+  +----------------------+  +---------------------+
```

### Core Architecture Highlights

1. **Streaming Protocol**: Messages stream from the API via NDJSON chunks (`delta`, `reasoning_delta`, `done`, `error`). The client uses an asynchronous generator stream reader to render tokens in real time alongside separate collapsible reasoning blocks.
2. **Conversation & Turn Integrity**: User prompts and assistant responses are stamped chronologically with isolated transaction settling, preventing out-of-order race conditions and stale turns.
3. **Resilient Model Routing**: Dynamic fallback chains (up to 5 hops) allow automatic degradation across providers when a model slot is rate-limited or unavailable.
4. **True-Black OLED Design**: Pure-black grounds (`#000000`), adaptive fluid typography (`clamp()`), and responsive mobile drawers (`Sheet`) ensure a high-end experience across both desktop and mobile devices.

---

## Key Features

### 1. Multi-Model Chat & Reasoning
- Select between free, pro, and advanced reasoning models powered by OpenRouter.
- First-token streaming with live reasoning display (`thinking` mode extraction).
- In-place message editing with optimistic tree rewrites.
- Multi-variant regeneration with variant switching.
- Graceful stream abortion and recovery.

### 2. Multimodal Documents & Attachments
- File upload processing with magic byte inspection and extension validation:
  - **Documents**: PDF (`pdf-parse`), DOCX (`mammoth`), CSV, XLSX/XLS (`xlsx`), plain text.
  - **Images**: PNG, JPEG, WEBP, GIF.
- Prompt injection defense: Untrusted document contents are enclosed within cryptographic nonces before dispatch to LLM context windows.

### 3. Image Generation
- Integrated image generation powered by Cloudflare Workers AI (`@cf/black-forest-labs/flux-1-schnell`).
- Persistent asset storage in Supabase Storage with signed asset proxy routes.

### 4. Internationalization (7 Languages & RTL)
- Supported languages:
  - 🇺🇸 English (`en`)
  - 🇸🇦 Arabic (`ar`) — with full Right-to-Left (RTL) layout parity
  - 🇫🇷 French (`fr`)
  - 🇪🇸 Spanish (`es`)
  - 🇧🇷 Portuguese (`pt`)
  - 🇨🇳 Chinese (`zh`)
  - 🇯🇵 Japanese (`ja`)
- Intelligent locale resolution based on visitor geolocation country headers, fallback `Accept-Language` headers, and URL prefixes (`/[locale]/...`).

### 5. Subscription & Entitlements Engine
- Multi-currency billing handled through Paystack (e.g. `NGN ₦`, `USD $`).
- Daily quota tracking for messages, image generation, vision inputs, and file attachments.
- Secure webhook listener with HMAC-SHA512 signature validation and idempotent subscription updates.

### 6. Staff & Admin Consoles
- Dedicated, non-enumerable administrative portal protected by secret slug paths (`STAFF_PORTAL_SLUG` and `ADMIN_PORTAL_SLUG`).
- Role-based access control (Super Admin, Moderator, User).
- Live Model Registry management: toggle availability (`available`, `locked`, `disabled`, `maintenance`), adjust tier gating, and repoint provider model IDs.
- System-wide audit logs, broadcast announcements, user account controls, and plan configuration.

---

## Tech Stack

| Layer | Technology |
|---|---|
| **Framework** | [Next.js 15](https://nextjs.org/) (App Router, Server Actions, React Server Components) |
| **Runtime / Library** | [React 19](https://react.dev/) |
| **Styling** | [Tailwind CSS v4](https://tailwindcss.com/), CSS variables, fluid typography clamp |
| **UI Primitives** | [Radix UI](https://www.radix-ui.com/), [Lucide React](https://lucide.dev/), Sonner |
| **Database & Auth** | [Supabase](https://supabase.com/) (PostgreSQL, Row Level Security, Auth SSR) |
| **AI Gateway** | [OpenRouter API](https://openrouter.ai/) |
| **Image Generation** | [Cloudflare Workers AI](https://developers.cloudflare.com/workers-ai/) (Flux-1-schnell) |
| **Email Delivery** | [Resend](https://resend.com/) |
| **Payment Gateway** | [Paystack](https://paystack.com/) |
| **Localization** | [next-intl](https://next-intl-docs.vercel.app/) |
| **Validation** | [Zod v4](https://zod.dev/) |
| **Testing** | Node test runner with `tsx` |

---

## Project Structure

```text
├── messages/                 # Translation dictionaries (en, ar, fr, es, pt, zh, ja)
├── public/                   # Static assets, logos, favicons, PWA manifests
├── scripts/                  # Operational CLI scripts & smoke tests
│   ├── check-env.ts          # Validates environment readiness & failure boundaries
│   ├── check-i18n.ts         # Verifies 100% translation key completeness across all 7 locales
│   ├── smoke-chat.ts         # End-to-end chat turn test
│   ├── smoke-conversation.ts # Verifies turn alternation and history
│   ├── smoke-models.ts       # Validates reasoning vs non-reasoning slots
│   └── super-admin.ts        # Bootstrap CLI for provisioning super administrators
├── src/
│   ├── admin/                # Permissions matrix, audit logging, staff operations
│   ├── ai/                   # OpenRouter gateway, streaming logic, registry, fallbacks
│   ├── app/                  # Next.js App Router (locale routing, API endpoints, layouts)
│   │   ├── [locale]/
│   │   │   ├── (app)/        # In-app experience: /chat, /chat/[id], settings
│   │   │   ├── (auth)/       # Auth routes: login, register, reset password, verify
│   │   │   ├── (marketing)/  # Landing page, pricing table, legal pages
│   │   │   └── (staff)/      # Protected staff consoles (/admin, /moderator)
│   │   └── api/              # Route handlers: chat stream, image generation, assets, paystack webhooks
│   ├── auth/                 # Session management, role assertion, MFA checks
│   ├── billing/              # Pricing resolution, plans, Paystack transactions
│   ├── chat/                 # Database message mapping and turn integrity
│   ├── components/
│   │   ├── chat/             # Chat view, composer, message list, model selector, sidebar
│   │   ├── marketing/        # Header, footer, theme toggle, language switcher, mobile nav
│   │   └── ui/               # Radix UI wrappers (dialog, dropdown, sheet, button, table)
│   ├── files/                # Document parsers (PDF, DOCX, CSV, XLSX) and security gates
│   ├── i18n/                 # next-intl configuration, routing, locale negotiation
│   ├── lib/                  # Supabase clients, streaming protocols, logger, settings
│   └── types/                # TypeScript definitions & Supabase generated database types
└── supabase/
    └── migrations/           # 25+ SQL migrations (RLS, tables, functions, triggers, seed)
```

---

## Database Schema & Migrations

The database is built on PostgreSQL with Row Level Security (RLS) enabled on every user-facing table:

- **`profiles`**: User metadata, active tier, reading font preference, role (`user`, `moderator`, `super_admin`), and suspension status.
- **`conversations`**: Chat sessions, titles, pinning, archive flags, and timestamps.
- **`messages`**: Sequence of user and assistant turns with optimistic ID reconciliation and settlement states (`pending`, `streaming`, `complete`, `stopped`, `error`).
- **`message_variants`**: Regenerated variant trees with explicit finish reasons, provider response IDs, and reasoning summaries.
- **`models` & `providers`**: Dynamic model registry with tier requirements, reasoning rules, fallback targets, and priority routing.
- **`assets`**: Stored user attachments and generated images with MIME types and storage references.
- **`plans` & `plan_entitlements`**: Configurable subscriptions, currency price mappings, and daily feature limits.
- **`user_daily_usage`**: Atomically enforced daily meters for messages, images, vision requests, and file processing.
- **`audit_logs`**: Tamper-evident operational log tracking staff modifications, privilege escalations, and model changes.

Migrations are located in `supabase/migrations/` and can be pushed using the Supabase CLI:
```bash
supabase db push
```

---

## Getting Started

### Prerequisites

- **Node.js**: `v20.x` or higher
- **Package Manager**: `npm`
- **Supabase Account**: With a configured project and storage bucket
- **OpenRouter API Key**: For model inference
- **Resend API Key**: For email verification and password resets
- **Paystack Keys**: For subscription payments (optional in local development)
- **Cloudflare Workers AI**: For image generation (optional)

### Environment Configuration

1. Copy `.env.example` to `.env.local`:
   ```bash
   cp .env.example .env.local
   ```

2. Fill in the required credentials in `.env.local`:
   ```env
   # Required
   NEXT_PUBLIC_SUPABASE_URL=https://your-project-ref.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_...
   SUPABASE_SERVICE_ROLE_KEY=sb_secret_...
   NEXT_PUBLIC_SITE_URL=http://localhost:3000
   NEXT_PUBLIC_APP_NAME="Mujeeb AI"
   RESEND_API_KEY=re_...
   RESEND_FROM_EMAIL="Mujeeb AI <security@yourdomain.com>"

   # AI Inference & Generation
   OPENROUTER_API_KEY=sk-or-v1-...
   CLOUDFLARE_ACCOUNT_ID=...
   CLOUDFLARE_API_TOKEN=...

   # Payments
   PAYSTACK_SECRET_KEY=sk_test_...
   PAYSTACK_PUBLIC_KEY=pk_test_...

   # Admin Security
   SUPER_ADMIN_SETUP_TOKEN=your-random-token
   STAFF_PORTAL_SLUG=your-secret-slug
   ADMIN_PORTAL_SLUG=your-admin-slug
   ```

3. Validate your configuration:
   ```bash
   npm run check-env
   ```

### Installation & Local Run

```bash
# Install dependencies
npm install

# Run type check and verify tests
npm run typecheck
npm test

# Start development server
npm run dev
```

Visit `http://localhost:3000` to access the application.

### Bootstrapping Super Admin

To promote a user account to Super Admin:

1. Ensure `SUPER_ADMIN_SETUP_TOKEN` is set in `.env.local`.
2. Register a standard user account through the web interface.
3. Run the bootstrap CLI:
   ```bash
   npm run super-admin promote <user-email>
   ```
4. Access the staff console at:
   ```text
   http://localhost:3000/en/{STAFF_PORTAL_SLUG}/admin
   ```

---

## Available Scripts

| Command | Description |
|---|---|
| `npm run dev` | Starts Next.js development server |
| `npm run build` | Builds the application for production |
| `npm run start` | Starts the production server |
| `npm run typecheck` | Validates TypeScript with `tsc --noEmit` |
| `npm run lint` | Executes ESLint analysis |
| `npm test` | Runs the full unit test suite via `tsx` |
| `npm run check-env` | Audits environment variables and reports active feature boundaries |
| `npm run check-i18n` | Asserts parity and missing translation keys across all 7 locales |
| `npm run verify` | Full CI gate: typecheck, lint, i18n checks, tests, and build |
| `npm run smoke:chat` | Performs a live test against the streaming chat route |
| `npm run smoke:models` | Verifies thinking and non-thinking slots |
| `npm run smoke:conversation` | Tests conversation history consistency and turn alternation |
| `npm run smoke:ordering` | Asserts timestamp sequence and ordering integrity |
| `npm run smoke:staff` | Verifies staff authorization gates and route permissions |

---

## Security & Governance

- **Zero-Trust Client Access**: Public client interactions are bound strictly by Postgres Row Level Security (RLS). The `SUPABASE_SERVICE_ROLE_KEY` is restricted strictly to server-only boundary code (`server-only`).
- **Prompt Injection Isolation**: User uploaded files and contextual document attachments are escaped and wrapped within unique cryptographic nonces before prompt construction.
- **Obscured Staff URLs**: Administrator and moderator consoles answer exclusively on unpredictable paths governed by `STAFF_PORTAL_SLUG` and `ADMIN_PORTAL_SLUG`. Unauthenticated probes to standard `/admin` return HTTP 404.
- **Safe Authentication Origin Matching**: OAuth redirect origins are resolved dynamically from request headers (`x-forwarded-host`, `x-forwarded-proto`), preventing callback redirection spoofing across custom domains and preview branches.
- **Tamper-Proof Billing Webhooks**: Paystack webhooks require HMAC-SHA512 verification before processing any transaction payload.

---

## Internationalization (i18n)

Mujeeb AI is engineered from the ground up for multi-lingual fluency:

- All copy is centralized in `messages/{locale}.json`.
- Missing keys or structure drift between languages are caught in CI using `npm run check-i18n`.
- Full bidirectional support: Arabic triggers `<html dir="rtl">`, adjusting padding, iconography, sheet drawers, and animations via logical CSS properties (`start`, `end`, `ms-`, `me-`).

---

## Deployment

### Vercel Deployment

1. Import the repository into your Vercel team dashboard.
2. In **Project Settings &rarr; Environment Variables**, populate all required keys from `.env.example`.
3. Configure the custom domain (e.g., `mujeebai.yungswag.xyz`):
   - Add a CNAME DNS record in your registrar pointing to `cname.vercel-dns.com`.
4. Add your Paystack webhook URL in the Paystack Dashboard:
   ```text
   https://mujeebai.yungswag.xyz/api/billing/paystack/webhook
   ```
5. Deploy `main`. Automatic deployments will trigger on any push to the `main` branch.

---

## License

Private and proprietary. All rights reserved.
