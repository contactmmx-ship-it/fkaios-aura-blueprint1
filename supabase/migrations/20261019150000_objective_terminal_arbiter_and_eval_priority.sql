-- FKAIOS lifecycle repair: the database is the single terminal-state arbiter.
-- Objective completion is allowed only when deterministic evidence, contract,
-- tasks, project output and background-job state agree in one transaction.

create or replace function public.trg_fkaios_project_terminal_guard()
returns trigger
language plpgsql
set search_path = public, extensions, pg_temp
as $function$
begin
  if new.status = 'complete'
     and new.request like '[objective:%'
     and coalesce(current_setting('fkaios.objective_terminal_arbiter', true), '') <> 'on' then
    raise exception 'objective_terminal_arbiter_required: project completion must use fkaios_objective_terminal_transition';
  end if;

  if tg_op = 'UPDATE' and old.status = 'complete' and new.status <> 'complete' then
    if coalesce(current_setting('fkaios.objective_terminal_arbiter', true), '') = 'on'
       and new.status in ('working', 'failed') then
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
$function$;

drop trigger if exists trg_fkaios_project_terminal_guard on public.orchestration_projects;
create trigger trg_fkaios_project_terminal_guard
before insert or update of status on public.orchestration_projects
for each row execute function public.trg_fkaios_project_terminal_guard();

create or replace function public.fkaios_objective_request_completion_guard()
returns trigger
language plpgsql
set search_path = public, extensions, pg_temp
as $function$
begin
  if new.status = 'completed'
     and coalesce(current_setting('fkaios.objective_terminal_arbiter', true), '') <> 'on' then
    raise exception 'objective_terminal_arbiter_required: request completion must use fkaios_objective_terminal_transition';
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_fkaios_objective_request_completion_guard on public.orchestrator_requests;
create trigger trg_fkaios_objective_request_completion_guard
before insert or update of status on public.orchestrator_requests
for each row execute function public.fkaios_objective_request_completion_guard();

create or replace function public.fkaios_objective_state_completion_guard()
returns trigger
language plpgsql
set search_path = public, extensions, pg_temp
as $function$
begin
  if new.phase = 'completed'
     and coalesce(current_setting('fkaios.objective_terminal_arbiter', true), '') <> 'on' then
    raise exception 'objective_terminal_arbiter_required: state completion must use fkaios_objective_terminal_transition';
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_fkaios_objective_state_completion_guard on public.fkaios_objective_state;
create trigger trg_fkaios_objective_state_completion_guard
before insert or update of phase on public.fkaios_objective_state
for each row execute function public.fkaios_objective_state_completion_guard();

create or replace function public.fkaios_objective_terminal_transition(
  p_objective_id uuid,
  p_status text,
  p_summary text,
  p_project_id uuid default null,
  p_deliverable text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $function$
declare
  v_request public.orchestrator_requests%rowtype;
  v_contract public.objective_contracts%rowtype;
  v_project public.orchestration_projects%rowtype;
  v_status text := p_status;
  v_phase text;
  v_summary text := left(coalesce(p_summary, ''), 5000);
  v_reason text;
  v_task_count integer := 0;
  v_bad_task_count integer := 0;
  v_open_job_count integer := 0;
  v_other_active_project uuid;
  v_from_phase text;
  v_new_version integer;
begin
  if p_status not in ('completed', 'failed', 'awaiting_approval') then
    raise exception 'unsupported objective terminal status: %', p_status;
  end if;

  perform set_config('fkaios.objective_terminal_arbiter', 'on', true);

  select * into v_request
  from public.orchestrator_requests
  where id = p_objective_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'status', 'not_found', 'reason', 'objective_not_found');
  end if;

  select * into v_contract
  from public.objective_contracts
  where objective_id = p_objective_id
  order by version desc
  limit 1
  for update;

  if p_project_id is not null then
    select * into v_project
    from public.orchestration_projects
    where id = p_project_id
      and request like '[objective:' || p_objective_id::text || ']%'
    for update;
  else
    select * into v_project
    from public.orchestration_projects
    where request like '[objective:' || p_objective_id::text || ']%'
    order by created_at desc
    limit 1
    for update;
  end if;

  if v_status = 'completed' then
    if v_contract.id is null then
      v_reason := 'missing_objective_contract';
    elsif jsonb_typeof(v_contract.acceptance_criteria) <> 'array'
       or jsonb_array_length(v_contract.acceptance_criteria) = 0 then
      v_reason := 'missing_acceptance_criteria';
    elsif jsonb_typeof(v_contract.evidence_requirements) <> 'array'
       or jsonb_array_length(v_contract.evidence_requirements) = 0 then
      v_reason := 'missing_evidence_requirements';
    elsif v_project.id is null then
      v_reason := 'missing_execution_project';
    elsif length(trim(coalesce(nullif(p_deliverable, ''), nullif(v_project.final_output, ''), v_summary))) = 0 then
      v_reason := 'missing_persisted_deliverable';
    else
      select count(*),
             count(*) filter (where t.status not in ('done', 'approved', 'completed', 'verified') or length(trim(coalesce(t.output, ''))) = 0)
      into v_task_count, v_bad_task_count
      from public.orchestration_tasks t
      where t.project_id = v_project.id;

      if v_task_count = 0 then
        v_reason := 'missing_execution_tasks';
      elsif v_bad_task_count > 0 then
        v_reason := format('unverified_tasks:%s_of_%s', v_bad_task_count, v_task_count);
      else
        select count(*) into v_open_job_count
        from public.ai_jobs j
        where j.type = 'work_engine_task'
          and j.status in ('pending', 'running', 'retry')
          and j.payload->>'project_id' = v_project.id::text;

        if v_open_job_count > 0 then
          v_reason := format('open_execution_jobs:%s', v_open_job_count);
        else
          select p.id into v_other_active_project
          from public.orchestration_projects p
          where p.request like '[objective:' || p_objective_id::text || ']%'
            and p.id <> v_project.id
            and p.status in ('planning', 'working', 'reviewing', 'reworking', 'merging')
          order by p.created_at desc
          limit 1;

          if v_other_active_project is not null then
            v_reason := format('another_project_still_active:%s', v_other_active_project);
          end if;
        end if;
      end if;
    end if;

    if v_reason is null then
      update public.objective_contracts
      set status = 'verified', updated_at = now()
      where objective_id = p_objective_id;

      if not public.fkaios_objective_completion_allowed(p_objective_id) then
        v_reason := 'contract_or_deterministic_evidence_gate_failed';
      end if;
    end if;

    if v_reason is not null then
      v_status := 'awaiting_approval';
      v_summary := left('BLOCKED: ' || v_reason || '. ' || coalesce(nullif(v_summary, ''), 'Completion criteria were not met.'), 5000);
      update public.objective_contracts
      set status = 'blocked', updated_at = now()
      where objective_id = p_objective_id;
    end if;
  else
    update public.objective_contracts
    set status = 'blocked', updated_at = now()
    where objective_id = p_objective_id;
  end if;

  if v_project.id is not null then
    if v_status = 'completed' then
      update public.orchestration_projects
      set status = 'complete',
          final_output = coalesce(nullif(p_deliverable, ''), nullif(final_output, ''), v_summary),
          draft_final_output = null,
          error_message = null
      where id = v_project.id;
    elsif v_status = 'failed' then
      update public.orchestration_projects
      set status = 'failed', error_message = v_summary
      where id = v_project.id;
    elsif v_status = 'awaiting_approval' and v_project.status = 'complete' then
      update public.orchestration_projects
      set status = 'working',
          error_message = 'Evidence audit reopened this project: ' || v_summary
      where id = v_project.id;
    elsif v_status = 'awaiting_approval' then
      update public.orchestration_projects
      set error_message = v_summary
      where id = v_project.id
        and status <> 'failed';
    end if;
  end if;

  update public.orchestrator_requests
  set status = v_status,
      result_summary = v_summary,
      action_taken = 'objective_terminal_arbiter'
  where id = p_objective_id;

  v_phase := case v_status
    when 'completed' then 'completed'
    when 'failed' then 'failed'
    else 'blocked'
  end;

  select phase into v_from_phase
  from public.fkaios_objective_state
  where objective_id = p_objective_id
  for update;

  if not found then
    insert into public.fkaios_objective_state
      (objective_id, phase, objective, blocked_reason, next_action)
    values
      (p_objective_id, v_phase, v_request.raw_request,
       case when v_phase = 'blocked' then v_summary else null end,
       case when v_phase = 'blocked' then 'Resolve the exact blocker, then resume the existing project.' else null end);

    select state_version into v_new_version
    from public.fkaios_objective_state where objective_id = p_objective_id;
    insert into public.fkaios_objective_state_history
      (objective_id, state_version, from_phase, to_phase, reason)
    values (p_objective_id, v_new_version, null, v_phase, 'objective terminal arbiter: ' || v_summary);
  else
    update public.fkaios_objective_state
    set phase = v_phase,
        state_version = state_version + 1,
        blocked_reason = case when v_phase = 'blocked' then v_summary else null end,
        next_action = case when v_phase = 'blocked' then 'Resolve the exact blocker, then resume the existing project.' else null end,
        updated_at = now()
    where objective_id = p_objective_id
    returning state_version into v_new_version;

    if v_from_phase is distinct from v_phase then
      insert into public.fkaios_objective_state_history
        (objective_id, state_version, from_phase, to_phase, reason)
      values (p_objective_id, v_new_version, v_from_phase, v_phase, 'objective terminal arbiter: ' || v_summary);
    end if;
  end if;

  return jsonb_build_object(
    'ok', true,
    'objective_id', p_objective_id,
    'status', v_status,
    'phase', v_phase,
    'project_id', v_project.id,
    'reason', v_reason,
    'summary', v_summary
  );
end;
$function$;

revoke all on function public.fkaios_objective_terminal_transition(uuid, text, text, uuid, text) from public, anon, authenticated;
grant execute on function public.fkaios_objective_terminal_transition(uuid, text, text, uuid, text) to service_role;

comment on function public.fkaios_objective_terminal_transition(uuid, text, text, uuid, text) is
  'Single transactional terminal-state arbiter for objective request, contract, project and canonical state. Completion fails closed on missing deterministic evidence.';


-- Background capability tests may consume model capacity only when no objective
-- is actively executing. One budget unit permits one evaluator tick (at most
-- one small paired batch); the hard daily cap prevents a repeat of the Oct 11-14
-- benchmark storm. The table is private and only mutated through this RPC.
create table if not exists public.fkaios_background_eval_budget (
  budget_date date primary key,
  claimed_units integer not null default 0 check (claimed_units >= 0),
  updated_at timestamptz not null default now()
);
alter table public.fkaios_background_eval_budget enable row level security;
revoke all on table public.fkaios_background_eval_budget from public, anon, authenticated;

create or replace function public.fkaios_claim_background_eval_budget(p_daily_limit integer default 5)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $function$
declare
  v_units integer;
begin
  if p_daily_limit < 1 or p_daily_limit > 10 then
    return jsonb_build_object('allowed', false, 'reason', 'invalid_daily_limit');
  end if;

  if exists (
    select 1 from public.orchestrator_requests r
    where r.status in ('submitted', 'processing', 'queued', 'running', 'in_progress')
  ) then
    return jsonb_build_object('allowed', false, 'reason', 'objective_priority');
  end if;

  insert into public.fkaios_background_eval_budget (budget_date, claimed_units)
  values (current_date, 1)
  on conflict (budget_date) do update
    set claimed_units = public.fkaios_background_eval_budget.claimed_units + 1,
        updated_at = now()
    where public.fkaios_background_eval_budget.claimed_units < p_daily_limit
  returning claimed_units into v_units;

  if v_units is null then
    return jsonb_build_object('allowed', false, 'reason', 'daily_background_eval_cap', 'daily_limit', p_daily_limit);
  end if;

  return jsonb_build_object('allowed', true, 'claimed_units', v_units, 'daily_limit', p_daily_limit);
end;
$function$;

revoke all on function public.fkaios_claim_background_eval_budget(integer) from public, anon, authenticated;
grant execute on function public.fkaios_claim_background_eval_budget(integer) to service_role;

comment on table public.fkaios_background_eval_budget is
  'Daily unit budget for background capability evaluation; objectives have priority and background tests are capped at five ticks per day.';
