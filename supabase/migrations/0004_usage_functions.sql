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
