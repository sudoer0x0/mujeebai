-- Mujeeb AI — 0023: where a session signed in from.
--
-- `auth.sessions` records the IP but not a place, and turning an IP into a
-- location means either a third-party lookup on every render — which sends
-- a user's address to someone else and adds a network hop to a settings
-- page — or capturing it once, at sign-in, from headers the hosting
-- platform already attaches.
--
-- This is the second option. Cloudflare sets `cf-ipcountry`; Vercel sets
-- `x-vercel-ip-country`, `-country-region` and `-city`. The sign-in action
-- reads them and writes a row keyed by the session id taken from the
-- freshly-minted access token.
--
-- Nothing here comes from anything the browser controls, and no address
-- leaves the deployment.

create table if not exists public.session_locations (
  session_id uuid primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  country text,
  region text,
  city text,
  created_at timestamptz not null default now()
);

create index if not exists session_locations_user_id_idx on public.session_locations (user_id);

alter table public.session_locations enable row level security;

-- Read-your-own (and staff, for the account detail page). Everything is
-- written by the service role from the sign-in path, so there is
-- deliberately no insert or update policy.
drop policy if exists "session_locations_select_own_or_admin" on public.session_locations;
create policy "session_locations_select_own_or_admin" on public.session_locations for select
  using (user_id = (select auth.uid()) or (select private.is_admin((select auth.uid()))));

comment on table public.session_locations is
  'Sign-in location per auth session, captured once from platform geo headers. Rows are orphaned when GoTrue deletes the session; cleaned up opportunistically.';
