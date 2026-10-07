-- FKAIOS backlog cleanup (audit 2026-10-07, docs/FKAIOS_AUDIT_2026-10-07.md, step 4).
--
-- Data-only, idempotent, and makes no founder decision. Every row it changes is
-- marked with the reason, so the history stays auditable. It does not touch
-- ai_jobs (including the historical research backlog), tasks, completed
-- work, or any approval that is the only one of its kind.
--
-- A. Duplicate proposal approvals. Between 18 and 22 Sep a loop re-drafted the
--    same pricing proposal for the same lead every ~30 minutes, filing 269
--    'price_and_send_proposal' approvals for 5 leads. Only the newest approval
--    per lead stays pending. The older copies become 'expired', which is not a
--    decision about the proposal.
-- B. Founder Brain objectives that started themselves without approval
--    (created after 2026-10-06, risk assessed low/medium, so the old
--    high/critical-only gate let them run). Under the new rule (founder-brain.ts
--    createTask, autonomous: true), the newest becomes a pending proposal in
--    the Decision Center and the older ones are superseded, matching the
--    existing single-active-proposal convention.
-- C. Projects still 'working' (or another non-terminal status) whose objective
--    already ended become 'failed', with the reason recorded. For a completed
--    objective, this only happens when it has a 'complete' project, which is
--    what the Console shows. Projects are never set to 'complete' here
--    (trg_fkaios_task_terminal_guard would then mark their tasks done).

set local lock_timeout = '5s';

-- A ─────────────────────────────────────────────────────────────────────────
with ranked as (
  select id, row_number() over (partition by payload->>'lead_id' order by created_at desc) rn
  from public.approvals
  where status = 'pending' and action_type = 'price_and_send_proposal' and payload ? 'lead_id'
)
update public.approvals a
set status = 'expired',
    decided_by = 'system:audit-2026-10-07',
    decided_at = now(),
    reason = left('[Expired 2026-10-07: duplicate re-draft; the newest proposal for this lead is still pending] ' || coalesce(a.reason, ''), 4000)
from ranked r
where a.id = r.id and r.rn > 1;

-- B ─────────────────────────────────────────────────────────────────────────
do $$
declare
  newest record;
  new_approval uuid;
begin
  select id, raw_request, department_code, risk_level into newest
  from public.orchestrator_requests
  where requested_by = 'founder-brain' and status = 'processing'
    and action_taken is null and classification is null and approval_id is null
    and created_at >= '2026-10-06'
  order by created_at desc
  limit 1;

  if newest.id is null then return; end if;

  update public.orchestrator_requests
  set status = 'failed',
      action_taken = 'Founder Brain request superseded by newer active gate',
      result_summary = 'Self-generated Founder Brain objective started without founder approval; superseded on 2026-10-07 (audit step 4). Newest proposal ' || newest.id || ' awaits approval instead.'
  where requested_by = 'founder-brain' and status = 'processing'
    and action_taken is null and classification is null and approval_id is null
    and created_at >= '2026-10-06' and id <> newest.id;

  insert into public.approvals (department_code, action_type, payload, risk_level, reason)
  values (newest.department_code, 'founder_brain_task',
          jsonb_build_object('orchestrator_request_id', newest.id, 'description', newest.raw_request),
          coalesce(newest.risk_level, 'low'),
          'Founder Brain proposed this objective itself (assessed ' || coalesce(newest.risk_level, 'low') || ' risk); it starts only if the founder approves')
  returning id into new_approval;

  update public.orchestrator_requests
  set status = 'awaiting_approval', approval_id = new_approval
  where id = newest.id;
end $$;

-- C ─────────────────────────────────────────────────────────────────────────
with stale as (
  select p.id, r.id as objective_id, r.status as objective_status
  from public.orchestration_projects p
  join public.orchestrator_requests r
    on r.id::text = substring(p.request from '^\[objective:([0-9a-f-]{36})\]')
  where p.status in ('planning', 'working', 'reviewing', 'reworking', 'merging')
    and (r.status = 'failed'
         or (r.status = 'completed' and exists (
               select 1 from public.orchestration_projects c
               where c.request like '[objective:' || r.id || ']%' and c.status = 'complete')))
)
update public.orchestration_projects p
set status = 'failed',
    error_message = left('Archived 2026-10-07 (audit step 4): objective ' || s.objective_id || ' is ' || s.objective_status
      || '; this project was left ' || p.status || '. ' || coalesce(p.error_message, ''), 4000)
from stale s
where p.id = s.id;
