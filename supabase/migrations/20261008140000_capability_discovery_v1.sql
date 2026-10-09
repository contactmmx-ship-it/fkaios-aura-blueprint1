-- FKAIOS automatic capability discovery V1
-- Discovery builds a candidate/test backlog from the existing model registry.
-- It never changes production routing or auto-adopts a candidate.

create table if not exists public.capability_discovery_candidates (
  id uuid primary key default gen_random_uuid(),
  resource_key text not null,
  candidate_type text not null default 'model'
    check (candidate_type in ('model','provider_capability','tool','skill')),
  provider text,
  model text,
  capability_hint text,
  source text not null,
  status text not null default 'discovered'
    check (status in ('discovered','eligible','testing','verified','rejected','blocked')),
  capability_id uuid references public.capability_registry(id) on delete set null,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  last_test_enqueued_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  unique (resource_key)
);

create index if not exists idx_capability_discovery_status
  on public.capability_discovery_candidates(status);
create index if not exists idx_capability_discovery_provider_model
  on public.capability_discovery_candidates(provider, model);

create table if not exists public.capability_test_queue (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.capability_discovery_candidates(id) on delete cascade,
  capability_id uuid references public.capability_registry(id) on delete set null,
  benchmark_suite text not null default 'fkaios_default_v1',
  status text not null default 'queued'
    check (status in ('queued','running','passed','failed','cancelled')),
  priority integer not null default 50,
  attempt integer not null default 0,
  requested_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  evidence jsonb not null default '{}'::jsonb,
  unique(candidate_id, benchmark_suite, status)
);

create index if not exists idx_capability_test_queue_ready
  on public.capability_test_queue(status, priority desc, requested_at);

alter table public.capability_discovery_candidates enable row level security;
alter table public.capability_test_queue enable row level security;

create or replace function public.fkaios_discover_capabilities(
  p_source text default 'model_registry_sync'
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  discovered_count integer := 0;
  eligible_count integer := 0;
  queued_count integer := 0;
begin
  insert into public.capability_discovery_candidates
    (resource_key, candidate_type, provider, model, capability_hint, source, status, metadata)
  select
    'model:' || mr.provider || ':' || mr.model,
    'model',
    mr.provider,
    mr.model,
    coalesce(array_to_string(mr.good_at, ','), 'general'),
    p_source,
    case when mr.available then 'eligible' else 'blocked' end,
    jsonb_build_object(
      'weak_at', coalesce(mr.weak_at, array[]::text[]),
      'blocked_reason', mr.blocked_reason,
      'cost_in_per_mtok', mr.cost_in_per_mtok,
      'cost_out_per_mtok', mr.cost_out_per_mtok,
      'notes', mr.notes
    )
  from public.model_registry mr
  on conflict (resource_key) do update set
    provider = excluded.provider,
    model = excluded.model,
    capability_hint = excluded.capability_hint,
    status = case
      when excluded.status = 'eligible'
       and public.capability_discovery_candidates.status in ('blocked','discovered')
        then 'eligible'
      when public.capability_discovery_candidates.status = 'verified' then 'verified'
      when public.capability_discovery_candidates.status = 'testing' then 'testing'
      else excluded.status
    end,
    last_seen_at = now(),
    metadata = excluded.metadata;

  get diagnostics discovered_count = row_count;

  insert into public.capability_test_queue(candidate_id, capability_id, benchmark_suite, priority)
  select c.id, c.capability_id, 'fkaios_default_v1',
         case when c.status = 'eligible' then 70 else 30 end
  from public.capability_discovery_candidates c
  where c.status = 'eligible'
    and c.last_test_enqueued_at is null
  on conflict do nothing;

  get diagnostics queued_count = row_count;

  update public.capability_discovery_candidates c
  set last_test_enqueued_at = now()
  where c.status = 'eligible'
    and c.last_test_enqueued_at is null;

  select count(*) into eligible_count
  from public.capability_discovery_candidates
  where status = 'eligible';

  return jsonb_build_object(
    'source', p_source,
    'discovered_or_updated', discovered_count,
    'eligible_candidates', eligible_count,
    'tests_queued', queued_count,
    'generated_at', now()
  );
end;
$$;

revoke all on function public.fkaios_discover_capabilities(text) from public;
revoke all on function public.fkaios_discover_capabilities(text) from anon;
revoke all on function public.fkaios_discover_capabilities(text) from authenticated;
grant execute on function public.fkaios_discover_capabilities(text) to service_role;

comment on table public.capability_discovery_candidates is
  'Canonical backlog of newly discovered execution resources. Discovery never changes production routing.';
comment on table public.capability_test_queue is
  'Governed queue for controlled capability tests. Passing tests feed capability_benchmarks; they do not auto-promote resources.';
