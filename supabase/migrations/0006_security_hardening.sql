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
