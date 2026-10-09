-- FKAIOS Capability Benchmarking V1
-- Adds evidence-backed benchmark records and governed adoption proposals.
-- This migration intentionally does not change routing or auto-promote resources.

create table if not exists public.capability_benchmarks (
  id uuid primary key default gen_random_uuid(),
  capability_id uuid not null references public.capability_registry(id) on delete cascade,
  resource_key text not null,
  provider text,
  model text,
  task_type text,
  benchmark_suite text not null,
  success boolean not null default false,
  verified boolean not null default false,
  quality_score numeric not null default 0,
  latency_ms integer,
  estimated_cost_usd numeric,
  input_tokens integer,
  output_tokens integer,
  evidence jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists capability_benchmarks_capability_idx
  on public.capability_benchmarks(capability_id, created_at desc);

create index if not exists capability_benchmarks_resource_idx
  on public.capability_benchmarks(capability_id, resource_key, created_at desc);

alter table public.capability_benchmarks enable row level security;

create table if not exists public.capability_adoption_proposals (
  id uuid primary key default gen_random_uuid(),
  capability_id uuid not null references public.capability_registry(id) on delete cascade,
  candidate_resource_key text not null,
  incumbent_resource_key text,
  benchmark_suite text not null,
  candidate_score numeric not null default 0,
  incumbent_score numeric not null default 0,
  improvement_pct numeric not null default 0,
  confidence_pct numeric not null default 0,
  recommendation text not null default 'observe'
    check (recommendation in ('observe','test','candidate','approve','rejected','adopted')),
  evidence jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by text
);

create index if not exists capability_adoption_proposals_capability_idx
  on public.capability_adoption_proposals(capability_id, created_at desc);

alter table public.capability_adoption_proposals enable row level security;

create or replace function public.fkaios_rank_benchmarked_resources(
  p_capability_id uuid,
  p_task_type text default null,
  p_benchmark_suite text default null
)
returns table (
  resource_key text,
  provider text,
  model text,
  attempts bigint,
  verified_attempts bigint,
  success_rate numeric,
  verified_quality numeric,
  avg_latency_ms numeric,
  avg_cost_usd numeric,
  benchmark_score numeric
)
language sql
stable
as $$
  with grouped as (
    select
      b.resource_key,
      max(b.provider) as provider,
      max(b.model) as model,
      count(*) as attempts,
      count(*) filter (where b.verified) as verified_attempts,
      avg((b.success::int)::numeric) * 100 as success_rate,
      coalesce(avg(b.quality_score) filter (where b.verified), 0) as verified_quality,
      avg(b.latency_ms)::numeric as avg_latency_ms,
      avg(b.estimated_cost_usd)::numeric as avg_cost_usd
    from public.capability_benchmarks b
    where b.capability_id = p_capability_id
      and (p_task_type is null or b.task_type = p_task_type)
      and (p_benchmark_suite is null or b.benchmark_suite = p_benchmark_suite)
    group by b.resource_key
  )
  select
    g.*,
    round((
      g.success_rate * 0.45 +
      g.verified_quality * 0.40 +
      least(100, greatest(0, 100 - coalesce(g.avg_latency_ms, 0) / 1000)) * 0.10 +
      least(100, greatest(0, 100 - coalesce(g.avg_cost_usd, 0) * 100)) * 0.05
    )::numeric, 2) as benchmark_score
  from grouped g
  where g.verified_attempts > 0
  order by benchmark_score desc, verified_attempts desc;
$$;

comment on table public.capability_benchmarks is
  'Verified benchmark and execution evidence for capability resources. Does not itself change routing.';

comment on table public.capability_adoption_proposals is
  'Governed proposals to promote a benchmarked resource. Proposal creation never changes active routing.';
