-- Mujeeb AI — 0014: one round trip for the admin dashboard.
--
-- ## The problem
--
-- The dashboard issued eight separate PostgREST requests: three `count`
-- queries, recent signups, recent audit entries, the usage-counter roll-up,
-- and then — only after the audit rows came back — a follow-up query to
-- resolve actor ids into names.
--
-- Seven of those were issued in parallel, which sounds free but is not:
-- each one is a distinct HTTPS request, and the client opens a *new* TLS
-- connection per concurrent request. Against this project's region
-- (measured RTT ~156ms) a fresh connection costs two to three round trips
-- before a single byte of SQL is sent. The eighth was strictly sequential
-- behind the audit query.
--
-- Net effect: ~1.9s to render a page whose actual database work is a few
-- milliseconds of counting.
--
-- ## The fix
--
-- One function, one request, one connection. Postgres does the counting
-- and the actor-name join internally — which is where a join belongs —
-- and returns a single JSON document.
--
-- ## Security
--
-- SECURITY DEFINER, so it reads past RLS — therefore it checks the caller
-- itself, first thing, and refuses anyone who is not staff. It is granted
-- only to `authenticated`; `anon` cannot call it at all. It returns
-- aggregate counts plus the same recent-rows the console already showed to
-- staff, and nothing else — no message bodies, no tokens, no payment
-- details.
--
-- It is deliberately read-only: no INSERT, UPDATE or DELETE anywhere in
-- the body, so a caller who somehow reached it cannot change state.

create or replace function public.admin_dashboard_snapshot()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  week_ago timestamptz := now() - interval '7 days';
  today_key text := to_char(now() at time zone 'utc', 'YYYY-MM-DD');
  result jsonb;
begin
  -- Authorize before reading anything. SECURITY DEFINER bypasses RLS, so
  -- this check *is* the access control for everything below.
  if not private.is_admin((select auth.uid())) then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'total_users', (select count(*) from public.profiles),
    'new_users_7d', (select count(*) from public.profiles where created_at >= week_ago),
    'active_subscriptions', (
      select count(*) from public.subscriptions where status in ('active', 'trialing')
    ),
    'usage_totals', coalesce((
      select jsonb_agg(jsonb_build_object(
               'category', category,
               'total', total,
               'users', users
             ))
      from (
        select category, sum(count)::bigint as total, count(distinct user_id)::bigint as users
        from public.usage_counters
        where period = 'day' and period_key = today_key
        group by category
      ) u
    ), '[]'::jsonb),
    'recent_signups', coalesce((
      select jsonb_agg(row_to_json(s))
      from (
        select id, email, display_name, created_at, status
        from public.profiles
        order by created_at desc
        limit 6
      ) s
    ), '[]'::jsonb),
    -- The actor name is resolved here, in the same pass, instead of being
    -- a second network round trip that could not start until this one
    -- finished.
    'recent_audit', coalesce((
      select jsonb_agg(row_to_json(a))
      from (
        select l.id, l.action, l.target_type, l.target_id, l.result, l.created_at,
               l.actor_id,
               coalesce(p.display_name, p.email, l.actor_id::text) as actor_name
        from public.admin_audit_logs l
        left join public.profiles p on p.id = l.actor_id
        order by l.created_at desc
        limit 8
      ) a
    ), '[]'::jsonb)
  ) into result;

  return result;
end;
$$;

revoke all on function public.admin_dashboard_snapshot() from public, anon;
grant execute on function public.admin_dashboard_snapshot() to authenticated;
