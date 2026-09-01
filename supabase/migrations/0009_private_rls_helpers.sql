-- Mujeeb AI — 0009: move the RLS helper functions out of the exposed schema.
--
-- 0008 revoked EXECUTE on public.is_admin()/is_super_admin() from anon and
-- authenticated to stop them being callable over PostgREST as
-- /rest/v1/rpc/is_admin. That closed the RPC, but it also broke sixteen RLS
-- policies that call these functions during policy evaluation: every one of
-- them started failing with "permission denied for function is_admin",
-- which made `plans`, `profiles`, `conversations`, `messages`,
-- `subscriptions` and the rest unreadable for ordinary sessions. The
-- pricing page rendering "Plans are unavailable" was the visible symptom.
--
-- The right fix is placement, not permission: PostgREST only exposes the
-- schemas it is configured with (public/graphql_public here), so a helper
-- that lives in a private schema is unreachable as an RPC while remaining
-- perfectly callable from inside a policy.

create schema if not exists private;

grant usage on schema private to authenticated, anon, service_role;

create or replace function private.is_admin(uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = uid and role in ('moderator', 'super_admin')
  );
$$;

create or replace function private.is_super_admin(uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles where id = uid and role = 'super_admin'
  );
$$;

grant execute on function private.is_admin(uuid) to authenticated, anon, service_role;
grant execute on function private.is_super_admin(uuid) to authenticated, anon, service_role;

-- ---------------------------------------------------------------------
-- Repoint every policy that referenced the public helpers.
-- ---------------------------------------------------------------------
drop policy if exists "profiles_select_own_or_admin" on public.profiles;
create policy "profiles_select_own_or_admin" on public.profiles for select
  using (id = auth.uid() or private.is_admin(auth.uid()));

drop policy if exists "conversations_admin_select" on public.conversations;
create policy "conversations_admin_select" on public.conversations for select
  using (private.is_admin(auth.uid()));

drop policy if exists "messages_admin_select" on public.messages;
create policy "messages_admin_select" on public.messages for select
  using (private.is_admin(auth.uid()));

drop policy if exists "message_variants_admin_select" on public.message_variants;
create policy "message_variants_admin_select" on public.message_variants for select
  using (private.is_admin(auth.uid()));

drop policy if exists "attachments_admin_select" on public.attachments;
create policy "attachments_admin_select" on public.attachments for select
  using (private.is_admin(auth.uid()));

drop policy if exists "generated_assets_admin_select" on public.generated_assets;
create policy "generated_assets_admin_select" on public.generated_assets for select
  using (private.is_admin(auth.uid()));

drop policy if exists "plans_select_active" on public.plans;
create policy "plans_select_active" on public.plans for select
  using (is_active or private.is_admin(auth.uid()));

drop policy if exists "user_entitlements_select_own_or_admin" on public.user_entitlements;
create policy "user_entitlements_select_own_or_admin" on public.user_entitlements for select
  using (user_id = auth.uid() or private.is_admin(auth.uid()));

drop policy if exists "usage_events_select_own_or_admin" on public.usage_events;
create policy "usage_events_select_own_or_admin" on public.usage_events for select
  using (user_id = auth.uid() or private.is_admin(auth.uid()));

drop policy if exists "usage_counters_select_own_or_admin" on public.usage_counters;
create policy "usage_counters_select_own_or_admin" on public.usage_counters for select
  using (user_id = auth.uid() or private.is_admin(auth.uid()));

drop policy if exists "subscriptions_select_own_or_admin" on public.subscriptions;
create policy "subscriptions_select_own_or_admin" on public.subscriptions for select
  using (user_id = auth.uid() or private.is_admin(auth.uid()));

drop policy if exists "payment_records_select_own_or_admin" on public.payment_records;
create policy "payment_records_select_own_or_admin" on public.payment_records for select
  using (user_id = auth.uid() or private.is_admin(auth.uid()));

drop policy if exists "system_prompt_versions_admin_select" on public.system_prompt_versions;
create policy "system_prompt_versions_admin_select" on public.system_prompt_versions for select
  using (private.is_admin(auth.uid()));

drop policy if exists "admin_roles_select_admin" on public.admin_roles;
create policy "admin_roles_select_admin" on public.admin_roles for select
  using (private.is_admin(auth.uid()));

drop policy if exists "admin_audit_logs_select_admin" on public.admin_audit_logs;
create policy "admin_audit_logs_select_admin" on public.admin_audit_logs for select
  using (private.is_admin(auth.uid()));

drop policy if exists "moderation_records_select_admin" on public.moderation_records;
create policy "moderation_records_select_admin" on public.moderation_records for select
  using (private.is_admin(auth.uid()));

-- The public copies are now unreferenced. Drop them so there is exactly one
-- definition of "is this account an administrator" and no un-revoked
-- duplicate can drift back into an exposed schema.
drop function if exists public.is_admin(uuid);
drop function if exists public.is_super_admin(uuid);
