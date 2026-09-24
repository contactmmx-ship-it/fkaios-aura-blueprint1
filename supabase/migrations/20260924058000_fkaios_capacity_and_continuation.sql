-- FKAIOS Autonomous Continuation Mechanism (master spec: "the complete
-- autonomous chain has NOT yet been proven" - this migration builds the
-- exact missing bridge, reusing existing tables/functions throughout).
--
-- AUDIT FINDING (this session, before writing anything): worker_handoffs +
-- fkaios_worker_step + fkaios_select_worker already implement
-- checkpoint -> handoff -> "pick a worker" as real, working SQL. What is
-- genuinely missing:
--   1. fkaios_select_worker has NO capacity/usage awareness at all (master
--      spec Part 7/13's 79% rule) - it ranks by availability/cost/priority
--      only. FIXED below: optional projected-usage band, computed by a new
--      pure fkaios_capacity_band() function.
--   2. worker_handoffs has no dedicated, SELF-GENERATED continuation
--      instruction field, and no milestone_id/task_id/acceptance_criteria/
--      verification_state/retry_count/parent_handoff_id/capacity_state -
--      several of the durable-continuation-contract fields the spec lists
--      were only ever crammed into free-text columns. FIXED below: real
--      columns + fkaios_generate_continuation_instruction(), which formats
--      the record into ready-to-send text FROM THE DATA, not authored by a
--      human each time.
--   3. "Automatically deliver the continuation instruction to the next
--      worker" for a kind='ai_model' capability already exists (this
--      build's fkaios-autonomous-controller.ts). For kind='coding_worker'
--      (a Claude Code session, like the one writing this), there is no
--      HTTP-invocable path from an edge function - unchanged architectural
--      fact, documented repeatedly this build. What IS newly real: this
--      interactive session itself holds tools (Claude Code Remote's
--      create_session/create_trigger/send_later) that CAN start another
--      session or schedule automatic resumption of this one - a capability
--      no edge function has. That is tested live in this session's own
--      transcript, not in SQL (nothing to migrate for it) - see the
--      acceptance matrix requirement this migration's evidence references.

-- ── 1. Capacity band: pure, real, independently testable ────────────────
-- Bands and defaults exactly per master spec Part 7/12: GREEN 0-60, NORMAL
-- 60-75, CAUTION 75-85, HIGH_RISK 85-95, CRITICAL 95-100. Thresholds are a
-- parameter (jsonb), not hardcoded, per "make thresholds configurable."
create or replace function public.fkaios_capacity_band(
  current_pct numeric,
  estimated_pct numeric default 0,
  thresholds jsonb default '{"normal":60,"caution":75,"high_risk":85,"critical":95}'::jsonb
) returns jsonb language sql immutable as $$
  select jsonb_build_object(
    'current_pct', current_pct,
    'estimated_pct', estimated_pct,
    'projected_pct', current_pct + estimated_pct,
    'band', case
      when current_pct + estimated_pct >= coalesce((thresholds->>'critical')::numeric, 95) then 'critical'
      when current_pct + estimated_pct >= coalesce((thresholds->>'high_risk')::numeric, 85) then 'high_risk'
      when current_pct + estimated_pct >= coalesce((thresholds->>'caution')::numeric, 75) then 'caution'
      when current_pct + estimated_pct >= coalesce((thresholds->>'normal')::numeric, 60) then 'normal'
      else 'green'
    end,
    -- Not a bare band->action lookup: CAUTION is a soft preference
    -- (master spec's own worked example keeps a small 2%-task on a 79%
    -- worker, landing at 81% = caution), HIGH_RISK/CRITICAL are a real
    -- "route it elsewhere if you can."
    'recommendation', case
      when current_pct + estimated_pct >= coalesce((thresholds->>'high_risk')::numeric, 85) then 'reassign_if_alternative_exists'
      when current_pct + estimated_pct >= coalesce((thresholds->>'caution')::numeric, 75) then 'prefer_alternative_for_new_work'
      else 'keep_current_worker'
    end,
    'thresholds', thresholds
  )
$$;
revoke all on function public.fkaios_capacity_band(numeric, numeric, jsonb) from public, anon, authenticated;

-- ── 2. fkaios_select_worker gains OPTIONAL capacity awareness ───────────
-- Backward compatible: p_current_usage_pct/p_estimated_task_pct default
-- null, meaning "unknown, do not filter on it" - the exact previous
-- behavior for a caller that has no usage info to report (most callers,
-- honestly, since no live introspection API for a worker's own quota
-- exists - see this migration's header). When a caller DOES report its own
-- projected usage, a worker whose recommendation is reassign_if_alternative
-- is pushed to the back of the ranking rather than hard-excluded (a lone
-- capable worker over threshold is still returned - "no alternative exists"
-- is a real, common case, not a dead end).
create or replace function public.fkaios_select_worker(
  required text[],
  exclude text[] default '{}'::text[],
  p_current_usage_pct numeric default null,
  p_estimated_task_pct numeric default null,
  p_caller_name text default null
) returns table(name text, provider text, availability text, cost_state text, priority integer, capacity_band text, capacity_recommendation text)
language sql stable as $$
  select r.name, r.provider, r.availability, r.cost_state, r.priority,
    case when r.name = p_caller_name and p_current_usage_pct is not null
      then (public.fkaios_capacity_band(p_current_usage_pct, coalesce(p_estimated_task_pct, 0))->>'band')
      else null end as capacity_band,
    case when r.name = p_caller_name and p_current_usage_pct is not null
      then (public.fkaios_capacity_band(p_current_usage_pct, coalesce(p_estimated_task_pct, 0))->>'recommendation')
      else null end as capacity_recommendation
  from public.capability_registry r
  where r.kind in ('coding_worker','ai_model')
    and r.handoff_support
    and r.capabilities @> required
    and not (r.name = any(exclude))
    and r.availability <> 'unavailable'
    and r.cost_state <> 'paid_exhausted'
  order by
    -- A caller over its own reassign-worthy threshold ranks LAST among
    -- otherwise-equal candidates - "prefer another worker" made real,
    -- without ever excluding the only capable one.
    case when r.name = p_caller_name and p_current_usage_pct is not null
      and (public.fkaios_capacity_band(p_current_usage_pct, coalesce(p_estimated_task_pct, 0))->>'recommendation') = 'reassign_if_alternative_exists'
      then 1 else 0 end,
    case r.availability when 'available' then 0 when 'degraded' then 1 else 2 end,
    (r.cost_state in ('free','paid_active')) desc,
    r.priority asc
$$;
revoke all on function public.fkaios_select_worker(text[], text[], numeric, numeric, text) from public, anon, authenticated;
-- The old 2-arg signature is a real overload (Postgres dispatches by
-- argument count/types), not a replacement - anything already calling
-- fkaios_select_worker(required, exclude) keeps working unchanged.

-- ── 3. Durable continuation contract: missing fields, additive ──────────
alter table public.worker_handoffs
  add column if not exists milestone_id uuid references public.orchestration_milestones(id),
  add column if not exists task_id uuid references public.orchestration_tasks(id),
  add column if not exists acceptance_criteria text,
  add column if not exists verification_state text,
  add column if not exists retry_count integer not null default 0,
  add column if not exists parent_handoff_id uuid references public.worker_handoffs(id),
  add column if not exists capacity_state jsonb,
  add column if not exists continuation_instruction text;

-- ── 4. Self-generated continuation instruction ───────────────────────────
-- Formats the handoff's OWN persisted fields into the exact structure
-- master spec Part 4 asks for (what's done, what must not be repeated,
-- what remains, acceptance criteria, what failed, first action, how to
-- verify, how to hand off again) - generated FROM the row, not typed by a
-- human, and stored back onto the row so it is itself part of the durable
-- record the next worker reads. Idempotent - safe to regenerate.
create or replace function public.fkaios_generate_continuation_instruction(p_handoff_id uuid)
returns text language plpgsql as $$
declare
  h record;
  txt text;
begin
  select * into h from public.worker_handoffs where id = p_handoff_id;
  if h.id is null then raise exception 'FKAIOS: handoff % does not exist', p_handoff_id; end if;

  txt :=
    'FKAIOS CONTINUATION INSTRUCTION (self-generated from worker_handoffs ' || h.id || ', parent_handoff_id ' || coalesce(h.parent_handoff_id::text, 'none') || ')' || E'\n\n' ||
    'OBJECTIVE: ' || coalesce(h.current_task, '(not recorded)') || E'\n' ||
    'PROJECT/BRAND: ' || coalesce(h.project, '?') || ' / ' || coalesce(h.brand, '?') || E'\n\n' ||
    'ALREADY COMPLETED (do not repeat): ' || coalesce(h.completed_work::text, '{}') || E'\n\n' ||
    'PARTIAL WORK: ' || coalesce(h.partial_work::text, '[]') || E'\n\n' ||
    'REMAINING WORK: ' || coalesce(h.pending_work::text, '{}') || E'\n\n' ||
    'ACCEPTANCE CRITERIA: ' || coalesce(h.acceptance_criteria, '(not recorded - check the acceptance matrix / objective row directly)') || E'\n\n' ||
    'WHAT FAILED / BLOCKERS: ' || coalesce(h.blockers::text, '{}') || E'\n\n' ||
    'DECISIONS ALREADY MADE (do not re-litigate): ' || coalesce(h.decisions::text, '{}') || E'\n\n' ||
    'FROM WORKER: ' || coalesce(h.from_worker, '?') || ' (' || coalesce(h.from_provider, '?') || '/' || coalesce(h.from_model, '?') || ')' || E'\n' ||
    'CAPACITY STATE AT HANDOFF: ' || coalesce(h.capacity_state::text, '(not reported)') || E'\n' ||
    'RETRY COUNT: ' || h.retry_count::text || E'\n\n' ||
    'FIRST ACTION: ' || coalesce(h.next_action, '(not recorded)') || E'\n\n' ||
    'HOW TO VERIFY: ' || coalesce(h.verification_state, 'Check current_state/evidence fields on this handoff, then confirm against live repo/database state directly - do not trust this record blindly (protocol rule).') || E'\n\n' ||
    'HOW TO HAND OFF AGAIN IF NEEDED: insert a new worker_handoffs row with parent_handoff_id=' || h.id || ', then call fkaios_generate_continuation_instruction() on it.' || E'\n\n' ||
    'FILES CHANGED: ' || coalesce(array_to_string(h.files_changed, ', '), '(none recorded)') || E'\n' ||
    'COMMITS: ' || coalesce(array_to_string(h.commits, ', '), '(none recorded)');

  update public.worker_handoffs set continuation_instruction = txt where id = p_handoff_id;
  return txt;
end $$;
revoke all on function public.fkaios_generate_continuation_instruction(uuid) from public, anon, authenticated;
