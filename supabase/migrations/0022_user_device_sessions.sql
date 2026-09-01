-- Mujeeb AI — 0022: let a user see and revoke their own devices.
--
-- `auth.sessions` holds one row per signed-in device, carrying the user
-- agent and IP recorded at sign-in, with `refreshed_at` advancing on every
-- token exchange — a good proxy for "last active". The `auth` schema is
-- not exposed through PostgREST and there is no admin API for it, so these
-- two functions are the access path.
--
-- (An earlier version of the staff security page claimed a per-device list
-- was not obtainable and showed only the current session. That was wrong:
-- the table is right here.)
--
-- ## Why SECURITY DEFINER, and what makes it safe
--
-- Reading `auth.sessions` needs privileges `authenticated` does not have,
-- so both functions run as definer. Both take the user id as an argument
-- and filter on it, so a caller can only ever reach their own rows.
--
-- EXECUTE is granted to `service_role` only. The application calls them
-- with the service role *after* establishing who the caller is from their
-- own session, so the user id never comes from the browser. Granting to
-- `authenticated` would mean trusting a client-supplied argument, which is
-- precisely the mistake this shape avoids.

create or replace function public.list_user_sessions(p_user_id uuid)
returns table (
  id uuid,
  created_at timestamptz,
  refreshed_at timestamptz,
  user_agent text,
  ip text,
  aal text
)
language sql
stable
security definer
set search_path = auth, public
as $$
  select
    s.id,
    s.created_at,
    s.refreshed_at::timestamptz,
    s.user_agent,
    host(s.ip) as ip,
    s.aal::text
  from auth.sessions s
  where s.user_id = p_user_id
    and (s.not_after is null or s.not_after > now())
  order by coalesce(s.refreshed_at::timestamptz, s.created_at) desc;
$$;

-- Deleting the session revokes it: auth.refresh_tokens and
-- auth.mfa_amr_claims both cascade, so the device cannot mint a new
-- access token. Its current access token remains valid until it expires,
-- which is inherent to stateless JWTs.
create or replace function public.revoke_user_session(p_user_id uuid, p_session_id uuid)
returns boolean
language plpgsql
security definer
set search_path = auth, public
as $$
declare
  removed int;
begin
  delete from auth.sessions
  where id = p_session_id
    and user_id = p_user_id;   -- ownership enforced here, not by the caller

  get diagnostics removed = row_count;
  return removed > 0;
end;
$$;

revoke all on function public.list_user_sessions(uuid) from public, anon, authenticated;
revoke all on function public.revoke_user_session(uuid, uuid) from public, anon, authenticated;
grant execute on function public.list_user_sessions(uuid) to service_role;
grant execute on function public.revoke_user_session(uuid, uuid) to service_role;
