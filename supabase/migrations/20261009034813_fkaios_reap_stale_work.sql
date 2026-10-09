-- No work item may stay in a non-terminal state indefinitely without a visible
-- reason. Hourly: a website build still 'generating' after 2 hours, and an
-- orchestration project still 'working'/'merging' with no task created for 72
-- hours, are marked failed with the reason and the time they were reaped.
-- Rows are not deleted; a stalled project can be re-run from its request.
create or replace function public.fkaios_reap_stale_work()
returns jsonb language plpgsql security definer set search_path = public as $f$
declare v_builds int; v_projects int;
begin
  update public.build_projects
     set status = 'failed',
         error_message = coalesce(nullif(error_message, '') || ' | ', '') || 'reaped ' || to_char(now() at time zone 'utc', 'YYYY-MM-DD HH24:MI') || ' UTC: still generating after 2 hours (worker stopped without a result)'
   where status = 'generating' and created_at < now() - interval '2 hours';
  get diagnostics v_builds = row_count;

  update public.orchestration_projects p
     set status = 'failed',
         error_message = coalesce(nullif(p.error_message, '') || ' | ', '') || 'reaped ' || to_char(now() at time zone 'utc', 'YYYY-MM-DD HH24:MI') || ' UTC: ' || p.status || ' with no task activity for 72 hours'
   where p.status in ('working', 'merging')
     and coalesce((select max(t.created_at) from public.orchestration_tasks t where t.project_id = p.id), p.created_at) < now() - interval '72 hours';
  get diagnostics v_projects = row_count;

  return jsonb_build_object('builds_reaped', v_builds, 'projects_reaped', v_projects, 'at', now());
end $f$;
revoke all on function public.fkaios_reap_stale_work() from public, anon, authenticated;

select cron.schedule('fkaios-reap-stale-work', '7 * * * *', $c$select public.fkaios_reap_stale_work()$c$);
