-- Part 8 fix: allocation must match actual executor, or record a real
-- reassignment - never silently substitute. fkaios_allocate_task gains an
-- optional p_actual_executor: the CALLING worker's own registry name. If
-- given and it differs from the static top-priority pick, it is honored
-- ONLY when it is itself a genuinely eligible candidate (registered,
-- available/degraded, tagged with the required capability) - otherwise the
-- call fails loudly rather than pretending. A real TASK_REASSIGNED event and
-- an actual_executor column record the divergence, per the GoMax proof's own
-- honest finding (allocation named opus-5-5, sonnet-5 actually executed).
alter table public.orchestration_task_allocations
  add column if not exists actual_executor text references public.capability_registry(name);

create or replace function public.fkaios_allocate_task(p_task_id uuid, required_capabilities text[], p_actual_executor text default null)
returns jsonb language plpgsql as $$
declare
  t record;
  candidates jsonb;
  chosen jsonb;
  top_choice_name text;
  alloc_id uuid;
  gap_id uuid;
  result_status text;
  reason_text text;
  reassigned boolean := false;
begin
  select id, title, status into t from public.orchestration_tasks where id = p_task_id;
  if t.id is null then raise exception 'FKAIOS: task % does not exist', p_task_id; end if;
  if required_capabilities is null or array_length(required_capabilities, 1) is null then
    raise exception 'FKAIOS: required_capabilities must be a non-empty array - this function matches declared capability tags, it does not guess from free-text title/description';
  end if;

  select coalesce(jsonb_agg(m order by (m->>'priority')::numeric), '[]'::jsonb) into candidates from (
    select jsonb_build_object(
      'name', cr.name, 'kind', cr.kind, 'purpose', cr.purpose, 'availability', cr.availability,
      'cost_state', cr.cost_state, 'auth_state', cr.auth_state, 'priority', cr.priority, 'limitations', cr.limitations
    ) as m
    from public.capability_registry cr
    where cr.capabilities && required_capabilities
      and cr.availability in ('available', 'degraded')
      and cr.cost_state <> 'paid_exhausted'
    order by (cr.availability = 'available') desc, cr.priority asc
  ) s;

  if jsonb_array_length(candidates) = 0 then
    result_status := 'no_candidate';
    reason_text := 'No capability_registry row is both available/degraded and tagged with any of: ' || array_to_string(required_capabilities, ', ');
    select id into gap_id from public.capability_backlog
      where source_agent = 'fkaios_allocate_task' and capability = array_to_string(required_capabilities, '+') and status = 'proposed'
      order by created_at desc limit 1;
    if gap_id is null then
      insert into public.capability_backlog (capability, engine, gap_type, observed_defect, source_agent, status)
      values (
        array_to_string(required_capabilities, '+'), 'Work Allocation Engine', 'missing',
        'fkaios_allocate_task could not find any available capability_registry row tagged with [' || array_to_string(required_capabilities, ', ') ||
          '] for task "' || t.title || '" (' || p_task_id || ') on ' || to_char(now(), 'YYYY-MM-DD') || '.',
        'fkaios_allocate_task', 'proposed'
      )
      returning id into gap_id;
    end if;
    chosen := null;
  else
    top_choice_name := (candidates -> 0) ->> 'name';
    if p_actual_executor is not null and p_actual_executor <> top_choice_name then
      select m into chosen from jsonb_array_elements(candidates) m where m ->> 'name' = p_actual_executor limit 1;
      if chosen is null then
        raise exception 'FKAIOS: actual_executor % is not an eligible candidate for [%] - unregistered, unavailable, or missing this capability tag. Refusing to silently substitute a worker identity that cannot be verified.',
          p_actual_executor, array_to_string(required_capabilities, ', ');
      end if;
      reassigned := true;
      result_status := 'allocated';
      reason_text := 'Reassigned to ' || p_actual_executor || ' (' || (chosen->>'kind') || '): the calling session declared itself the actual available executor, overriding the static top pick ' || top_choice_name ||
        ' (priority ranking alone does not know which worker session is live right now). ' || coalesce(chosen->>'purpose', '');
    else
      chosen := candidates -> 0;
      result_status := 'allocated';
      reason_text := 'Selected ' || (chosen->>'name') || ' (' || (chosen->>'kind') || '): ' || coalesce(chosen->>'purpose', '') ||
        '. Chosen from ' || jsonb_array_length(candidates) || ' available candidate(s) tagged with [' || array_to_string(required_capabilities, ', ') ||
        '], ranked by availability then priority.';
    end if;
  end if;

  insert into public.orchestration_task_allocations (task_id, required_capabilities, capability_name, actual_executor, reason, alternatives_considered, status)
  values (
    p_task_id, required_capabilities, chosen->>'name', chosen->>'name', reason_text,
    case when jsonb_array_length(candidates) > 1 then candidates - 0 else '[]'::jsonb end,
    result_status
  )
  returning id into alloc_id;

  if result_status = 'allocated' and t.status = 'pending' then
    update public.orchestration_tasks set status = 'assigned' where id = p_task_id;
  end if;

  perform public.fkaios_log_event(null, p_task_id, 'TASK_ALLOCATED', jsonb_build_object('allocation_id', alloc_id, 'capability', chosen->>'name', 'status', result_status));
  if reassigned then
    perform public.fkaios_log_event(null, p_task_id, 'TASK_REASSIGNED', jsonb_build_object('allocation_id', alloc_id, 'from', top_choice_name, 'to', p_actual_executor));
  end if;

  return jsonb_build_object(
    'allocation_id', alloc_id, 'task_id', p_task_id, 'status', result_status,
    'capability_name', chosen->>'name', 'actual_executor', coalesce(chosen->>'name', null), 'reassigned', reassigned,
    'reason', reason_text, 'candidates_considered', jsonb_array_length(candidates), 'capability_gap_id', gap_id
  );
end $$;
revoke all on function public.fkaios_allocate_task(uuid, text[], text) from public, anon, authenticated;

-- Part 3/4: the persistent Master Acceptance Matrix. One row per named
-- requirement from the master specification; the controller (and any human)
-- re-evaluates it against live evidence rather than trusting a prior claim.
-- Distinct from capability_backlog (tool/capability gaps) and
-- orchestration_tasks (execution units) - this tracks SPECIFICATION
-- compliance for the FKAIOS build itself, which neither existing table models.
create table if not exists public.fkaios_acceptance_matrix (
  id uuid primary key default gen_random_uuid(),
  objective_id uuid references public.orchestrator_requests(id),
  requirement_no integer not null,
  description text not null,
  status text not null default 'unverified'
    check (status in ('missing','partial','implemented','tested','verified','human_blocked','unverified')),
  priority text not null default 'normal' check (priority in ('critical','high','normal','low')),
  evidence text,
  verification_method text,
  current_implementation text,
  related_files text[] not null default '{}',
  related_database_objects text[] not null default '{}',
  related_capabilities text[] not null default '{}',
  blocker text,
  last_verified_at timestamptz,
  provenance text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (objective_id, requirement_no)
);
alter table public.fkaios_acceptance_matrix enable row level security;
drop trigger if exists fkaios_acceptance_matrix_no_secrets on public.fkaios_acceptance_matrix;
create trigger fkaios_acceptance_matrix_no_secrets before insert or update on public.fkaios_acceptance_matrix
  for each row execute function public.fkaios_reject_secrets();

create or replace function public.fkaios_acceptance_summary(p_objective_id uuid)
returns jsonb language sql stable as $$
  select jsonb_build_object(
    'objective_id', p_objective_id,
    'total', count(*),
    'by_status', coalesce((select jsonb_object_agg(status, n) from (
      select status, count(*) as n from public.fkaios_acceptance_matrix where objective_id = p_objective_id group by status
    ) s), '{}'::jsonb),
    'all_verified_or_human_blocked', bool_and(status in ('verified', 'human_blocked')),
    'generated_at', now()
  )
  from public.fkaios_acceptance_matrix where objective_id = p_objective_id
$$;
revoke all on function public.fkaios_acceptance_summary(uuid) from public, anon, authenticated;
