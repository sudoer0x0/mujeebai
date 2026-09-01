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
-- Mujeeb AI — Seed data

-- Providers
insert into providers (slug, name, kind, status, enabled, config) values
  ('openrouter', 'OpenRouter', 'text', 'unknown', true, '{}'::jsonb),
  ('cloudflare-images', 'Cloudflare Workers AI', 'image', 'unknown', true, '{}'::jsonb)
on conflict (slug) do nothing;

-- Models
with p as (select id from providers where slug = 'openrouter')
insert into models (
  slug, display_name, provider_id, provider_model_id, description,
  capabilities, context_limit, output_limit, tier, availability,
  priority, is_default, is_default_vision
)
select
  v.slug, v.display_name, p.id, v.provider_model_id, v.description,
  v.capabilities, v.context_limit, v.output_limit, v.tier, v.availability,
  v.priority, v.is_default, v.is_default_vision
from p, (values
  (
    'mujeeb-free',
    'Mujeeb AI Free',
    'meta-llama/llama-3.3-70b-instruct:free',
    'Fast, general-purpose free model for everyday conversation.',
    array['text', 'streaming']::text[],
    32768, 4096, 'free', 'available', 100, true, false
  ),
  (
    'mujeeb-vision',
    'Mujeeb AI Vision',
    'meta-llama/llama-3.2-11b-vision-instruct:free',
    'Free vision-capable model for image understanding.',
    array['text', 'vision', 'streaming']::text[],
    32768, 4096, 'free', 'available', 90, false, true
  ),
  (
    'mujeeb-reasoning',
    'Mujeeb AI Reasoning (Pro)',
    'deepseek/deepseek-r1:free',
    'Reasoning-capable model with visible thinking summaries. Locked until Mujeeb AI Pro or a future provider makes it broadly available.',
    array['text', 'streaming', 'reasoning']::text[],
    64000, 8192, 'pro', 'locked', 50, false, false
  ),
  (
    'mujeeb-advanced',
    'Mujeeb AI Advanced (Pro)',
    'openrouter/auto',
    'Placeholder slot for a premium provider/model added post-launch. Locked by default — enable from Admin -> Models once a real paid model is configured.',
    array['text', 'streaming']::text[],
    128000, 8192, 'premium', 'locked', 10, false, false
  )
) as v(slug, display_name, provider_model_id, description, capabilities, context_limit, output_limit, tier, availability, priority, is_default, is_default_vision)
on conflict (slug) do nothing;

-- Wire the free model's fallback to itself removed; instead set reasoning/advanced fallback to the free model.
update models set fallback_model_id = (select id from models where slug = 'mujeeb-free')
where slug in ('mujeeb-vision', 'mujeeb-reasoning', 'mujeeb-advanced')
  and fallback_model_id is null;

-- ---------------------------------------------------------------------
-- Plans
-- ---------------------------------------------------------------------
insert into plans (slug, name, description, price_usd, currency_prices, billing_interval, is_active, is_default, sort_order)
values
  ('free', 'Mujeeb AI Free', 'Core chat, free models and limited image generation at no cost.', 0, '{}'::jsonb, 'month', true, true, 0),
  ('pro', 'Mujeeb AI Pro', 'Higher limits, more image generation and priority access to new models.', 10.00, '{"NGN": 15000}'::jsonb, 'month', true, false, 1)
on conflict (slug) do nothing;

with free as (select id from plans where slug = 'free'),
     pro as (select id from plans where slug = 'pro')
insert into plan_entitlements (plan_id, feature_key, value)
select id, key, value from free, (values
  ('messages_per_day', '50'::jsonb),
  ('image_generations_per_day', '5'::jsonb),
  ('vision_requests_per_day', '15'::jsonb),
  ('file_processing_per_day', '10'::jsonb),
  ('max_file_size_mb', '10'::jsonb),
  ('premium_models', 'false'::jsonb),
  ('advanced_models', 'false'::jsonb)
) as v(key, value)
union all
select id, key, value from pro, (values
  ('messages_per_day', '500'::jsonb),
  ('image_generations_per_day', '50'::jsonb),
  ('vision_requests_per_day', '150'::jsonb),
  ('file_processing_per_day', '100'::jsonb),
  ('max_file_size_mb', '25'::jsonb),
  ('premium_models', 'true'::jsonb),
  ('advanced_models', 'true'::jsonb)
) as v(key, value)
on conflict (plan_id, feature_key) do nothing;

-- ---------------------------------------------------------------------
-- Feature flags
-- ---------------------------------------------------------------------
insert into feature_flags (key, enabled, description) values
  ('image_generation', true, 'Cloudflare Workers AI image generation.'),
  ('vision', true, 'Vision-capable model requests.'),
  ('file_uploads', true, 'Document/spreadsheet/presentation upload + processing.'),
  ('audio', false, 'Audio transcription pipeline (post-launch).'),
  ('video', false, 'Video processing pipeline (post-launch).'),
  ('web_search', false, 'Web search augmented answers (future).'),
  ('memory', false, 'Cross-conversation memory (future).'),
  ('projects', false, 'Projects / workspaces (future).'),
  ('registration', true, 'Whether new account registration is open.'),
  ('maintenance_mode', false, 'Show maintenance page to non-admins.')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------
-- System settings
-- ---------------------------------------------------------------------
insert into system_settings (key, value, description) values
  ('default_model_slug', '"mujeeb-free"'::jsonb, 'Model used for new conversations when the user has not chosen one.'),
  ('default_vision_model_slug', '"mujeeb-vision"'::jsonb, 'Model used automatically when a request includes an image and the current model lacks vision.'),
  ('max_upload_size_mb', '25'::jsonb, 'Hard server-side cap regardless of plan (defense in depth).'),
  ('supported_locales', '["en","fr","ar","pt","es","ja","zh"]'::jsonb, 'Enabled UI locales.'),
  ('announcement', 'null'::jsonb, 'Optional platform-wide banner message shown to all users.')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------
-- System prompt — PLACEHOLDER, see note at top of file.
-- ---------------------------------------------------------------------
insert into system_prompt_versions (version, content, status, published_at)
values (
  1,
  'You are Mujeeb AI, a helpful, honest and safe multilingual assistant. '
  'Answer clearly and concisely, respond in the language the user is writing in when possible, '
  'and say when you are unsure rather than guessing. '
  '[PLACEHOLDER — replace with the real product system prompt from Admin -> System Prompt before production launch.]',
  'active',
  now()
)
on conflict (version) do nothing;
-- Atomic usage counter increment RPC.
create or replace function increment_usage_counter(
  p_user_id uuid,
  p_category text,
  p_period text,
  p_period_key text,
  p_quantity integer default 1
)
returns integer as $$
declare
  new_count integer;
begin
  insert into usage_counters (user_id, category, period, period_key, count)
  values (p_user_id, p_category, p_period, p_period_key, p_quantity)
  on conflict (user_id, category, period, period_key)
  do update set count = usage_counters.count + excluded.count, updated_at = now()
  returning count into new_count;

  insert into usage_events (user_id, category, quantity)
  values (p_user_id, p_category, p_quantity);

  return new_count;
end;
$$ language plpgsql security definer set search_path = public;

-- Only callable by the service role (application server), never directly
-- by a user session — usage must only ever be recorded by trusted
-- server-side code that has already performed its own quota check.
revoke all on function increment_usage_counter(uuid, text, text, text, integer) from public, anon, authenticated;
grant execute on function increment_usage_counter(uuid, text, text, text, integer) to service_role;
-- Plans metadata column for provider configuration.
alter table plans add column if not exists metadata jsonb not null default '{}'::jsonb;

comment on column plans.metadata is
  'Provider-specific config, e.g. paystack_plan_code. Never store secrets here — this table is publicly readable.';
-- Security hardening: RLS attachment ownership check and atomic try_consume_usage RPC.

-- 1. message_attachments RLS hardening
drop policy if exists "message_attachments_owner_all" on message_attachments;

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
    and exists (
      select 1 from attachments
      where attachments.id = message_attachments.attachment_id
        and attachments.owner_id = auth.uid()
    )
  );

-- 2. Atomic check-and-consume quota RPC
create or replace function try_consume_usage(
  p_user_id uuid,
  p_category text,
  p_period text,
  p_period_key text,
  p_quantity integer,
  p_limit integer
)
returns table(allowed boolean, new_count integer) as $$
declare
  v_count integer;
begin
  -- p_limit < 0 is the "unlimited" convention (see src/usage/quota.ts) —
  -- still record the usage event for observability, but never reject.
  insert into usage_counters (user_id, category, period, period_key, count)
  values (p_user_id, p_category, p_period, p_period_key, p_quantity)
  on conflict (user_id, category, period, period_key)
  do update set count = usage_counters.count + excluded.count, updated_at = now()
  returning count into v_count;

  if p_limit >= 0 and v_count > p_limit then
    -- Over the limit: revert the increment we just applied (this update
    -- targets the same row we just locked via the upsert above, so no
    -- other concurrent call can have modified it in between) and reject.
    update usage_counters
      set count = count - p_quantity, updated_at = now()
      where user_id = p_user_id
        and category = p_category
        and period = p_period
        and period_key = p_period_key;

    return query select false, greatest(v_count - p_quantity, 0);
    return;
  end if;

  insert into usage_events (user_id, category, quantity)
  values (p_user_id, p_category, p_quantity);

  return query select true, v_count;
end;
$$ language plpgsql security definer set search_path = public;

revoke all on function try_consume_usage(uuid, text, text, text, integer, integer) from public, anon, authenticated;
grant execute on function try_consume_usage(uuid, text, text, text, integer, integer) to service_role;
-- Paystack subscription token column for cancellation.

alter table subscriptions
  add column if not exists provider_subscription_token text;
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
-- Mujeeb AI — 0010: point the model registry at models that still exist.
--
-- Every provider model id seeded in 0003 has since been retired upstream:
--
--   meta-llama/llama-3.3-70b-instruct:free          404 "unavailable for free"
--   meta-llama/llama-3.2-11b-vision-instruct:free   404 "no endpoints found"
--   deepseek/deepseek-r1:free                       404 "unavailable for free"
--
-- so every chat request failed the whole fallback chain and surfaced as
-- "provider_error". The gateway behaved correctly — it tried each
-- candidate, normalized the failure and never leaked the provider's
-- message — but the registry it was reading from pointed at nothing.
--
-- The ids below were verified live against OpenRouter before being written
-- here. This is exactly the churn the model registry exists to absorb: a
-- data change, not a code change.

-- The free default is OpenRouter's own free auto-router rather than one
-- pinned model. A single pinned free model is a single point of failure on
-- a pool that rotates constantly (four of five candidates tested returned
-- 429 or 403 at least once); the router picks a live one per request.
update models
set provider_model_id = 'openrouter/free',
    display_name = 'Mujeeb AI Free',
    description = 'Fast, general-purpose model for everyday questions. Automatically routed across available free models.',
    capabilities = array['text', 'vision', 'streaming']::text[],
    context_limit = 128000,
    output_limit = 4096,
    availability = 'available',
    tier = 'free'
where slug = 'mujeeb-free';

update models
set provider_model_id = 'minimax/minimax-m3:free',
    display_name = 'Mujeeb AI Vision',
    description = 'Large-context model for reading images, screenshots and long documents.',
    capabilities = array['text', 'vision', 'streaming']::text[],
    context_limit = 1000000,
    output_limit = 8192,
    availability = 'available',
    tier = 'free'
where slug = 'mujeeb-vision';

-- Previously a locked placeholder pointing at a dead id. It is now a real
-- reasoning-capable model, gated to Pro — so the upgrade path advertises
-- something that actually exists and works.
update models
set provider_model_id = 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free',
    display_name = 'Mujeeb AI Reasoning',
    description = 'Works through harder problems step by step and can show a summary of its reasoning.',
    capabilities = array['text', 'vision', 'streaming', 'reasoning']::text[],
    context_limit = 128000,
    output_limit = 8192,
    availability = 'available',
    tier = 'pro'
where slug = 'mujeeb-reasoning';

-- Kept deliberately locked: the slot for a genuinely premium paid model,
-- enabled from Admin -> Models once one is configured (#14, #152).
update models
set provider_model_id = 'openrouter/auto',
    display_name = 'Mujeeb AI Advanced',
    description = 'Reserved for a premium provider added post-launch. Enable from Admin -> Models once a paid model is configured.',
    capabilities = array['text', 'streaming']::text[],
    availability = 'locked',
    tier = 'premium'
where slug = 'mujeeb-advanced';

-- Everything falls back to the free auto-router, the candidate most likely
-- to still be answering.
update models
set fallback_model_id = (select id from models where slug = 'mujeeb-free')
where slug in ('mujeeb-vision', 'mujeeb-reasoning', 'mujeeb-advanced');

update models set fallback_model_id = null where slug = 'mujeeb-free';

update providers set status = 'operational' where slug = 'openrouter';
-- Mujeeb AI — 0011: relocate pg_trgm out of the public schema.
--
-- 0008 installed pg_trgm with a bare `create extension`, which put it in
-- `public` and therefore into the schema PostgREST exposes. Supabase
-- provisions an `extensions` schema for exactly this, and every role's
-- search_path already includes it, so the gin_trgm_ops operator classes
-- backing the search indexes keep resolving after the move.
create schema if not exists extensions;
grant usage on schema extensions to authenticated, anon, service_role;

alter extension pg_trgm set schema extensions;
