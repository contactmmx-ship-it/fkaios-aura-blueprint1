-- Real gap found while building a controlled failure-recovery test
-- (acceptance matrix requirement #23): fkaios_dispatch_task marks an
-- allocation 'dispatched' and fkaios_complete_task requires status in
-- ('dispatched','running') to finish it - but if the worker that received
-- the dispatch fails/is interrupted/never calls fkaios_complete_task, the
-- allocation is stuck at 'dispatched' forever. fkaios_dispatch_task itself
-- refuses to re-dispatch anything not in 'allocated' status (by design -
-- see 20260924056000's own comment), so there was no way back.
--
-- ai_jobs already has exactly this pattern solved (reap_orphaned_ai_jobs,
-- a cron reaper for stale 'running' jobs) - this reuses that same idea for
-- orchestration_task_allocations rather than inventing a new concept.
-- Deliberately NOT a cron job here (unlike ai_jobs' reaper): a dispatched
-- allocation might legitimately be mid-work for a long time (an
-- interactive coding-worker session), so an automatic time-based reap
-- would risk yanking real, live work. This is callable on-demand by a
-- worker/controller that has independently confirmed the assigned worker
-- actually failed (e.g. observed session termination), not a background
-- sweep.
create or replace function public.fkaios_reap_stale_dispatch(p_allocation_id uuid, p_reason text)
returns jsonb language plpgsql as $$
declare
  a record;
  obj_id uuid;
begin
  select * into a from public.orchestration_task_allocations where id = p_allocation_id;
  if a.id is null then raise exception 'FKAIOS: allocation % does not exist', p_allocation_id; end if;
  if a.status not in ('dispatched', 'running') then
    raise exception 'FKAIOS: allocation % is % - can only reap a dispatched/running allocation', p_allocation_id, a.status;
  end if;

  select (regexp_match(p.request, '\[objective:([0-9a-f-]+)\]'))[1]::uuid into obj_id
    from public.orchestration_tasks tsk
    join public.orchestration_projects p on p.id = tsk.project_id
    where tsk.id = a.task_id;

  update public.orchestration_task_allocations
    set status = 'allocated', dispatched_at = null
    where id = p_allocation_id;

  perform public.fkaios_log_event(obj_id, a.task_id, 'WORKER_FAILED', jsonb_build_object('allocation_id', p_allocation_id, 'reason', p_reason));

  return jsonb_build_object('allocation_id', p_allocation_id, 'status', 'allocated', 'reason', p_reason, 'reapable_again_via', 'fkaios_dispatch_task');
end $$;
revoke all on function public.fkaios_reap_stale_dispatch(uuid, text) from public, anon, authenticated;
