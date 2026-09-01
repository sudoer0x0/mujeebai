-- Mujeeb AI — 0010: point the model registry at models that still exist.
--
-- Every provider model id seeded in 0003 has since been retired upstream:
--
--   meta-llama/llama-3.3-70b-instruct:free          404 "unavailable for free"
--   meta-llama/llama-3.2-11b-vision-instruct:free   404 "no endpoints found"
--   deepseek/deepseek-r1:free                       404 "unavailable for free"
--
-- so every chat request failed the whole fallback chain and surfaced as
-- "provider_error". The gateway behaved correctly — it tried each
-- candidate, normalized the failure and never leaked the provider's
-- message — but the registry it was reading from pointed at nothing.
--
-- The ids below were verified live against OpenRouter before being written
-- here. This is exactly the churn the model registry exists to absorb: a
-- data change, not a code change.

-- The free default is OpenRouter's own free auto-router rather than one
-- pinned model. A single pinned free model is a single point of failure on
-- a pool that rotates constantly (four of five candidates tested returned
-- 429 or 403 at least once); the router picks a live one per request.
update models
set provider_model_id = 'openrouter/free',
    display_name = 'Mujeeb AI Free',
    description = 'Fast, general-purpose model for everyday questions. Automatically routed across available free models.',
    capabilities = array['text', 'vision', 'streaming']::text[],
    context_limit = 128000,
    output_limit = 4096,
    availability = 'available',
    tier = 'free'
where slug = 'mujeeb-free';

update models
set provider_model_id = 'minimax/minimax-m3:free',
    display_name = 'Mujeeb AI Vision',
    description = 'Large-context model for reading images, screenshots and long documents.',
    capabilities = array['text', 'vision', 'streaming']::text[],
    context_limit = 1000000,
    output_limit = 8192,
    availability = 'available',
    tier = 'free'
where slug = 'mujeeb-vision';

-- Previously a locked placeholder pointing at a dead id. It is now a real
-- reasoning-capable model, gated to Pro — so the upgrade path advertises
-- something that actually exists and works.
update models
set provider_model_id = 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free',
    display_name = 'Mujeeb AI Reasoning',
    description = 'Works through harder problems step by step and can show a summary of its reasoning.',
    capabilities = array['text', 'vision', 'streaming', 'reasoning']::text[],
    context_limit = 128000,
    output_limit = 8192,
    availability = 'available',
    tier = 'pro'
where slug = 'mujeeb-reasoning';

-- Kept deliberately locked: the slot for a genuinely premium paid model,
-- enabled from Admin -> Models once one is configured (#14, #152).
update models
set provider_model_id = 'openrouter/auto',
    display_name = 'Mujeeb AI Advanced',
    description = 'Reserved for a premium provider added post-launch. Enable from Admin -> Models once a paid model is configured.',
    capabilities = array['text', 'streaming']::text[],
    availability = 'locked',
    tier = 'premium'
where slug = 'mujeeb-advanced';

-- Everything falls back to the free auto-router, the candidate most likely
-- to still be answering.
update models
set fallback_model_id = (select id from models where slug = 'mujeeb-free')
where slug in ('mujeeb-vision', 'mujeeb-reasoning', 'mujeeb-advanced');

update models set fallback_model_id = null where slug = 'mujeeb-free';

update providers set status = 'operational' where slug = 'openrouter';
