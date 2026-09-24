-- FKAIOS Dispatch Engine (master spec Section 5/12): the layer between
-- ALLOCATION (fkaios_allocate_task, 20260924055000 - a decision) and a
-- COMPLETED task with real, verified evidence. Extends
-- orchestration_task_allocations rather than creating a parallel table.
--
-- Lifecycle implemented here, honestly scoped to what a SQL layer can do
-- without inventing execution it doesn't have:
--   allocated -> dispatched -> (a real worker does the work OUTSIDE this
--   function - a human, a Claude Code session, or in future an edge
--   function) -> fkaios_complete_task() records the REAL structured result,
--   runs a real structural verification (status + evidence present - never
--   a rubber stamp), and on pass marks the task 'done' (an existing,
--   unmodified status value) and emits real activity events.
--
-- This function does NOT itself invoke Claude/OpenAI/Gemini/a browser/etc -
-- that invocation still happens in whatever actually executed the task
-- (this migration cannot make an outbound API call). What it DOES do for
-- real: persist the structured worker-result contract, apply honest
-- verification rules, transition real task/allocation state, and compute
-- which newly-unblocked tasks become ready - so a human or a future
-- dispatcher never has to re-derive that by hand.

alter table public.orchestration_task_allocations
  drop constraint if exists orchestration_task_allocations_status_check;
alter table public.orchestration_task_allocations
  add constraint orchestration_task_allocations_status_check
  check (status in ('allocated','no_candidate','dispatched','running','completed','verification_failed','failed','superseded'));

alter table public.orchestration_task_allocations
  add column if not exists result jsonb,
  add column if not exists evidence jsonb not null default '[]',
  add column if not exists verification_status text
    check (verification_status in ('passed','failed')),
  add column if not exists verification_notes text,
  add column if not exists dispatched_at timestamptz,
  add column if not exists completed_at timestamptz;

-- Real, structured activity stream (master spec Section 12). One row per
-- state transition; enough detail to reconstruct what actually happened,
-- per the spec's own example format. Read-only for any future Command
-- Center — this table is written only by the functions below.
create table if not exists public.orchestration_activity_events (
  id uuid primary key default gen_random_uuid(),
  objective_id uuid references public.orchestrator_requests(id),
  milestone_id uuid references public.orchestration_milestones(id),
  task_id uuid references public.orchestration_tasks(id),
  allocation_id uuid references public.orchestration_task_allocations(id),
  event_type text not null check (event_type in (
    'OBJECTIVE_ACCEPTED','PLAN_CREATED','TASK_READY','TASK_ALLOCATED','WORKER_SELECTED',
    'DISPATCH_STARTED','WORKER_RUNNING','WORKER_RESULT','VERIFICATION_STARTED',
    'VERIFICATION_PASSED','VERIFICATION_FAILED','TASK_COMPLETED','WORKER_FAILED',
    'WORKER_LIMIT_REACHED','HANDOFF_STARTED','HANDOFF_COMPLETED','TASK_REASSIGNED',
    'NEXT_TASK_ALLOCATED','HUMAN_BLOCKED','OBJECTIVE_COMPLETED'
  )),
  detail jsonb not null default '{}',
  created_at timestamptz not null default now()
);
alter table public.orchestration_activity_events enable row level security;
drop trigger if exists orchestration_activity_events_no_secrets on public.orchestration_activity_events;
create trigger orchestration_activity_events_no_secrets before insert or update on public.orchestration_activity_events
  for each row execute function public.fkaios_reject_secrets();
create index if not exists orchestration_activity_events_objective_idx on public.orchestration_activity_events(objective_id, created_at);
create index if not exists orchestration_activity_events_task_idx on public.orchestration_activity_events(task_id, created_at);

create or replace function public.fkaios_log_event(
  p_objective_id uuid, p_task_id uuid, p_event_type text, p_detail jsonb default '{}'
) returns uuid language plpgsql as $$
declare
  eid uuid;
  p_milestone_id uuid;
  p_allocation_id uuid;
begin
  if p_task_id is not null then
    select milestone_id into p_milestone_id from public.orchestration_tasks where id = p_task_id;
    select id into p_allocation_id from public.orchestration_task_allocations
      where task_id = p_task_id order by decided_at desc limit 1;
  end if;
  insert into public.orchestration_activity_events (objective_id, milestone_id, task_id, allocation_id, event_type, detail)
  values (p_objective_id, p_milestone_id, p_task_id, p_allocation_id, p_event_type, p_detail)
  returning id into eid;
  return eid;
end $$;
revoke all on function public.fkaios_log_event(uuid, uuid, text, jsonb) from public, anon, authenticated;

-- Self-generated worker instruction (master spec Section 3), assembled from
-- REAL state only - the objective, the task, its milestone, sibling task
-- outputs already done in the same project (existing implementation /
-- previous attempts), and real Brain context via fkaios_brain_context()
-- (reused, not reimplemented). Also marks the allocation 'dispatched' and
-- logs DISPATCH_STARTED + WORKER_RUNNING, since for a live worker session
-- picking this up, dispatch and running-start are the same real moment.
create or replace function public.fkaios_dispatch_task(p_allocation_id uuid)
returns jsonb language plpgsql as $$
declare
  a record;
  t record;
  obj record;
  milestone_json jsonb;
  prior_outputs jsonb;
  brain jsonb;
  instruction jsonb;
begin
  select * into a from public.orchestration_task_allocations where id = p_allocation_id;
  if a.id is null then raise exception 'FKAIOS: allocation % does not exist', p_allocation_id; end if;
  if a.status <> 'allocated' then raise exception 'FKAIOS: allocation % is % - can only dispatch an allocated task', p_allocation_id, a.status; end if;

  select tsk.*, p.request as project_request into t from public.orchestration_tasks tsk
    join public.orchestration_projects p on p.id = tsk.project_id where tsk.id = a.task_id;
  select id, raw_request, status, result_summary into obj from public.orchestrator_requests
    where id = (select (regexp_match(t.project_request, '\[objective:([0-9a-f-]+)\]'))[1]::uuid);

  -- A plain jsonb variable (unlike a `record`) is safely assigned NULL when
  -- the task has no milestone, instead of staying "unassigned" and raising
  -- on first reference - the bug this replaced.
  milestone_json := null;
  if t.milestone_id is not null then
    select jsonb_build_object('id', ms.id, 'title', ms.title, 'description', ms.description, 'acceptance_criteria', ms.acceptance_criteria)
      into milestone_json from public.orchestration_milestones ms where ms.id = t.milestone_id;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('title', st.title, 'status', st.status, 'output', left(st.output, 2000))), '[]'::jsonb)
    into prior_outputs
    from public.orchestration_tasks st
    where st.project_id = t.project_id and st.id <> t.id and st.status in ('done', 'approved');

  begin
    select public.fkaios_brain_context(coalesce(obj.raw_request, t.title)) into brain;
  exception when others then
    brain := jsonb_build_object('error', 'brain context lookup failed: ' || SQLERRM);
  end;

  instruction := jsonb_build_object(
    'objective', jsonb_build_object('id', obj.id, 'request', obj.raw_request, 'status', obj.status),
    'milestone', milestone_json,
    'task', jsonb_build_object('id', t.id, 'title', t.title, 'description', t.description, 'status', t.status),
    'required_capabilities', a.required_capabilities,
    'assigned_capability', a.capability_name,
    'allocation_reason', a.reason,
    'existing_implementation_in_this_project', prior_outputs,
    'relevant_brain_context', brain,
    'constraints', jsonb_build_array(
      'Do not repeat work already done - reuse existing_implementation_in_this_project where applicable.',
      'Do not fabricate evidence.',
      'If genuinely blocked by a human-only requirement, return status=blocked with the exact reason - do not guess.'
    ),
    'evidence_required', 'Depends on task type - code changes need files/commits, research needs sources, content needs the actual content produced. No evidence = cannot be marked verified.',
    'when_complete', 'Call fkaios_complete_task(allocation_id, result) with the structured worker result contract.'
  );

  update public.orchestration_task_allocations set status = 'dispatched', dispatched_at = now() where id = p_allocation_id;
  perform public.fkaios_log_event(obj.id, t.id, 'DISPATCH_STARTED', jsonb_build_object('allocation_id', p_allocation_id, 'capability', a.capability_name));
  perform public.fkaios_log_event(obj.id, t.id, 'WORKER_RUNNING', jsonb_build_object('allocation_id', p_allocation_id));

  return instruction;
end $$;
revoke all on function public.fkaios_dispatch_task(uuid) from public, anon, authenticated;

-- Records a REAL worker result (master spec Section 2's structured
-- contract), runs honest structural verification (never a rubber stamp:
-- status must be a recognized terminal value AND, when claiming success,
-- evidence must be non-empty), transitions task/allocation state using
-- ONLY existing, unmodified status values, and computes which sibling
-- tasks in the same project just became unblocked (all depends_on_task_ids
-- now 'done') - logged as TASK_READY, not auto-allocated (allocation still
-- requires a human or caller to declare required_capabilities honestly,
-- per fkaios_allocate_task's own design - this function does not guess).
create or replace function public.fkaios_complete_task(p_allocation_id uuid, p_result jsonb)
returns jsonb language plpgsql as $$
declare
  a record;
  obj_id uuid;
  result_status text := p_result->>'status';
  has_evidence boolean;
  verdict text;
  verdict_notes text;
  newly_ready jsonb;
begin
  select * into a from public.orchestration_task_allocations where id = p_allocation_id;
  if a.id is null then raise exception 'FKAIOS: allocation % does not exist', p_allocation_id; end if;
  if a.status not in ('dispatched', 'running') then
    raise exception 'FKAIOS: allocation % is % - can only complete a dispatched/running task', p_allocation_id, a.status;
  end if;

  select (regexp_match(p.request, '\[objective:([0-9a-f-]+)\]'))[1]::uuid into obj_id
    from public.orchestration_tasks tsk
    join public.orchestration_projects p on p.id = tsk.project_id
    where tsk.id = a.task_id;

  perform public.fkaios_log_event(obj_id, a.task_id, 'WORKER_RESULT', jsonb_build_object('allocation_id', p_allocation_id, 'status', result_status));
  perform public.fkaios_log_event(obj_id, a.task_id, 'VERIFICATION_STARTED', jsonb_build_object('allocation_id', p_allocation_id));

  has_evidence := (p_result ? 'evidence') and jsonb_typeof(p_result->'evidence') = 'array' and jsonb_array_length(p_result->'evidence') > 0;

  if result_status = 'blocked' then
    verdict := 'failed';
    verdict_notes := 'Worker reported blocked: ' || coalesce(p_result->>'next_action', 'no reason given');
    update public.orchestration_task_allocations set status = 'failed', result = p_result, verification_status = 'failed', verification_notes = verdict_notes, completed_at = now() where id = p_allocation_id;
    perform public.fkaios_log_event(obj_id, a.task_id, 'VERIFICATION_FAILED', jsonb_build_object('reason', verdict_notes));
    perform public.fkaios_log_event(obj_id, a.task_id, 'HUMAN_BLOCKED', jsonb_build_object('reason', verdict_notes));
    return jsonb_build_object('allocation_id', p_allocation_id, 'verification', 'failed', 'reason', verdict_notes, 'task_status', 'unchanged');
  elsif result_status in ('completed', 'partial_success') and has_evidence then
    verdict := 'passed';
    verdict_notes := 'status=' || result_status || ', ' || jsonb_array_length(p_result->'evidence') || ' evidence item(s) present.';
  else
    verdict := 'failed';
    verdict_notes := case when not has_evidence then 'No evidence array (or empty) - a result cannot be verified without evidence (Section 28).'
      else 'Unrecognized or unsuccessful result status: ' || coalesce(result_status, '(none)') end;
  end if;

  if verdict = 'passed' then
    update public.orchestration_task_allocations
      set status = 'completed', result = p_result, evidence = p_result->'evidence', verification_status = 'passed', verification_notes = verdict_notes, completed_at = now()
      where id = p_allocation_id;
    update public.orchestration_tasks
      set status = 'done', output = left(coalesce(p_result->>'summary', ''), 5000)
      where id = a.task_id;
    perform public.fkaios_log_event(obj_id, a.task_id, 'VERIFICATION_PASSED', jsonb_build_object('notes', verdict_notes));
    perform public.fkaios_log_event(obj_id, a.task_id, 'TASK_COMPLETED', jsonb_build_object('allocation_id', p_allocation_id));

    select coalesce(jsonb_agg(jsonb_build_object('task_id', nt.id, 'title', nt.title)), '[]'::jsonb) into newly_ready
      from public.orchestration_tasks nt
      where nt.project_id = (select project_id from public.orchestration_tasks where id = a.task_id)
        and nt.id <> a.task_id
        and nt.status = 'pending'
        and a.task_id = any(nt.depends_on_task_ids)
        and not exists (
          select 1 from unnest(nt.depends_on_task_ids) dep(id)
          left join public.orchestration_tasks dt on dt.id = dep.id
          where dt.status is distinct from 'done'
        );
    if jsonb_array_length(newly_ready) > 0 then
      perform public.fkaios_log_event(obj_id, a.task_id, 'TASK_READY', jsonb_build_object('unblocked', newly_ready));
    end if;
  else
    update public.orchestration_task_allocations
      set status = 'verification_failed', result = p_result, verification_status = 'failed', verification_notes = verdict_notes, completed_at = now()
      where id = p_allocation_id;
    perform public.fkaios_log_event(obj_id, a.task_id, 'VERIFICATION_FAILED', jsonb_build_object('notes', verdict_notes));
    newly_ready := '[]'::jsonb;
  end if;

  return jsonb_build_object('allocation_id', p_allocation_id, 'verification', verdict, 'notes', verdict_notes, 'newly_ready_tasks', newly_ready);
end $$;
revoke all on function public.fkaios_complete_task(uuid, jsonb) from public, anon, authenticated;
