-- Wave 0 clean-up, founder GO 5 Nov 2026. Data only; nothing is deleted. Reversible.
-- Evidence (live audit 5 Nov): 1,333 approvals pending, none newer than 2 days, only 10 ever
-- decided; 20 agents made 0 AI calls in 30 days; lead hunting found no lead since 22 Sep and
-- the proposal engine wrote 269 unsent duplicate drafts.

-- 1. Archive the stale approval backlog (pending and older than 2 days -> expired).
update public.approvals
   set status = 'expired', decided_at = now(),
       reason = coalesce(reason, '') || ' [archived 2026-11-05: wave 0 clean-up, founder GO]'
 where status = 'pending' and created_at < now() - interval '2 days';

-- 2. Mark agents with no AI call in the last 30 days inactive (rows kept).
update public.ai_agents a
   set status = 'inactive', is_active = false, updated_at = now()
 where a.status = 'active'
   and not exists (
     select 1 from public.agent_performance_metrics m
      where m.agent_id::text = a.id::text and m.created_at > now() - interval '30 days');

-- 3. Pause the scheduled jobs that produced nothing (schedules kept; set active = true to resume).
do $$
declare j record;
begin
  for j in select jobid, jobname from cron.job
            where jobname in ('auto-agents-hunt-leads-at','auto-agents-hunt-leads-fk',
                              'proposal-engine-hourly','enrich-new-leads','auto-agents-qualify')
              and active loop
    perform cron.alter_job(job_id := j.jobid, active := false);
  end loop;
end $$;
