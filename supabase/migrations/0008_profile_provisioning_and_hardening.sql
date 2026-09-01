-- Mujeeb AI — 0008: profile provisioning repair, privilege guards, search indexes.
--
-- NOTE: parts of this migration are superseded by 0009. The revokes at the
-- bottom of section 3 on is_admin/is_super_admin broke every RLS policy
-- that calls them; 0009 fixes that properly by moving those helpers into a
-- schema PostgREST does not expose. Migrations are history, so this file
-- is left as it ran — read 0009 alongside it.

-- ---------------------------------------------------------------------
-- 1. Repair profile auto-provisioning.
--
-- The deployed version of this trigger only ever inserted (id, email), so
-- every account created since launch landed with a null display_name and
-- the default 'en' locale regardless of what the user chose. It had
-- drifted from 0001_core_schema.sql; this is the authoritative version.
-- ---------------------------------------------------------------------
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  _display_name text;
  _locale text;
begin
  _display_name := nullif(trim(coalesce(
    new.raw_user_meta_data->>'display_name',
    new.raw_user_meta_data->>'full_name',
    new.raw_user_meta_data->>'name',
    nullif(trim(concat_ws(' ',
      new.raw_user_meta_data->>'first_name',
      new.raw_user_meta_data->>'last_name')), ''),
    split_part(coalesce(new.email, ''), '@', 1)
  )), '');

  _locale := coalesce(nullif(new.raw_user_meta_data->>'locale', ''), 'en');
  if _locale not in ('en','fr','ar','pt','es','ja','zh') then
    _locale := 'en';
  end if;

  insert into public.profiles (id, email, display_name, locale)
  values (new.id, new.email, _display_name, _locale)
  on conflict (id) do update set
    email = excluded.email,
    -- Never clobber a name the user has already set for themselves.
    display_name = coalesce(public.profiles.display_name, excluded.display_name);

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

-- Backfill accounts the broken trigger left without a name.
update public.profiles p
set display_name = coalesce(
  nullif(trim(u.raw_user_meta_data->>'display_name'), ''),
  nullif(trim(u.raw_user_meta_data->>'full_name'), ''),
  nullif(trim(concat_ws(' ',
    u.raw_user_meta_data->>'first_name',
    u.raw_user_meta_data->>'last_name')), ''),
  split_part(coalesce(p.email, u.email, ''), '@', 1)
)
from auth.users u
where u.id = p.id and (p.display_name is null or trim(p.display_name) = '');

-- ---------------------------------------------------------------------
-- 2. Pin search_path on the remaining helper functions.
-- ---------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.profiles_guard_privileged_fields()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  if auth.role() is distinct from 'service_role' then
    if new.role is distinct from old.role or new.status is distinct from old.status then
      raise exception 'profiles.role and profiles.status can only be changed by a trusted server-side process';
    end if;
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- 3. Stop exposing internal SECURITY DEFINER helpers over PostgREST.
--    (See the header: the is_admin/is_super_admin revokes here are
--    superseded by 0009, which relocates them instead.)
-- ---------------------------------------------------------------------
revoke all on function public.handle_new_auth_user() from public, anon, authenticated;
revoke all on function public.sync_profile_role_from_admin_roles() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 4. Never allow the platform to lose its last Super Admin (#132).
--
-- Enforced in the database rather than only in the admin UI, so it also
-- holds for a service-role call, a script, or a manual SQL edit.
-- ---------------------------------------------------------------------
create or replace function public.guard_last_super_admin()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  remaining integer;
begin
  if tg_op = 'UPDATE'
     and not (old.role = 'super_admin' and old.revoked_at is null and new.revoked_at is not null) then
    return new;
  end if;
  if tg_op = 'DELETE' and not (old.role = 'super_admin' and old.revoked_at is null) then
    return old;
  end if;

  select count(*) into remaining
  from admin_roles
  where role = 'super_admin' and revoked_at is null and id <> old.id;

  if remaining = 0 then
    raise exception
      'Refusing to remove the last active Super Admin. Grant the role to another account first, or use scripts/super-admin.ts to recover.'
      using errcode = 'check_violation';
  end if;

  return case tg_op when 'DELETE' then old else new end;
end;
$$;

drop trigger if exists admin_roles_guard_last_super_admin on public.admin_roles;
create trigger admin_roles_guard_last_super_admin
  before update or delete on public.admin_roles
  for each row execute function public.guard_last_super_admin();

revoke all on function public.guard_last_super_admin() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 5. Make the admin audit trail append-only.
--
-- An audit log an administrator can quietly edit is not an audit log. The
-- service role bypasses RLS, so this has to be a trigger.
-- ---------------------------------------------------------------------
create or replace function public.admin_audit_logs_append_only()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'admin_audit_logs is append-only; % is not permitted', tg_op
    using errcode = 'insufficient_privilege';
end;
$$;

drop trigger if exists admin_audit_logs_immutable on public.admin_audit_logs;
create trigger admin_audit_logs_immutable
  before update or delete on public.admin_audit_logs
  for each row execute function public.admin_audit_logs_append_only();

-- ---------------------------------------------------------------------
-- 6. Indexes matching the queries the app actually runs.
-- ---------------------------------------------------------------------
create extension if not exists pg_trgm;

-- Admin user search does `email ilike '%term%'`, which cannot use a btree
-- index at all; trigram makes it an index scan.
create index if not exists profiles_email_trgm_idx on public.profiles using gin (email gin_trgm_ops);
create index if not exists profiles_display_name_trgm_idx on public.profiles using gin (display_name gin_trgm_ops);
create index if not exists profiles_role_idx on public.profiles (role) where role <> 'user';
create index if not exists profiles_status_idx on public.profiles (status) where status <> 'active';

create index if not exists conversations_title_trgm_idx on public.conversations using gin (title gin_trgm_ops);

-- Admin usage roll-ups scan a whole period, not a single user.
create index if not exists usage_counters_period_idx on public.usage_counters (period, period_key, category);

-- Subscription reconciliation looks up by provider identifiers.
create index if not exists subscriptions_provider_sub_code_idx
  on public.subscriptions (provider_subscription_code) where provider_subscription_code is not null;
create index if not exists subscriptions_provider_reference_idx
  on public.subscriptions (provider_reference) where provider_reference is not null;

create index if not exists admin_audit_logs_action_idx on public.admin_audit_logs (action, created_at desc);
