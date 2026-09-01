-- Mujeeb AI — 0013: stop RLS re-evaluating auth per row.
--
-- ## The problem
--
-- Every policy in 0002/0009 was written the natural way:
--
--     using (user_id = auth.uid() or private.is_admin(auth.uid()))
--
-- Postgres treats `auth.uid()` and `private.is_admin(...)` as ordinary
-- expressions in the qualifier, so it evaluates them **once per candidate
-- row**. `private.is_admin()` is a SECURITY DEFINER function that runs its
-- own `select ... from public.profiles` — so reading N rows from a table
-- ran N extra sub-queries against `profiles`.
--
-- Worse, the `OR` makes the whole qualifier opaque to the planner: it can
-- no longer use the `user_id` index to narrow the scan first, so it reads
-- the entire table and calls `is_admin()` on every row it touches.
--
-- Measured on this project, against a ~170ms network baseline for a
-- trivial query:
--
--     user_entitlements  674 – 1080ms
--     subscriptions      168 –  664ms
--
-- That was the single largest cost in an authenticated request — larger
-- than every network round trip put together — and it grows with the size
-- of the table, so it would have degraded further as the platform filled up.
--
-- ## The fix
--
-- Wrapping the call in a scalar sub-query — `(select auth.uid())` — lets
-- the planner hoist it into an **InitPlan**: evaluated once for the whole
-- statement, then treated as a constant. The constant then makes
-- `user_id = <const>` an ordinary indexable predicate again.
--
-- This is a pure planner optimisation. The policies below grant and deny
-- exactly what they granted and denied before — same columns, same
-- operators, same OR structure, same admin escape hatch. `auth.uid()` and
-- `is_admin()` are STABLE, meaning they are already guaranteed to return
-- the same value for the duration of one statement, which is precisely why
-- hoisting them cannot change the outcome.
--
-- Nothing here relaxes an authorization boundary. Verify with the RBAC
-- matrix in scripts/verify-rbac.ts after applying.

-- ---------------------------------------------------------------------
-- Owner-scoped policies
-- ---------------------------------------------------------------------

drop policy if exists "profiles_select_own_or_admin" on public.profiles;
create policy "profiles_select_own_or_admin" on public.profiles for select
  using (id = (select auth.uid()) or (select private.is_admin((select auth.uid()))));

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles for update
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

drop policy if exists "conversations_owner_all" on public.conversations;
create policy "conversations_owner_all" on public.conversations for all
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists "messages_owner_all" on public.messages;
create policy "messages_owner_all" on public.messages for all
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists "attachments_owner_all" on public.attachments;
create policy "attachments_owner_all" on public.attachments for all
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

drop policy if exists "generated_assets_owner_all" on public.generated_assets;
create policy "generated_assets_owner_all" on public.generated_assets for all
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

drop policy if exists "notifications_owner_select" on public.notifications;
create policy "notifications_owner_select" on public.notifications for select
  using (user_id = (select auth.uid()));

drop policy if exists "notifications_owner_update" on public.notifications;
create policy "notifications_owner_update" on public.notifications for update
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- Join-scoped ownership: the EXISTS sub-queries stay exactly as they were,
-- only the auth call inside them is hoisted.

drop policy if exists "message_variants_owner_all" on public.message_variants;
create policy "message_variants_owner_all" on public.message_variants for all
  using (
    exists (
      select 1 from public.messages
      where messages.id = message_variants.message_id
        and messages.user_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.messages
      where messages.id = message_variants.message_id
        and messages.user_id = (select auth.uid())
    )
  );

drop policy if exists "message_attachments_owner_all" on public.message_attachments;
create policy "message_attachments_owner_all" on public.message_attachments for all
  using (
    exists (
      select 1 from public.messages
      where messages.id = message_attachments.message_id
        and messages.user_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.messages
      where messages.id = message_attachments.message_id
        and messages.user_id = (select auth.uid())
    )
    and exists (
      select 1 from public.attachments
      where attachments.id = message_attachments.attachment_id
        and attachments.owner_id = (select auth.uid())
    )
  );

-- ---------------------------------------------------------------------
-- Own-or-admin policies (the expensive OR)
-- ---------------------------------------------------------------------

drop policy if exists "user_entitlements_select_own_or_admin" on public.user_entitlements;
create policy "user_entitlements_select_own_or_admin" on public.user_entitlements for select
  using (user_id = (select auth.uid()) or (select private.is_admin((select auth.uid()))));

drop policy if exists "subscriptions_select_own_or_admin" on public.subscriptions;
create policy "subscriptions_select_own_or_admin" on public.subscriptions for select
  using (user_id = (select auth.uid()) or (select private.is_admin((select auth.uid()))));

drop policy if exists "usage_events_select_own_or_admin" on public.usage_events;
create policy "usage_events_select_own_or_admin" on public.usage_events for select
  using (user_id = (select auth.uid()) or (select private.is_admin((select auth.uid()))));

drop policy if exists "usage_counters_select_own_or_admin" on public.usage_counters;
create policy "usage_counters_select_own_or_admin" on public.usage_counters for select
  using (user_id = (select auth.uid()) or (select private.is_admin((select auth.uid()))));

drop policy if exists "payment_records_select_own_or_admin" on public.payment_records;
create policy "payment_records_select_own_or_admin" on public.payment_records for select
  using (user_id = (select auth.uid()) or (select private.is_admin((select auth.uid()))));

drop policy if exists "plans_select_active" on public.plans;
create policy "plans_select_active" on public.plans for select
  using (is_active or (select private.is_admin((select auth.uid()))));

-- ---------------------------------------------------------------------
-- Admin-only read policies
-- ---------------------------------------------------------------------

drop policy if exists "conversations_admin_select" on public.conversations;
create policy "conversations_admin_select" on public.conversations for select
  using ((select private.is_admin((select auth.uid()))));

drop policy if exists "messages_admin_select" on public.messages;
create policy "messages_admin_select" on public.messages for select
  using ((select private.is_admin((select auth.uid()))));

drop policy if exists "message_variants_admin_select" on public.message_variants;
create policy "message_variants_admin_select" on public.message_variants for select
  using ((select private.is_admin((select auth.uid()))));

drop policy if exists "attachments_admin_select" on public.attachments;
create policy "attachments_admin_select" on public.attachments for select
  using ((select private.is_admin((select auth.uid()))));

drop policy if exists "generated_assets_admin_select" on public.generated_assets;
create policy "generated_assets_admin_select" on public.generated_assets for select
  using ((select private.is_admin((select auth.uid()))));

drop policy if exists "admin_audit_logs_select_admin" on public.admin_audit_logs;
create policy "admin_audit_logs_select_admin" on public.admin_audit_logs for select
  using ((select private.is_admin((select auth.uid()))));

drop policy if exists "admin_roles_select_admin" on public.admin_roles;
create policy "admin_roles_select_admin" on public.admin_roles for select
  using ((select private.is_admin((select auth.uid()))));

drop policy if exists "moderation_records_select_admin" on public.moderation_records;
create policy "moderation_records_select_admin" on public.moderation_records for select
  using ((select private.is_admin((select auth.uid()))));

drop policy if exists "system_prompt_versions_admin_select" on public.system_prompt_versions;
create policy "system_prompt_versions_admin_select" on public.system_prompt_versions for select
  using ((select private.is_admin((select auth.uid()))));

-- ---------------------------------------------------------------------
-- Indexes the planner can now actually reach.
--
-- With the qualifier reduced to `user_id = <constant>`, these stop being
-- decorative.
-- ---------------------------------------------------------------------

create index if not exists user_entitlements_user_id_idx on public.user_entitlements (user_id);
create index if not exists subscriptions_user_id_status_idx on public.subscriptions (user_id, status);
create index if not exists usage_counters_user_id_idx on public.usage_counters (user_id);
create index if not exists usage_events_user_id_idx on public.usage_events (user_id);
create index if not exists payment_records_user_id_idx on public.payment_records (user_id);

analyze public.user_entitlements;
analyze public.subscriptions;
analyze public.usage_counters;
analyze public.profiles;
