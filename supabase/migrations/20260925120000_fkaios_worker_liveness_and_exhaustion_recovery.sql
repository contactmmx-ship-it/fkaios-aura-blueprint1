-- FKAIOS worker liveness + provider-exhaustion recovery.
-- Extends the existing Master Controller (20260924132700) - no new
-- controller, scheduler, objective or task system.
--
-- AUDIT (2026-09-25, live production data, not assumed) - where the chain
-- stopped when the previous Claude Code session hit its usage limit:
--   * That session's last worker_runs row (935e5cc6) closed 2026-09-24 12:08.
--     It kept working until ~16:24 (commits e927c48, 7d77c6c, 80173bd) with
--     NO active worker_run, and its last handoff (37bbc8c5) is from 13:41 -
--     80173bd's "NOT YET DEPLOYED" state was only in git.
--   * fkaios_master_controller_tick's only recovery path reaps coding_worker
--     ALLOCATIONS stuck 'dispatched' >8h. Session work on acceptance-matrix
--     requirements never flows through allocations, and nothing inspects
--     worker_runs, so a dead session was invisible to FKAIOS.
--   * capability_registry.availability for claude-code:* is static
--     'available' - nothing ever marks a worker unavailable on a usage limit.
--     ai_model rows drifted from provider_health_state (the real llm-router /
--     ai-engine failure telemetry).
--   * No resume entrypoint: a new session reconstructed context by hand.
--
-- TELEMETRY BOUNDARY, stated honestly: FKAIOS receives NO Claude Code
-- usage/session-limit event. Detection here is (a) worker self-report via
-- fkaios_report_worker_limit - a session that can see its own limit, or is
-- told by its harness, reports it - and (b) inactivity: an active run with
-- no heartbeat for 3h is marked 'stalled' with cause UNKNOWN. A stall is
-- NOT recorded as a verified quota event.
--
-- Nothing here starts a Claude Code session (harness "Create Unsafe Agents"
-- boundary unchanged). What it guarantees: a dead/exhausted worker never
-- leaves the objective looking finished or its work stuck; work is released,
-- a structured handoff is generated from persisted data, the controller
-- names the next authorized worker (or says honestly that none is
-- available), and fkaios_worker_checkin() lets ANY next worker resume from
-- DB state with one call.

-- ── 1. Schema, additive ──────────────────────────────────────────────────
alter table public.worker_runs
  add column if not exists last_heartbeat_at timestamptz,
  add column if not exists capacity_state jsonb,
  add column if not exists end_reason text;
update public.worker_runs set last_heartbeat_at = coalesce(ended_at, started_at) where last_heartbeat_at is null;
alter table public.worker_runs alter column last_heartbeat_at set default now();

alter table public.worker_runs drop constraint worker_runs_status_check;
alter table public.worker_runs add constraint worker_runs_status_check
  check (status = any (array['active','handed_off','completed','failed','stalled','limit_reached']));

alter table public.worker_handoffs drop constraint worker_handoffs_transfer_mode_check;
alter table public.worker_handoffs add constraint worker_handoffs_transfer_mode_check
  check (transfer_mode = any (array['provider_limit','controlled_test','manual','worker_inactive']));

alter table public.orchestration_task_allocations
  add column if not exists worker_run_id uuid references public.worker_runs(id);

alter table public.fkaios_controller_state
  add column if not exists active_run_count integer not null default 0,
  add column if not exists recovered_runs_last_tick jsonb not null default '[]'::jsonb,
  add column if not exists available_workers jsonb not null default '[]'::jsonb,
  add column if not exists pending_worker_allocation_count integer not null default 0,
  add column if not exists latest_open_handoff_id uuid references public.worker_handoffs(id);

-- ── 2. Heartbeat: fkaios_worker_step now records liveness ────────────────
-- Same signature/return keys as before (plus 'revived'). A step on a run the
-- controller marked 'stalled' revives it: the worker is demonstrably alive,
-- so the inactivity guess was wrong and is corrected, not hidden.
create or replace function public.fkaios_worker_step(run_id uuid, step text)
returns jsonb language plpgsql as $$
declare
  r public.worker_runs;
  was_stalled boolean := false;
begin
  select status = 'stalled' into was_stalled from public.worker_runs where id = run_id;
  update public.worker_runs
    set steps = steps + 1, last_step = left(step, 500), last_heartbeat_at = now(),
        status = 'active', ended_at = case when status = 'stalled' then null else ended_at end,
        end_reason = case when status = 'stalled' then null else end_reason end
    where id = run_id and status in ('active', 'stalled') returning * into r;
  if r.id is null then raise exception 'FKAIOS: worker run % is not active', run_id; end if;
  insert into public.execution_log(function_name, action, status, input_summary, output_summary)
    values ('fkaios-worker', 'worker_step', 'success', r.worker || ' step ' || r.steps, left(step, 500));
  if coalesce(was_stalled, false) then
    perform public.fkaios_log_event(r.objective_id, null, 'WORKER_RUNNING', jsonb_build_object(
      'run_id', r.id, 'worker', r.worker, 'note', 'run was marked stalled by the controller and has resumed heartbeating - revived'));
  end if;
  return jsonb_build_object('run_id', r.id, 'steps', r.steps, 'max_steps', r.max_steps,
    'transfer_required', r.max_steps is not null and r.steps >= r.max_steps,
    'revived', coalesce(was_stalled, false));
end $$;

-- ── 3. Shared recovery: persist, release, hand off ───────────────────────
-- Used by both the explicit limit report and the controller's stall sweep.
-- Never marks any task/requirement complete. Idempotent per run: a second
-- call on a run that is no longer active/stalled is a no-op.
create or replace function public.fkaios_recover_worker_run(
  p_run_id uuid, p_new_status text, p_transfer_mode text, p_reason text, p_detail jsonb default '{}'::jsonb
) returns jsonb language plpgsql as $$
declare
  r public.worker_runs;
  obj_id uuid;
  cs record;
  alloc record;
  released jsonb := '[]'::jsonb;
  own_handoff uuid;
  parent_handoff uuid;
  new_handoff uuid;
begin
  if p_new_status not in ('stalled', 'limit_reached', 'failed') then
    raise exception 'FKAIOS: invalid recovery status %', p_new_status;
  end if;
  select * into r from public.worker_runs where id = p_run_id for update;
  if r.id is null then raise exception 'FKAIOS: worker run % does not exist', p_run_id; end if;
  if r.status not in ('active', 'stalled') then
    return jsonb_build_object('run_id', r.id, 'status', r.status, 'recovered', false, 'note', 'run already closed - nothing to recover');
  end if;

  update public.worker_runs
    set status = p_new_status, ended_at = coalesce(ended_at, now()), end_reason = left(p_reason, 500),
        capacity_state = coalesce(p_detail->'capacity_state', capacity_state)
    where id = r.id;

  -- Release this run's in-flight allocations for another worker.
  for alloc in select id from public.orchestration_task_allocations
    where worker_run_id = r.id and status in ('dispatched', 'running')
  loop
    perform public.fkaios_reap_stale_dispatch(alloc.id, 'worker run ' || r.id || ' ' || p_new_status || ': ' || p_reason);
    released := released || to_jsonb(alloc.id);
  end loop;

  obj_id := coalesce(r.objective_id,
    (select objective_id from public.fkaios_controller_state where objective_state <> 'complete' order by updated_at desc limit 1));
  select * into cs from public.fkaios_controller_state where objective_id = obj_id;

  -- Only synthesize a handoff if the worker did not leave one itself during
  -- this run - a worker-written handoff is always richer than a reconstruction.
  select id into own_handoff from public.worker_handoffs
    where from_run_id = r.id and status = 'open' order by created_at desc limit 1;
  if own_handoff is null and obj_id is not null then
    parent_handoff := coalesce(r.handoff_id,
      (select id from public.worker_handoffs where objective_id = obj_id and status in ('open', 'accepted') order by created_at desc limit 1));
    insert into public.worker_handoffs (
      objective_id, from_run_id, from_worker, from_provider, from_model, transfer_mode, reason, status,
      current_task, completed_work, partial_work, pending_work, blockers, decisions,
      current_state, next_action, verification_state, parent_handoff_id, capacity_state, retry_count
    ) values (
      obj_id, r.id, r.worker, r.provider, r.model, p_transfer_mode, left(p_reason, 1000), 'open',
      coalesce(cs.next_requirement_description, '(see fkaios_controller_state)'),
      jsonb_build_object('source', 'RECONSTRUCTED by FKAIOS from worker_runs - the worker did not write its own handoff',
        'steps_logged', r.steps, 'last_step', r.last_step, 'run_started_at', r.started_at, 'last_heartbeat_at', r.last_heartbeat_at),
      jsonb_build_array(jsonb_build_object('note', 'Work after the last logged step is UNKNOWN to FKAIOS. Check git (branch log after last_heartbeat_at) and fkaios_acceptance_matrix.updated_at for changes the worker made but did not record.')),
      jsonb_build_object('next_requirement_no', cs.next_requirement_no, 'next_requirement', cs.next_requirement_description,
        'open_requirements', cs.open_requirement_count, 'released_allocations', released),
      jsonb_build_object('recovery_reason', p_reason, 'detail', p_detail),
      '{}'::jsonb,
      'Worker run ' || r.id || ' ended as ' || p_new_status || ' without its own handoff. Objective NOT complete.',
      coalesce(cs.next_action, 'Read fkaios_controller_state for this objective.'),
      'Do not trust this reconstruction blindly: diff git and fkaios_acceptance_matrix against last_heartbeat_at, re-verify any requirement touched after it, then continue.',
      parent_handoff, p_detail->'capacity_state',
      coalesce((select retry_count + 1 from public.worker_handoffs where id = parent_handoff), 0)
    ) returning id into new_handoff;
    perform public.fkaios_generate_continuation_instruction(new_handoff);
  end if;

  perform public.fkaios_log_event(obj_id, null,
    case when p_new_status = 'limit_reached' then 'WORKER_LIMIT_REACHED' else 'WORKER_FAILED' end,
    jsonb_build_object('run_id', r.id, 'worker', r.worker, 'status', p_new_status, 'reason', p_reason,
      'released_allocations', released, 'handoff_id', coalesce(own_handoff, new_handoff),
      'handoff_source', case when own_handoff is not null then 'worker' when new_handoff is not null then 'fkaios_reconstructed' else 'none' end));
  if coalesce(own_handoff, new_handoff) is not null then
    perform public.fkaios_log_event(obj_id, null, 'HANDOFF_STARTED', jsonb_build_object('handoff_id', coalesce(own_handoff, new_handoff), 'from_run_id', r.id));
  end if;

  return jsonb_build_object('run_id', r.id, 'recovered', true, 'status', p_new_status, 'objective_id', obj_id,
    'released_allocations', released, 'handoff_id', coalesce(own_handoff, new_handoff),
    'handoff_source', case when own_handoff is not null then 'worker' when new_handoff is not null then 'fkaios_reconstructed' else 'none' end);
end $$;
revoke all on function public.fkaios_recover_worker_run(uuid, text, text, text, jsonb) from public, anon, authenticated;

-- ── 4. Explicit limit / failure report (the real-event path) ─────────────
-- A worker that knows it is exhausted/failing reports it. p_scope='provider'
-- marks every coding_worker of the same provider unavailable - correct for a
-- shared subscription quota (all claude-code:* share one Claude account).
-- p_resets_at unknown -> assumed now()+5h and labelled as an assumption.
create or replace function public.fkaios_report_worker_limit(
  p_run_id uuid,
  p_limit_kind text,
  p_resets_at timestamptz default null,
  p_scope text default 'capability',
  p_detail jsonb default '{}'::jsonb
) returns jsonb language plpgsql as $$
declare
  r public.worker_runs;
  recovery jsonb;
  until_ts timestamptz;
  marked text[];
  alternatives jsonb;
begin
  if p_limit_kind not in ('usage_limit','session_limit','context_limit','rate_limit','auth_failure',
                          'tool_failure','provider_unavailable','timeout','execution_failure') then
    raise exception 'FKAIOS: unknown limit kind %', p_limit_kind;
  end if;
  if p_scope not in ('capability', 'provider', 'none') then raise exception 'FKAIOS: invalid scope %', p_scope; end if;
  select * into r from public.worker_runs where id = p_run_id;
  if r.id is null then raise exception 'FKAIOS: worker run % does not exist', p_run_id; end if;

  until_ts := coalesce(p_resets_at, now() + interval '5 hours');

  -- Capacity-type failures make the worker unavailable until reset; a
  -- tool/execution failure is about the task, not the worker's capacity.
  if p_scope <> 'none' and p_limit_kind in ('usage_limit','session_limit','rate_limit','auth_failure','provider_unavailable') then
    with upd as (
      update public.capability_registry cr
        set availability = 'unavailable',
            metadata = coalesce(cr.metadata, '{}'::jsonb) || jsonb_build_object('limit_state', jsonb_build_object(
              'kind', p_limit_kind, 'unavailable_until', until_ts,
              'reset_time_source', case when p_resets_at is null then 'assumed_5h_default' else 'reported' end,
              'reported_by_run', r.id, 'reported_at', now(), 'scope', p_scope)),
            updated_at = now()
        where (p_scope = 'capability' and cr.name = r.worker)
           or (p_scope = 'provider' and cr.kind = 'coding_worker'
               and cr.provider = (select provider from public.capability_registry where name = r.worker))
        returning cr.name)
    select coalesce(array_agg(name), '{}') into marked from upd;
  else
    marked := '{}';
  end if;

  recovery := public.fkaios_recover_worker_run(r.id,
    case when p_limit_kind in ('tool_failure','execution_failure','timeout') then 'failed' else 'limit_reached' end,
    'provider_limit', p_limit_kind || ' reported by worker',
    p_detail || jsonb_build_object('limit_kind', p_limit_kind, 'unavailable_until', until_ts, 'registry_marked_unavailable', marked));

  select coalesce(jsonb_agg(jsonb_build_object('name', w.name, 'availability', w.availability)), '[]'::jsonb) into alternatives
    from public.fkaios_select_worker(array['repo_edit'], array[r.worker], null::numeric, null::numeric, null::text) w;

  return recovery || jsonb_build_object('registry_marked_unavailable', marked, 'unavailable_until', until_ts,
    'alternative_workers', alternatives,
    'next', case when jsonb_array_length(alternatives) > 0
      then 'Another authorized worker exists: it resumes with select public.fkaios_worker_checkin(''<worker>'');'
      else 'No authorized worker available - objective stays open and blocked_awaiting_worker until a limit resets.' end);
end $$;
revoke all on function public.fkaios_report_worker_limit(uuid, text, timestamptz, text, jsonb) from public, anon, authenticated;

-- ── 5. Resume entrypoint for any next worker ─────────────────────────────
create or replace function public.fkaios_worker_checkin(
  p_worker text, p_objective_id uuid default null, p_max_steps integer default 50
) returns jsonb language plpgsql as $$
declare
  cr record;
  obj_id uuid;
  run_id uuid;
  h record;
  instruction text;
  cs jsonb;
  pending jsonb;
begin
  select * into cr from public.capability_registry where name = p_worker and kind in ('coding_worker', 'ai_model');
  if cr.id is null then raise exception 'FKAIOS: % is not a registered worker capability', p_worker; end if;

  -- A session that is running and checking in is itself live evidence it
  -- has capacity now: clear only THIS worker's limit state.
  update public.capability_registry
    set availability = 'available', last_success_at = now(), updated_at = now(),
        metadata = (coalesce(metadata, '{}'::jsonb) - 'limit_state')
          || case when metadata ? 'limit_state' then jsonb_build_object('last_limit_state', metadata->'limit_state') else '{}'::jsonb end
    where name = p_worker;

  obj_id := coalesce(p_objective_id,
    (select objective_id from public.fkaios_controller_state where objective_state <> 'complete' order by updated_at desc limit 1));

  insert into public.worker_runs (objective_id, worker, provider, model, status, steps, max_steps, last_step, started_at, last_heartbeat_at)
    values (obj_id, p_worker, cr.provider, split_part(p_worker, ':', 2), 'active', 0, p_max_steps, 'checked in via fkaios_worker_checkin', now(), now())
    returning id into run_id;

  select * into h from public.worker_handoffs
    where objective_id = obj_id and status = 'open' order by created_at desc limit 1;
  if h.id is not null then
    update public.worker_handoffs set status = 'accepted', accepted_at = now(), to_run_id = run_id, to_worker = p_worker where id = h.id;
    update public.worker_runs set handoff_id = h.id where id = run_id;
    instruction := coalesce(h.continuation_instruction, public.fkaios_generate_continuation_instruction(h.id));
    perform public.fkaios_log_event(obj_id, h.task_id, 'HANDOFF_COMPLETED', jsonb_build_object('handoff_id', h.id, 'to_run_id', run_id, 'to_worker', p_worker));
  end if;

  select to_jsonb(s) into cs from public.fkaios_controller_state s where s.objective_id = obj_id;

  select coalesce(jsonb_agg(jsonb_build_object('allocation_id', a.id, 'task_id', a.task_id, 'task', t.title,
      'capability', a.capability_name, 'status', a.status, 'allocated_at', a.decided_at) order by a.decided_at), '[]'::jsonb)
    into pending
    from public.orchestration_task_allocations a
    join public.capability_registry c on c.name = a.capability_name
    join public.orchestration_tasks t on t.id = a.task_id
    where a.status = 'allocated' and c.kind = 'coding_worker';

  perform public.fkaios_log_event(obj_id, null, 'WORKER_SELECTED', jsonb_build_object('run_id', run_id, 'worker', p_worker, 'via', 'fkaios_worker_checkin', 'accepted_handoff_id', h.id));

  return jsonb_build_object(
    'run_id', run_id, 'objective_id', obj_id, 'worker', p_worker,
    'controller_state', cs,
    'accepted_handoff_id', h.id,
    'continuation_instruction', instruction,
    'pending_coding_allocations', pending,
    'protocol', jsonb_build_array(
      'Heartbeat: call fkaios_worker_step(run_id, what_you_did) after every meaningful step (the controller marks a run stalled after 3h without one).',
      'Dispatch an allocation to yourself with fkaios_dispatch_task(allocation_id, run_id) so it is released automatically if this run dies.',
      'If you hit or are about to hit a usage/session/rate limit: write your own worker_handoffs row (from_run_id = run_id), then call fkaios_report_worker_limit(run_id, kind, resets_at, ''provider'').',
      'Never mark a requirement verified without evidence; verify against git and live state before trusting this handoff.'));
end $$;
revoke all on function public.fkaios_worker_checkin(text, uuid, integer) from public, anon, authenticated;

-- ── 6. Dispatch bound to a run (so recovery can release it) ──────────────
create or replace function public.fkaios_dispatch_task(p_allocation_id uuid, p_run_id uuid)
returns jsonb language plpgsql as $$
declare
  r public.worker_runs;
  a record;
  instruction jsonb;
begin
  select * into r from public.worker_runs where id = p_run_id;
  if r.id is null or r.status <> 'active' then raise exception 'FKAIOS: worker run % is not active', p_run_id; end if;
  select * into a from public.orchestration_task_allocations where id = p_allocation_id;
  instruction := public.fkaios_dispatch_task(p_allocation_id);
  update public.orchestration_task_allocations
    set worker_run_id = r.id,
        actual_executor = case when r.worker <> a.capability_name
          and exists (select 1 from public.capability_registry where name = r.worker) then r.worker else actual_executor end
    where id = p_allocation_id;
  if r.worker <> a.capability_name then
    perform public.fkaios_log_event(r.objective_id, a.task_id, 'TASK_REASSIGNED', jsonb_build_object(
      'allocation_id', p_allocation_id, 'allocated_to', a.capability_name, 'executed_by', r.worker, 'run_id', r.id));
  end if;
  update public.worker_runs set last_heartbeat_at = now() where id = r.id;
  return instruction || jsonb_build_object('worker_run_id', r.id);
end $$;
revoke all on function public.fkaios_dispatch_task(uuid, uuid) from public, anon, authenticated;

-- ── 7. Master Controller tick: same loop, three recovery steps added ─────
create or replace function public.fkaios_master_controller_tick()
returns jsonb language plpgsql as $$
declare
  stall_after constant interval := interval '3 hours';
  obj_id uuid;
  reaped jsonb;
  reaped_count integer;
  recovered jsonb := '[]'::jsonb;
  restored jsonb := '[]'::jsonb;
  synced jsonb := '[]'::jsonb;
  stale_alloc record;
  stale_run record;
  next_req record;
  counts record;
  action_text text;
  state_text text;
  results jsonb := '[]'::jsonb;
  tick_row record;
  workers jsonb;
  pending_count integer;
  active_runs integer;
  open_handoff uuid;
begin
  -- (a) NEW: a reported limit whose reset time has passed no longer blocks
  -- the worker. Restored to 'unknown' (selectable, but not claimed healthy)
  -- - only a real checkin/step proves it available again.
  with upd as (
    update public.capability_registry cr
      set availability = 'unknown', updated_at = now(),
          metadata = (cr.metadata - 'limit_state') || jsonb_build_object('last_limit_state', cr.metadata->'limit_state')
      where cr.kind = 'coding_worker' and cr.availability = 'unavailable'
        and cr.metadata ? 'limit_state'
        and (cr.metadata->'limit_state'->>'unavailable_until')::timestamptz <= now()
      returning cr.name)
  select coalesce(jsonb_agg(name), '[]'::jsonb) into restored from upd;

  -- (b) NEW: ai_model registry rows follow provider_health_state (written by
  -- the real ai-engine failover path) instead of a static seed value.
  with upd as (
    update public.capability_registry cr
      set availability = case
            when phs.status = 'unavailable' and (phs.unavailable_until is null or phs.unavailable_until > now()) then 'unavailable'
            when phs.status = 'unavailable' then 'unknown'
            when phs.status in ('available', 'degraded') then phs.status
            else cr.availability end,
          cost_state = case
            when phs.failure_category = 'credit_exhaustion' and phs.status = 'unavailable'
                 and (phs.unavailable_until is null or phs.unavailable_until > now()) then 'paid_exhausted'
            when phs.status = 'available' and cr.cost_state = 'paid_exhausted' then 'unknown'
            else cr.cost_state end,
          metadata = coalesce(cr.metadata, '{}'::jsonb) || jsonb_build_object('provider_health_synced_at', now(),
            'provider_health', jsonb_build_object('status', phs.status, 'failure_category', phs.failure_category,
              'unavailable_until', phs.unavailable_until, 'consecutive_failures', phs.consecutive_failures)),
          updated_at = now()
      from public.provider_health_state phs
      where cr.kind = 'ai_model' and cr.name = 'fkaios-llm:' || phs.provider
      returning cr.name, cr.availability, cr.cost_state)
  select coalesce(jsonb_agg(jsonb_build_object('name', name, 'availability', availability, 'cost_state', cost_state)), '[]'::jsonb) into synced from upd;

  -- (c) NEW: silent worker death. An active run with no heartbeat for 3h is
  -- marked 'stalled' (cause UNKNOWN - not claimed to be a quota event), its
  -- allocations released and a handoff reconstructed if it left none.
  for stale_run in
    select id from public.worker_runs
    where status = 'active' and coalesce(last_heartbeat_at, started_at) < now() - stall_after
  loop
    begin
      recovered := recovered || public.fkaios_recover_worker_run(stale_run.id, 'stalled', 'worker_inactive',
        'no heartbeat for more than ' || stall_after || ' - worker presumed ended (usage/session limit, crash or session close; cause not observable to FKAIOS)');
    exception when others then null;
    end;
  end loop;

  -- (d) EXISTING: stale-dispatch recovery for allocations never bound to a run.
  reaped := '[]'::jsonb;
  reaped_count := 0;
  for stale_alloc in
    select a.id from public.orchestration_task_allocations a
    join public.capability_registry cr on cr.name = a.capability_name
    where a.status = 'dispatched'
      and cr.kind = 'coding_worker'
      and a.dispatched_at < now() - interval '8 hours'
  loop
    begin
      perform public.fkaios_reap_stale_dispatch(stale_alloc.id, 'fkaios_master_controller_tick: dispatched_at older than 8h with no progress - auto-reaped, no manual observation required');
      reaped := reaped || to_jsonb(stale_alloc.id);
      reaped_count := reaped_count + 1;
    exception when others then
      null;
    end;
  end loop;

  select coalesce(jsonb_agg(jsonb_build_object('name', w.name, 'availability', w.availability) order by w.priority), '[]'::jsonb)
    into workers
    from public.fkaios_select_worker(array['repo_edit'], '{}'::text[], null::numeric, null::numeric, null::text) w;
  select count(*) into pending_count from public.orchestration_task_allocations a
    join public.capability_registry c on c.name = a.capability_name
    where a.status = 'allocated' and c.kind = 'coding_worker';

  -- EXISTING (extended): authoritative "what's next" per objective.
  for obj_id in select distinct objective_id from public.fkaios_acceptance_matrix loop
    select
      count(*) as total,
      count(*) filter (where status = 'verified') as verified,
      count(*) filter (where status = 'human_blocked') as human_blocked,
      count(*) filter (where status not in ('verified', 'human_blocked')) as open
      into counts
      from public.fkaios_acceptance_matrix where objective_id = obj_id;

    select requirement_no, description, priority, status into next_req
      from public.fkaios_acceptance_matrix
      where objective_id = obj_id and status not in ('verified', 'human_blocked')
      order by
        case priority when 'critical' then 1 when 'high' then 2 when 'normal' then 3 when 'low' then 4 else 5 end asc,
        requirement_no asc
      limit 1;

    select count(*) into active_runs from public.worker_runs where objective_id = obj_id and status = 'active';
    select id into open_handoff from public.worker_handoffs where objective_id = obj_id and status = 'open' order by created_at desc limit 1;

    if next_req.requirement_no is null then
      state_text := case when counts.human_blocked > 0
        then 'complete_except_human_blocked'
        else 'complete' end;
      action_text := case when counts.human_blocked > 0
        then counts.human_blocked || ' requirement(s) remain human_blocked - nothing more is autonomously executable. A human must act on those before this objective can be fully VERIFIED.'
        else 'All ' || counts.total || ' requirement(s) are VERIFIED. Engineering objective complete - no further autonomous work is available.' end;
    elsif jsonb_array_length(workers) = 0 then
      -- Genuinely blocked on capacity: objective stays open, state preserved.
      state_text := 'blocked_awaiting_worker';
      action_text := 'BLOCKED: no authorized coding worker is currently available (all unavailable/exhausted - see capability_registry.metadata.limit_state). Objective is NOT complete; ' || counts.open ||
        ' requirement(s) open. Next requirement when capacity returns: #' || next_req.requirement_no || ' (' || next_req.priority || ', ' || next_req.status || '): ' || next_req.description ||
        '. The controller re-checks every 15 minutes and restores workers whose reset time has passed.';
    else
      state_text := 'in_progress';
      action_text := 'Next requirement: #' || next_req.requirement_no || ' (' || next_req.priority || ' priority, currently ' || next_req.status || '): ' || next_req.description ||
        '. RESUME: select public.fkaios_worker_checkin(''' || (workers->0->>'name') || ''') - returns this state, accepts the latest open handoff'
        || case when open_handoff is not null then ' (' || open_handoff || ')' else '' end
        || ' with its continuation instruction, and lists pending coding allocations (' || pending_count || ').'
        || case when active_runs > 0 then ' NOTE: ' || active_runs || ' worker run(s) already active on this objective - coordinate, do not duplicate.' else '' end;
    end if;

    insert into public.fkaios_controller_state (
      objective_id, tick_count, last_tick_at, stale_reaped_last_tick,
      next_requirement_no, next_requirement_description, next_requirement_priority, next_requirement_status,
      next_action, open_requirement_count, human_blocked_count, verified_count, total_count,
      objective_state, updated_at,
      active_run_count, recovered_runs_last_tick, available_workers, pending_worker_allocation_count, latest_open_handoff_id
    ) values (
      obj_id, 1, now(), reaped,
      next_req.requirement_no, next_req.description, next_req.priority, next_req.status,
      action_text, counts.open, counts.human_blocked, counts.verified, counts.total,
      state_text, now(),
      active_runs, recovered, workers, pending_count, open_handoff
    )
    on conflict (objective_id) do update set
      tick_count = fkaios_controller_state.tick_count + 1,
      last_tick_at = now(),
      stale_reaped_last_tick = excluded.stale_reaped_last_tick,
      next_requirement_no = excluded.next_requirement_no,
      next_requirement_description = excluded.next_requirement_description,
      next_requirement_priority = excluded.next_requirement_priority,
      next_requirement_status = excluded.next_requirement_status,
      next_action = excluded.next_action,
      open_requirement_count = excluded.open_requirement_count,
      human_blocked_count = excluded.human_blocked_count,
      verified_count = excluded.verified_count,
      total_count = excluded.total_count,
      objective_state = excluded.objective_state,
      updated_at = now(),
      active_run_count = excluded.active_run_count,
      recovered_runs_last_tick = excluded.recovered_runs_last_tick,
      available_workers = excluded.available_workers,
      pending_worker_allocation_count = excluded.pending_worker_allocation_count,
      latest_open_handoff_id = excluded.latest_open_handoff_id
    returning * into tick_row;

    perform public.fkaios_log_event(obj_id, null, 'CONTROLLER_TICK', jsonb_build_object(
      'tick_count', tick_row.tick_count, 'state', state_text, 'next_requirement_no', next_req.requirement_no,
      'open_count', counts.open, 'verified_count', counts.verified, 'human_blocked_count', counts.human_blocked,
      'stale_reaped_this_tick', reaped, 'recovered_runs', recovered, 'workers_restored', restored,
      'available_workers', workers, 'active_runs', active_runs
    ));

    results := results || jsonb_build_object(
      'objective_id', obj_id, 'state', state_text, 'next_requirement_no', next_req.requirement_no,
      'next_action', action_text, 'open_count', counts.open, 'verified_count', counts.verified,
      'human_blocked_count', counts.human_blocked, 'total_count', counts.total
    );
  end loop;

  return jsonb_build_object('objectives_processed', jsonb_array_length(results), 'stale_reaped_total', reaped_count,
    'recovered_runs', recovered, 'workers_restored', restored, 'ai_models_synced', synced,
    'available_workers', workers, 'results', results);
end $$;
revoke all on function public.fkaios_master_controller_tick() from public, anon, authenticated;
