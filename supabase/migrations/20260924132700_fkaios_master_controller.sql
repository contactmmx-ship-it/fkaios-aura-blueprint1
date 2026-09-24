-- FKAIOS MASTER CONTROLLER — durable, cron-driven continuation for the
-- engineering capability objective (and any future objective tracked in
-- fkaios_acceptance_matrix), closing the gap a direct audit confirmed:
--
-- AUDIT FINDINGS (read from the live source/DB before writing this, not
-- assumed):
--   1. objective advancement    -> runObjectiveLoop() + cognitiveTick(),
--      already cron-driven every 15 min via founder-brain-tick. REAL, KEEP.
--   2. next-task selection      -> planObjective() (executive-planner.ts),
--      invoked automatically when cognitiveTick assigns a new objective.
--      REAL, KEEP.
--   3. capability allocation    -> autoAllocateReadyTasks() in
--      fkaios-autonomous-controller.ts, cron-driven, capability-agnostic
--      (works for both ai_model and coding_worker tasks). REAL, KEEP.
--   4. worker dispatch/execute/verify for kind='ai_model'
--                                -> autoDispatchAiModelWork(), cron-driven,
--      fully autonomous (dispatch -> reason() -> fkaios_complete_task,
--      whose own verification rules apply unchanged). REAL, KEEP.
--   5. worker dispatch/execute/verify for kind='coding_worker'
--                                -> NOTHING. Explicitly and honestly scoped
--      OUT in fkaios-autonomous-controller.ts's own header comment: "no
--      HTTP-invocable execution path from an edge function... requires a
--      human or an explicitly-started worker session." Confirmed still
--      true - the harness's own "Create Unsafe Agents" restriction (hit
--      twice this build for repeated/successive session-spawning) means an
--      edge function cannot start a new Claude Code session either. This
--      is a real architectural boundary, not fixed by this migration, and
--      not fabricated as fixed.
--   6. failure recovery         -> fkaios_reap_stale_dispatch() exists
--      (20260924059000) but nothing calls it automatically - confirmed by
--      grep, it is on-demand only. THIS is a real, closeable gap: a stuck
--      coding_worker dispatch (session died/was interrupted mid-task)
--      previously stayed stuck forever unless a human/session happened to
--      notice and call the function by hand.
--   7. continuation             -> previously ONLY this conversation's own
--      memory (what task to pick next) or send_later (session-bound,
--      fragile - dies with the session). THIS is the other real gap the
--      Founder explicitly named: "the controller must make FKAIOS itself
--      responsible... rather than depending on Claude remembering."
--
-- WHAT THIS MIGRATION ACTUALLY CLOSES (smallest durable change, not a
-- rewrite): (6) automatic stale-dispatch recovery for coding_worker
-- allocations, wired into the existing 15-minute cron tick, and (7) a
-- single DB-resident, continuously self-correcting "what's next" pointer
-- per objective (fkaios_controller_state) that ANY session - this one,
-- after a restart, or a brand new one Rajeev starts - can read as the
-- authoritative source of truth, instead of relying on chat history or a
-- specific handoff row someone wrote once. send_later stays exactly what
-- the Founder asked for it to be: a fallback delivery channel that wakes a
-- session to go read this state, not the state itself.
--
-- WHAT THIS DOES NOT CLOSE, STATED HONESTLY: it does not and cannot make
-- FKAIOS itself spawn a new Claude Code session to write code for the next
-- requirement - that remains genuinely human/session-initiated, exactly
-- like the existing ai_model/coding_worker split already honestly states.
-- No new objective/task system is created - this reads the existing
-- orchestration_tasks/orchestration_task_allocations/fkaios_acceptance_matrix
-- tables and does not duplicate any of them.

-- One new, additive event type - the other 20 already cover task/worker
-- lifecycle events, none of them fit "the controller itself ran a tick".
alter table public.orchestration_activity_events drop constraint orchestration_activity_events_event_type_check;
alter table public.orchestration_activity_events add constraint orchestration_activity_events_event_type_check
  check (event_type = any (array[
    'OBJECTIVE_ACCEPTED','PLAN_CREATED','TASK_READY','TASK_ALLOCATED','WORKER_SELECTED',
    'DISPATCH_STARTED','WORKER_RUNNING','WORKER_RESULT','VERIFICATION_STARTED','VERIFICATION_PASSED',
    'VERIFICATION_FAILED','TASK_COMPLETED','WORKER_FAILED','WORKER_LIMIT_REACHED','HANDOFF_STARTED',
    'HANDOFF_COMPLETED','TASK_REASSIGNED','NEXT_TASK_ALLOCATED','HUMAN_BLOCKED','OBJECTIVE_COMPLETED',
    'CONTROLLER_TICK'
  ]));

-- Single authoritative row per objective - overwritten each tick, not
-- accumulated, so reading it never requires picking "the latest one out of
-- many" the way a handoff-row search does.
create table if not exists public.fkaios_controller_state (
  objective_id uuid primary key references public.orchestrator_requests(id),
  tick_count integer not null default 0,
  last_tick_at timestamptz not null default now(),
  stale_reaped_last_tick jsonb not null default '[]'::jsonb,
  next_requirement_no integer,
  next_requirement_description text,
  next_requirement_priority text,
  next_requirement_status text,
  next_action text not null,
  open_requirement_count integer not null default 0,
  human_blocked_count integer not null default 0,
  verified_count integer not null default 0,
  total_count integer not null default 0,
  objective_state text not null default 'in_progress',
  updated_at timestamptz not null default now()
);
alter table public.fkaios_controller_state enable row level security;
revoke all on public.fkaios_controller_state from public, anon, authenticated;

comment on table public.fkaios_controller_state is
  'FKAIOS Master Controller: one row per objective, overwritten every cron tick by fkaios_master_controller_tick(). Authoritative "what happens next" - read this, do not infer it from chat history or a single old handoff row.';

create or replace function public.fkaios_master_controller_tick()
returns jsonb language plpgsql as $$
declare
  obj_id uuid;
  reaped jsonb;
  reaped_count integer;
  stale_alloc record;
  next_req record;
  counts record;
  action_text text;
  state_text text;
  results jsonb := '[]'::jsonb;
  tick_row record;
begin
  -- (6) STALE-DISPATCH RECOVERY, now automatic: any coding_worker
  -- allocation dispatched more than 8 hours ago and never progressed past
  -- 'dispatched' (never reached running/completed/failed) is treated as a
  -- dead session, exactly the scenario fkaios_reap_stale_dispatch was built
  -- for. 8 hours is deliberately generous - long enough that no genuine
  -- single-task interactive session is mistaken for dead, short enough to
  -- actually provide recovery instead of leaving a task stuck indefinitely.
  -- Restricted to 'dispatched' only (not 'running', which this table's
  -- schema does not actually distinguish from 'dispatched' via any separate
  -- heartbeat column) - the conservative choice from the reap function's
  -- own migration comment ("risk yanking real, live work") still applies to
  -- an automatic caller even more than a human-invoked one.
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
      -- A single bad row must not stop the tick from computing the
      -- next-requirement pointer below - best-effort, same pattern as
      -- founder-brain-tick's own Promise.allSettled callers.
      null;
    end;
  end loop;

  -- (7) AUTHORITATIVE "WHAT'S NEXT", recomputed fresh every tick for every
  -- objective currently tracked in the acceptance matrix - not hardcoded to
  -- one objective id, so a future objective gets the same treatment for
  -- free without another migration.
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

    if next_req.requirement_no is null then
      state_text := case when counts.human_blocked > 0
        then 'complete_except_human_blocked'
        else 'complete' end;
      action_text := case when counts.human_blocked > 0
        then counts.human_blocked || ' requirement(s) remain human_blocked - nothing more is autonomously executable. A human must act on those before this objective can be fully VERIFIED.'
        else 'All ' || counts.total || ' requirement(s) are VERIFIED. Engineering objective complete - no further autonomous work is available.' end;
    else
      state_text := 'in_progress';
      action_text := 'Next requirement: #' || next_req.requirement_no || ' (' || next_req.priority || ' priority, currently ' || next_req.status || '): ' || next_req.description ||
        '. Call fkaios_generate_continuation_instruction on the latest open worker_handoffs row for this objective for full context, or read this requirement''s own row in fkaios_acceptance_matrix directly.';
    end if;

    insert into public.fkaios_controller_state (
      objective_id, tick_count, last_tick_at, stale_reaped_last_tick,
      next_requirement_no, next_requirement_description, next_requirement_priority, next_requirement_status,
      next_action, open_requirement_count, human_blocked_count, verified_count, total_count,
      objective_state, updated_at
    ) values (
      obj_id, 1, now(), reaped,
      next_req.requirement_no, next_req.description, next_req.priority, next_req.status,
      action_text, counts.open, counts.human_blocked, counts.verified, counts.total,
      state_text, now()
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
      updated_at = now()
    returning * into tick_row;

    perform public.fkaios_log_event(obj_id, null, 'CONTROLLER_TICK', jsonb_build_object(
      'tick_count', tick_row.tick_count, 'state', state_text, 'next_requirement_no', next_req.requirement_no,
      'open_count', counts.open, 'verified_count', counts.verified, 'human_blocked_count', counts.human_blocked,
      'stale_reaped_this_tick', reaped
    ));

    results := results || jsonb_build_object(
      'objective_id', obj_id, 'state', state_text, 'next_requirement_no', next_req.requirement_no,
      'next_action', action_text, 'open_count', counts.open, 'verified_count', counts.verified,
      'human_blocked_count', counts.human_blocked, 'total_count', counts.total
    );
  end loop;

  return jsonb_build_object('objectives_processed', jsonb_array_length(results), 'stale_reaped_total', reaped_count, 'results', results);
end $$;
revoke all on function public.fkaios_master_controller_tick() from public, anon, authenticated;

-- Schedules the tick directly via pg_cron, every 15 minutes (matching
-- founder-brain-tick's own cadence). Pure in-database SQL call - no HTTP
-- hop, no edge function, no Deno runtime dependency, so this cannot fail
-- from an Edge Function cold-start/timeout/auth issue. This is deliberately
-- NOT wired through founder-brain-tick's edge function: that bundle has an
-- 11-file, ~290KB transitive dependency closure (founder-brain.ts,
-- executive-planner.ts, work-engine.ts, objective-loop.ts, llm-router.ts,
-- company-os.ts, fact-grounding.ts, objective-rerun.ts, cognitive-budget.ts,
-- fkaios-autonomous-controller.ts, plus the entrypoint) that a manual
-- redeploy would have to reproduce byte-for-byte to avoid silently shipping
-- a broken/truncated file (a real mistake made and caught earlier this same
-- build session on founder-objective's v6 deploy) - unnecessary risk for a
-- pure-SQL function with zero HTTP/LLM/Deno dependencies of its own. Same
-- pg_cron mechanism the codebase already trusts for
-- 'fkaios-founder-brain-tick' (cron.job jobid 39) and 'ai-jobs-orphan-reaper'
-- - reused, not a new scheduling mechanism.
select cron.schedule(
  'fkaios-master-controller-tick',
  '*/15 * * * *',
  $$select public.fkaios_master_controller_tick();$$
);
