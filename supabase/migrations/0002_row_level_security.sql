-- Mujeeb AI — Row Level Security (RLS) policies
-- Helper functions
create or replace function is_admin(uid uuid)
returns boolean as $$
  select exists (
    select 1 from profiles
    where id = uid and role in ('moderator', 'super_admin')
  );
$$ language sql stable security definer set search_path = public;

create or replace function is_super_admin(uid uuid)
returns boolean as $$
  select exists (
    select 1 from profiles where id = uid and role = 'super_admin'
  );
$$ language sql stable security definer set search_path = public;

-- ---------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------
alter table profiles enable row level security;

create policy "profiles_select_own_or_admin"
  on profiles for select
  using (id = auth.uid() or is_admin(auth.uid()));

create policy "profiles_update_own"
  on profiles for update
  using (id = auth.uid())
  with check (id = auth.uid());
  -- role/status changes are additionally blocked by the
  -- profiles_guard_privileged_fields trigger regardless of this policy.

-- ---------------------------------------------------------------------
-- providers & models — public read (needed to render the model selector),
-- writes are server-only (service role / admin API routes).
-- ---------------------------------------------------------------------
alter table providers enable row level security;
create policy "providers_select_all" on providers for select using (true);

alter table models enable row level security;
create policy "models_select_all" on models for select using (true);

-- ---------------------------------------------------------------------
-- conversations
-- ---------------------------------------------------------------------
alter table conversations enable row level security;

create policy "conversations_owner_all"
  on conversations for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "conversations_admin_select"
  on conversations for select
  using (is_admin(auth.uid()));

-- ---------------------------------------------------------------------
-- messages
-- ---------------------------------------------------------------------
alter table messages enable row level security;

create policy "messages_owner_all"
  on messages for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "messages_admin_select"
  on messages for select
  using (is_admin(auth.uid()));

-- ---------------------------------------------------------------------
-- message_variants (ownership derived from parent message)
-- ---------------------------------------------------------------------
alter table message_variants enable row level security;

create policy "message_variants_owner_all"
  on message_variants for all
  using (
    exists (
      select 1 from messages
      where messages.id = message_variants.message_id
        and messages.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from messages
      where messages.id = message_variants.message_id
        and messages.user_id = auth.uid()
    )
  );

create policy "message_variants_admin_select"
  on message_variants for select
  using (is_admin(auth.uid()));

-- ---------------------------------------------------------------------
-- attachments & message_attachments & generated_assets
-- ---------------------------------------------------------------------
alter table attachments enable row level security;

create policy "attachments_owner_all"
  on attachments for all
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

create policy "attachments_admin_select"
  on attachments for select
  using (is_admin(auth.uid()));

alter table message_attachments enable row level security;

create policy "message_attachments_owner_all"
  on message_attachments for all
  using (
    exists (
      select 1 from messages
      where messages.id = message_attachments.message_id
        and messages.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from messages
      where messages.id = message_attachments.message_id
        and messages.user_id = auth.uid()
    )
  );

alter table generated_assets enable row level security;

create policy "generated_assets_owner_all"
  on generated_assets for all
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

create policy "generated_assets_admin_select"
  on generated_assets for select
  using (is_admin(auth.uid()));

-- ---------------------------------------------------------------------
-- plans & entitlements — plans/plan_entitlements are public read (pricing
-- page); user_entitlements are private to the user (and admins).
-- ---------------------------------------------------------------------
alter table plans enable row level security;
create policy "plans_select_active" on plans for select using (is_active or is_admin(auth.uid()));

alter table plan_entitlements enable row level security;
create policy "plan_entitlements_select_all" on plan_entitlements for select using (true);

alter table user_entitlements enable row level security;

create policy "user_entitlements_select_own_or_admin"
  on user_entitlements for select
  using (user_id = auth.uid() or is_admin(auth.uid()));

-- ---------------------------------------------------------------------
-- usage — users can read (not write; writes go through server-side usage
-- service using the service-role client after quota checks) their own
-- usage; admins can read all.
-- ---------------------------------------------------------------------
alter table usage_events enable row level security;
create policy "usage_events_select_own_or_admin"
  on usage_events for select
  using (user_id = auth.uid() or is_admin(auth.uid()));

alter table usage_counters enable row level security;
create policy "usage_counters_select_own_or_admin"
  on usage_counters for select
  using (user_id = auth.uid() or is_admin(auth.uid()));

-- ---------------------------------------------------------------------
-- subscriptions & payment_records — read-only to the owner; all writes
-- happen server-side (checkout + verified webhook handlers).
-- ---------------------------------------------------------------------
alter table subscriptions enable row level security;
create policy "subscriptions_select_own_or_admin"
  on subscriptions for select
  using (user_id = auth.uid() or is_admin(auth.uid()));

alter table payment_records enable row level security;
create policy "payment_records_select_own_or_admin"
  on payment_records for select
  using (user_id = auth.uid() or is_admin(auth.uid()));

-- ---------------------------------------------------------------------
-- system configuration — public read where safe (feature flags/settings
-- gate client behaviour), writes are super-admin only via server routes.
-- ---------------------------------------------------------------------
alter table system_settings enable row level security;
create policy "system_settings_select_all" on system_settings for select using (true);

alter table system_prompt_versions enable row level security;
create policy "system_prompt_versions_admin_select"
  on system_prompt_versions for select
  using (is_admin(auth.uid()));

alter table feature_flags enable row level security;
create policy "feature_flags_select_all" on feature_flags for select using (true);

-- ---------------------------------------------------------------------
-- admin_roles, admin_audit_logs, moderation_records — no direct client
-- access at all. Only readable by admins; all writes are service-role.
-- ---------------------------------------------------------------------
alter table admin_roles enable row level security;
create policy "admin_roles_select_admin" on admin_roles for select using (is_admin(auth.uid()));

alter table admin_audit_logs enable row level security;
create policy "admin_audit_logs_select_admin" on admin_audit_logs for select using (is_admin(auth.uid()));

alter table moderation_records enable row level security;
create policy "moderation_records_select_admin" on moderation_records for select using (is_admin(auth.uid()));

-- ---------------------------------------------------------------------
-- notifications
-- ---------------------------------------------------------------------
alter table notifications enable row level security;

create policy "notifications_owner_select"
  on notifications for select
  using (user_id = auth.uid());

create policy "notifications_owner_update"
  on notifications for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
