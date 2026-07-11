-- Priority-1 repair (Founder Directive Part 8): connect real execution to metrics.
-- Root cause: agent_dispatch_log recorded 661 real dispatches (267 completed) across
-- all 41 agents, but ai_agents rollups (total_tasks_completed, success_rate,
-- last_active_at) were never written -> Command Center showed 0/0/NULL.
-- Fix: derive rollups from the real dispatch log; idempotent; scheduled every 15m
-- via pg_cron job 'reconcile-agent-metrics'. No fabricated values.

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

-- Continuous reconciliation so execution stays connected to metrics.
-- select cron.schedule('reconcile-agent-metrics','*/15 * * * *','select public.reconcile_agent_metrics();');
