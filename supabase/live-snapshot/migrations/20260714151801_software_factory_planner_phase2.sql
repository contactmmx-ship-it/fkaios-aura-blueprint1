-- Applied in production as version 20260714151801 (software_factory_planner_phase2).
-- Exported read-only from supabase_migrations.schema_migrations on 2026-10-07 (md5 of statements: eece63358961eaebe2e47bca762a771e).
-- Record only: do not apply from this folder.

-- SOFTWARE FACTORY — PHASE 2: THE MANUFACTURING PLANNER.
--
-- Approved architecture -> epics -> features -> tasks -> dependencies -> milestones
-- -> AI employee assignment -> parallel execution waves.
--
-- THE RULE THAT MAKES THIS A FACTORY AND NOT A TO-DO LIST, ENFORCED IN THE SCHEMA:
--   A task may NOT be marked 'done' without EVIDENCE.
--   CHECK (status <> 'done' OR length(trim(coalesce(evidence,''))) > 8)
-- Postgres will physically reject a completion with no artefact behind it. This is the
-- 5,970-fabricated-completions lesson turned into a constraint. A machine cannot lie
-- here even if a future prompt tells it to.
--
-- Tasks are born 'planned'. Nothing self-completes. Phase 3 (code generation) is what
-- will move them, and it does not exist yet — so nothing will move them yet, and the
-- factory will say so rather than pretend.
CREATE TABLE IF NOT EXISTS public.factory_tasks (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    uuid NOT NULL REFERENCES public.software_projects(id) ON DELETE CASCADE,
  epic          text NOT NULL,
  feature       text NOT NULL,
  task          text NOT NULL,
  layer         text NOT NULL CHECK (layer IN ('database','backend','frontend','integration','test','docs','security','deploy')),
  agent_role    text NOT NULL,           -- which AI employee owns it
  wave          integer NOT NULL DEFAULT 1,   -- parallel execution wave; wave N needs wave N-1
  depends_on    text,                    -- human-readable dependency
  effort_hours  numeric,
  reuses        text,                    -- component reused, if any
  status        text NOT NULL DEFAULT 'planned'
                CHECK (status IN ('planned','building','review','done','failed','blocked')),
  evidence      text,                    -- commit / file / URL. MANDATORY to be 'done'.
  failure_note  text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  -- THE CONSTRAINT. No evidence, no completion. Ever.
  CONSTRAINT done_requires_evidence CHECK (
    status <> 'done' OR length(trim(coalesce(evidence, ''))) > 8
  )
);

CREATE INDEX IF NOT EXISTS idx_factory_tasks_project ON public.factory_tasks (project_id, wave, status);
ALTER TABLE public.factory_tasks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ft_select ON public.factory_tasks;
CREATE POLICY ft_select ON public.factory_tasks FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS ft_update ON public.factory_tasks;
CREATE POLICY ft_update ON public.factory_tasks FOR UPDATE TO authenticated USING (true);

-- PHASE 10 (partial): the Software Factory dashboard number. Built now because a
-- manufacturing plan nobody can see is a plan nobody can govern.
CREATE OR REPLACE FUNCTION public.compute_factory_plan(p_project uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_proj jsonb; v_tasks int; v_done int; v_failed int; v_blocked int;
        v_hours numeric; v_waves int; v_reuse int; v_by_wave jsonb; v_by_layer jsonb;
BEGIN
  SELECT to_jsonb(sp) INTO v_proj FROM (
    SELECT id, product_name, request, stage, est_build_days, pricing_status, automation_status,
           reused_components, new_components, unknowns
    FROM software_projects
    WHERE (p_project IS NULL OR id = p_project)
    ORDER BY created_at DESC LIMIT 1
  ) sp;

  IF v_proj IS NULL THEN
    RETURN jsonb_build_object('projects', 0, 'note', 'No software project exists yet. The factory is idle because nothing has been requested — not because it is broken.');
  END IF;

  SELECT count(*), count(*) FILTER (WHERE status='done'), count(*) FILTER (WHERE status='failed'),
         count(*) FILTER (WHERE status='blocked'), COALESCE(SUM(effort_hours),0),
         COALESCE(MAX(wave),0), count(*) FILTER (WHERE reuses IS NOT NULL)
    INTO v_tasks, v_done, v_failed, v_blocked, v_hours, v_waves, v_reuse
  FROM factory_tasks WHERE project_id = (v_proj->>'id')::uuid;

  SELECT COALESCE(jsonb_agg(x ORDER BY (x->>'wave')::int), '[]'::jsonb) INTO v_by_wave FROM (
    SELECT jsonb_build_object('wave', wave, 'tasks', count(*), 'hours', ROUND(COALESCE(SUM(effort_hours),0),1),
           'agents', count(DISTINCT agent_role)) AS x
    FROM factory_tasks WHERE project_id = (v_proj->>'id')::uuid GROUP BY wave) t;

  SELECT COALESCE(jsonb_agg(x ORDER BY x->>'layer'), '[]'::jsonb) INTO v_by_layer FROM (
    SELECT jsonb_build_object('layer', layer, 'tasks', count(*)) AS x
    FROM factory_tasks WHERE project_id = (v_proj->>'id')::uuid GROUP BY layer) t;

  RETURN jsonb_build_object(
    'project', v_proj,
    'tasks_total', v_tasks,
    'tasks_done', v_done,
    'tasks_failed', v_failed,
    'tasks_blocked', v_blocked,
    'completion_pct', CASE WHEN v_tasks = 0 THEN 0 ELSE ROUND(100.0 * v_done / v_tasks, 1) END,
    'total_effort_hours', v_hours,
    'parallel_waves', v_waves,
    'tasks_reusing_components', v_reuse,
    'by_wave', v_by_wave,
    'by_layer', v_by_layer,
    'evidence_rule', 'A task CANNOT be marked done without evidence. Postgres physically rejects it (CHECK done_requires_evidence). A machine cannot fabricate progress here even if instructed to.',
    'automation_truth', CASE WHEN v_done = 0 AND v_tasks > 0
      THEN format('%s tasks planned, 0 done. NOTHING has been built. Phase 3 (code generation) does not exist yet, so nothing can move these tasks — and the factory reports that instead of simulating progress.', v_tasks)
      ELSE NULL END
  );
END; $$;

REVOKE ALL ON FUNCTION public.compute_factory_plan(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.compute_factory_plan(uuid) TO service_role, authenticated;
