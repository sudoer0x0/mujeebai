-- Mujeeb AI — 0015: staff onboarding state (temp password + mandatory MFA).
--
-- A moderator is now provisioned by a super admin from the console rather
-- than by handing someone a password out of band. That flow needs state
-- the profile did not carry:
--
--   must_change_password  the account was created with a temporary
--                         password and must set its own before it can do
--                         anything
--   mfa_enrolled_at       TOTP enrolment completed; staff cannot reach a
--                         portal before this
--   password_changed_at   for the audit trail
--   invited_by/invited_at who provisioned this account, and when
--
-- ## Why a trigger and not just RLS
--
-- `profiles_update_own` deliberately lets a user update their own row —
-- that is how display name, theme and locale are saved. That policy would
-- also let a browser send `must_change_password = false` and walk straight
-- past the gate, which turns a security control into a suggestion.
--
-- Column-level grants were the alternative, but they would have to be
-- repeated for every future column and are easy to forget. A trigger
-- states the rule once: these four columns are writable by the service
-- role only. Server actions that legitimately change them already run
-- with the service role after an authorization check.

alter table public.profiles
  add column if not exists must_change_password boolean not null default false,
  add column if not exists password_changed_at timestamptz,
  add column if not exists mfa_enrolled_at timestamptz,
  add column if not exists invited_by uuid references public.profiles(id) on delete set null,
  add column if not exists invited_at timestamptz;

comment on column public.profiles.must_change_password is
  'Set when an account is provisioned with a temporary password. The staff portal refuses to render anything but the change-password screen while this is true.';
comment on column public.profiles.mfa_enrolled_at is
  'When the account completed TOTP enrolment. Staff roles cannot reach a portal until this is set.';

create or replace function public.protect_staff_onboarding_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if current_setting('request.jwt.claim.role', true) is distinct from 'service_role'
     and auth.uid() is not null then
    if new.must_change_password is distinct from old.must_change_password
       or new.mfa_enrolled_at is distinct from old.mfa_enrolled_at
       or new.password_changed_at is distinct from old.password_changed_at
       or new.invited_by is distinct from old.invited_by then
      raise exception 'onboarding columns are not user-writable'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists protect_staff_onboarding_columns on public.profiles;
create trigger protect_staff_onboarding_columns
  before update on public.profiles
  for each row execute function public.protect_staff_onboarding_columns();

create index if not exists profiles_role_idx on public.profiles (role) where role <> 'user';
