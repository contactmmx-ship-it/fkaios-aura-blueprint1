-- Applied in production as version 20260924071035 (fkaios_dispatch_task_fix).
-- Exported read-only from supabase_migrations.schema_migrations on 2026-10-07 (md5 of statements: 7dc6ca485581bff9416deeee924ccb5b).
-- Record only: do not apply from this folder.

-- Fix: fkaios_dispatch_task raised "record m is not assigned yet" for any
-- task with no milestone (milestone_id null), because the conditional
-- select into the `record` variable m never ran and record variables stay
-- unassigned (not null) until populated - referencing m.id then errors.
-- Replaced with a plain jsonb variable, which PL/pgSQL safely assigns NULL
-- when the guarded select matches no rows.
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
