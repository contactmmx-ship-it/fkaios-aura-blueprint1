-- FKAIOS autonomy foundation, part A (mission 2026-10-08, docs/FKAIOS_AUTONOMY_ARCHITECTURE.md).
--
-- Extends existing tables instead of adding parallel ones:
--   model_registry          -> the execution-resource registry (identity, lifecycle, access, health)
--   capability_test_queue   -> leased, crash-safe test queue
--   capability_registry     -> gains one row per LLM task class so benchmarks have a capability_id
-- Adds what does not exist anywhere yet:
--   fkaios_execution_steps  -> per-attempt execution evidence ledger (one resource identity convention)
--   fkaios_objective_state  -> one authoritative, versioned state record per objective
--   fkaios_routing_policies -> versioned routing decisions with rollback targets
--   fkaios_eval_cases       -> versioned golden evaluation cases with deterministic checks
-- Resource identity convention (enforced by check constraints):
--   model:<provider>:<model> | worker:<id> | tool:<provider>:<tool> | capability:<id>

set local lock_timeout = '5s';

-- 1. Resource registry ──────────────────────────────────────────────────────
alter table public.model_registry
  add column if not exists resource_ref text generated always as ('model:' || provider || ':' || model) stored,
  add column if not exists lifecycle_state text not null default 'available',
  add column if not exists access_state text not null default 'unknown',
  add column if not exists context_window integer,
  add column if not exists max_output_tokens integer,
  add column if not exists free_tier boolean,
  add column if not exists source text,
  add column if not exists first_seen_at timestamptz not null default now(),
  add column if not exists last_seen_at timestamptz,
  add column if not exists retired_at timestamptz,
  add column if not exists health_status text not null default 'unknown',
  add column if not exists unavailable_until timestamptz,
  add column if not exists consecutive_failures integer not null default 0,
  add column if not exists last_success_at timestamptz,
  add column if not exists last_failure_at timestamptz,
  add column if not exists last_failure_category text,
  add column if not exists metadata jsonb not null default '{}'::jsonb,
  add column if not exists updated_at timestamptz not null default now();

alter table public.model_registry drop constraint if exists model_registry_lifecycle_state_check;
alter table public.model_registry add constraint model_registry_lifecycle_state_check check (lifecycle_state in
  ('discovered','available','testing','verified','candidate','adopted','monitored','degraded','retired'));
alter table public.model_registry drop constraint if exists model_registry_access_state_check;
alter table public.model_registry add constraint model_registry_access_state_check check (access_state in
  ('configured','no_credential','no_credit','unknown'));
alter table public.model_registry drop constraint if exists model_registry_health_status_check;
alter table public.model_registry add constraint model_registry_health_status_check check (health_status in
  ('available','degraded','unavailable','unknown'));
create unique index if not exists model_registry_resource_ref_key on public.model_registry(resource_ref);

-- Existing rows: retired models stay out of routing; the router's live default
-- (gemini-3.5-flash-lite, which is not in the registry yet) becomes the adopted
-- incumbent; Anthropic/OpenAI keys exist but have no credit.
update public.model_registry set lifecycle_state = 'retired', retired_at = coalesce(retired_at, now())
  where blocked_reason ilike 'RETIRED%';
update public.model_registry set lifecycle_state = 'retired', retired_at = coalesce(retired_at, now()),
       blocked_reason = coalesce(blocked_reason, '') || ' Superseded by provider-discovered gemini models (2026-10-08).'
  where provider = 'google' and model = 'gemini-pro';
update public.model_registry set access_state = 'no_credit', lifecycle_state = 'monitored'
  where provider = 'anthropic' and lifecycle_state <> 'retired';
update public.model_registry set access_state = 'no_credit'
  where provider = 'openai';
insert into public.model_registry (model, provider, available, good_at, notes, lifecycle_state, access_state, source, free_tier)
values ('gemini-3.5-flash-lite', 'gemini', true, array['agent_structured_task','extraction','reasoning'],
        'Live router default since 2026-09-23 (llm-router getGeminiModel).', 'adopted', 'configured', 'router_default', true)
on conflict (model) do update set provider = excluded.provider, lifecycle_state = 'adopted', access_state = 'configured', available = true;

-- 2. LLM task classes as capabilities ───────────────────────────────────────
alter table public.capability_registry drop constraint if exists capability_registry_kind_check;
alter table public.capability_registry add constraint capability_registry_kind_check check (kind in
  ('ai_model','coding_worker','tool','artifact_tool','repository','connector','edge_function','llm_task_class'));
insert into public.capability_registry (name, kind, provider, purpose, capabilities, availability, priority, source)
select 'llm:' || c, 'llm_task_class', 'fkaios', 'LLM work of class ' || c || ' (routing, evaluation and learning key).',
       array[c], 'available', 50, 'fkaios_autonomy_foundation'
from unnest(array['reasoning','extraction','planning','writing','verification','coding','research_synthesis','general']) c
where not exists (select 1 from public.capability_registry r where r.name = 'llm:' || c);

