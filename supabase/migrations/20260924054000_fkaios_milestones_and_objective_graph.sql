-- FKAIOS Feature 3/5/8: milestones + dependency links + one query answering
-- "what is happening with this objective" (the Command Center / Rajeev AI
-- requirement). Extends the EXISTING objective pipeline in place:
--   orchestrator_requests (objective)
--     -> orchestration_projects (one planning pass; a rerun creates a new
--        one, per objective-rerun.ts, so milestones belong to the OBJECTIVE,
--        not the transient project)
--     -> orchestration_tasks (individual tasks, status pending/assigned/
--        done/rework/approved — UNCHANGED, no existing status touched)
--     -> ai_jobs (the real work queue a task's work_engine_task lands in)
-- Nothing here replaces or renames any of that. Two additive, nullable
-- columns on orchestration_tasks, one new table for the genuinely-missing
-- concept (milestones — confirmed absent by grep + information_schema
-- before writing this), and two SQL functions. No edge function is
-- redeployed by this migration; existing planners/workers that don't know
-- about milestones keep writing tasks exactly as before (milestone_id
-- defaults null, depends_on_task_ids defaults '{}').
--
-- Evidence grading (verified/no_data_source/failed/incomplete) stays owned
-- by _shared/fact-grounding.ts — deliberately NOT reimplemented in SQL here,
-- to avoid a second, divergent copy of that logic. fkaios_objective_graph()
-- below reports raw task/job status only; a caller that wants a graded
-- verdict still goes through founder-objective's existing status action.

create table if not exists public.orchestration_milestones (
  id uuid primary key default gen_random_uuid(),
  objective_id uuid not null references public.orchestrator_requests(id),
  title text not null,
  description text,
  acceptance_criteria text,
  sequence integer not null default 0,
  status text not null default 'not_started'
    check (status in ('not_started','ready','running','blocked','verifying','completed','failed')),
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
alter table public.orchestration_milestones enable row level security;
drop trigger if exists orchestration_milestones_no_secrets on public.orchestration_milestones;
create trigger orchestration_milestones_no_secrets before insert or update on public.orchestration_milestones
  for each row execute function public.fkaios_reject_secrets();
create index if not exists orchestration_milestones_objective_idx on public.orchestration_milestones(objective_id, sequence);

alter table public.orchestration_tasks
  add column if not exists milestone_id uuid references public.orchestration_milestones(id),
  add column if not exists depends_on_task_ids uuid[] not null default '{}';
create index if not exists orchestration_tasks_milestone_idx on public.orchestration_tasks(milestone_id);

-- Bulk-create milestones for an objective. milestones:
-- [{title, description?, acceptance_criteria?, sequence?}]. Sequence
-- defaults to array position (0-based) when omitted. Returns the created
-- rows' ids in the same order, so a caller can then attach task.milestone_id.
create or replace function public.fkaios_create_milestones(objective_id uuid, milestones jsonb)
returns uuid[] language plpgsql as $$
declare
  m jsonb;
  idx integer := 0;
  ids uuid[] := '{}';
  new_id uuid;
begin
  if not exists (select 1 from public.orchestrator_requests where id = objective_id) then
    raise exception 'FKAIOS: objective % does not exist', objective_id;
  end if;
  for m in select * from jsonb_array_elements(milestones) loop
    if coalesce(m->>'title','') = '' then
      raise exception 'FKAIOS: every milestone needs a title';
    end if;
    insert into public.orchestration_milestones (objective_id, title, description, acceptance_criteria, sequence)
    values (
      objective_id, m->>'title', m->>'description', m->>'acceptance_criteria',
      coalesce((m->>'sequence')::integer, idx)
    )
    returning id into new_id;
    ids := array_append(ids, new_id);
    idx := idx + 1;
  end loop;
  return ids;
end $$;
revoke all on function public.fkaios_create_milestones(uuid, jsonb) from public, anon, authenticated;

-- One query answering "what is happening with this objective" — the
-- structural half of the Command Center / Rajeev AI requirement. Reads the
-- objective's LATEST planning pass only (a rerun's new orchestration_projects
-- row supersedes the previous one for current-state purposes, matching
-- founder-objective's own readObjectiveStatus() convention), every task in
-- it, each task's milestone (if attached) and dependency ids, and the real
-- ai_jobs row(s) working that task. Progress is a coarse, honest count of
-- terminal-vs-not task status (done/approved = complete) — NOT a graded
-- verdict; a caller needing verified/no_data_source/failed grading should
-- still use founder-objective's status action (fact-grounding.ts).
create or replace function public.fkaios_objective_graph(objective_id uuid)
returns jsonb language sql stable as $$
  with obj as (
    select id, raw_request, status, action_taken, result_summary, risk_level, department_code, created_at
    from public.orchestrator_requests where id = objective_id
  ),
  latest_project as (
    select id, status, created_at from public.orchestration_projects
    where request like '[objective:' || objective_id || ']%'
    order by created_at desc limit 1
  ),
  tasks as (
    select t.id, t.milestone_id, t.title, t.description, t.status, t.attempts,
      t.depends_on_task_ids, t.review_score, t.created_at,
      (select jsonb_agg(jsonb_build_object('id', j.id, 'agent_id', j.agent_id, 'status', j.status,
                'retry_count', j.retry_count, 'updated_at', j.updated_at) order by j.created_at)
         from public.ai_jobs j
         where j.type = 'work_engine_task' and j.payload->>'task_id' = t.id::text) as jobs
    from public.orchestration_tasks t, latest_project p
    where t.project_id = p.id
  ),
  milestones as (
    select m.id, m.title, m.description, m.acceptance_criteria, m.sequence, m.status, m.completed_at,
      coalesce((select jsonb_agg(to_jsonb(tk) - 'milestone_id' order by tk.created_at) from tasks tk where tk.milestone_id = m.id), '[]'::jsonb) as tasks,
      (select count(*) from tasks tk where tk.milestone_id = m.id) as task_count,
      (select count(*) from tasks tk where tk.milestone_id = m.id and tk.status in ('done','approved')) as tasks_complete
    from public.orchestration_milestones m
    where m.objective_id = fkaios_objective_graph.objective_id
    order by m.sequence
  ),
  unmilestoned as (
    select to_jsonb(tk) as t from tasks tk where tk.milestone_id is null
  )
  select jsonb_build_object(
    'objective', (select to_jsonb(obj) from obj),
    'latest_project', (select to_jsonb(latest_project) from latest_project),
    'milestones', coalesce((select jsonb_agg(jsonb_build_object(
        'id', ms.id, 'title', ms.title, 'description', ms.description,
        'acceptance_criteria', ms.acceptance_criteria, 'sequence', ms.sequence, 'status', ms.status,
        'completed_at', ms.completed_at, 'tasks', ms.tasks, 'task_count', ms.task_count,
        'tasks_complete', ms.tasks_complete,
        'progress_pct', case when ms.task_count > 0 then round(100.0 * ms.tasks_complete / ms.task_count) else 0 end
      ) order by ms.sequence) from milestones ms), '[]'::jsonb),
    'unmilestoned_tasks', coalesce((select jsonb_agg(t) from unmilestoned), '[]'::jsonb),
    'overall_progress_pct', (
      select case when count(*) = 0 then 0 else round(100.0 * count(*) filter (where status in ('done','approved')) / count(*)) end
      from tasks
    ),
    'generated_at', now()
  )
$$;
revoke all on function public.fkaios_objective_graph(uuid) from public, anon, authenticated;
