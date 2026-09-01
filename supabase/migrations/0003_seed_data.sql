-- Mujeeb AI — Seed data

-- Providers
insert into providers (slug, name, kind, status, enabled, config) values
  ('openrouter', 'OpenRouter', 'text', 'unknown', true, '{}'::jsonb),
  ('cloudflare-images', 'Cloudflare Workers AI', 'image', 'unknown', true, '{}'::jsonb)
on conflict (slug) do nothing;

-- Models
with p as (select id from providers where slug = 'openrouter')
insert into models (
  slug, display_name, provider_id, provider_model_id, description,
  capabilities, context_limit, output_limit, tier, availability,
  priority, is_default, is_default_vision
)
select
  v.slug, v.display_name, p.id, v.provider_model_id, v.description,
  v.capabilities, v.context_limit, v.output_limit, v.tier, v.availability,
  v.priority, v.is_default, v.is_default_vision
from p, (values
  (
    'mujeeb-free',
    'Mujeeb AI Free',
    'meta-llama/llama-3.3-70b-instruct:free',
    'Fast, general-purpose free model for everyday conversation.',
    array['text', 'streaming']::text[],
    32768, 4096, 'free', 'available', 100, true, false
  ),
  (
    'mujeeb-vision',
    'Mujeeb AI Vision',
    'meta-llama/llama-3.2-11b-vision-instruct:free',
    'Free vision-capable model for image understanding.',
    array['text', 'vision', 'streaming']::text[],
    32768, 4096, 'free', 'available', 90, false, true
  ),
  (
    'mujeeb-reasoning',
    'Mujeeb AI Reasoning (Pro)',
    'deepseek/deepseek-r1:free',
    'Reasoning-capable model with visible thinking summaries. Locked until Mujeeb AI Pro or a future provider makes it broadly available.',
    array['text', 'streaming', 'reasoning']::text[],
    64000, 8192, 'pro', 'locked', 50, false, false
  ),
  (
    'mujeeb-advanced',
    'Mujeeb AI Advanced (Pro)',
    'openrouter/auto',
    'Placeholder slot for a premium provider/model added post-launch. Locked by default — enable from Admin -> Models once a real paid model is configured.',
    array['text', 'streaming']::text[],
    128000, 8192, 'premium', 'locked', 10, false, false
  )
) as v(slug, display_name, provider_model_id, description, capabilities, context_limit, output_limit, tier, availability, priority, is_default, is_default_vision)
on conflict (slug) do nothing;

-- Wire the free model's fallback to itself removed; instead set reasoning/advanced fallback to the free model.
update models set fallback_model_id = (select id from models where slug = 'mujeeb-free')
where slug in ('mujeeb-vision', 'mujeeb-reasoning', 'mujeeb-advanced')
  and fallback_model_id is null;

-- ---------------------------------------------------------------------
-- Plans
-- ---------------------------------------------------------------------
insert into plans (slug, name, description, price_usd, currency_prices, billing_interval, is_active, is_default, sort_order)
values
  ('free', 'Mujeeb AI Free', 'Core chat, free models and limited image generation at no cost.', 0, '{}'::jsonb, 'month', true, true, 0),
  ('pro', 'Mujeeb AI Pro', 'Higher limits, more image generation and priority access to new models.', 10.00, '{"NGN": 15000}'::jsonb, 'month', true, false, 1)
on conflict (slug) do nothing;

with free as (select id from plans where slug = 'free'),
     pro as (select id from plans where slug = 'pro')
insert into plan_entitlements (plan_id, feature_key, value)
select id, key, value from free, (values
  ('messages_per_day', '50'::jsonb),
  ('image_generations_per_day', '5'::jsonb),
  ('vision_requests_per_day', '15'::jsonb),
  ('file_processing_per_day', '10'::jsonb),
  ('max_file_size_mb', '10'::jsonb),
  ('premium_models', 'false'::jsonb),
  ('advanced_models', 'false'::jsonb)
) as v(key, value)
union all
select id, key, value from pro, (values
  ('messages_per_day', '500'::jsonb),
  ('image_generations_per_day', '50'::jsonb),
  ('vision_requests_per_day', '150'::jsonb),
  ('file_processing_per_day', '100'::jsonb),
  ('max_file_size_mb', '25'::jsonb),
  ('premium_models', 'true'::jsonb),
  ('advanced_models', 'true'::jsonb)
) as v(key, value)
on conflict (plan_id, feature_key) do nothing;

-- ---------------------------------------------------------------------
-- Feature flags
-- ---------------------------------------------------------------------
insert into feature_flags (key, enabled, description) values
  ('image_generation', true, 'Cloudflare Workers AI image generation.'),
  ('vision', true, 'Vision-capable model requests.'),
  ('file_uploads', true, 'Document/spreadsheet/presentation upload + processing.'),
  ('audio', false, 'Audio transcription pipeline (post-launch).'),
  ('video', false, 'Video processing pipeline (post-launch).'),
  ('web_search', false, 'Web search augmented answers (future).'),
  ('memory', false, 'Cross-conversation memory (future).'),
  ('projects', false, 'Projects / workspaces (future).'),
  ('registration', true, 'Whether new account registration is open.'),
  ('maintenance_mode', false, 'Show maintenance page to non-admins.')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------
-- System settings
-- ---------------------------------------------------------------------
insert into system_settings (key, value, description) values
  ('default_model_slug', '"mujeeb-free"'::jsonb, 'Model used for new conversations when the user has not chosen one.'),
  ('default_vision_model_slug', '"mujeeb-vision"'::jsonb, 'Model used automatically when a request includes an image and the current model lacks vision.'),
  ('max_upload_size_mb', '25'::jsonb, 'Hard server-side cap regardless of plan (defense in depth).'),
  ('supported_locales', '["en","fr","ar","pt","es","ja","zh"]'::jsonb, 'Enabled UI locales.'),
  ('announcement', 'null'::jsonb, 'Optional platform-wide banner message shown to all users.')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------
-- System prompt — PLACEHOLDER, see note at top of file.
-- ---------------------------------------------------------------------
insert into system_prompt_versions (version, content, status, published_at)
values (
  1,
  'You are Mujeeb AI, a helpful, honest and safe multilingual assistant. '
  'Answer clearly and concisely, respond in the language the user is writing in when possible, '
  'and say when you are unsure rather than guessing. '
  '[PLACEHOLDER — replace with the real product system prompt from Admin -> System Prompt before production launch.]',
  'active',
  now()
)
on conflict (version) do nothing;
