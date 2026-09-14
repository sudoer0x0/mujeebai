-- Mujeeb AI — 0011: register Google Gemini provider and Fast / Think models.

insert into providers (id, slug, name, kind, status, enabled, config)
values (
  'd7154ae7-debe-4c8f-8637-a8bd93a1bd12',
  'google',
  'Google Gemini',
  'text',
  'operational',
  true,
  '{}'::jsonb
)
on conflict (slug) do update set
  name = excluded.name,
  status = 'operational',
  enabled = true;

update models
set provider_id = 'd7154ae7-debe-4c8f-8637-a8bd93a1bd12',
    provider_model_id = 'gemini-3.5-flash-lite',
    display_name = 'Fast',
    description = 'Blazing fast everyday responses.',
    capabilities = array['text', 'vision', 'streaming']::text[],
    tier = 'free',
    availability = 'available',
    is_default = true,
    reasoning_mode = 'exclude'
where slug = 'mujeeb-free';

update models
set provider_id = 'd7154ae7-debe-4c8f-8637-a8bd93a1bd12',
    provider_model_id = 'gemini-3.6-flash',
    display_name = 'Think',
    description = 'Deep thinking and step-by-step reasoning.',
    capabilities = array['text', 'vision', 'streaming', 'reasoning']::text[],
    tier = 'free',
    availability = 'available',
    is_default = false,
    reasoning_mode = 'require'
where slug = 'mujeeb-reasoning';
