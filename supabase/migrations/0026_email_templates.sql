-- Configurable, versioned email templates.
--
-- Every transactional email the platform sends has copy in the message
-- catalogs. Those are the *defaults* and stay the source of truth for any
-- locale an operator has not touched — a deployment that never opens this
-- screen behaves exactly as before, and a template row that is missing,
-- blank or malformed falls back rather than sending an empty email.
--
-- ## Why two tables
--
-- `email_templates` holds what is live: one row per (kind, locale).
-- `email_template_versions` is append-only history.
--
-- Restoring an old version is recorded as a *new* version rather than by
-- rewinding, for the same reason `admin_audit_logs` is append-only: the
-- trail should show that something was changed and then changed back, not
-- pretend the change never happened. That also means restore is itself
-- undoable by restoring again.

create table if not exists public.email_templates (
  id uuid primary key default gen_random_uuid(),
  -- Matches AuthEmailKind in src/notifications/templates/auth.ts.
  kind text not null,
  locale text not null,
  subject text not null,
  preview text not null default '',
  heading text not null,
  body text not null,
  action_label text not null default '',
  footnote text not null default '',
  -- Bumped on every save; the newest version row carries the same number.
  version integer not null default 1,
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint email_templates_kind_locale_key unique (kind, locale)
);

create table if not exists public.email_template_versions (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.email_templates (id) on delete cascade,
  kind text not null,
  locale text not null,
  version integer not null,
  subject text not null,
  preview text not null default '',
  heading text not null,
  body text not null,
  action_label text not null default '',
  footnote text not null default '',
  -- What this save was: an edit, or a restore of an earlier version.
  change_note text,
  restored_from integer,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists email_template_versions_template_idx
  on public.email_template_versions (template_id, version desc);

-- Row level security: this is platform configuration, not user data.
-- Nothing here is readable by a customer, and it is written only through
-- the service role from a permission-checked server action.
alter table public.email_templates enable row level security;
alter table public.email_template_versions enable row level security;

-- Deny by default: no policy grants access to `authenticated` or `anon`,
-- so PostgREST returns zero rows for everyone. The application reads
-- these through the service role during email rendering, which bypasses
-- RLS by design.
revoke all on public.email_templates from anon, authenticated;
revoke all on public.email_template_versions from anon, authenticated;

-- History is append-only, enforced here rather than by convention: an
-- operator who could edit a version row could quietly rewrite what an
-- email is recorded as having said, which is the one thing this table
-- exists to prevent.
--
-- Scoped to UPDATE, deliberately. Covering DELETE as well looked stricter
-- but made the parent `email_templates` row impossible to remove: the FK
-- cascades into these rows and the trigger refused the cascade. Deleting
-- a template wholesale is visible and takes the live copy with it — it is
-- not a way to make a past version say something it never said. And
-- "reset to default" does not delete anything: it saves a blank version,
-- which is what "use the built-in copy" already means everywhere else, so
-- the history survives and the reset is itself recorded.
create or replace function public.forbid_email_version_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'email_template_versions is append-only';
end;
$$;

drop trigger if exists email_template_versions_no_update on public.email_template_versions;
create trigger email_template_versions_no_update
  before update on public.email_template_versions
  for each row execute function public.forbid_email_version_mutation();

revoke execute on function public.forbid_email_version_mutation() from anon, authenticated;
