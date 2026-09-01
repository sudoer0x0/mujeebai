-- Mujeeb AI — 0025: require an authenticator code on every staff sign-in.
--
-- `staff_require_mfa_each_signin` was introduced defaulting to false, on
-- the reasoning that setup should happen once and not be asked for again.
-- In practice that made the second factor decorative: enrolment was
-- mandatory, but the factor was never challenged, so a stolen staff
-- password alone reached the console.
--
-- Default is now true. Enrolment was already required; this makes the
-- verification required too, which is the entire point of having it.
--
-- It stays a setting rather than a constant so an operator locked out
-- mid-incident can turn it off deliberately and visibly — recorded in the
-- audit log — rather than needing a deploy.

update public.system_settings
set value = 'true'::jsonb,
    description = 'Require staff to enter an authenticator code on every sign-in. On by default. Turning it off means a stolen staff password alone reaches the console — do it only to recover from a lockout, and turn it back on.'
where key = 'staff_require_mfa_each_signin';
