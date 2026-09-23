-- orchestration_tasks_status_check never allowed 'assigned' as a value, even
-- though work-engine.ts's allocateTask() has always set status:'assigned'
-- after creating a task's ai_jobs row, and executive-planner.ts's
-- getBrainState() / objective-loop.ts's runObjectiveLoop() both already read
-- and filter on status='assigned' expecting it to be reachable (Brain State's
-- runningTasks.assignedTasks count, and the objective loop's "still active"
-- check). The mismatch meant allocateTask()'s status update silently violated
-- the CHECK constraint and did nothing — discovered via the V1 mandate's
-- Task #20 end-to-end test: two real tasks were successfully allocated to
-- ai_jobs (confirmed via execution_log's "work-engine allocate_task success"
-- entries and real ai_jobs rows), yet orchestration_tasks.status stayed
-- 'pending' the entire time. Same failure shape as the ai_jobs 'retry'
-- status gap fixed in 20260727110000_ai_jobs_allow_retry_status.sql.
-- Purely additive: widens the allowed value set, touches no existing rows,
-- matches behavior the code (and the Brain's own state reporting) already
-- assumed.

ALTER TABLE public.orchestration_tasks DROP CONSTRAINT orchestration_tasks_status_check;
ALTER TABLE public.orchestration_tasks ADD CONSTRAINT orchestration_tasks_status_check
  CHECK (status = ANY (ARRAY['pending', 'assigned', 'done', 'rework', 'approved']));
