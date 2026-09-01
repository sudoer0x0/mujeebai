# Changelog

## 2026-09-01 — "No authenticator is set up" (there was one)

### I reintroduced the bug I had just fixed

Earlier today I fixed the step-up screen reporting every failure as "that
code isn't right". The fix added branches for the causes that are not the
code — and used `mfaUnavailable` as the fallback for anything
unrecognised. `mfaUnavailable` reads **"No authenticator is set up on this
account."**

So an unrecognised error now told an operator their perfectly good
authenticator did not exist. Same misdirection, more alarming words,
introduced by the fix for it.

Two changes, and the second is the one that matters.

**The screen only says what it knows.** An HTTP status is trusted because
it says what it says: 429 is a rate limit, 5xx is a server fault.
Everything else is reported as a wrong code, because that is
overwhelmingly what it is. The provider's own message is logged rather
than pattern-matched — guessing at error text is what produced a
confidently wrong message twice.

**The factor is resolved on the server.** The browser was calling
`listFactors()` and treating an empty result as "no authenticator
exists". That call can come back empty for reasons that have nothing to
do with the account — a client created before the session cookie was
written, a network blip — and the account is then told it has no
authenticator. The id is now read while authenticating, on both the
sign-in and the `?step=mfa` paths, and passed to the form. The browser
lookup remains only as a fallback.

Verified end to end against a running build: server-side the factor is
found and a fresh code verifies to `aal2`; the rendered step-up screen
shows no alert, carries the resolved factor id, and asks for a code.

### The recovery note is gone

"Staff accounts are recovered from the server with
`scripts/super-admin.ts`" — a repository path shown on a sign-in page, to
an audience who cannot act on it. Removed from the screen and from all
seven catalogues, so it cannot drift back onto a page.

### A note on testing

Two assertions in this session failed against *correct* behaviour because
they searched the whole document for a phrase. next-intl ships the entire
message catalogue to the client, so every string appears in the HTML of
every page. Both now read the rendered element — the alert's own
`role="alert"` text, the label's own node — which is what an operator
actually sees. The step-up screen is now covered by the smoke walk for
exactly this reason: it has said something untrue twice.


## 2026-09-01 — Two dev servers, one build directory

### The webpack error

`__webpack_modules__[moduleId] is not a function`, thrown from
`(staff-auth)/layout.tsx`. The file was not the problem.

Two `next dev` processes were running against this project — one on :3000
and one on :3001 — and they share a single `.next-dev` directory. They
overwrite each other's module graph as they compile, and the failure
surfaces as a type error inside whichever file happened to be recompiled
mid-write. The second error, "an unexpected response was received from
the server", was the same corruption reaching the page below it.

`npm run dev` now refuses to start when a dev server is already running
for this directory, and says why. It is conservative on purpose: it only
matches a `next dev` whose command line contains *this* project path, so
a dev server for something else is left alone and a false positive cannot
block work.

### A real bug in the same file

Separately, and worth fixing regardless: the staff entrance layout called
`getTranslations("staffAuth.portal")` with no locale, unlike every other
layout under `[locale]`, all of which take `params` and pass it. Without
`setRequestLocale` there is no request-scoped locale for it to fall back
on — fragile in a layout that is already dynamic because it reads
headers. It now takes `params` and passes the locale explicitly.

Verified against a production build across five locales including Arabic
and Japanese, both entrances rendering their own label.


## 2026-09-01 — "That code isn't right" (it was), and two real doors

### The authenticator code was fine

The message was wrong, not the code. Every failure from
`challengeAndVerify` was reported as "That code isn't right" — including
failures that had nothing to do with the code, which sent operators to
check an authenticator that was telling them the truth.

Three causes are now handled rather than mislabelled:

- **The session was already stepped up.** A step-up that succeeded but
  whose destination then 404'd left the session at `aal2`; coming back
  and entering a fresh code asked Supabase to challenge a factor already
  verified for that session, which it refuses. The screen now checks the
  assurance level on mount and simply continues if there is nothing left
  to prove.
- **A stale browser client.** The Supabase client is created when the
  page mounts — before the password step writes the new session cookie —
  so its in-memory session can be absent, and a challenge on a stale
  session fails exactly like a wrong code. The session is re-read from
  cookies before challenging.
- **Rate limits and expired challenges** now say so.

Anything still unrecognised is logged rather than blamed on the operator.

### Two doors that say which is which

Both entrances rendered "STAFF ACCESS", so there was no way to tell which
console you had opened.

Each now names itself — **Super admin access** / **Moderator access** —
and the name comes from the *secret the request arrived through*, not
from the path. That distinction is the whole fix: `/staff/login` is
served under both entrances, so deriving it from the path labelled the
super admin door as the moderator one.

The area travels as a request header the middleware sets. Any inbound
`x-portal-area` is deleted first, so the browser cannot state its own —
asserted in the smoke walk with a forged header.

**Each entrance now admits only its own role.** A moderator signing in at
the admin URL is refused and told to use their own link, rather than
having it confirmed as a working staff entrance. This is a routing rule,
not the authorization boundary — the role matrix and portal guards are
unchanged — and it exists so the two doors stay genuinely separate.

The consoles themselves were both called "console" too; they are now
**Super admin console** and **Moderator console**.

### The case with no secrets configured

Local development has one shared door. Inferring an area from the path
there would read as "staff", so a super admin signing in locally would be
refused for using the wrong entrance when no wrong entrance exists. No
secrets means no header, the label reads a neutral "Staff access", and
the entrance rule does not apply. Both configurations are tested.


## 2026-09-01 — Super admin console reachable again; invitation emails

### The super admin console was unreachable

Both entrances led to the moderator portal, so there was no way in as a
super admin. Two faults, one on each side of sign-in.

**The bounce went to the wrong entrance.** `/staff/login` is served under
both secrets, and the middleware resolved which one by path alone — which
always picks the moderator's. Opening a `/{adminSlug}/admin` bookmark
therefore landed on the *moderator* entrance. It now resolves by the area
being entered, so an admin bookmark leads to the admin entrance.

**The destination after sign-in was built in the browser.** It took the
slug from the page's own URL, so a super admin who signed in at the
moderator entrance was sent to `/{moderatorSlug}/admin` — which 404s,
correctly, because that secret does not guard `/admin`. The page cannot
know which slug an account is entitled to; only the server does. The
sign-in action now returns the fully-resolved destination and the client
navigates to it verbatim.

This is the third bug from the same root: prefixing done by hand at each
call site. There are now unit tests asserting each role's destination
carries its own secret, and the smoke walk signs in as a **moderator**
too and proves they reach `/moderator`, are refused `/admin`, and cannot
reach it through their own secret either.

### Invitation emails

With the domain now authenticated (SPF, DKIM, DMARC in Resend), both
invitations get their own template again rather than borrowing the
sign-in one.

- **Subjects say invitation, not sign-in.** "You're invited to Mujeeb AI"
  and "A special invitation to Mujeeb AI". `magicLink` keeps its sign-in
  wording, because that is what it is.
- **The special invitation is personal again**: the heading addresses the
  recipient by name, and the body says plainly that this is not a general
  sign-up and that an account is already waiting.

`{name}` is an ICU placeholder, so the value is now passed to *every*
catalog lookup rather than only the ones using it today — a template
containing a placeholder with no value supplied throws at render time,
and an email that fails to build is an email nobody receives.

### A way to read an email before sending it

`/api/dev/email-preview?kind=…&locale=…` renders any template as subject,
text and HTML. Development only: it 404s in production, so it cannot be
probed for the template list. It is how the copy above was checked —
including that no literal `{name}` leaks into a subject line.


## 2026-09-01 (revert) — Email components restored

I changed the invitation emails on a theory and made delivery worse. The
ordinary invite had been arriving reliably; after my change it went to
junk too. Reverted.

### What I got wrong

I reasoned that a long tokenised URL under the words "you have been
invited" reads as phishing, so I removed the readable fallback link and
rebuilt invites to carry no token at all — a plain link to the sign-up
page instead.

That was reasoning, not evidence, and the evidence went the other way. A
message whose only link is hidden behind a styled button gives a filter
*less* to verify and a reader no way to see where they are being sent.

### Restored

- **The readable fallback URL** under the button, in every email.
- **The invite flow**: the account is created, a Supabase auth link is
  mailed, and the send is rolled back if delivery fails. Undo works again
  (it deletes an unredeemed invitation; `users.delete`, super-admin only).
- The unused `invite` template kind I had added is gone.

### The special invitation, kept but quieter

Rather than delete the feature, its copy is now modelled on the
`magicLink` template — the one with an actual delivery record. Same
structure, same subject, same call to action, and none of the vocabulary
filters weight heavily ("exclusive", "VIP", "selected"). It differs in
its heading and one sentence. The toggle in the console now describes
what it really does instead of promising a "clearly-VIP" message.

### What I do not know

Two explanations fit the evidence and I cannot separate them from here:
the copy triggered filters, or the sending domain's reputation simply
degraded across a session of test sends from a young domain. Both are
plausible.

What is certain is that the real fix is not in this codebase. **SPF, DKIM
and DMARC for `mujeebai.yungswag.xyz` in Resend** are what move mail from
junk to inbox for a new domain; until they are configured, any wording
will drift. Once they are in place, a louder special invitation can come
back safely.


## 2026-09-01 (later) — PWA, themes, invites rebuilt, billing cycle

### Your email was never in the code

Checked rather than asserted: the owner's address appears in **no**
file that would be pushed, and zero times in the distribution ZIP. It is
not in `.env.local` either.

I knew it two ways, neither of which was reading the source: you listed
your accounts in conversation, and I queried your live database with the
`SUPABASE_SERVICE_ROLE_KEY` from `.env.local` while testing. That key
reads every user's email — which is exactly why it must never be
committed (it is gitignored) and why any key pasted into a chat has to be
rotated.

`HANDOFF.md` did name the address; that was redacted earlier.

### Invitations rebuilt — and that is the spam fix

The old invite provisioned an account and mailed a Supabase magic link.
That was wrong three times over, and the junk folder was the symptom:

- **A long opaque tokenised URL under the words "you have been invited"
  is the exact shape of a phishing email**, and filters score it that
  way. The bare fallback URL printed under the button made it worse.
- It created a real account for someone who had not asked for one, and a
  mistyped address left an unreachable orphan to roll back.
- The way in then lived in an inbox indefinitely.

Invitations now carry **no token at all**. The button points at the
sign-up page; the recipient creates the account themselves and chooses a
password nobody else ever sees. Nothing is provisioned until they act,
which is what you asked for and removes the main spam signal at the same
time. The naked URL under the button is gone from every email.

Deliverability beyond this is domain configuration, not code — SPF, DKIM
and DMARC for `mujeebai.yungswag.xyz` in Resend. Without those, *any*
mail from a new domain lands in junk eventually.

Both invite kinds are now editable in the email-template console, so you
can see and change exactly what each one says.

### A real PWA

The manifest existed; nothing else did. The icons were **1×1 pixel
placeholders**, so an install prompt had nothing to show.

- Real icons, drawn to match the site header — a rounded square with the
  accent gradient and a white M. No image library was available, so they
  are rasterised by a small PNG encoder: 192, 512, a maskable 512 with the
  mark inside the safe zone, and a 180 for iOS.
- A **service worker**, which is what actually makes the app installable.
  Its caching rules are a strict allowlist: nothing under `/api/`, no RSC
  payloads, no response carrying `Set-Cookie` or `Cache-Control: private`,
  no opaque cross-origin response. A service-worker cache is unencrypted
  origin storage that outlives the session — the staff console must never
  be readable from disk after sign-out.
- An offline page, iOS standalone meta (iOS ignores the manifest for
  this), a maskable icon, and a "New chat" shortcut.
- Not registered in development, where a caching worker is the classic
  "why am I still seeing the old page" bug.

### Themes

Seven accent colours, applied across buttons, links, focus rings and the
chat. Light and dark are separate palettes rather than one lightened
programmatically — the same hue needs more chroma on a dark ground, and
the text colour on top of the accent has to flip to stay legible.

The stored value is an **identifier, never a colour**. It only selects a
`[data-accent]` rule that already exists, so nothing a person can set
reaches a style attribute. Guarded three times: the TypeScript list, a
zod enum, and a CHECK constraint. Applied before first paint via the same
cookie mechanism as the theme, and re-applied on client navigation — or a
sign-in on a shared browser keeps the previous account's colour.

### Billing cycle

The panel computed the renewal date and then only showed it if you were
cancelling, so "when am I next charged?" was unanswerable. It is now
always shown for a paid plan: period start, renewal date, and days
remaining. Complimentary grants say so and correctly offer no cancel
button — there is no payment to stop.

### Also

- "Start for free" now says **Create your free account**, which is what
  the button does.
- The homepage price was never hardcoded — it reads `price_usd` from the
  plan row. It showed $10 because that is your Pro price in the platform
  default currency.
- **The currency setting works.** What I saw was a stale `unstable_cache`
  entry caused by my own direct database write, which bypasses the
  invalidation the console performs. Set through the panel it applies:
  the homepage now reads **NGN 15,000**.
- The site URL, OpenRouter attribution and metadata base all point at
  `mujeebai.yungswag.xyz`, with `metadataBase` set so shared links stop
  resolving preview images against localhost.


## 2026-09-01 (final) — Email templates, and the 404 after MFA

### The bug you hit

Entering the authenticator code sent the browser to `/en/admin`, which
404s. The step-up branch prefixed its destination with the secret path;
the **challenge** branch passed `state.portal` raw. Sign-in succeeded and
landed on a dead URL.

That was not the only one. Prefixing was being done by hand at each call
site, so every new one was a fresh chance to forget — and four more had:
both staff onboarding steps, and five links from the admin dashboard,
subscriptions, usage and moderator quick-links. The whole onboarding
flow would have 404'd at every step.

A type cannot catch this — every candidate is a `string` — so there is
now a test that scans the source and fails on any navigation to a bare
staff path. It found the five links above the moment it was written.

### Testing the pages, not the URLs

Requesting a console URL unauthenticated only ever proves it redirects.
That is the gap the 404 slipped through, so there is now
`npm run smoke:staff`: it signs in for real, enrols and verifies a TOTP
factor to reach `aal2`, and requests every console page the way a browser
would. 17 super admin pages, 5 moderator pages, the post-MFA landing and
a user detail page — all 200.

It creates a temporary super admin, so it refuses any origin that is not
localhost, and deletes the account in a `finally`. An earlier run aborted
mid-walk and left a real `super_admin` on the project; a cleanup that
only runs on the happy path is not a cleanup.

### Configurable, versioned email templates

`/admin/email-templates`, super admin only — this is the copy the platform
sends from its own domain, and a bad edit is a phishing email with genuine
headers.

**The catalogs remain the default.** The store only ever *overrides*, and
a blank field means "use the built-in wording". So an operator can change
one subject line and leave the other six locales correctly translated, a
deployment that never opens the screen behaves exactly as before, and a
database that is unreachable at send time degrades to the shipped copy
rather than failing to send. The editor shows the defaults as placeholder
text, so what will actually go out is always visible.

**Every save is a version.** `email_template_versions` is append-only,
enforced by a trigger rather than by convention: someone who could edit a
version row could quietly rewrite what an email is recorded as having
said. Restoring is a *new* version carrying the old content, never a
rewind — the history keeps growing, so it shows what happened, and a
restore can itself be undone by restoring again.

**Reset is a recorded change, not a delete.** Deleting cascaded into the
version rows, which the append-only trigger correctly refused. Rather than
weaken the guarantee, reset saves a blank version — which is what "use the
built-in copy" already means everywhere else. The history survives, the
reset is itself in the history, and the earlier copy stays restorable.

Placeholders (`{name}`, `{appName}`, `{email}`) are a closed set: anything
an operator types ends up in an email sent from this domain, so
substitution must not reach arbitrary data. An unknown placeholder is left
visible rather than blanked, so a typo shows up in the preview.

Verified against the live database: 19 checks covering versioning,
restore, append-only enforcement (UPDATE genuinely refused), RLS (a
customer reads zero rows from both tables), and fallback after reset.

### One more thing the build caught

The client editor imported the `server-only` store for three constants,
which would have dragged the service-role client toward the browser
bundle. Split into `templates/shared.ts` — pure, no server imports.
Confirmed afterwards that no secret appears anywhere in `.next/static`.


## 2026-09-01 (later) — VIP invites, Google sign-in, idle cut-off, split slugs

### The console was not broken by the secret URL

Diagnosed rather than guessed. The `ChunkLoadError` was a **dev-server
cold compile**: `/[locale]/staff/login` takes ~11.6s to build from cold
and ~1.1s warm. The browser gave up waiting, the global error boundary
caught it, and nothing hydrated — which is exactly "no button works",
including the MFA confirm and the password reveal. Caused by repeatedly
deleting `.next-dev`, not by the rewrite. Production was never affected:
every chunk is prebuilt and returns 200, the CSP nonce on the header
matches the one on the script tags, and the RSC payload resolves through
the rewrite.

### Two secrets, not one

`ADMIN_PORTAL_SLUG` now guards `/admin`; `STAFF_PORTAL_SLUG` guards
`/moderator`. Sign-in is reachable under both, and which console you land
in is decided server-side from your role — so a moderator, who learns
their own URL simply by using it, never receives the administrator's.
The staff slug is refused on `/admin` with a 404, tested both ways.

If only `STAFF_PORTAL_SLUG` is set it still covers both, so existing
single-slug setups keep working.

### Five-minute idle cut-off on the consoles

Two halves, and it needs both. The **middleware** enforces it from an
httpOnly cookie timestamp — that is the actual control, and it holds with
JavaScript off and against a replayed session cookie. The **page**
heartbeats while there is real interaction, which is what stops an
operator who is *reading* a long audit log from being ejected mid-sentence.
A warning appears a minute before.

Customer sessions are deliberately exempt: ending someone's own chat
because they read slowly is hostile, and the blast radius is their own
account.

Malformed and future-dated cookies both read as "not idle" — a corrupted
value must never become a way to force other people out.

### Special (VIP) invitations

Both staff roles can send one. It changes the **email** — its own
subject, heading and personal framing — and nothing about the account:
there is no permission difference, and the toggle says so on itself, so
nobody sends one expecting it to grant something. That is also why it sits
behind `users.invite` rather than a stricter permission.

### Google sign-in

One button on both the sign-in and sign-up forms, because an OAuth
provider does not distinguish them. Started from a **server action**, so
the callback URL is composed server-side from `NEXT_PUBLIC_SITE_URL` —
the redirect target in an OAuth flow is precisely the value an attacker
wants control of. `next` is normalised by `safeNextPath` before use.
The existing `/api/auth/callback` needed no changes: an OAuth code and a
magic-link code exchange identically. Staff signing in this way still get
the MFA gate — OAuth does not bypass the second factor.

Google's mark is inline SVG, not a remote image: the CSP allows images
from this origin only, and widening it for one logo is a bad trade.

### Homepage

Type scale raised across the board (display 34→60px becomes 42→76px,
body 15→17 becomes 16→19), and the measures widened with it so bigger
type does not mean fewer words per line. Verified those five tokens are
used **only** by marketing pages, so the console's density is untouched.

Container widened to 76rem and — the part that was actually wrong — the
header, footer and page now share one width. The header had been at
`max-w-6xl` while the page was at `max-w-5xl`, so it visibly overhung the
content beneath it.

Header logo, wordmark and nav all scaled up. The language control was an
unlabelled icon, which does not tell you *which* language is active; it
now shows the code.

Animations restored: a staged hero entrance (0/90/180/270ms), an ambient
accent wash, scroll reveals on the lower sections, and hover lift on the
feature cards — all disabled under `prefers-reduced-motion`.

### The currency switcher is now obviously a control

A bare code in a quiet button read as a label. It has a border, an icon,
the words "Display currency", and the active code.

### Dead code

`hero-preview.tsx` (orphaned by the homepage revert), `GoogleSignInButton`
(replaced by the real one), and eight exported functions referenced
nowhere. Two of those — `getEffectiveEntitlement` and `getDefaultPlan` —
turned out to be used *inside* their own modules; the typecheck caught it
and both were restored. The `requireRole` / `requireSuperAdmin` /
`requireModerator` trio is deliberately kept: it is a matched, documented
API surface, and deleting one of a set invites someone to hand-roll it
worse later.

### Secrets and a public repo

`.gitignore` covers `.env*` except `.env.example`; a simulated `git add -A`
tracks only the template. No key, token or password appears in any source
file. The super admin's email address was named in `HANDOFF.md` and has
been redacted — not a secret, but it tells an attacker which single
account is worth attacking.


## 2026-09-01 — Portal separation, staff self-service, currency choice

### The two portals no longer touch the customer app

The console's sidebar had a "back to Mujeeb AI" link pointing at `/chat`.
It was the one place the two worlds met. It is now **Sign out and leave**:
it ends the session and returns to the public homepage, behind a
confirmation because losing an authenticator step-up to a mis-click
mid-task is its own small disaster.

The customer sidebar's link *into* the console went too, along with its
`portal` prop — the app layout already redirects staff out before it
renders, so the link was dead code that shipped admin URLs in the
customer bundle. `AdminNav`, a whole navigation component nothing
rendered, was deleted.

### The console has a secret URL

`STAFF_PORTAL_SLUG` moves it off `/admin`. The canonical path now returns
404 rather than redirecting, because a redirect tells a prober the console
exists and where it moved to. Full reasoning in SECURITY.md; the property
that took the most care is that the slug never reaches the browser —
server code reads it from a `server-only` module, client code derives it
from the URL it is already on. Verified against a production build: the
value appears nowhere in `.next`.

Unset, everything stays at `/admin`, which is the right default locally.
An invalid value is ignored rather than half-applied — a typo must not
brick the only way in.

### Moderators are first-class operators

- **Their own Security tab**, sharing one component with the super
  admin's rather than being a second copy that falls behind: session and
  assurance level, a device list with location and last-active time and
  per-device sign-out, sign out here / everywhere, and change password.
- **Changing a password requires the current one.** Supabase will change
  it from a valid session alone; that is fine for a customer and not for
  an administrator, where an unattended console would otherwise be enough
  to lock the real owner out. The check runs on a throwaway client — a
  plain `signInWithPassword` would issue a *new* session and silently drop
  the operator from `aal2` back to `aal1`.
- Rate-limited to 5 attempts per 15 minutes, because verifying a current
  password is a credential oracle.

### Copy that talked down to moderators is gone

"Your access — you can review accounts and apply account-level
moderation… restricted to Super Admins" and "Administrator and moderator
accounts are excluded from this list" both removed, and their keys
deleted from all seven catalogs so they cannot drift back onto a page.

### MFA recovery codes: not a bug

Checked rather than assumed. Supabase's MFA API has no notion of them:
`AuthMFAEnrollTOTPResponse` carries `{qr_code, secret, uri}` and nothing
else, and the string does not appear anywhere in `@supabase/auth-js`.
Nothing is being generated and dropped, and nothing is failing to render.

Since they are not wanted anyway, the recovery path is now *stated* —
during enrolment and on the Security tab — instead of being something an
operator discovers is missing at the worst moment.

### Currency is choosable

Two separate problems.

**The default could not be set.** `billing_currency` is validated against
an eight-value enum but rendered as a free-text box, so anything but an
exact `NGN` failed validation in a way that looked like "only USD works".
It is a picker now. Enum-valued settings get one generally.

**Customers could not choose.** A switcher on the pricing page and the
in-app upgrade page, offering only currencies where **every paid plan**
has a price — anything looser shows one plan priced and another
"unavailable", which reads as broken. The list is derived from stored
prices rather than configured separately, so adding an NGN price to every
plan makes NGN appear with no second step to forget.

Checkout no longer accepts a currency from the browser at all. It was not
exploitable (the amount was always read from the database), but it let
the client steer a Paystack call, and "what will I be charged in?" should
not have a client-supplied answer. The server derives it, validating the
cookie twice — once when written, once against what can actually be sold.

Nothing here converts anything. There is no exchange rate in this
feature; a currency only ever selects a price an operator typed.

### Bugs found and fixed

- **`enabledCurrencies` returned nothing.** The free plan carries
  `{"NGN": 0}`, and testing for the key's presence rather than its value
  pulled it into the set every currency had to satisfy — which a free
  plan can never do. Caught before shipping by checking against real
  data rather than trusting the types.
- **Two features had server actions and no UI.** `addModerationNoteAction`
  and `revokePlanGrantAction` were both implemented, permission-gated and
  audited, and unreachable. A moderator could not record *why* they acted,
  and a complimentary grant given by mistake could only be undone in the
  database — grants are not in the undoable set either. Both are now on
  the user detail page.
- **`GoogleSignInButton`** — a component with no OAuth route behind it.
  Deleted rather than left to break whoever rendered it.
- Invites are rate-limited to 20/hour per operator; an unbounded invite
  form is a way to send mail from this domain to arbitrary addresses.

### Verified

53 unit tests (6 new, covering slug normalisation, malformed and
colliding slugs, and exact-segment matching). Behavioural checks against
the running app: 21 URL cases including locale-less, uppercase-locale,
traversal and near-miss slugs; cross-tenant reads from eight tables and a
self-escalation attempt, all refused; production CSP confirmed to drop
`unsafe-eval` and `ws:`; every non-public secret in `.env.local` confirmed
absent from the client bundle.


## 2026-09-01 — Moderators given real authority over accounts

Four powers moved to moderators, and each one moved for a reason rather
than because the role needed filling out.

**Invite a customer.** A new `users.invite`, distinct from
`moderators.create` — the action has no `role` parameter at all, so the
form a moderator can reach is not a privilege-escalation control even if
someone forges the request. The invitee gets a link and sets their own
password; nothing secret is written into an email that then lives in two
mailboxes forever. The account is created unconfirmed, so a mistyped
address produces an account nobody can sign into rather than one anyone
can. If the email fails to send, the account is rolled back — an invite
nobody received should not litter the user list.

**Send a password reset.** Previously super-admin-only. The link goes to
the account holder's own address and gives the operator nothing: they
never see a password and cannot set one. Withholding it only meant the
single most common support request had to be escalated.

Magic links stay super-admin-only, and the contrast is the point: a reset
link asks the recipient to prove they can choose a new password. A magic
link *is* a session. Same inbox, but one of them is a way in.

**See the account's history.** A new timeline merging `moderation_records`
(the reasoned account of what was done and why) with the audit entries
aimed at that user (what happened, and who did it). They interleave — a
suspension appears in both, and read separately neither tells the story.

It is deliberately not a record of what the user *did*. No conversation
titles, no message content. A moderator reviewing a report does not need
to read someone's chats to act on the account, and building the
affordance is what makes the overreach possible later. Sign-in history —
the one piece of genuine user activity support needs — was already served
by the device list, which shows each session's device and location.

**End every session.** The answer to "I think someone else is signed in
as me". The rare privileged action with no destructive edge: nothing is
deleted and the account holder simply signs in again.

### Moderators got a user detail page

They had a list and no way to open a row. The new page is narrower than
the super admin's by construction, not by hidden buttons:

- **Staff accounts are not viewable at all** — `notFound()`, not a
  permission error, because whether a given id belongs to an
  administrator is itself not a moderator's business to confirm.
- **Usage is read-only.** Resetting a counter needs a super admin, so the
  interactive panel would offer a lever the server refuses. Tiles tell
  the moderator what a support conversation needs without pretending.
- **No entitlement overrides**, which are billing-adjacent.

### Super admins can reverse it

Undoing an invite deletes the account it created, and deletion is
super-admin-only — so a moderator issues invitations and an administrator
reverses them. That asymmetry is exactly what was asked for, and it falls
out of the existing rule that undo requires the permission the forward
action would need *now*.

The reversal refuses once the invitation has been redeemed. An account
someone has signed into is theirs; "undo" must not become a way to delete
a real customer two weeks later because a stale button was still on
screen. The failure says *why* — "already used" rather than "undo
failed", which would send an operator hunting for a bug.

Session revocation is deliberately **not** undoable and is absent from
the table rather than listed with a no-op: a revoked token cannot be
un-revoked, and an undo that quietly does nothing is worse than none.

### Verified

47 unit tests (3 new, covering the widened matrix, the escalation guard,
and the invite/undo asymmetry), plus a live run against the database:
invites create unprivileged unconfirmed accounts, the timeline merges and
orders both sources and leaks no conversation data, undo deletes an
unused invite, and undo refuses — without deleting — one that has been
used.


## 2026-09-01 — Homepage rebuilt

### The margins

The page container was `max-w-5xl` (1024px). On a 1512px display that
stranded a narrow column between two 244px voids, which is what read as
"wide margins" — the problem was the column being too narrow, not the
margins being too wide. Everything is now `max-w-6xl` (1152px) with a
larger horizontal pad, and the footer shares that container: it had been
using a *different* max width, so its content visibly stepped inward from
the rest of the page.

### The header

Was a row of five buttons with a logo. Now:

- A gradient accent mark instead of a flat foreground square, which read
  as a placeholder.
- Nav as links rather than buttons — a row of button chrome across the top
  competes with the one action that matters.
- A fixed 56px height and a divider before the account actions, so the two
  groups read as two groups.
- **Scroll-aware surface.** At the top it shares the hero's background and
  shows no edge; once anything scrolls beneath it, it takes a translucent
  background, a blur and a hairline. A header needs to separate itself
  from what it is covering, and only then.

### The page

- **Hero** — an eyebrow pill, a gradient headline, and an ambient accent
  wash behind it. Entrances are staged at 80ms intervals so the eye is
  given an order to read in rather than being handed everything at once.
- **A product still**, built from the app's own components — the same
  bubble shape, the same composer pill, the same tokens. Deliberately not
  a screenshot: a screenshot goes stale the moment the UI changes, ships
  as a large image, and cannot follow the reader's theme. This is a few
  hundred bytes of HTML that is always current, and `aria-hidden` because
  every claim it illustrates is made in text nearby.
- **A proof strip** of four concrete, checkable facts.
- **Bento features** — the two things the product is actually for get full
  width; a grid where every cell is identical tells the reader nothing
  about what matters.
- **A closing panel** with its own glow, so the page ends on something
  with weight rather than a centred paragraph.

### The motion

A `Reveal` component using `IntersectionObserver` — answered off the main
thread and disconnected after the first reveal, so a long page costs
nothing once it has been seen. It starts *visible* and hides on mount, so
the server-rendered HTML is complete for anyone with JavaScript off or on
a slow connection; the animation is an enhancement, never a precondition
for content. Elements already on screen at first paint are skipped so the
page does not flash its own hero out and back in.

Reveals rise 18px with a short blur rather than sliding — content resolves
into place rather than arriving from somewhere it never was. Everything
uses the easing tokens the app already had, and the whole system is
disabled under `prefers-reduced-motion`.

Marketing pages are still SSG in the build output.


## 2026-08-31 — Dev cache incoherence, and a one-command remedy

`Cannot find module './vendor-chunks/next-intl.js'` — every page 500ing.

Same shape as the `@supabase.js` error earlier, and this time genuinely a
cache problem rather than an application bug. Confirmed before acting: the
chunk was **sitting on disk** at
`.next-dev/server/vendor-chunks/next-intl.js`, so `webpack-runtime.js` was
holding a manifest that disagreed with the files next to it. Next's dev
cache drifts out of step after a long run of hot reloads, particularly
across large refactors, and the `static-paths-worker` in the stack trace is
the tell.

Clearing `.next-dev` and restarting fixed it; all pages 200, clean log.

### My previous change made this likelier

Last time I stopped clearing `.next-dev` on restart, because clearing it
regenerates server-action IDs and breaks open tabs. That was the right call
for *that* failure and the wrong default for this one — the two remedies
are opposites:

- **Stale action ID** → hard-reload the tab, and do *not* clear the cache.
- **Missing vendor chunk** → clear the cache; a reload will not help.

So rather than picking one default, there is now `npm run dev:clean`
(`rm -rf .next-dev && next dev`) sitting next to `npm run dev`, and
HANDOFF §13 explains which symptom calls for which. Neither disturbs a
production build: dev and production write to different directories.


## 2026-08-30 — Staff MFA is now actually enforced

You could sign in as super admin without ever touching an authenticator.
Three separate reasons, and all three had to be fixed.

### 1. The step-up was off by default

`staff_require_mfa_each_signin` was introduced defaulting to **false**, on
the earlier instruction that setup should happen once and not be asked for
again. That made the second factor decorative: enrolment was mandatory, but
the factor was never challenged, so a stolen staff password alone reached
the console.

Default is now **true** (migration 0025). It stays a setting rather than a
constant so an operator locked out mid-incident can turn it off
deliberately and visibly, with the change audited — rather than needing a
deploy. The reader also fails closed now: only an explicit `false` turns it
off, so a missing or malformed row means "required".

### 2. The gate ran on pages but not on actions

`requireStaffPage`/`requireSuperAdminPage` enforced it. `requireStaff()` —
which **every admin server action** calls — did not.

So an authenticated-but-not-stepped-up staff session was redirected by the
console while still being able to POST directly to `suspendUserAction`,
`updatePlanPriceAction`, `grantPlanAccessAction` and the rest. The redirect
looked like enforcement and was not. Both paths now call the same
`staffGateStatus`; pages redirect, actions throw.

### 3. A redirect loop hid the challenge

The staff login page sent *any* signed-in staff straight to their portal —
including a session that had not stepped up. The portal bounced it back for
a code, and the login page bounced it to the portal again. Neither page
rendered: the operator saw an empty card, which is what "no authenticator
checkpoint" looked like from the outside. The shortcut now fires only when
the gate is satisfied.

### Verified

Swept all six admin pages across three session states:

| Session | Result |
|---|---|
| Staff, not enrolled | redirected to enrolment |
| Staff, enrolled, password-only (aal1) | redirected to the code challenge |
| Staff, verified with authenticator (aal2) | console renders |

Then the whole flow in a browser: password → authenticator code → console.

### The lockout escape hatch, made to work

Mandatory MFA means a lost authenticator is a lockout, so the break-glass
path had to be real. `npm run super-admin -- recover` already deleted the
factors, but it left `profiles.mfa_enrolled_at` set — and the gate trusted
that flag, so a recovered account would be asked for a code it could no
longer produce. **Permanent lockout surviving recovery.**

Two fixes: the gate now derives enrolment from the live factor list rather
than the flag (so it self-heals), and `recover` clears the flag *and*
revokes existing sessions — an access token minted while the factor existed
keeps claiming `aal2` until it expires, and if recovery was needed because
the account was taken, that session belongs to whoever took it.

Verified: after factors are removed, a fresh sign-in goes to enrolment, not
to an impossible challenge.


## 2026-08-30 — Stale action IDs, and a font leaking between accounts

### The "Server Action was not found" error

Not an application bug. Every dev-server restart with a cleared cache
regenerates the IDs Next assigns to server actions, and any tab still
holding the previous page posts an ID the server no longer knows. The
login form was simply the first action clicked.

Verified rather than assumed this time: the running server carried exactly
one action id for the login page, and it was **not** the `606d28…` the
browser reported. Then signed in through the form in a real browser — it
worked end to end and landed on `/chat`.

**The cause was my own habit.** I had been running `rm -rf .next-dev`
before every restart, left over from the period when dev and production
shared `.next` and genuinely corrupted each other. Since `distDir` was
split, that cache is safe to keep — and keeping it is what lets action IDs
survive a restart. A hard reload clears the browser half.

### One account's reading font followed another into their session

Found while verifying the login fix, not reported.

`/theme-init.js` applies the font before first paint, which is what avoids
a flash — but it only runs on a **full page load**. Signing in is a
client-side transition, so `<html data-font>` kept the value set for the
*previous* account: sign out, sign in as someone else, and their reading
font stayed until the next hard refresh. On a shared browser that is one
person's preference leaking into another's session.

The cookie was already correct — the sign-in path had updated it — so only
the DOM attribute was stale. A small client component now re-applies it
from the cookie on every render of the signed-in shell, validated against
the same nine-item allowlist. Verified: after signing in as a different
account, the attribute and the computed font both follow the new account.

### Raw keys still on two console screens

The dashboard's "Recent admin activity" table was still printing
`admin.plan_granted` and `staff.signin` — I had fixed the audit-log page
and missed this one. It now uses the same readable labels.

The security page showed Supabase's `aal1`/`aal2` verbatim; it now reads
"Password only" / "Password + two-factor".

I then swept every monospace string in both consoles. The rest are
deliberate — a raw setting key under its readable label, currency codes,
model slugs, prompt text and input fields — and are staying.


## 2026-08-30 — Plan confirmations, flexible grants, announcements tab

### Gaining a plan now says so

A purchase or a grant produced no visible confirmation at all — the plan
simply changed. A payment that changes nothing on screen is the most
common reason someone contacts support after paying.

Both now write a `notifications` row, and the app shows a notice at the top
of the signed-in shell. Two shapes, because they are not the same news:

- **Purchased** reads as a receipt — active, renews on a date.
- **Granted** says plainly that it was given, for how many days, and when
  it ends. That is what stops it reading as a billing error later when it
  lapses.

Backed by the notifications table rather than browser storage, so
confirming on a phone does not leave it waiting on a laptop, and support
can see that the confirmation was actually delivered.

The notice unfolds on the shared easing curve with the badge scaling in
just behind it — two beats rather than one, which is what separates a
confirmation from a warning strip. Disabled under `prefers-reduced-motion`.

### Grants are any length, not 30 days

The duration was hardcoded. A trial, an apology for an outage and a partner
arrangement are not the same length, and an operator working around a fixed
number ends up granting 30 days and revoking early — a worse record of what
was actually intended.

A dialog now offers 7/14/30/90 and any value from 1 to 365, plus an
optional reason that lands in the audit entry. The subscription lapses on
its own, so there is nothing to remember to switch off. The recipient's
notice states the exact number of days granted.

### Announcements have their own tab

`/admin/announcements` replaces editing the announcement as one row among
ten on the Settings page, with a live preview rendered through the exact
component readers see — banner chrome included, because a preview in a
different frame is a preview of something else.

**On rendering HTML.** Rich formatting was the requirement and raw HTML the
suggested means; this uses Markdown instead, through the same
`rehype-sanitize` configuration the chat already uses. Accepting raw HTML
would mean adding `rehype-raw` and then trusting a sanitizer to undo it, on
content shown to *every signed-in user* — the blast radius of getting that
wrong is the entire user base, and the upside over Markdown is a few tags
nobody has asked for. Bold, italic, code and links all work; verified that
a pasted `<script>` is stripped.

### A bug found while testing the above

Every custom Markdown component spread react-markdown's props onto a DOM
element, including the AST `node` — so `node="[object Object]"` shipped as
a real attribute on every paragraph, table cell and list in every message.
Invalid HTML that React warns about. Now destructured out, with ESLint's
`ignoreRestSiblings` configured so the idiom does not read as an unused
variable.


## 2026-08-30 — Code legibility, composer, and image actions

### Code blocks were nearly unreadable

Two causes, both mine to fix:

`customStyle` only reaches the `<pre>`. The Prism themes **also** set a
background on `code[class*="language-"]`, and without clearing that the
inner element painted its own panel behind every line — the boxes around
each line of code.

And the syntax theme was chosen from `window.matchMedia` **during render**:
`undefined` on the server, so the *light* Prism theme was picked and
shipped inside a dark block. Light tokens on a light panel inside a dark
terminal is why the code was barely visible.

The block's chrome — window bar, traffic lights, `#0d0f14` surface — is a
dark terminal in both app themes, so the syntax theme is now pinned to the
dark one to match the surface it sits on. That also removes a hydration
hazard: a value read from `matchMedia` at render time cannot agree between
server and client by construction.

### The composer

The blue box around the input was a focus ring. The app already had a
global `:focus-visible` rule, and the composer's shell separately shows
focus via `:focus-within` — so a focused field drew a second rectangle
inside the first. The rule now excludes the composer input; keyboard users
still get clear focus, from the surface rather than an outline. (I had also
added a *duplicate* focus rule in an earlier pass; that is removed.)

The border is gone entirely — a filled surface reads as a field on its own.

The composer now has two layouts on one surface: a pill on a single line
with everything in a row, and once the text wraps, the controls drop
beneath so the message gets the full width. The corner radius animates
between them, so it reads as one field growing rather than two components
swapping.

The single-line threshold is measured from the element on first layout
rather than hardcoded. My first attempt guessed a constant, and padding
plus line height put an *empty* composer over it — so it rendered expanded
before anything had been typed.

### Images

Generated images had no actions at all: the only thing you could do was
open a new browser tab. For a feature whose entire output is the image,
that was the product surface missing.

Now: click to view full size **in the app** (Escape closes, the page
behind it does not scroll), and copy or download from either the card or
the viewer.

Two details worth recording. Download fetches the blob rather than using
`<a download>` — the src is an auth-gated redirect to a signed URL on
another origin, and browsers ignore `download` cross-origin, so the file
would have opened in a tab instead of saving. And copy re-encodes to PNG
through a canvas, because the clipboard only accepts a narrow set of image
types and these generations are JPEG.

### Regenerating an image gave you prose

`handleRegenerate` always called `/api/chat/regenerate` — a **text**
endpoint — so asking for another image handed the prompt to a text model.
It now recognises a generated-image reply (the message is the markdown
image and nothing else), recovers the prompt from the preceding user
message, and goes back to the image model.

### A button showing its own message key

`billing.upgrade` was a string used by the upgrade button. When I added the
in-app upgrade page last turn I overwrote it with an object namespace, so
next-intl had nothing to render and printed the key path instead. The page
namespace is now `billing.upgradePage` and the button label is restored.

I also scanned every `t()` call against the message catalog for the same
class of collision — a key that resolves to a namespace rather than a
string. That was the only real one, and a sweep of six rendered pages
shows no message key leaking into visible text.


## 2026-08-30 — Generated images sized like part of the conversation

Generated images arrive in the reply as markdown — `![prompt](/api/assets/<id>)`
— and the Markdown renderer had no `img` override, so `react-markdown`
emitted a bare `<img>` at its natural size. A 1024px generation filled the
column and pushed the rest of the conversation off screen.

Uploaded attachments never had this problem because they are rendered by a
different component that has always capped them. The two paths had simply
drifted.

The renderer now bounds images by **height** rather than width, so a
portrait and a landscape generation take up a similar amount of the
conversation instead of one running twice as tall. They sit in the same
rounded, bordered card the rest of the app uses, load lazily, and open full
size in a new tab.

Measured in the browser after the change: 320 × 320 rendered, down from
~800. Confirmed the image still passes `rehype-sanitize` (relative URLs are
permitted) and that no uncapped `/api/assets` image remains in the page.

### Two things checked and found fine

- **Sidebar navigation appeared broken** while testing — clicking a
  conversation did nothing, with no request reaching the server. That was
  the browser tab holding a client bundle from before a dev-server
  restart; it cleared on reload and navigation works normally.
- **The image looked missing** in a screenshot taken right after load. It
  was rendering — measuring the element showed a correct 320px box. The
  screenshot had caught it mid-paint.


## 2026-08-30 (later still) — The vendor-chunks error, actually fixed

### What it really was

`Cannot find module './vendor-chunks/@supabase.js'` was a bug I introduced
with the font feature, not a build-cache problem.

`src/app/[locale]/layout.tsx` exports `generateStaticParams()`, and I had
added `getCurrentProfile()` to it to read the reading font. Next evaluates
`generateStaticParams` in a **separate worker process**
(`static-paths-worker`), and that worker then had to load Supabase into its
module graph — where the vendor chunk is not resolvable. Every page render
went through it, so every page failed.

My first diagnosis — dev and production sharing `.next` — was wrong.
Clearing the directory made it disappear just long enough to look fixed,
because the worker only fails once the layout's module graph is actually
loaded. The stack trace named `static-paths-worker` from the start; I read
the "Cannot find module" and stopped there.

### The fix

The font is now applied by `/theme-init.js` before first paint, from a
`MUJEEB_FONT` cookie — the same mechanism the theme already used, and for
the same reason.

Reading the cookie server-side in the layout would also have worked, but
`cookies()` in the root layout forces **every** route to render
dynamically, including the marketing pages. Verified after the change:
they are still listed as SSG in the build output.

The database column stays the source of truth. The cookie is written when
the preference is saved and refreshed at sign-in, so the choice follows the
account onto a new browser from its first paint. The script validates
against the same nine-value allowlist before touching the DOM, so a
hand-edited cookie can still only ever select a CSS rule — the zod enum and
the CHECK constraint continue to govern what can be stored.

### The distDir split stays

Splitting dev (`.next-dev`) and production (`.next`) output did not fix
this, but it is worth keeping: sharing one directory is a real hazard, and
it is now impossible to hit. `.next-dev` is gitignored and excluded from
ESLint.

Verified: homepage, login and pricing all 200 with a clean log; all nine
fonts still offered; a stored preference still reflected in Settings;
`npm run verify` green, 44/44.


## 2026-08-30 (later) — Dev and production builds no longer share a directory

### The "Cannot find module './vendor-chunks/@supabase.js'" error

Not an application bug, and not related to image generation despite where
it surfaced. `next dev` and `next build` write incompatible artifacts into
`.next`, and whichever ran last wins. I had run `npm run verify` (a
production build) and then started the dev server on top of its output, so
the dev server was loading production chunks that did not match its own
runtime manifest.

It presents as a missing dependency, which sends you looking at
`node_modules` and at whatever feature you happened to be using — in this
case image generation, which was working the whole time.

**Fixed structurally rather than by clearing it again.** `distDir` now
resolves to `.next-dev` in development and `.next` in production. Next
sets `NODE_ENV` itself for each command, so the split needs no flag to
remember and deployment output is unchanged.

Verified by doing the exact thing that broke it three times in this
session: running `npm run build` while the dev server was serving. The
build succeeded, the dev server stayed healthy, and two separate output
directories now exist.

`.next-dev` is gitignored and excluded from ESLint — without the latter it
lints Next's generated type files and reports several thousand problems in
code nobody wrote.

### Image generation, re-confirmed

Tested through the same path the chat UI uses, after a clean restart *and*
again after a production build: generated in ~15s (dev), stored, served
back as `image/jpeg` with matching magic bytes, and referenced in the
conversation page. No change was needed.


## 2026-08-30 — Cloudflare, device identity, in-app checkout, motion

### Cloudflare Workers AI — configured, and two bugs fixed to make it work

Credentials are in `.env.local`. Verified: token active, and
`flux-1-schnell` returns a 506 KB image in ~1.6s.

Getting it working end to end needed two fixes:

**Every Flux generation was returning 400.** The adapter always sent
`width` and `height`. Workers AI models do not share a schema and the API
rejects unknown properties outright, so Flux answered
`AiError: Bad input: Additional or unevaluated properties '/width, /height'
not allowed` — surfaced as a generic "images.failed". The payload is now
built per model family: Flux gets `prompt`, the Stable Diffusion family
gets dimensions, and an unrecognised model gets the prompt alone so a
model added from the console works by default.

**The image was mislabelled.** The adapter hardcoded `image/png`, but this
model returns JPEG — and the app sends `X-Content-Type-Options: nosniff`,
so a JPEG served as PNG is one the browser refuses to render. The type is
now sniffed from the magic bytes. Verified: generated → stored as `.jpg` →
served as `image/jpeg` with matching bytes.

### "Script" in the device list was a real bug

Sign-in runs in a server action, so GoTrue recorded the **Next.js
server's** user agent rather than the browser's — which is why the list
read "Script" and "Next.js Middleware" instead of naming devices. The
server client now forwards the caller's `user-agent` and address to
GoTrue. Verified: a session now lists as "Chrome on macOS" with the right
IP.

Existing rows keep their old labels (the agent is recorded once, at
sign-in); they read as "Server session (before device tracking)" and
disappear as they expire or are signed out.

### Sign-in location

Each session now shows where it signed in from. The place is captured
**once, at sign-in**, from the hosting platform's own geo headers —
Cloudflare's `cf-ipcountry`, Vercel's `x-vercel-ip-*`. Deliberately not an
IP-to-location lookup: that would send a user's address to a third party
on every settings render and put a network call on a page that needs none.
No geo headers (local development) reads as "Unknown location" rather than
inventing one.

Staff see the same list, read-only, on each account's detail page —
support gets asked "was that really me?", and the sessions are where the
answer lives. Read-only on purpose: signing out someone else's device is
indistinguishable from locking them out, and the account-level controls
that already exist do that with an audit trail.

### Upgrading no longer leaves the app

`/upgrade` compares plans inside the app shell, and paying opens
Paystack's own modal over the page instead of navigating away. The
transaction is created server-side and the browser only *resumes* it, so
the amount and currency stay server-decided — a client cannot declare what
it owes.

Card details are entered in Paystack's iframe and never touch this app's
DOM, which is what keeps it out of PCI scope. That required allowing
`js.paystack.co` in `script-src` and their checkout origins in
`frame-src`; the allowlist is deliberately narrow, and the hosted-page
redirect remains as a fallback when the script is blocked.

### Four more fonts

Geometric, Rounded, Slab and Reading, joining the existing five. Same
three-gate safety as before — fixed list, zod enum, CHECK constraint
(migration 0024) — and every stack is device fonts only, so nothing is
downloaded and the CSP is untouched. Reading also loosens line height,
which is the point of it.

### Motion and the composer

A single set of easing curves and durations (`--ease-out`,
`--duration-*`), applied to every Radix surface through one `data-state`
rule, plus one focus-ring treatment across the app. Consistent motion is
most of what makes an interface feel like one product rather than
assembled parts.

The composer's auto-grow moved from `useEffect` to `useLayoutEffect`.
Measuring `scrollHeight` after paint meant the field visibly flashed at
its collapsed height for a frame on every keystroke that wrapped a line —
that flicker was most of what made the input feel cheap. It also now only
scrolls internally once it hits its cap, and uses native `field-sizing`
where supported.

The announcement banner unfolds on the shared curve with its content
easing in just behind, rather than appearing all at once.

### On "make the whole app feel premium"

What is above is a design-system pass — shared motion, focus, composer,
banner, and a real upgrade page — not a redesign of every screen. That is
a deliberate limit: a coherent set of primitives lifts every page that
uses them, and rewriting each page's layout without a specific complaint
about it would be churn. Tell me which screens feel wrong and I will take
them one at a time.


## 2026-08-30 — Devices, and a correction

### Users can see and sign out their devices

`/settings` now lists every device the account is signed in on — "Chrome
on macOS", "Safari on iPhone" — with the IP it signed in from, when it was
last active, and whether it used two-factor. Each row can be signed out
individually, or all the others at once.

The current device is pinned first and has no sign-out button: that is
what the ordinary sign-out is for, and offering it inside a list of "other
places you're signed in" invites an accidental self-logout while someone
is trying to remove a device they don't recognise. "Sign out all other
devices" uses `scope: "others"` for the same reason — you keep the page
you are standing on.

**This corrects something I got wrong.** When I built the staff security
page I wrote that Supabase exposes no per-device inventory and that
presenting one would mean inventing it. That was wrong. `auth.sessions`
carries `user_agent`, `ip`, `aal` and `refreshed_at` per session — it is
simply not reachable through PostgREST or the admin API. Migration 0022
adds two functions that reach it, the stale comment is corrected in place,
and `/admin/security` now shows staff the same real list.

### How the access is constrained

Both functions are SECURITY DEFINER (reading `auth.sessions` needs
privileges `authenticated` does not have), and both take the user id as an
argument and filter on it. EXECUTE is granted to `service_role` **only**:
the app calls them after establishing who the caller is from their own
session, so the user id never comes from the browser. Granting to
`authenticated` would have meant trusting a client-supplied argument,
which is the mistake this shape exists to avoid.

Revoking deletes the session row; `auth.refresh_tokens` and
`auth.mfa_amr_claims` cascade from it, so the device cannot mint a new
access token. Its current access token stays valid until it expires — up
to an hour — which is inherent to stateless JWTs and is why
"sign out everywhere" still exists for when minutes matter.

Verified end to end: three sessions from three different user agents list
with the right labels and IPs; an attacker's id revoking a victim's
session affects **0 rows**; an ordinary authenticated client calling
either function directly is refused (PGRST202 / 42501); and the owner
revoking their own session works. Each revocation is audited.


## 2026-08-29 (night) — Audit log readability, drag-and-drop, and a broken PDF path

### Every PDF upload was failing in production

Found while testing mixed file types, not reported: `pdf-parse` wraps
pdf.js, which resolves `pdf.worker.mjs` by a path relative to itself at
runtime. Bundling it rewrote that path into `.next/server/chunks/`, where
the worker was never emitted, so every PDF returned 422 with "Setting up
fake worker failed: Cannot find module …/pdf.worker.mjs".

Development builds resolve it, which is why it survived — it only appeared
in a production build. PDF is the first document type named on the
homepage.

Fixed by listing `pdf-parse`, `mammoth` and `xlsx` in
`serverExternalPackages`, so they stay plain `node_modules` requires and
their relative paths resolve again. Verified: a PDF now uploads and its
text is extracted ("Quarterly report").

### Audit log targets are names now

The target column rendered `user:3f9c1a0e-…` — complete and unreadable.
Nobody matches a UUID by eye.

`resolveAuditTargets` groups the page's ids by type and resolves each type
in **one** query (200 rows would otherwise be 200 round trips), turning
them into account names, plan names, model and provider names, and flag
keys. The type is shown underneath as context ("Account", "Plan"), the id
is kept in the `title` attribute since it is what identifies a row during
an incident, and a target whose row is gone reads as "deleted account"
rather than as hex an operator would try and fail to look up.

Verified against the live log: no bare `type:uuid` pairs remain.

### The audit table scrolls

It had no height bound, so 200 rows made the whole page scroll, the column
headings vanished after the first screen, and every scroll started from
the top of the document. `TableScroll` now takes a `maxHeight`, the header
is `sticky`, and `overscroll-contain` stops a flick at the end of the
table from scrolling the page behind it.

### Drag and drop, mixed types

Files can be dropped straight onto the composer — several images, or an
image with a PDF and a spreadsheet, any combination. The same count, size
and type rules apply as for the picker, so nothing can bypass the
entitlement by being dropped.

Two details worth recording: `dragover` must be `preventDefault`ed or the
browser opens the file instead of letting the page handle it, and
dragenter/dragleave fire per child element, so the highlight is driven by
a depth counter rather than a boolean — otherwise it flickers as the
pointer crosses the composer's contents. Dragging selected text is
ignored; only actual files raise the overlay.

Verified in a browser: a PNG, a Markdown file and a CSV dropped as one
batch all upload, with three `POST /api/files 200` at near-identical
timings — concurrent, not sequential. A six-type batch (PNG, JPEG, PDF,
XLSX, MD, CSV) uploads and extracts text from each.

One thing that behaved correctly and is worth knowing: a file whose
contents do not match its extension is rejected. A PNG renamed `.jpg` gets
`files.unsupported` from the magic-byte check.


## 2026-08-29 (late) — Image upload, MFA loop, dividers, grants

### Image upload was broken by my own rewrite — two causes

**`event.target.files` is a live FileList.** `handleFileSelect` copied the
reference, then reset `input.value` (which is what allows the same file to
be picked twice in a row) — and that reset **empties the very list it was
holding**. `addFiles` therefore received zero files on every attempt. The
single-file code it replaced had copied the `File` out first
(`files?.[0]`), which is why this only appeared after the multi-upload
rewrite. Fixed by copying with `Array.from` before the reset.

**The file dialog never opened from the new menu.** Opening a file picker
from a Radix `onSelect` fails: the menu closes and restores focus
synchronously, and the browser treats the user-activation gesture as spent
before `.click()` lands. Fixed with `preventDefault` plus a deferred click.

Verified in a browser: two images injected into the input both upload, and
the server log shows two `POST /api/files 200` with near-identical timings
— confirming they upload concurrently rather than in sequence.

### The admin console kept asking about MFA

The gate required every staff session to reach `aal2`, so an authenticator
code was demanded on each sign-in. When the browser-side verification and
the server's view disagreed, the gate bounced to
`/staff/login?step=mfa` — a page that showed the **password form again**.
From the outside that reads as the console demanding MFA setup over and
over. The server log showed the loop plainly.

Two changes:

- **Step-up is now a setting** (`staff_require_mfa_each_signin`, migration
  0021), default **off** — the requested behaviour. Enrolment stays
  mandatory: a staff account still cannot reach a portal without setting
  up an authenticator. Worth being plain about the trade-off, though: a
  second factor that is never asked for cannot stop a stolen password, so
  `true` is the stronger posture and is one toggle away at
  `/admin/settings`.
- **`?step=mfa` now shows the code field**, not the password form, for the
  case where step-up is on.

Verified: a password-only session reaches the console with step-up off; an
un-enrolled account is still redirected to setup; and with step-up on, the
same session is redirected to the code entry.

### Dividers

The homepage used a ruled grid (`gap-px` over a `bg-line` parent draws a
hairline between every cell), plus rules between sections and under the
header. Sections and header rules are gone; the feature grid is spaced
cards. Separation now comes from space rather than lines.

In chat, the composer's `border-t` ran the full width and cut the input
off from the conversation — which is what made it read as a floating bar.
Replaced with a short gradient, so messages scrolling underneath dissolve
into the page instead of sliding under a line.

### Super admin can reset a staff account

Enrolment is mandatory and only the account holder can complete it, so a
moderator who loses their authenticator was locked out permanently — an
ordinary password reset does nothing, because the gate they are stuck
behind is the authenticator.

`resetModeratorAccountAction` resets both halves: new temporary password,
enrolled factors deleted, every session revoked, credentials emailed. The
account returns through the same door a new moderator uses. Revoking
sessions matters — if the account was stolen rather than merely lost,
leaving an old session alive would keep the attacker signed in while the
owner resets around them. Self-reset is refused (that would lock the
console); use the CLI.

### Complimentary Pro access

`grantPlanAccessAction` writes an ordinary subscription row with
`billing_provider: 'manual'`, so entitlements, quotas and the plan shown
in Settings all resolve through the path they already use — no second code
path to keep in step. `manual` also keeps grants out of the Paystack
webhook's matching and out of revenue.

Grants expire (30 days by default, a year maximum): a grant with no end
date is indistinguishable from a billing bug six months later. Available
to **both** roles, since it is a support gesture that cannot change a
price or take a payment, and it refuses to overwrite a real paid
subscription — that would silently detach a paying customer from billing.


## 2026-08-29 (evening) — Login error, and two bugs behind it

### The login page error

The stack trace pointed at `<LoginForm />`, but the form was fine. Three
separate things were tangled together:

**1. A stale dev build (the actual cause).** The server log showed
`Failed to find Server Action "602ffdb…"` and
`__webpack_modules__[moduleId] is not a function`. Both are symptoms of a
`.next` directory that had been written by `next build` and `next dev`
alternately — which is exactly what a day of rebuilding does to it. The
browser was holding a page whose server-action IDs no longer existed on
the server. Clearing `.next` and restarting resolved it; a hard reload
clears the browser half.

**2. A real conflict.** `public/favicon.ico` (a 70-byte stub) shadowed
`src/app/favicon.ico` (the real 26 KB icon), which Next reports as
"A conflicting public file and page file was found" and answers with
`GET /favicon.ico 500` on every page load. The stub is removed; nothing
referenced it.

**3. A misdiagnosis of my own.** My first attempt to test the form by
POSTing a fabricated server-action ID returned 500, which looked like a
bug and was not — it was an invalid request. Verified properly in a real
browser instead: the page renders, a wrong password returns
"That email or password isn't right.", and correct credentials sign in
and land on `/chat`.

### An announcement could be published but never taken down

`system_settings.value` was `jsonb NOT NULL`. `announcement` is optional —
its validator accepts `null` and the console sends `null` when the field
is emptied — so clearing it violated the constraint and failed with a
generic "couldn't save that". Migration 0019 makes the column nullable,
which is the honest shape: "unset" is a real state for an optional
setting, and every reader already falls back to `SETTING_DEFAULTS`.

Found by publishing a test banner during the audit and then being unable
to remove it.

### Staff who had done anything could never be deleted

`admin_audit_logs.actor_id` is `ON DELETE SET NULL`, so removing a user
makes Postgres UPDATE their audit rows to null the actor. The append-only
trigger from migration 0008 blocked **every** UPDATE, including that one —
so the delete failed with "Database error deleting user", and any staff
member who had ever performed an audited action was permanently
undeletable. `deleteUserAction` in the console would have failed the same
way.

Migration 0020 narrows the trigger to permit exactly one shape: `actor_id`
going from a value to NULL with every other column byte-identical. What
was done, to what, when and with what result all still survive, entries
still cannot be edited or removed, and DELETE is still refused outright.
Verified: the deletion now succeeds, the trail keeps all 17 rows with the
departed actors anonymised, and an attempted edit is still rejected.

### Also

Removed every `@example.com` probe account this session created —
including four leftover test **super admins** on the live project. Only
your two real accounts remain.


## 2026-08-29 (later) — Console fix, multi-file upload, chat UI, reader fonts

### The admin console error

`/admin/providers` returned a **500**. Same cause as the feature-flags page
earlier today: a Server Component passing an inline
`onToggle={(enabled) => ...}` closure to a Client Component, which React
refuses outright. A closure has to be created on the client, so the list
became a client component.

Rather than fix the one page, I swept every `.tsx` outside `"use client"`
for an inline `on*={(` handler — providers was the last one. All 15 admin
pages and all 4 moderator pages now return 200 under a real MFA-verified
session, with no errors in the server log.

### Up to five files per message, adjustable

The composer accepted exactly one file (`files?.[0]`, no `multiple`). It
now takes a batch, uploads them concurrently rather than one after another,
and counts against what is already attached — so picking three twice cannot
slip past a limit of five.

The limit is `max_attachments_per_message`, a plan entitlement seeded at 5
(migration 0017), so:

- a **super admin** changes it per plan at `/admin/plans`, and
- a **moderator** can raise it for one account.

Moderators got a *narrow* new permission for this — `usage.override_attachments`
— rather than the existing `usage.override`. Widening that one would have
handed them every quota including the billing-adjacent ones; this covers a
single feature key. The cap is re-enforced in `/api/chat` against the
caller's own entitlement, because a client-side limit is an affordance,
not a control. Verified: eight attachments → `400 {"error":"chat.tooManyAttachments","limit":5}`.

### Chat UI

Reworked toward the reference layout:

- The composer is one rounded surface holding everything that acts on the
  message — attachment menu, text, model, send — instead of a toolbar
  above and a button below. The eye lands in one place.
- A `+` menu replaces the bare paperclip, with **Upload files** (showing
  `n/5` used) and **Create image** as explicit choices.
- The model selector moved inside the pill in a compact variant.
- The assistant's single-letter avatar is gone. A repeated badge down the
  left edge added a column of noise without identifying anything, and
  removing it lets replies start flush and gives long answers more room.
- User messages are soft pills; assistant replies stay plain text.
- Assistant action buttons (copy, regenerate) are now **always visible**
  rather than hover-only. Hover does not exist on touch, which made the
  two most-reached-for controls undiscoverable on a phone.

Type sizes were left alone — you said the fonts already read well.

### Reader-selectable fonts — yes, safely

Short answer to the question: **yes, with no security implication**, but
only because of how it is built.

The risk in "let users pick a font" is twofold: a user-supplied
`font-family` string is CSS injection, and a webfont URL leaks the
reader's IP to a third party and forces `font-src` open in the CSP. This
implementation avoids both by never accepting either.

A reader picks an **identifier** from five fixed options. It is validated
three times — a fixed list in the UI, a `z.enum` in the server action, and
a `CHECK` constraint in the database (migration 0018) — then rendered into
`data-font` on `<html>`, where CSS maps it to a stack. User input never
becomes part of a `font-family` declaration.

Every stack is composed of fonts already on the device, so nothing is
downloaded, no third party is contacted, and the CSP is untouched. The
attribute is server-rendered, so the chosen font is correct in the first
paint with no flash.

Options: Default, Grotesk, Humanist, Serif, Monospace. Each button renders
its own sample in the font it offers, so the choice is made by looking.
Code blocks stay monospaced regardless. Verified: switching writes through
to `data-font="serif"`, and the database refuses an injected value.


## 2026-08-29 (security audit) — Full component audit, undo, and readable labels

### Security audit

Every server action, route handler, RLS policy and the classic injection
surfaces were reviewed, and each conclusion was tested rather than
reasoned about.

**Verified sound, no change needed:** all 13 server-action modules carry an
auth guard (the six that looked unguarded delegate to `moderate()` /
`sendLink()`, which do); every API route is guarded except the four that
must not be (auth callbacks, Paystack redirect, webhook); the Paystack
webhook verifies its HMAC against the raw body with `timingSafeEqual`
before parsing; Markdown is sanitized through `rehype-sanitize` with no
`rehype-raw`; there is no `dangerouslySetInnerHTML`, `eval`, or
`new Function` anywhere; no secrets reach the logs; the storage bucket is
private with **zero** policies (deny-by-default) and refused every anon and
authenticated attempt to list, download, sign or upload; and an ordinary
user reading twelve tables directly got zero rows from all of them —
confirming the RLS rewrite in 0013 did not weaken anything.

**Fixed:**

- **`xlsx` (SheetJS) parses attacker-controlled uploads with two unpatched
  high-severity advisories** — prototype pollution (GHSA-4r6h-8v6p-xvw6)
  and ReDoS (GHSA-5pgg-2g8v-p4x9). SheetJS stopped publishing to npm at
  0.18.5, so `npm audit` reports "no fix available". The parse now runs in
  a **worker thread**, which is a separate V8 isolate: pollution corrupts
  the worker's `Object.prototype` and dies with it, and because
  `XLSX.read` is synchronous — an in-process `Promise.race` timeout could
  never fire, since the event loop is the thing being blocked — moving it
  off-thread is what makes a 15s kill possible at all. The worker gets no
  environment (`env: {}`), so the parser cannot read the service-role key,
  and only a string crosses back. Upgrading remains the real fix; see
  SECURITY.md.
- **Two SECURITY DEFINER trigger functions were callable as PostgREST
  RPCs** (`protect_staff_onboarding_columns`, `rls_auto_enable`).
  Migration 0016 revokes EXECUTE. Verified refused for anon and
  authenticated. `admin_dashboard_snapshot` stays callable by design and
  was confirmed to reject a non-staff caller with 42501.
- **`DELETE /api/conversations/[id]` answered `{ok:true}` unconditionally**
  — including for another user's conversation. No data was at risk (the
  handler filters on `user_id` and RLS refuses it again; the row survived
  the attack), but it reported success without checking whether anything
  succeeded. It now returns 404 when nothing was deleted, matching PATCH.
  404 covers both "not yours" and "does not exist" deliberately, so it
  cannot be used to confirm an id exists.
- **No HSTS**, and `X-Powered-By: Next.js` advertised the framework. Added
  a two-year HSTS with `includeSubDomains` (no `preload` — that is close
  to irreversible and belongs to whoever owns the domain), and disabled
  the powered-by header.

**Left for you** (both need an action outside this repo): upgrade `xlsx`
from the vendor CDN, and enable leaked-password protection in the Supabase
dashboard. Both are recorded in SECURITY.md.

### Undo for administrative actions

Super admins and moderators can now reverse what they did. Undo is not its
own privilege: reversing an action requires the permission that
*performing* it requires now, checked against the live profile — so a
moderator can undo a suspension but not a price change, whoever made it.

Ten action types are reversible. Several needed to start recording their
prior state to become so — suspending an account recorded only the reason,
which is not enough to put back a status that might have been
`pending_verification` rather than `active`. Anything whose effect left the
system (an email sent, a session revoked, an account deleted from the auth
provider) is deliberately **not** offered: an undo button that silently
does nothing is worse than none.

Because `admin_audit_logs` is append-only at the database level, an undo
records a *new* entry pointing at the original through `metadata.undoes`,
and "already undone" is answered by looking for one. The trail shows that
something was done and then reversed, rather than pretending it never
happened. Undo is available once per entry.

Moderators get `/moderator/activity` — their own recent actions, filtered
to the ones their role may reverse.

### The console no longer shows variable names

The audit log rendered `admin.plan_currency_prices_updated` in a monospace
column, the settings page used `chat_rate_limit_per_minute` as a heading,
and the feature-flag list showed raw keys. Those are identifiers: correct,
untranslatable, and they read as internals leaking through the UI.

All three now lead with a readable, translated name in all seven locales
("Plan currency prices changed", "Chat rate limit"), with the raw key kept
as a small muted second line — operators still need it to cross-reference
migrations and docs. Unknown keys fall back to a humanized form rather
than to a blank cell, so a newly added action is never rendered as a bare
identifier while its translation catches up.

### Two bugs found while doing the above

- **`/admin/feature-flags` returned a 500.** A Server Component was passing
  an inline `onToggle` closure to a Client Component, which React refuses
  ("Event handlers cannot be passed to Client Component props"). It was
  broken before this change and nothing had exercised it. The list is now
  a client component that owns the closure.
- **Nav labels for new pages resolved to the wrong namespace**, producing
  `MISSING_MESSAGE` at runtime, and the audit-action labels used flat keys
  containing dots, which next-intl reads as nesting. Both restructured;
  the server log is now clean of missing-message errors.

### The announcement banner animates

Slides and fades in, and collapses its own height on the way out so the
content below settles instead of jumping. The height transition uses
`grid-template-rows: 0fr -> 1fr`, since `height: auto` is not animatable.
Fully disabled under `prefers-reduced-motion`, and the dismissal is
persisted before the exit animation runs so a reload mid-animation still
counts as dismissed.


## 2026-08-29 (later) — Staff separation completed, pricing unfrozen

### The Naira price was not hardcoded in code — it was unreachable from the console

`plans.currency_prices` held `{"NGN": 15000}` from a seed migration, and
the only price editor in the admin console wrote `price_usd`. So changing
the Naira price meant writing SQL, which from the outside is
indistinguishable from it being hardcoded.

`/admin/plans` now edits the price in **every** supported currency as one
saved unit, with the currency checkout is actually charging marked, and a
warning when that currency has no price set. Switching `billing_currency`
in Settings now picks up a figure an operator chose.

Prices are stored per currency rather than converted from a live FX rate:
a rate feed would make the listed price move between the moment a customer
reads it and the moment they are charged.

Two real bugs fell out of the same area:

- **Display and billing disagreed.** `resolveAmount` fell back to the USD
  *number* for a currency with no configured price, so a $5 plan rendered
  as "₦5" on the pricing page while checkout — correctly — refused the
  purchase. It now returns null and the card says the price is unavailable.
- **XOF would have been charged 100x.** Amounts were multiplied by 100 to
  reach Paystack's minor unit. XOF has no subunit. `minorUnitFactor` in
  the new `src/billing/currencies.ts` handles it, and a test covers it.

### Moderators are created from the console, with mandatory 2FA

`moderators.create` had been in the permission matrix with nothing
implementing it. `/admin/moderators` now provisions an account by email:
a generated temporary password (from `crypto.randomBytes`, not
`Math.random`) is emailed to the address, and the account is then held at
the door until it has

1. replaced the temporary password (12 characters minimum), and
2. enrolled an authenticator app and verified a code.

Both gates are enforced server-side in `src/auth/staff-gate.ts`, which
every `/admin` and `/moderator` page calls — not by hiding a nav link.
The gate checks the **session's** assurance level (`aal2`), not merely
whether a factor is enrolled: enrolment is a property of the account,
verification is a property of the session, and only the second one means
someone actually used their authenticator to get here.

Migration `0015` adds the onboarding columns and a trigger that makes them
writable by the service role only. `profiles_update_own` deliberately lets
a user update their own row — that is how display name and theme are
saved — and without the trigger a browser could simply POST
`must_change_password = false` and walk past the gate. Verified: the
self-clear is refused with "onboarding columns are not user-writable".

This applies to super admins too, including existing ones.

### Announcements now actually appear

`announcement` was a `system_settings` row, validated by the settings
action, editable in the console — and read by no component anywhere.
Saving it wrote a value nothing displayed.

It now renders as a dismissable banner across the signed-in app.
Dismissal is keyed by a hash of the message text, so editing the
announcement makes it reappear for everyone who dismissed the previous
one — keying it by a constant would silently swallow every announcement
after the first.

The banner renders **visible by default** so it is present in the
server-rendered HTML. The first version initialised to "dismissed" and
only appeared after hydration, which meant it was absent for anyone whose
JavaScript was slow or blocked — the wrong failure direction for an
operational notice.

### The default language follows the visitor's region

A visitor with no stored preference gets the language their country
actually uses online, not the country's official language. Morocco,
Algeria and Tunisia resolve to **French** — Arabic is official there, but
French is the administrative language and dominant online. Countries whose
online language is not one of the seven shipped fall back to English
rather than to a near-miss (Kenya gets English, not Arabic), and Singapore
is deliberately English rather than Chinese.

Order: country → Accept-Language → English. Once a visitor picks a
language, next-intl's `MUJEEB_LOCALE` cookie carries it and none of this
is consulted again, so the choice sticks until they change it. Nine tests
cover the mapping; verified over real HTTP with geo headers.

### Session visibility and sign-out everywhere

`/admin/security` shows the account's two-factor state, its session
assurance level, last sign-in, and offers sign-out here or everywhere.

It deliberately does **not** list devices. Supabase exposes no per-session
device inventory, and a fabricated list would be worse than a short honest
one — an operator would read "no unknown devices" out of data that never
contained any.

### Why a super admin had "reset usage" — and what changed

Resetting **one user's** counters is a legitimate support action: someone
was metered for a request that failed, and an operator gives it back. It
is narrow, attributable and audited. That one stays.

Resetting **every** account's counters at once did not survive the
question. It was not a support action but a silent, unbounded grant of
free capacity across the whole platform, with no undo and no way to
reconstruct afterwards who had actually used what. Every real need it
covered is better served by raising an entitlement for the affected
window, which is visible in the plan and reversible. The permission, the
action, the helper and the button are removed rather than hidden.

### The admin sidebar scrolls properly

The shell was `min-h-screen`, so it grew with the page: the nav's
`overflow-y-auto` never had a bounded height to scroll inside, the whole
document scrolled instead, and the sidebar slid away with it. From `md`
up the shell is now `h-dvh overflow-hidden` with the nav and the content
pane each owning their own scroll, plus `overscroll-contain` so a flick at
the end of the nav does not chain into the page behind it. Small screens
keep a single normal page scroll.

### Other bugs found and fixed

- **`server-only` was never declared in `package.json`.** Fifteen modules
  import it; it survived only as a hoisted transitive package. Next
  aliases the specifier internally so builds passed — but `npm ci` on a
  clean machine would have produced a node_modules without it, and the
  test suite could not run. Now a real dependency, and `npm test` runs
  under `--conditions=react-server` so the package resolves to its
  intended empty module outside a server bundle.
- **The permission matrix imported the whole session module** for one
  error class, pulling Supabase, `next/navigation` and environment
  validation into a pure lookup-table unit test. `ForbiddenError` and
  `UnauthorizedError` moved to `src/auth/errors.ts`; `@/auth/session`
  re-exports them, so nothing else changed.
- **Redundant cache invalidation.** An earlier pass had inserted
  `revalidateRegistry()` before every `revalidatePath()` in the plan
  actions — three consecutive identical calls. Collapsed to one.


## 2026-08-29 — Separate staff entrance, and the app got ~5x faster

### The app was slow because of how RLS was written, not how much data there is

The platform felt sluggish on every signed-in page. Measured, the admin
dashboard took **1930ms** and `/api/models` **2249ms** — while the same
`/api/models` took 174ms for a signed-out visitor. Anything authenticated
was slow; anything anonymous was fine.

Three separate causes, found by instrumenting the server rather than
guessing:

**1. Every RLS policy re-evaluated auth once per row.** Policies were
written the natural way — `using (user_id = auth.uid() or
private.is_admin(auth.uid()))`. Postgres evaluates that expression *per
candidate row*, and `is_admin()` runs its own query against `profiles`, so
reading N rows fired N extra sub-queries. Worse, the `OR` made the
qualifier opaque to the planner, which then refused to use the `user_id`
index and scanned the whole table. Reading a handful of entitlement rows
cost **674–1080ms** against a ~170ms baseline.

Migration `0013` wraps each call in a scalar sub-query — `(select
auth.uid())` — which the planner hoists into an InitPlan evaluated once
per statement. `auth.uid()` and `is_admin()` are both STABLE, so hoisting
cannot change the result: same grants, same denials, same admin escape
hatch, 25 policies rewritten identically. Indexes were added on the
`user_id` columns the planner can now actually reach.

**2. Global config was re-read on every request.** Models, providers,
plans, plan entitlements, feature flags and system settings are identical
for every visitor and change only when an administrator edits them, yet
each request re-fetched them. `src/lib/cached-registry.ts` loads all six in
one batch behind a cross-request cache, keyed by a tag that every admin
write invalidates — so an edit still appears immediately. Nothing
user-scoped is cached across requests, and the loader uses a dedicated
cookie-less anon client so one visitor's view can never be served to
another.

**3. User-scoped data took three sequential round trips.** `profiles`,
`subscriptions` and `user_entitlements` were fetched one after another,
and the round-trip time to this project's region is ~156ms (min 141, max
181), so that was ~500ms of waiting before rendering began.
`src/auth/user-context.ts` fetches all three in a single embedded PostgREST
request — they all foreign-key to `profiles` — memoised per request.

The admin dashboard additionally made eight requests (three counts, two
listings, a usage roll-up, and a follow-up actor-name lookup that could not
start until the audit query returned). Migration `0014` replaces them with
one `admin_dashboard_snapshot()` RPC that does the counting and the join
inside Postgres. It is SECURITY DEFINER, so it authorizes the caller
itself before reading anything, is granted only to `authenticated`, and
contains no writes.

Measured, production build, cache-busted URLs:

| Route | Before | After |
| --- | --- | --- |
| `/en` (landing) | 574ms | **68ms** |
| `/en/pricing` | 449ms | **74ms** |
| `/en/admin` | 1930ms | **425ms** |
| `/en/admin/users` | 761ms | **404ms** |
| `/api/models` (authenticated) | 2249ms | **390ms** |
| `/api/conversations` | 379ms | **195ms** |

What remains is largely network distance: every database call is a real
round trip to a region ~156ms away from this machine. Deployed next to the
database that floor mostly disappears; see HANDOFF §14.

> **A measurement caveat worth recording.** The first three rounds of
> "optimisation" showed no improvement because the server under test was a
> stale process: `pkill -f "next start"` never matched it, since Next
> renames itself to `next-server`. Every "after" number was really a
> "before" number. Kill by `next-server`, and confirm the process age,
> before trusting a benchmark. Likewise, repeating a request to an
> identical URL measures Next's router cache, not the server — the numbers
> above use cache-busting query strings.

### Staff no longer share a front door with customers

Super admins and moderators now sign in at `/staff/login`, which is a
different page, form and server action from the customer `/login`:

- Five sign-in attempts per minute instead of fifteen.
- Every attempt is written to the audit log, success or failure.
- A non-staff account that authenticates correctly is signed straight back
  out and told nothing about which portals exist.
- `robots: noindex, nofollow`, and no "create an account" link — a staff
  role can only be granted from the CLI, so offering registration there
  would be a dead end.
- The customer login does not link to it.

Signed-out requests to `/admin` or `/moderator` now redirect to
`/staff/login` rather than the customer form, so an operator opening a
bookmark lands on their own entrance.

### The super admin can change more without a deploy

Six operational settings became editable at `/admin/settings`. They already
existed as rows but the server action rejected them, because its validation
map did not list them — so saving silently failed. Each now has a schema:

- `billing_currency` — checkout currency (this account is NGN-only)
- `default_locale` — locale for a visitor with no preference
- `support_email` — contact shown in error and billing copy
- `free_plan_slug` — plan an account falls back to
- `chat_rate_limit_per_minute` — burst limit in front of the daily quota
- `max_conversation_messages` — history sent to the model per turn


## 2026-08-29 — The app was never interactive in a browser

Three bugs, each independently fatal, that only showed up under a real
browser. `curl` returned 200 and full HTML throughout, which is why every
server-side check passed while the product did nothing when clicked.

### The Content Security Policy blocked the framework

`next.config.ts` set `script-src 'self'` with no `unsafe-inline` and no
nonce, above a comment asserting "no inline scripts exist anywhere in the
app". The App Router streams its RSC payload to the browser as inline
`<script>self.__next_f.push(...)</script>` tags — that is *how* the client
receives the component tree. Every one was blocked, the flight stream
truncated with "Connection closed", and **React never hydrated on any
page**. Nothing was clickable anywhere: the password reveal, the send
button, the nav links, the login form (which sat on its loading skeleton
forever).

- CSP moved to `src/lib/csp.ts` and issued per request from middleware
  with a fresh nonce, which Next stamps onto its own inline scripts.
- `'unsafe-eval'` is allowed in **development only** — Next's React
  Refresh runtime evaluates its hot-reload payload with `eval`, so a
  strict policy blocks the dev bundle entirely. Production stays strict.
- Deliberately not `'strict-dynamic'`: it makes browsers ignore `'self'`,
  which would force a nonce onto external scripts too — and a per-request
  nonce rendered into the tree is a guaranteed hydration mismatch.
- The theme script moved from `next/script` (`beforeInteractive`, which
  emitted `nonce=""` against `undefined` and tripped React's hydration
  check) to a plain same-origin `<script src>` with no nonce.

Verified in Chrome against both a dev and a production build: zero console
errors, full hydration, strict production policy.

### Chat history never loaded

`messages` and `message_variants` reference each other twice
(`message_variants.message_id → messages.id` and
`messages.active_variant_id → message_variants.id`), so PostgREST rejected
the `message_variants(*)` embed as ambiguous with `PGRST201`. The result
was discarded without checking `error`, so every conversation rendered as
"no messages" — including immediately after a reply streamed in.

- Both call sites now name the foreign key explicitly
  (`message_variants!message_variants_message_id_fkey`).
- The conversation page throws and logs on a failed read instead of
  rendering an empty conversation, which is indistinguishable from a real
  empty one and is exactly how this stayed invisible.
- `loadConversationHistory` no longer issues one query per assistant
  message; it batches them. That ran on every chat turn.

### Homepage typography

Reworked to a fluid scale (`--text-display` … `--text-body` in
`globals.css`) built on `clamp()`, so the headline moves smoothly from
~34px on a phone to ~60px on a wide monitor with no jump at any
breakpoint. Each step carries its own leading, since a 60px headline at
body line-height looks unset. Copy is capped to a readable measure rather
than running the full width of a large screen, and the `rem` term in each
clamp keeps text responsive to the reader's own browser font size (a pure
`vw` value would break zoom, WCAG 1.4.4).

Applied to the landing page, pricing page and plan cards; the application
chrome deliberately keeps its fixed dense sizes. CTAs go full-width and
touch-height on phones, and the header sheds its duplicate "Pricing" link
below `sm`.


## 2026-08-28 — Audit, repair and overhaul

A full pass over the codebase: registration outage fixed, pricing
corrected at the source, staff portals separated, design system rebuilt,
security hardened. Everything below was verified against the live Supabase
project unless noted otherwise.

---

### Critical fixes

**Registration was completely broken for every user outside the project
team.** `supabase.auth.signUp()` returned HTTP 500 "Error sending
confirmation email" and GoTrue rolled the sign-up back, so no account was
created. Supabase's built-in SMTP only delivers to project members.
Resend was configured with a verified domain and never imported anywhere.

- Added `src/notifications/` — provider-agnostic email with a Resend
  adapter, a console fallback that honestly reports `delivered: false`,
  and localized templates in all 7 locales.
- Added `src/auth/registration.ts`: creates the account via
  `admin.generateLink()` (no provider mail), sends our own verification
  email, and **deletes the account if delivery fails** so the person can
  retry rather than being stranded as an unverifiable "already
  registered" address.
- Added `/api/auth/confirm` to redeem the token via `verifyOtp`.
- Falls back to `signUp()` when no email provider is configured.
- The `registration` feature flag is now actually enforced (it existed and
  was never read).
- Verified end to end on the live project.

**The pricing page said $20; the database and checkout said $10.** The
page fetched the plans and discarded the result — the entire card was
hardcoded, including features that did not exist ("Claude 3.5 Sonnet,
GPT-4o", "unlimited daily conversations") next to a plan whose rows said
500 messages/day.

- Added `src/billing/pricing.ts` as the single source of truth. Price,
  plan name and every feature line now derive from `plans` /
  `plan_entitlements`; checkout resolves its amount through the same
  helper. Locale-aware currency formatting via `Intl.NumberFormat`.
- Verified: `/en/pricing` renders **$10** with the real entitlements.

**Every AI model was retired upstream**, so all chat failed with
`provider_error`. Registry refreshed with ids verified live (`0010`).

**Moderators had full run of the admin console.** No `/moderator` existed,
and the permission layer had no notion of who an action targets — a
moderator could suspend a Super Admin.

---

### Security

- **Fixed a self-inflicted regression:** migration `0008` revoked EXECUTE
  on `public.is_admin()` to close it as a PostgREST RPC, which broke the
  sixteen RLS policies calling it — `plans`, `profiles`, `conversations`
  and more became unreadable. `0009` moves the helpers to a `private`
  schema instead: callable from policies, unreachable as RPCs.
- `is_admin` / `is_super_admin` no longer callable as
  `/rest/v1/rpc/is_admin` by anonymous users.
- `assertCanActOn` added: moderators cannot act on staff; nobody can aim a
  destructive action at their own account; a Super Admin's role cannot be
  changed from the console.
- Database trigger refuses to remove the last active Super Admin.
- `admin_audit_logs` made append-only by trigger — the service role
  bypasses RLS, so this had to be a trigger.
- `src/lib/env.ts` split: `@/lib/env` is browser-safe; `@/lib/env.server`
  carries `server-only`, so a Client Component reaching a secret now fails
  the build. Previously the whole `process.env` object was handed to a
  schema listing every secret by name.
- Added `safeNextPath()` and applied it to the auth callback, the confirm
  route, middleware and the login form — rejects protocol-relative,
  backslash and control-character redirect smuggling.
- Sign-in now refuses suspended/disabled accounts and signs the session
  back out; the app shell re-checks on every request.
- Sign-in failures collapse to one message so the form is not an
  account-enumeration oracle.
- Bootstrap script rewritten: setup token mandatory and compared in
  constant time (it was only enforced *if* set); passwords prompted with
  echo off and never accepted as CLI arguments; `listUsers()` paginated
  (it silently failed past 50 accounts).
- `pg_trgm` moved out of the exposed `public` schema.
- Supabase security advisories: 13 → 3, the remainder benign or platform-owned.

---

### Billing

- Webhook rewritten. It previously returned **200 on every processing
  failure**, telling Paystack the event was handled and losing the
  payment. Now returns non-2xx so Paystack retries; the idempotency check
  makes redelivery safe.
- Fixed `.maybeSingle()` on a bare `user_id` subscription lookup, which
  *errors* on multiple rows — a user who cancelled and resubscribed had
  their new subscription silently never activated.
- Renewal charges carry no `metadata`, so renewals recorded a payment but
  never extended the period and subscriptions silently expired while
  billing continued. Plan is now resolved from the Paystack plan code, then
  from the existing subscription.
- `subscription.create` arriving before `charge.success` used to lose the
  subscription code and email token, making self-service cancellation
  impossible. Now detected and logged.
- `subscription.not_renew` no longer treated as immediate cancellation —
  it means "lapses at period end", and collapsing them cut access short for
  a period already paid for.
- `PAYSTACK_WEBHOOK_SECRET` now falls back to the secret key, which is what
  Paystack actually signs with.

---

### Portals

- **New `/moderator`** — separate route tree, own guard, own nav.
  Moderators see accounts and the moderation log; billing, plans, models,
  providers, settings and role changes are absent, not merely hidden.
- `/admin` is now Super Admin only. Moderators are redirected to their own
  console.
- **Usage administration built** — the admin usage page was read-only with
  no way to reset or override anything. Now: platform totals, top
  consumers, per-user and platform-wide resets (typed `RESET`
  confirmation), and per-user quota overrides with reason and audit trail.
- Admin user management: server-side search with escaped LIKE wildcards,
  role/status filters, pagination, and a detail view with usage and
  overrides.
- **Password-reset and magic-link actions now actually send.** They called
  `generateLink()` and dropped the result, reporting "Reset link sent"
  while nothing was delivered.
- New platform status page with live credential probes per provider.
- Plan editor: typed controls with explicit save. It previously saved on
  blur — tabbing through a card wrote every value it passed — and
  entitlements were edited as raw JSON.
- System settings validated per key; an unknown key is refused rather than
  written as a row nothing reads.
- Audit entries now record the previous value, not just the new one.

---

### Chat

- **Message editing actually edits.** It previously re-sent the text as a
  new message at the bottom, leaving the original and its orphaned answer
  in place. New `/api/chat/edit` rewrites the message, stamps `edited_at`,
  drops the superseded tail and re-answers.
- **Generated images no longer expire.** A 1-hour signed URL was baked
  permanently into message content, so every generated image broke an hour
  later. New `/api/assets/[id]` re-signs on demand and re-checks ownership.
- New conversations now appear in the sidebar without a reload.
- Auto-scroll only when already at the bottom — it previously yanked the
  view away from anyone reading back through a conversation while a reply
  streamed.
- Stop preserves the partial response as `stopped` rather than `error`.
- Optimistic message ids are reconciled with server ids, so regenerate and
  edit work without a reload.
- Conversation **rename** implemented — the translation key existed, the
  feature did not.
- Composer respects feature flags and plan limits: no attach button when
  uploads are off, no image control when generation is off, size checked
  before upload rather than after.
- IME-safe Enter handling (Japanese/Chinese input no longer sends on
  candidate selection).
- Streaming replies announced through a polite live region.

---

### Design system

Rebuilt against the master spec's explicit "avoid" list. Removed
glassmorphism, glow shadows, gradient text and decorative blobs. One
neutral ramp, one accent, four radii, three elevation steps, all in
`globals.css`.

- Rebuilt every UI primitive; added `Table`, `Alert`, `EmptyState`,
  `PageHeader`, `ConfirmDialog`, `Field`, `StatTile`, `StatusDot`.
- `ConfirmDialog` replaces `window.confirm`, with typed confirmation
  phrases for the highest-risk actions.
- Accessibility: single global focus-visible treatment; the password
  reveal is now reachable by keyboard (it had `tabIndex={-1}`) and
  announces state; row actions revealed on focus as well as hover; status
  never conveyed by colour alone; meters carry values; skip links.
- RTL via logical properties throughout.
- Dialogs dock to the bottom on mobile so the primary action stays in
  thumb reach.

---

### Internationalization

- 7 locales × 558 keys, all in sync (was 163 keys with large parts of the
  UI hardcoded in English).
- Full translations for the admin console, moderator console, chat,
  settings, billing, landing and all transactional email.
- New `npm run check-i18n` resolves each `t("…")` against its declared
  namespace and fails on missing or drifted keys.

---

### Data & types

- `Update` types now derive from `Partial<Row>`, not `Partial<Insert>`.
  The old shape made any column absent from `Insert` un-updatable — it
  broke `messages.edited_at` and `usage_counters.updated_at` with a
  `never` type.
- Fixed the drift between `src/types/database.ts` and the live schema.
- New `npm run db:types:check` fails the build on drift.
- Indexes added for the queries actually run: trigram for `ilike` search
  (which cannot use a btree index at all), usage roll-ups by period,
  subscription lookups by provider reference.
- N+1 patterns removed from the moderation log, audit log, subscriptions
  and user detail views.

---

### Housekeeping

- Three overlapping super-admin scripts consolidated into one.
- `npm run verify` runs typecheck, lint, i18n, tests and build.
- Tests: 22 → 34, covering the permission matrix, target guards,
  redirect safety and pricing resolution.
- `HANDOFF.md` rewritten; `.env.example` documents impact per provider.
