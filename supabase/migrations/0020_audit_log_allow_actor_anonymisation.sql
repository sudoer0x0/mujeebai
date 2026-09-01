-- Mujeeb AI — 0020: the append-only audit trigger made staff undeletable.
--
-- `admin_audit_logs.actor_id` is ON DELETE SET NULL, so deleting a user
-- makes Postgres UPDATE their audit rows to null the actor. The
-- append-only trigger from 0008 blocked *every* UPDATE, including that
-- one, so the delete failed with "Database error deleting user".
--
-- The effect: any staff member who had ever performed an audited action
-- could never be removed — precisely the account an administrator most
-- needs to be able to delete. `deleteUserAction` in the console would have
-- failed the same way. Found while cleaning up test accounts.
--
-- The fix keeps the guarantee that matters. An audit entry still cannot be
-- edited or removed; the only UPDATE now permitted is the foreign key's
-- own anonymisation — `actor_id` going from a value to NULL with every
-- other column byte-identical. What was done, to what, when, and with what
-- result all survive. Only the link to a deleted account is severed, which
-- is what SET NULL exists to do.
--
-- DELETE remains blocked outright.

create or replace function public.admin_audit_logs_append_only()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' then
    if old.actor_id is not null
       and new.actor_id is null
       and new.id            is not distinct from old.id
       and new.action        is not distinct from old.action
       and new.target_type   is not distinct from old.target_type
       and new.target_id     is not distinct from old.target_id
       and new.result        is not distinct from old.result
       and new.metadata      is not distinct from old.metadata
       and new.created_at    is not distinct from old.created_at
    then
      return new;
    end if;
  end if;

  raise exception 'admin_audit_logs is append-only; % is not permitted', tg_op
    using errcode = 'insufficient_privilege';
end;
$$;

drop trigger if exists admin_audit_logs_immutable on public.admin_audit_logs;
create trigger admin_audit_logs_immutable
  before update or delete on public.admin_audit_logs
  for each row execute function public.admin_audit_logs_append_only();

revoke all on function public.admin_audit_logs_append_only() from public, anon, authenticated;
