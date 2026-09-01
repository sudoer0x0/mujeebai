-- Mujeeb AI — Core schema
create extension if not exists "pgcrypto";

-- Helper: updated_at trigger
create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- Profiles
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  display_name text,
  avatar_url text,
  locale text not null default 'en',
  theme text not null default 'system' check (theme in ('system', 'light', 'dark')),
  role text not null default 'user' check (role in ('user', 'moderator', 'super_admin')),
  status text not null default 'active'
    check (status in ('active', 'suspended', 'disabled', 'pending_verification', 'deleted')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger profiles_set_updated_at
  before update on profiles
  for each row execute function set_updated_at();

-- Prevents non-service-role clients from modifying privileged fields directly.
create or replace function profiles_guard_privileged_fields()
returns trigger as $$
begin
  if auth.role() is distinct from 'service_role' then
    if new.role is distinct from old.role or new.status is distinct from old.status then
      raise exception 'profiles.role and profiles.status can only be changed by a trusted server-side process';
    end if;
  end if;
  return new;
end;
$$ language plpgsql;

create trigger profiles_guard_privileged_fields
  before update on profiles
  for each row execute function profiles_guard_privileged_fields();

-- Auto-provision profile on auth user creation.
create or replace function handle_new_auth_user()
returns trigger as $$
declare
  _display_name text;
begin
  _display_name := coalesce(
    new.raw_user_meta_data->>'display_name',
    new.raw_user_meta_data->>'full_name',
    new.raw_user_meta_data->>'name',
    nullif(trim(concat_ws(' ', new.raw_user_meta_data->>'first_name', new.raw_user_meta_data->>'last_name')), ''),
    split_part(new.email, '@', 1)
  );

  insert into public.profiles (id, email, display_name)
  values (new.id, new.email, _display_name)
  on conflict (id) do update set
    email = excluded.email,
    display_name = coalesce(profiles.display_name, excluded.display_name);
  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_auth_user();

-- ---------------------------------------------------------------------
-- providers & models (registry — see ARCHITECTURE.md #AI Gateway)
-- ---------------------------------------------------------------------
create table if not exists providers (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  kind text not null check (kind in ('text', 'image', 'audio', 'video')),
  status text not null default 'unknown'
    check (status in ('operational', 'degraded', 'disabled', 'configuration_error', 'unknown')),
  enabled boolean not null default true,
  config jsonb not null default '{}'::jsonb, -- non-secret config only, never credentials
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger providers_set_updated_at
  before update on providers
  for each row execute function set_updated_at();

create table if not exists models (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  display_name text not null,
  provider_id uuid not null references providers(id) on delete restrict,
  provider_model_id text not null,
  description text,
  capabilities text[] not null default '{}'::text[],
  context_limit integer,
  output_limit integer,
  tier text not null default 'free' check (tier in ('free', 'pro', 'premium', 'experimental')),
  availability text not null default 'available'
    check (availability in ('available', 'locked', 'disabled', 'maintenance', 'deprecated')),
  priority integer not null default 0,
  fallback_model_id uuid references models(id) on delete set null,
  is_default boolean not null default false,
  is_default_vision boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists models_provider_id_idx on models(provider_id);
create index if not exists models_availability_idx on models(availability);

create trigger models_set_updated_at
  before update on models
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------
-- conversations, messages, message_variants
-- ---------------------------------------------------------------------
create table if not exists conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  title text not null default 'New conversation',
  model_id uuid references models(id) on delete set null,
  is_archived boolean not null default false,
  is_pinned boolean not null default false,
  last_message_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists conversations_user_id_idx on conversations(user_id);
create index if not exists conversations_user_last_message_idx on conversations(user_id, last_message_at desc);

create trigger conversations_set_updated_at
  before update on conversations
  for each row execute function set_updated_at();

create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  role text not null check (role in ('user', 'assistant', 'system')),
  status text not null default 'complete'
    check (status in ('pending', 'streaming', 'complete', 'error', 'stopped')),
  content text,
  active_variant_id uuid,
  edited_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists messages_conversation_id_idx on messages(conversation_id, created_at);
create index if not exists messages_user_id_idx on messages(user_id);

create trigger messages_set_updated_at
  before update on messages
  for each row execute function set_updated_at();

-- Assistant response variants. A message can have several (regeneration);
-- `sequence` powers "Response 1 / 3" style navigation and the data model
-- deliberately leaves room for future conversation branching.
create table if not exists message_variants (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references messages(id) on delete cascade,
  sequence integer not null default 1,
  content text,
  reasoning_summary text,
  model_id uuid references models(id) on delete set null,
  provider_id uuid references providers(id) on delete set null,
  finish_reason text,
  usage jsonb not null default '{}'::jsonb,
  error jsonb,
  created_at timestamptz not null default now()
);

create index if not exists message_variants_message_id_idx on message_variants(message_id, sequence);

alter table messages
  add constraint messages_active_variant_fk
  foreign key (active_variant_id) references message_variants(id) on delete set null;

-- ---------------------------------------------------------------------
-- attachments & generated assets
-- ---------------------------------------------------------------------
create table if not exists attachments (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references profiles(id) on delete cascade,
  storage_provider text not null default 'supabase',
  storage_path text not null,
  original_filename text not null,
  mime_type text,
  size_bytes bigint not null default 0,
  kind text not null default 'other'
    check (kind in ('document', 'spreadsheet', 'presentation', 'image', 'audio', 'video', 'code', 'data', 'other')),
  status text not null default 'uploaded'
    check (status in ('uploading', 'uploaded', 'processing', 'ready', 'failed', 'unsupported', 'rejected')),
  processed_content text,
  processing_error text,
  created_at timestamptz not null default now()
);

create index if not exists attachments_owner_id_idx on attachments(owner_id);

create table if not exists message_attachments (
  message_id uuid not null references messages(id) on delete cascade,
  attachment_id uuid not null references attachments(id) on delete cascade,
  primary key (message_id, attachment_id)
);

create table if not exists generated_assets (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references profiles(id) on delete cascade,
  type text not null default 'image' check (type in ('image', 'other')),
  storage_provider text not null default 'supabase',
  storage_path text not null,
  prompt text,
  model_id uuid references models(id) on delete set null,
  conversation_id uuid references conversations(id) on delete set null,
  message_id uuid references messages(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists generated_assets_owner_id_idx on generated_assets(owner_id, created_at desc);

-- ---------------------------------------------------------------------
-- plans, entitlements
-- ---------------------------------------------------------------------
create table if not exists plans (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  description text,
  price_usd numeric(10, 2) not null default 0,
  currency_prices jsonb not null default '{}'::jsonb, -- e.g. {"NGN": 15000}
  billing_interval text not null default 'month' check (billing_interval in ('month', 'year')),
  is_active boolean not null default true,
  is_default boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger plans_set_updated_at
  before update on plans
  for each row execute function set_updated_at();

create table if not exists plan_entitlements (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references plans(id) on delete cascade,
  feature_key text not null,
  value jsonb not null,
  unique (plan_id, feature_key)
);

create table if not exists user_entitlements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  feature_key text not null,
  value jsonb not null,
  reason text,
  granted_by uuid references profiles(id) on delete set null,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, feature_key)
);

create index if not exists user_entitlements_user_id_idx on user_entitlements(user_id);

-- ---------------------------------------------------------------------
-- usage tracking (generic, capability-based — see ARCHITECTURE.md #Usage)
-- ---------------------------------------------------------------------
create table if not exists usage_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  category text not null,
  quantity integer not null default 1,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists usage_events_user_category_idx on usage_events(user_id, category, created_at desc);

create table if not exists usage_counters (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  category text not null,
  period text not null check (period in ('day', 'month')),
  period_key text not null, -- '2026-08-27' for day, '2026-08' for month
  count integer not null default 0,
  updated_at timestamptz not null default now(),
  unique (user_id, category, period, period_key)
);

create index if not exists usage_counters_lookup_idx on usage_counters(user_id, category, period, period_key);

-- ---------------------------------------------------------------------
-- subscriptions & payments (Paystack — see ARCHITECTURE.md #Billing)
-- ---------------------------------------------------------------------
create table if not exists subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  plan_id uuid not null references plans(id) on delete restrict,
  status text not null default 'active'
    check (status in ('active', 'past_due', 'canceled', 'expired', 'trialing')),
  billing_provider text not null default 'paystack',
  provider_customer_id text,
  provider_subscription_code text,
  provider_reference text,
  currency text not null default 'USD',
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  canceled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists subscriptions_user_id_idx on subscriptions(user_id);
create unique index if not exists subscriptions_active_per_user_idx
  on subscriptions(user_id) where status in ('active', 'trialing', 'past_due');

create trigger subscriptions_set_updated_at
  before update on subscriptions
  for each row execute function set_updated_at();

create table if not exists payment_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles(id) on delete set null,
  subscription_id uuid references subscriptions(id) on delete set null,
  provider text not null default 'paystack',
  provider_reference text not null,
  amount numeric(12, 2),
  currency text,
  status text not null check (status in ('pending', 'success', 'failed', 'refunded')),
  -- Verified webhook payload only. Never store card/PAN/CVV data here —
  -- Paystack itself never sends raw card numbers in webhook payloads.
  raw_event jsonb,
  created_at timestamptz not null default now(),
  unique (provider, provider_reference)
);

create index if not exists payment_records_user_id_idx on payment_records(user_id);

-- ---------------------------------------------------------------------
-- system configuration
-- ---------------------------------------------------------------------
create table if not exists system_settings (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  value jsonb not null,
  description text,
  updated_by uuid references profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);

create table if not exists system_prompt_versions (
  id uuid primary key default gen_random_uuid(),
  version integer not null,
  content text not null,
  status text not null default 'draft' check (status in ('draft', 'active', 'archived')),
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  published_at timestamptz,
  unique (version)
);

create unique index if not exists system_prompt_versions_single_active_idx
  on system_prompt_versions ((status = 'active')) where status = 'active';

create table if not exists feature_flags (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  enabled boolean not null default false,
  description text,
  updated_by uuid references profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- admin roles, audit logs, moderation
-- ---------------------------------------------------------------------
create table if not exists admin_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  role text not null check (role in ('moderator', 'super_admin')),
  granted_by uuid references profiles(id) on delete set null,
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_by uuid references profiles(id) on delete set null
);

create index if not exists admin_roles_user_id_idx on admin_roles(user_id);
create unique index if not exists admin_roles_active_unique_idx
  on admin_roles(user_id, role) where revoked_at is null;

-- Keep profiles.role in sync with the highest active role in admin_roles.
create or replace function sync_profile_role_from_admin_roles()
returns trigger as $$
declare
  target_user uuid;
  highest_role text;
begin
  target_user := coalesce(new.user_id, old.user_id);

  select role into highest_role
  from admin_roles
  where user_id = target_user and revoked_at is null
  order by case role when 'super_admin' then 2 when 'moderator' then 1 else 0 end desc
  limit 1;

  update profiles
  set role = coalesce(highest_role, 'user')
  where id = target_user;

  return null;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists admin_roles_sync_profile on admin_roles;
create trigger admin_roles_sync_profile
  after insert or update or delete on admin_roles
  for each row execute function sync_profile_role_from_admin_roles();

create table if not exists admin_audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references profiles(id) on delete set null,
  action text not null,
  target_type text,
  target_id text,
  result text not null default 'success' check (result in ('success', 'failure')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists admin_audit_logs_created_idx on admin_audit_logs(created_at desc);
create index if not exists admin_audit_logs_actor_idx on admin_audit_logs(actor_id);

create table if not exists moderation_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  action text not null check (action in ('warned', 'suspended', 'restored', 'disabled', 'deleted', 'note')),
  reason text,
  performed_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists moderation_records_user_id_idx on moderation_records(user_id);

-- ---------------------------------------------------------------------
-- notifications
-- ---------------------------------------------------------------------
create table if not exists notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  type text not null,
  title text not null,
  body text,
  read_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists notifications_user_id_idx on notifications(user_id, created_at desc);
