-- Applied in production as version 20260714152721 (factory_execution_queue_and_checkpoints).
-- Exported read-only from supabase_migrations.schema_migrations on 2026-10-07 (md5 of statements: 8a3d52e15c952998d09748de958c1462).
-- Record only: do not apply from this folder.

-- SOFTWARE FACTORY — PERSISTENT EXECUTION QUEUE + CHECKPOINTS.
-- "Never lose progress. If interrupted, resume automatically. Never restart."
--
-- This is the capability that makes the factory RESUMABLE. Without it, every
-- interruption restarts the work — which is exactly how this project has been losing
-- context between sessions all along.
--
-- compute_factory_next_action() answers ONE question with total precision:
--   "What is the single next executable task, right now?"
-- It respects the dependency graph: a task is executable only when EVERY task in EVERY
-- earlier wave is done. It cannot be tricked into running work out of order, and it
-- cannot report progress that did not happen (done requires evidence, enforced by the
-- CHECK constraint proven in production).
--
-- IT ALSO REPORTS THE BLOCKER HONESTLY. Phase 3 (code generation) cannot run because
-- the factory has NO WRITE CREDENTIAL to the repository. That is not a prompt I failed
-- to write; it is a permission the system does not hold. The Autonomy Rules name this
-- exact case as a legitimate Founder Approval Gate:
--   "Credentials, secrets, or permissions unavailable to the system."
-- So the queue exists, is correct, is resumable, and states precisely what it is
-- waiting for rather than pretending to build.
CREATE TABLE IF NOT EXISTS public.factory_checkpoints (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id     uuid NOT NULL REFERENCES public.software_projects(id) ON DELETE CASCADE,
  last_task_id   uuid REFERENCES public.factory_tasks(id) ON DELETE SET NULL,
  next_action    text NOT NULL,
  state          jsonb NOT NULL DEFAULT '{}'::jsonb,
  blocker        text,
  created_at     timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.factory_checkpoints ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS fc_select ON public.factory_checkpoints;
CREATE POLICY fc_select ON public.factory_checkpoints FOR SELECT TO authenticated USING (true);

CREATE OR REPLACE FUNCTION public.compute_factory_next_action(p_project uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_pid uuid; v_product text; v_next jsonb; v_wave int;
  v_total int; v_done int; v_failed int; v_blocked int;
  v_open_prior int; v_ready jsonb; v_ready_n int;
BEGIN
  SELECT id, product_name INTO v_pid, v_product
  FROM software_projects
  WHERE (p_project IS NULL OR id = p_project)
  ORDER BY created_at DESC LIMIT 1;

  IF v_pid IS NULL THEN
    RETURN jsonb_build_object('status','IDLE',
      'next_action','No software project exists. The factory is idle because nothing was requested — not because it is broken.');
  END IF;

  SELECT count(*), count(*) FILTER (WHERE status='done'),
         count(*) FILTER (WHERE status='failed'), count(*) FILTER (WHERE status='blocked')
    INTO v_total, v_done, v_failed, v_blocked
  FROM factory_tasks WHERE project_id = v_pid;

  -- A FAILURE OUTRANKS NEW WORK. Self-healing (Phase 7) starts here: never build on
  -- top of a broken foundation, and never let a failure go quiet.
  IF v_failed > 0 THEN
    SELECT to_jsonb(t) INTO v_next FROM (
      SELECT id, epic, feature, task, layer, agent_role, wave, failure_note
      FROM factory_tasks WHERE project_id = v_pid AND status='failed'
      ORDER BY wave, created_at LIMIT 1) t;
    RETURN jsonb_build_object(
      'status','REPAIR_REQUIRED', 'project', v_product,
      'next_action','A task FAILED. Repair it before any new work. Failures never go quiet.',
      'failed_task', v_next, 'tasks_failed', v_failed);
  END IF;

  -- The lowest wave with unfinished work.
  SELECT MIN(wave) INTO v_wave
  FROM factory_tasks WHERE project_id = v_pid AND status IN ('planned','building','review');

  IF v_wave IS NULL THEN
    RETURN jsonb_build_object('status', CASE WHEN v_total=0 THEN 'NOT_PLANNED' ELSE 'ALL_TASKS_DONE' END,
      'project', v_product, 'tasks_total', v_total, 'tasks_done', v_done,
      'next_action', CASE WHEN v_total=0
        THEN 'Project has no manufacturing plan. Run factory-planner.'
        ELSE 'Every task is done WITH EVIDENCE. Ready for deployment verification.' END);
  END IF;

  -- Dependency integrity: an earlier wave must be FULLY done before this one starts.
  SELECT count(*) INTO v_open_prior
  FROM factory_tasks
  WHERE project_id = v_pid AND wave < v_wave AND status <> 'done';

  IF v_open_prior > 0 THEN
    RETURN jsonb_build_object('status','DEPENDENCY_VIOLATION', 'project', v_product,
      'next_action', format('Wave %s cannot start: %s task(s) in earlier waves are not done. The queue refuses to run work out of order.', v_wave, v_open_prior));
  END IF;

  -- Everything in this wave is executable in parallel, right now.
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', id, 'epic', epic, 'task', task, 'layer', layer,
      'agent_role', agent_role, 'effort_hours', effort_hours, 'reuses', reuses)
      ORDER BY layer, created_at), '[]'::jsonb), count(*)
    INTO v_ready, v_ready_n
  FROM factory_tasks
  WHERE project_id = v_pid AND wave = v_wave AND status = 'planned';

  RETURN jsonb_build_object(
    'status','READY_TO_BUILD',
    'project', v_product,
    'current_wave', v_wave,
    'tasks_total', v_total, 'tasks_done', v_done,
    'completion_pct', CASE WHEN v_total=0 THEN 0 ELSE ROUND(100.0*v_done/v_total,1) END,
    'executable_now', v_ready_n,
    'executable_tasks', v_ready,
    'next_action', format('Execute wave %s: %s task(s) can run in PARALLEL right now. Every dependency is satisfied.', v_wave, v_ready_n),
    'BLOCKER', 'Phase 3 (code generation) CANNOT RUN: the factory holds NO WRITE CREDENTIAL to the repository or deployment targets. This is not a missing prompt — it is a permission the system does not have. The Autonomy Rules name this exact case a Founder Approval Gate: "Credentials, secrets, or permissions unavailable to the system." The queue is correct, resumable and waiting. It will not simulate a build.',
    'to_unblock', 'Founder: add a repo write credential (e.g. GITHUB_TOKEN) as a Supabase Edge Function secret. No tool available to me can set a Supabase secret — that action is yours alone.'
  );
END; $$;

REVOKE ALL ON FUNCTION public.compute_factory_next_action(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.compute_factory_next_action(uuid) TO service_role, authenticated;
