-- FKAIOS transactional objective completion arbiter.
-- All transitions into orchestrator_requests.status='completed' must pass through
-- this function. It validates persisted task/evidence state and commits the
-- project, request, contract, and canonical objective phase in one transaction.

create or replace function public.fkaios_objective_arbiter_set_phase(
  p_objective_id uuid,
  p_target text,
  p_reason text,
  p_patch jsonb default '{}'::jsonb
) returns boolean
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_version integer;
  v_phase text;
  v_next text;
begin
  select state_version, phase into v_version, v_phase
  from public.fkaios_objective_state
  where objective_id = p_objective_id
  for update;

  if not found then return false; end if;
  if v_phase = p_target then return true; end if;

  if p_target = 'completed' then
    if v_phase = 'failed' then return false; end if;
    if v_phase = 'completed' then return true; end if;
    if v_phase = 'understanding' then
      v_next := 'planning';
      v_version := public.fkaios_objective_state_apply(p_objective_id, v_version, v_next, '{}'::jsonb, p_reason || ' (arbiter path)');
      v_phase := v_next;
    end if;
    if v_phase = 'planning' or v_phase = 'blocked' or v_phase = 'rectifying' then
      v_next := 'executing';
      v_version := public.fkaios_objective_state_apply(p_objective_id, v_version, v_next, '{}'::jsonb, p_reason || ' (arbiter path)');
      v_phase := v_next;
    end if;
    if v_phase = 'executing' then
      v_next := 'verifying';
      v_version := public.fkaios_objective_state_apply(p_objective_id, v_version, v_next, '{}'::jsonb, p_reason || ' (arbiter path)');
      v_phase := v_next;
    end if;
    if v_phase <> 'verifying' then return false; end if;
    perform public.fkaios_objective_state_apply(p_objective_id, v_version, 'completed', coalesce(p_patch, '{}'::jsonb), p_reason);
    return true;
  end if;

  if p_target = 'blocked' then
    if v_phase = 'failed' then return false; end if;
    if v_phase = 'completed' then
      v_version := public.fkaios_objective_state_apply(p_objective_id, v_version, 'verifying', '{}'::jsonb, p_reason || ' (arbiter correction)');
      v_phase := 'verifying';
    end if;
    if v_phase <> 'blocked' then
      perform public.fkaios_objective_state_apply(p_objective_id, v_version, 'blocked', coalesce(p_patch, '{}'::jsonb), p_reason);
    end if;
    return true;
  end if;

  return false;
end;
$$;

revoke all on function public.fkaios_objective_arbiter_set_phase(uuid, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.fkaios_objective_arbiter_set_phase(uuid, text, text, jsonb) to service_role;

create or replace function public.fkaios_objective_completion_arbiter(
  p_objective_id uuid,
  p_project_id uuid,
  p_summary text,
  p_deliverable text,
  p_verification jsonb default '{}'::jsonb,
  p_preflight_block_reason text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_request public.orchestrator_requests%rowtype;
  v_project public.orchestration_projects%rowtype;
  v_contract public.objective_contracts%rowtype;
  v_task_count integer := 0;
  v_bad_tasks integer := 0;
  v_open_jobs integer := 0;
  v_output text;
  v_reason text;
  v_summary text;
  v_phase_ok boolean;
begin
  select * into v_request
  from public.orchestrator_requests
  where id = p_objective_id
  for update;

  if not found then
    return jsonb_build_object('decision', 'blocked', 'reason', 'objective request not found', 'summary', 'BLOCKED: objective request not found');
  end if;

  if nullif(trim(p_preflight_block_reason), '') is not null then
    v_reason := left(trim(p_preflight_block_reason), 2000);
  end if;

  -- A failed objective is terminal until the founder explicitly requests a rerun.
  if v_request.status = 'failed' then
    return jsonb_build_object('decision', 'blocked', 'reason', 'objective is already failed; an explicit rerun is required', 'summary', 'BLOCKED: objective is already failed; an explicit rerun is required');
  end if;

  select * into v_project
  from public.orchestration_projects
  where id = p_project_id
    and request like '[objective:' || p_objective_id::text || ']%'
  for update;

  if not found and v_reason is null then
    v_reason := 'completion project is missing or does not belong to this objective';
  end if;

  select * into v_contract
  from public.objective_contracts
  where objective_id = p_objective_id
  order by version desc
  limit 1
  for update;

  if v_reason is null and not found then
    v_reason := 'objective contract is missing';
  end if;

  v_output := coalesce(nullif(trim(p_deliverable), ''), nullif(trim(p_summary), ''));
  if v_reason is null and coalesce(length(v_output), 0) < 40 then
    v_reason := 'persisted deliverable is empty or too short to verify';
  end if;

  if v_reason is null and coalesce(jsonb_array_length(v_contract.acceptance_criteria), 0) = 0 then
    v_reason := 'objective contract has no acceptance criteria';
  end if;
  if v_reason is null and coalesce(jsonb_array_length(v_contract.evidence_requirements), 0) = 0 then
    v_reason := 'objective contract has no evidence requirements';
  end if;
  if v_reason is null and v_contract.risk_level in ('high', 'critical') and coalesce(v_contract.founder_approval_required, true) then
    v_reason := 'founder approval is required by the objective risk contract';
  end if;

  if v_reason is null then
    select count(*), count(*) filter (where t.status not in ('done', 'approved'))
    into v_task_count, v_bad_tasks
    from public.orchestration_tasks t
    where t.project_id = p_project_id;

    if v_task_count = 0 then
      v_reason := 'completion project has no persisted tasks';
    elsif v_bad_tasks > 0 then
      v_reason := format('%s task(s) are not in a verified terminal-success state', v_bad_tasks);
    end if;
  end if;

  if v_reason is null then
    select count(*) into v_open_jobs
    from public.ai_jobs j
    where j.type = 'work_engine_task'
      and j.status in ('pending', 'running', 'retry')
      and (
        j.payload->>'project_id' = p_project_id::text
        or j.payload->>'task_id' in (
          select t.id::text from public.orchestration_tasks t where t.project_id = p_project_id
        )
      );
    if v_open_jobs > 0 then
      v_reason := format('%s executable task job(s) remain open', v_open_jobs);
    end if;
  end if;

  if v_reason is null and not exists (
    select 1 from public.fkaios_verification_evidence e
    where e.objective_id = p_objective_id
      and e.project_id = p_project_id
      and e.requirement_key = 'completion_gate:all_tasks_verified'
      and e.evidence_type = 'deterministic_task_gate'
      and e.status = 'passed'
      and e.verified_at is not null
      and e.observed_result->>'project_id' = p_project_id::text
      and coalesce((e.observed_result->>'task_count')::integer, 0) = v_task_count
  ) then
    v_reason := 'deterministic completion-gate evidence is missing or does not match the persisted task set';
  end if;

  if v_reason is null then
    update public.objective_contracts
    set status = 'verified', updated_at = now()
    where id = v_contract.id;

    if not public.fkaios_objective_completion_allowed(p_objective_id) then
      if not public.fkaios_objective_verification_ready(p_objective_id) then
        v_reason := 'one or more contract evidence requirements have no passing persisted evidence';
      else
        v_reason := 'the existing objective completion guard rejected the acceptance contract';
      end if;
    end if;
  end if;

  if v_reason is not null then
    v_summary := left('BLOCKED: completion arbiter rejected terminal transition. Missing requirement: ' || v_reason, 5000);
    perform set_config('fkaios.objective_completion_arbiter', 'on', true);

    if v_project.id is not null then
      update public.orchestration_projects
      set status = 'failed', error_message = v_summary
      where id = v_project.id;
    end if;
    update public.orchestrator_requests
    set status = 'awaiting_approval', result_summary = v_summary, action_taken = 'objective_loop'
    where id = p_objective_id;
    update public.objective_contracts
    set status = 'blocked', updated_at = now()
    where objective_id = p_objective_id;

    v_phase_ok := public.fkaios_objective_arbiter_set_phase(
      p_objective_id, 'blocked', v_summary,
      jsonb_build_object('blocked_reason', v_reason, 'next_action', 'Fix the exact missing requirement and verify again.')
    );
    if not v_phase_ok then
      -- Do not claim a coherent blocked phase when the canonical state is terminal-failed.
      update public.orchestrator_requests set status = 'failed' where id = p_objective_id;
      return jsonb_build_object('decision', 'failed', 'reason', v_reason, 'summary', v_summary, 'project_id', p_project_id);
    end if;

    return jsonb_build_object('decision', 'blocked', 'reason', v_reason, 'summary', v_summary, 'project_id', p_project_id);
  end if;

  v_summary := left(coalesce(nullif(trim(p_summary), ''), 'Objective completed after deterministic verification.'), 5000);
  perform set_config('fkaios.objective_completion_arbiter', 'on', true);

  update public.orchestration_projects
  set status = 'complete', final_output = v_output, draft_final_output = null, error_message = null
  where id = p_project_id;

  update public.orchestrator_requests
  set status = 'completed', result_summary = v_summary, action_taken = 'objective_loop'
  where id = p_objective_id;

  v_phase_ok := public.fkaios_objective_arbiter_set_phase(
    p_objective_id, 'completed', v_summary,
    jsonb_build_object('verification', coalesce(p_verification, '{}'::jsonb), 'next_action', null, 'blocked_reason', null)
  );

  if not v_phase_ok then
    raise exception 'Completion arbiter could not transition canonical objective state to completed';
  end if;

  return jsonb_build_object('decision', 'completed', 'summary', v_summary, 'project_id', p_project_id, 'task_count', v_task_count);
end;
$$;

revoke all on function public.fkaios_objective_completion_arbiter(uuid, uuid, text, text, jsonb, text) from public, anon, authenticated;
grant execute on function public.fkaios_objective_completion_arbiter(uuid, uuid, text, text, jsonb, text) to service_role;

-- A direct request-table write can no longer mark an objective completed.
create or replace function public.fkaios_guard_objective_completed_write()
returns trigger
language plpgsql
set search_path = public, extensions, pg_temp
as $$
begin
  if new.status = 'completed'
     and old.status is distinct from 'completed'
     and current_setting('fkaios.objective_completion_arbiter', true) is distinct from 'on' then
    raise exception 'objective_completion_arbiter_required: all completed transitions must use fkaios_objective_completion_arbiter';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_fkaios_objective_completed_write on public.orchestrator_requests;
create trigger trg_fkaios_objective_completed_write
before update of status on public.orchestrator_requests
for each row execute function public.fkaios_guard_objective_completed_write();

-- The arbiter is the sole approved path for correcting a false terminal project.
create or replace function public.trg_fkaios_project_terminal_guard()
returns trigger
language plpgsql
set search_path = public, extensions, pg_temp
as $$
begin
  if old.status = 'complete' and new.status <> 'complete' then
    if current_setting('fkaios.objective_completion_arbiter', true) = 'on' then
      return new;
    end if;
    if new.status = 'working'
       and new.error_message ilike 'Evidence audit reopened this project:%' then
      return new;
    end if;
    new.status := 'complete';
  end if;
  return new;
end;
$$;

-- Legacy SQL reconciliation now delegates to the same transactional arbiter.
create or replace function public.fkaios_reconcile_terminal_objective(p_objective_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_project record;
  v_total integer;
  v_terminal integer;
  v_open_jobs integer;
  v_request_status text;
begin
  select r.status into v_request_status
  from public.orchestrator_requests r
  where r.id = p_objective_id
  for update;

  if v_request_status is null then
    return jsonb_build_object('reconciled', false, 'reason', 'objective_not_found');
  end if;

  select p.id, p.status, p.final_output
  into v_project
  from public.orchestration_projects p
  where p.request like '[objective:' || p_objective_id::text || ']%'
  order by p.created_at desc
  limit 1
  for update;

  if v_project.id is null then
    return jsonb_build_object('reconciled', false, 'reason', 'project_not_found');
  end if;

  select count(*), count(*) filter (where t.status in ('done', 'approved'))
  into v_total, v_terminal
  from public.orchestration_tasks t
  where t.project_id = v_project.id;

  select count(*) into v_open_jobs
  from public.ai_jobs j
  where j.type = 'work_engine_task'
    and j.status in ('pending', 'running', 'retry')
    and (
      j.payload->>'project_id' = v_project.id::text
      or j.payload->>'task_id' in (
        select t.id::text from public.orchestration_tasks t where t.project_id = v_project.id
      )
    );

  if v_project.status <> 'complete'
     or coalesce(length(trim(v_project.final_output)), 0) = 0
     or v_total = 0
     or v_terminal <> v_total
     or v_open_jobs > 0 then
    return jsonb_build_object(
      'reconciled', false,
      'project_status', v_project.status,
      'task_total', v_total,
      'task_terminal', v_terminal,
      'open_jobs', v_open_jobs,
      'reason', 'project/task state is not eligible for arbiter verification'
    );
  end if;

  return public.fkaios_objective_completion_arbiter(
    p_objective_id,
    v_project.id,
    'Terminal project submitted to the completion arbiter for full contract verification.',
    v_project.final_output,
    '{}'::jsonb,
    null
  );
end;
$$;

revoke all on function public.fkaios_reconcile_terminal_objective(uuid) from public, anon, authenticated;
grant execute on function public.fkaios_reconcile_terminal_objective(uuid) to service_role;
