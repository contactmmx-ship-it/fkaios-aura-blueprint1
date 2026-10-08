-- FKAIOS OUTCOME LEARNING V1
-- Turns execution + verification into reusable capability evidence.
-- Existing execution_log/agent_performance_metrics remain authoritative
-- history; this is the capability-level learning projection.

create table if not exists public.fkaios_capability_outcomes (
  id uuid primary key default gen_random_uuid(),
  capability text not null,
  resource_ref text not null,
  provider text,
  worker_ref text,
  project_id uuid,
  objective_id uuid,
  task_id uuid,
  job_id uuid,
  success boolean not null,
  verified boolean not null default false,
  verification_status text not null default 'unverified'
    check (verification_status in ('verified','unverified','failed','unknown')),
  latency_ms integer,
  estimated_cost_usd numeric(12,6),
  evidence jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_fk_cap_outcome_capability
  on public.fkaios_capability_outcomes(capability, created_at desc);
create index if not exists idx_fk_cap_outcome_resource
  on public.fkaios_capability_outcomes(resource_ref, capability, created_at desc);
create index if not exists idx_fk_cap_outcome_task
  on public.fkaios_capability_outcomes(task_id);

alter table public.fkaios_capability_outcomes enable row level security;
drop policy if exists fkaios_capability_outcomes_read on public.fkaios_capability_outcomes;
create policy fkaios_capability_outcomes_read
  on public.fkaios_capability_outcomes for select to authenticated using (true);
drop policy if exists fkaios_capability_outcomes_admin_write on public.fkaios_capability_outcomes;
create policy fkaios_capability_outcomes_admin_write
  on public.fkaios_capability_outcomes for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create or replace function public.fkaios_record_capability_outcome(
  p_capability text,
  p_resource_ref text,
  p_provider text,
  p_worker_ref text,
  p_project_id uuid,
  p_objective_id uuid,
  p_task_id uuid,
  p_job_id uuid,
  p_success boolean,
  p_verified boolean,
  p_verification_status text,
  p_latency_ms integer default null,
  p_estimated_cost_usd numeric default null,
  p_evidence jsonb default '{}'::jsonb
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_id uuid;
begin
  if p_capability is null or length(trim(p_capability)) = 0 then
    raise exception 'capability is required';
  end if;
  if p_resource_ref is null or length(trim(p_resource_ref)) = 0 then
    raise exception 'resource_ref is required';
  end if;
  insert into public.fkaios_capability_outcomes(
    capability, resource_ref, provider, worker_ref, project_id,
    objective_id, task_id, job_id, success, verified, verification_status,
    latency_ms, estimated_cost_usd, evidence
  ) values (
    trim(p_capability), trim(p_resource_ref), nullif(trim(p_provider), ''),
    nullif(trim(p_worker_ref), ''), p_project_id, p_objective_id, p_task_id,
    p_job_id, p_success, p_verified, p_verification_status,
    p_latency_ms, p_estimated_cost_usd, coalesce(p_evidence, '{}'::jsonb)
  ) returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.fkaios_record_capability_outcome(text,text,text,text,uuid,uuid,uuid,uuid,boolean,boolean,text,integer,numeric,jsonb) from public, anon, authenticated;

-- Evidence-based ranking. It only ranks resources with observed outcomes;
-- resources with no evidence are returned separately rather than pretending
-- they are good.
create or replace function public.fkaios_rank_capability_resources(p_capability text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with scored as (
    select
      resource_ref,
      max(provider) as provider,
      count(*) as observations,
      count(*) filter (where success) as successes,
      count(*) filter (where verified) as verified_count,
      round(100.0 * count(*) filter (where success) / nullif(count(*),0), 1) as success_pct,
      round(avg(latency_ms)::numeric, 0) as avg_latency_ms,
      round(avg(estimated_cost_usd)::numeric, 6) as avg_cost_usd
    from public.fkaios_capability_outcomes
    where capability = p_capability
    group by resource_ref
  )
  select jsonb_build_object(
    'capability', p_capability,
    'ranked_resources', coalesce((
      select jsonb_agg(jsonb_build_object(
        'resource_ref', resource_ref,
        'provider', provider,
        'observations', observations,
        'successes', successes,
        'verified_count', verified_count,
        'success_pct', success_pct,
        'avg_latency_ms', avg_latency_ms,
        'avg_cost_usd', avg_cost_usd
      ) order by verified_count desc, success_pct desc, avg_cost_usd asc nulls last, avg_latency_ms asc nulls last)
      from scored
    ), '[]'::jsonb),
    'evidence_rule', 'Observed verified outcomes outrank declared capability claims; no observation is treated as proof.'
  );
$$;

revoke all on function public.fkaios_rank_capability_resources(text) from public, anon;
grant execute on function public.fkaios_rank_capability_resources(text) to authenticated;

comment on table public.fkaios_capability_outcomes is
'Measured capability/resource outcomes used to improve future routing. Not a replacement for execution history.';
