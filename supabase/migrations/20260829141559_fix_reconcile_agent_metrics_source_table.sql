-- Applied directly to production on 2026-08-29 (version 20260829141559) and
-- imported into the repo during the FKAIOS production-fix pass to close the
-- drift between deployed migration history and this repo — see
-- FKAIOS_PRODUCTION_FIX_REPORT.md for the audit that found it missing.
--
-- FIX: reconcile_agent_metrics() was aggregating completion status from
-- agent_dispatch_log, but the current execution pipeline (agent-scheduler ->
-- ai_jobs -> ai-engine) never writes 'completed' to agent_dispatch_log.status
-- (only 'dispatched'/'failed' are ever written there by agent-scheduler's
-- dispatchSchedule()). Actual job outcomes are recorded in ai_jobs.status.
-- This caused total_tasks_completed/success_rate to be zeroed for every
-- agent whose dispatch_log had no historical 'completed' rows (37 of 41
-- agents), every 15 minutes, by this very reconciliation job.
--
-- Minimal fix: swap the source table from agent_dispatch_log to ai_jobs in
-- both CTEs. No other logic changed — same columns, same grouping, same
-- update targets (ai_agents, agent_workday).
--
-- Prior definition saved and verified unchanged immediately before this
-- migration (see conversation record). Rollback: re-apply the prior
-- definition with agent_dispatch_log restored as the source table.
CREATE OR REPLACE FUNCTION public.reconcile_agent_metrics()
 RETURNS TABLE(agents_updated integer, workdays_updated integer)
 LANGUAGE plpgsql
AS $function$
declare a_count int; w_count int;
begin
  with agg as (
    select agent_id,
      count(*) filter (where status = 'completed') as completed,
      round(100.0 * count(*) filter (where status = 'completed')
            / nullif(count(*) filter (where status in ('completed','failed')), 0))::int as success_pct,
      max(created_at) as last_active
    from ai_jobs
    where agent_id is not null
    group by agent_id
  )
  update ai_agents a
    set total_tasks_completed = agg.completed,
        success_rate = coalesce(agg.success_pct, a.success_rate),
        last_active_at = agg.last_active,
        updated_at = now()
  from agg
  where a.id = agg.agent_id;
  get diagnostics a_count = row_count;

  with today as (
    select agent_id,
      count(*) filter (where status = 'completed') as completed_today,
      count(*) as acts_today
    from ai_jobs
    where created_at::date = current_date and agent_id is not null
    group by agent_id
  )
  update agent_workday w
    set tasks_completed = today.completed_today,
        real_activity_count = today.acts_today,
        updated_at = now()
  from today
  where w.agent_id = today.agent_id and w.work_date = current_date;
  get diagnostics w_count = row_count;

  return query select a_count, w_count;
end;
$function$;
