-- FKAIOS CANONICAL PROJECT STATE V1
-- Project state is the durable source of truth; execution tables remain history/queues.
-- This is additive: it does not replace orchestration_projects, tasks, jobs, handoffs, or memory.

create table if not exists public.fkaios_project_state (
  id uuid primary key default gen_random_uuid(),
  orchestration_project_id uuid not null unique references public.orchestration_projects(id) on delete cascade,
  objective_id uuid references public.orchestrator_requests(id) on delete set null,

  objective text not null,
  desired_outcome text,
  status text not null default 'active' check (
    status in ('planning','active','blocked','awaiting_approval','interrupted','unknown','completed','failed','superseded')
  ),

  current_strategy text,
  current_architecture text,
  current_implementation text,

  current_task_id uuid references public.orchestration_tasks(id) on delete set null,
  current_task_summary text,
  next_action text,

  completed_work jsonb not null default '[]'::jsonb,
  pending_work jsonb not null default '[]'::jsonb,
  blocked_work jsonb not null default '[]'::jsonb,
  unknown_work jsonb not null default '[]'::jsonb,

  decisions jsonb not null default '[]'::jsonb,
  discoveries jsonb not null default '[]'::jsonb,
  errors jsonb not null default '[]'::jsonb,
  tests jsonb not null default '[]'::jsonb,
  artifacts jsonb not null default '[]'::jsonb,
  workers_used jsonb not null default '[]'::jsonb,
  capabilities_used jsonb not null default '[]'::jsonb,

  last_verified_at timestamptz,
  last_verified_by text,
  state_version integer not null default 1,
  provenance jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_fkaios_project_state_status
  on public.fkaios_project_state(status);
create index if not exists idx_fkaios_project_state_objective
  on public.fkaios_project_state(objective_id);
create index if not exists idx_fkaios_project_state_updated
  on public.fkaios_project_state(updated_at desc);

alter table public.fkaios_project_state enable row level security;

drop policy if exists fkaios_project_state_read on public.fkaios_project_state;
create policy fkaios_project_state_read
  on public.fkaios_project_state for select
  to authenticated using (true);

drop policy if exists fkaios_project_state_admin_write on public.fkaios_project_state;
create policy fkaios_project_state_admin_write
  on public.fkaios_project_state for all
  to authenticated using (public.is_admin()) with check (public.is_admin());

-- Existing worker_handoffs already is FKAIOS's continuity packet.
-- Link it to canonical project state instead of creating a second handoff system.
alter table public.worker_handoffs
  add column if not exists project_state_id uuid
    references public.fkaios_project_state(id) on delete set null;

alter table public.worker_handoffs
  add column if not exists packet_version integer not null default 1;

create index if not exists idx_worker_handoffs_project_state
  on public.worker_handoffs(project_state_id);

-- One atomic helper for workers/orchestrators to create or advance the durable state.
create or replace function public.fkaios_upsert_project_state(
  p_orchestration_project_id uuid,
  p_objective text,
  p_objective_id uuid default null,
  p_status text default 'active',
  p_current_task_id uuid default null,
  p_current_task_summary text default null,
  p_next_action text default null,
  p_current_strategy text default null,
  p_current_architecture text default null,
  p_current_implementation text default null,
  p_last_verified_at timestamptz default null,
  p_last_verified_by text default null,
  p_provenance jsonb default '{}'::jsonb
)
returns public.fkaios_project_state
language plpgsql
security definer
set search_path = public
as $$
declare
  result public.fkaios_project_state;
begin
  if p_status not in ('planning','active','blocked','awaiting_approval','interrupted','unknown','completed','failed','superseded') then
    raise exception 'FKAIOS: invalid project state %', p_status;
  end if;

  insert into public.fkaios_project_state (
    orchestration_project_id, objective_id, objective, status,
    current_strategy, current_architecture, current_implementation,
    current_task_id, current_task_summary, next_action,
    last_verified_at, last_verified_by, provenance
  )
  values (
    p_orchestration_project_id, p_objective_id, p_objective, p_status,
    p_current_strategy, p_current_architecture, p_current_implementation,
    p_current_task_id, p_current_task_summary, p_next_action,
    p_last_verified_at, p_last_verified_by, coalesce(p_provenance, '{}'::jsonb)
  )
  on conflict (orchestration_project_id) do update set
    objective_id = coalesce(excluded.objective_id, public.fkaios_project_state.objective_id),
    objective = excluded.objective,
    status = excluded.status,
    current_strategy = coalesce(excluded.current_strategy, public.fkaios_project_state.current_strategy),
    current_architecture = coalesce(excluded.current_architecture, public.fkaios_project_state.current_architecture),
    current_implementation = coalesce(excluded.current_implementation, public.fkaios_project_state.current_implementation),
    current_task_id = excluded.current_task_id,
    current_task_summary = excluded.current_task_summary,
    next_action = excluded.next_action,
    last_verified_at = coalesce(excluded.last_verified_at, public.fkaios_project_state.last_verified_at),
    last_verified_by = coalesce(excluded.last_verified_by, public.fkaios_project_state.last_verified_by),
    provenance = case
      when excluded.provenance = '{}'::jsonb then public.fkaios_project_state.provenance
      else excluded.provenance end,
    state_version = public.fkaios_project_state.state_version + 1,
    updated_at = now()
  returning * into result;

  return result;
end;
$$;

revoke all on function public.fkaios_upsert_project_state(
  uuid,text,uuid,text,uuid,text,text,text,text,text,timestamptz,text,jsonb
) from public, anon, authenticated;

comment on table public.fkaios_project_state is
'Canonical durable project state. Execution queues and worker outputs are history; this table answers where the project is now.';

comment on column public.fkaios_project_state.unknown_work is
'Work whose true state is not verified. UNKNOWN is intentionally distinct from FAILED.';
