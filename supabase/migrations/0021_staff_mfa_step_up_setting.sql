-- Mujeeb AI — 0021: make per-sign-in MFA step-up optional.
--
-- The gate previously required every staff session to reach `aal2`, which
-- meant an authenticator code on every sign-in. When the browser-side
-- verification and the server's view of the session disagreed, the gate
-- bounced the operator to `/staff/login?step=mfa` — a page that showed the
-- password form again. From the outside that reads as "the console keeps
-- asking me to set up MFA".
--
-- Enrolment stays mandatory either way: a staff account still cannot reach
-- a portal until it has an authenticator set up. This setting controls
-- only the step-up.
--
-- Default false, which is the requested behaviour: set it up once on first
-- access, then sign in with a password afterwards. Worth being plain about
-- the trade-off — a second factor that is never asked for cannot stop a
-- stolen password, so `true` is the stronger posture and is one toggle
-- away at /admin/settings.

insert into public.system_settings (key, value, description)
values (
  'staff_require_mfa_each_signin',
  'false'::jsonb,
  'Require staff to enter an authenticator code on every sign-in, not just at setup. Enrolment is always required. Off means a stolen staff password is enough to sign in — turn it on for the stronger posture.'
)
on conflict (key) do nothing;
