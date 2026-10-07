-- Applied in production as version 20260711115412 (reconcile_agent_metrics_from_dispatch).
-- Exported read-only from supabase_migrations.schema_migrations on 2026-10-07 (md5 of statements: 3af7e5646a2e39b28f8ec875c004260c).
-- Record only: do not apply from this folder.

-- Priority-1 repair: connect real execution (agent_dispatch_log) to the agent
-- rollup metrics the Command Center reads. Idempotent + recomputable. Derives
-- everything from actual dispatch outcomes — no fabricated values. Agents with
-- no outcome-bearing dispatches honestly stay at 0.
create or replace function public.reconcile_agent_metrics()
returns table(agents_updated int, workdays_updated int)
language plpgsql
as $$
declare a_count int; w_count int;
begin
  with agg as (
    select agent_id,
      count(*) filter (where status = 'completed') as completed,
      round(100.0 * count(*) filter (where status = 'completed')
            / nullif(count(*) filter (where status in ('completed','failed')), 0))::int as success_pct,
      max(created_at) as last_active
    from agent_dispatch_log
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
    from agent_dispatch_log
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
$$;

comment on function public.reconcile_agent_metrics() is
  'Reconciles ai_agents rollups (total_tasks_completed, success_rate, last_active_at) and today''s agent_workday completion counts from agent_dispatch_log. Idempotent; run after each dispatch cycle to keep execution and metrics connected.';
