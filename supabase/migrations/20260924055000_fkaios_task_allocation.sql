-- FKAIOS Work Allocation Engine (master spec Section 12): given a task and
-- its REQUIRED capabilities (declared by the caller — a human, or in future
-- a real LLM classifier; this function does not guess capabilities from
-- free-text title/description, since that would be an unverified NLP claim
-- this codebase cannot honestly make in plain SQL), select the best
-- available capability_registry candidate and PERSIST the decision with its
-- reasoning — the part Section 12 explicitly requires ("persist the
-- allocation decision... why was it selected") and Section 33 explicitly
-- warns against faking ("a capability registry row is not proof of actual
-- execution").
--
-- This function performs ALLOCATION (a decision), not DISPATCH (an actual
-- invocation) — Section 14's distinction, kept honest on purpose. It never
-- marks anything running/completed; a receiving worker or edge function
-- still has to actually invoke the chosen capability and record real
-- evidence. Reuses fkaios_find_capability's ranking pattern (available
-- first, then priority) and capability_backlog gap-recording convention
-- rather than introducing a second, divergent version of either.

create table if not exists public.orchestration_task_allocations (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.orchestration_tasks(id),
  required_capabilities text[] not null,
  capability_name text references public.capability_registry(name),
  reason text not null,
  alternatives_considered jsonb not null default '[]',
  status text not null default 'allocated'
    check (status in ('allocated','no_candidate','dispatched','invoked','completed','failed','superseded')),
  decided_at timestamptz not null default now()
);
alter table public.orchestration_task_allocations enable row level security;
drop trigger if exists orchestration_task_allocations_no_secrets on public.orchestration_task_allocations;
create trigger orchestration_task_allocations_no_secrets before insert or update on public.orchestration_task_allocations
  for each row execute function public.fkaios_reject_secrets();
create index if not exists orchestration_task_allocations_task_idx on public.orchestration_task_allocations(task_id, decided_at desc);

create or replace function public.fkaios_allocate_task(p_task_id uuid, required_capabilities text[])
returns jsonb language plpgsql as $$
declare
  t record;
  candidates jsonb;
  chosen jsonb;
  alloc_id uuid;
  gap_id uuid;
  result_status text;
  reason_text text;
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
    chosen := candidates -> 0;
    result_status := 'allocated';
    reason_text := 'Selected ' || (chosen->>'name') || ' (' || (chosen->>'kind') || '): ' || coalesce(chosen->>'purpose', '') ||
      '. Chosen from ' || jsonb_array_length(candidates) || ' available candidate(s) tagged with [' || array_to_string(required_capabilities, ', ') ||
      '], ranked by availability then priority.';
  end if;

  insert into public.orchestration_task_allocations (task_id, required_capabilities, capability_name, reason, alternatives_considered, status)
  values (
    p_task_id, required_capabilities, chosen->>'name', reason_text,
    case when jsonb_array_length(candidates) > 1 then candidates - 0 else '[]'::jsonb end,
    result_status
  )
  returning id into alloc_id;

  -- Reflects a real, existing task status (no new value added to the
  -- existing constraint) - an allocated pending task becomes assigned,
  -- exactly what a human planner already does manually today.
  if result_status = 'allocated' and t.status = 'pending' then
    update public.orchestration_tasks set status = 'assigned' where id = p_task_id;
  end if;

  return jsonb_build_object(
    'allocation_id', alloc_id, 'task_id', p_task_id, 'status', result_status,
    'capability_name', chosen->>'name', 'reason', reason_text,
    'candidates_considered', jsonb_array_length(candidates), 'capability_gap_id', gap_id
  );
end $$;
revoke all on function public.fkaios_allocate_task(uuid, text[]) from public, anon, authenticated;
