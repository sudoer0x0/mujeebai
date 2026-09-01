-- Plans metadata column for provider configuration.
alter table plans add column if not exists metadata jsonb not null default '{}'::jsonb;

comment on column plans.metadata is
  'Provider-specific config, e.g. paystack_plan_code. Never store secrets here — this table is publicly readable.';
