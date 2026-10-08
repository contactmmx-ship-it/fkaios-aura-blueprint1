-- FKAIOS autonomy foundation, part B1 (mission 2026-10-08). See part A and docs/FKAIOS_AUTONOMY_ARCHITECTURE.md.

set local lock_timeout = '5s';

-- 3. Execution evidence ledger ──────────────────────────────────────────────
create table if not exists public.fkaios_execution_steps (
  id uuid primary key default gen_random_uuid(),
  objective_id uuid,
  project_id uuid,
  task_id uuid,
  job_id uuid,
  agent_run_id uuid,
  step_kind text not null check (step_kind in ('task_execution','continuation','verification','rectification','evaluation','discovery','planning')),
  task_class text,
  resource_ref text check (resource_ref is null or resource_ref ~ '^(model|worker|tool|capability):'),
  provider text,
  model text,
  worker_ref text check (worker_ref is null or worker_ref ~ '^worker:'),
  tool_ref text check (tool_ref is null or tool_ref ~ '^tool:'),
  capability_ref text check (capability_ref is null or capability_ref ~ '^capability:'),
  attempt integer not null default 1,
  switched_from_ref text,
  routing_policy_id uuid,
  selection jsonb not null default '{}'::jsonb,
  started_at timestamptz,
  finished_at timestamptz,
  duration_ms integer,
  input_tokens integer,
  output_tokens integer,
  cost_usd numeric,
  outcome text not null check (outcome in ('attempted','completed','failed','partial')),
  failure_category text,
  error text,
  verification_status text not null default 'unverified'
    check (verification_status in ('unverified','verified','partially_verified','rejected','superseded')),
  verification_evidence_id uuid references public.fkaios_verification_evidence(id) on delete set null,
  quality_score numeric,
  output_excerpt text,
  created_at timestamptz not null default now()
);
create index if not exists fkaios_execution_steps_objective_idx on public.fkaios_execution_steps(objective_id, created_at);
create index if not exists fkaios_execution_steps_task_idx on public.fkaios_execution_steps(task_id, created_at);
create index if not exists fkaios_execution_steps_resource_idx on public.fkaios_execution_steps(resource_ref, task_class, created_at desc);
create index if not exists fkaios_execution_steps_job_idx on public.fkaios_execution_steps(job_id);
alter table public.fkaios_execution_steps enable row level security;
do $p$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'fkaios_execution_steps' and policyname = 'fkaios_execution_steps_read') then
    create policy fkaios_execution_steps_read on public.fkaios_execution_steps for select to authenticated using (true);
  end if;
end $p$;
