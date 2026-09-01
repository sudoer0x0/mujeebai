-- Mujeeb AI — 0017: attachments allowed on a single message.
--
-- A plan entitlement rather than a hardcoded constant, so a super admin
-- changes it per plan from /admin/plans and a moderator can lift it for a
-- single account without touching everyone else's limit.
--
-- Five for every existing plan; paid plans can be raised from the console.

insert into public.plan_entitlements (plan_id, feature_key, value)
select id, 'max_attachments_per_message', '5'::jsonb
from public.plans
on conflict (plan_id, feature_key) do nothing;

insert into public.system_settings (key, value, description)
values (
  'max_attachments_per_message',
  '5'::jsonb,
  'Files a user may attach to a single message. Plans can override this; a moderator can raise it for one account from the user detail page.'
)
on conflict (key) do nothing;
