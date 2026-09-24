-- FKAIOS Brain: capability registry, worker runs, handoff journal, worker
-- router, Brain context query and knowledge ingestion.
--
-- Extends the existing state instead of replacing it:
--   * objectives/plans/tasks/evidence stay in orchestrator_requests /
--     orchestration_projects / orchestration_tasks;
--   * knowledge stays in fleet_memory (ingested records use
--     source_department 'FKAIOS_BRAIN' so they never crowd the Founder
--     Brain's own EXECUTIVE rows, which getGoals() reads from the latest 20);
--   * model_registry, provider_health_state and connectors remain the
--     sources the registry seed reads from.
-- New here: one registry for every AI/tool/repository/connector, the worker
-- run + handoff journal that lets one AI worker hand an objective to the
-- next, and SQL functions any worker (Claude session, edge function, Rajeev
-- AI) can call. No credentials are ever stored: a trigger rejects rows that
-- look like secrets.

create or replace function public.fkaios_reject_secrets() returns trigger
language plpgsql as $$
declare
  body text := to_jsonb(new)::text;
begin
  if body ~ 'eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}'      -- JWTs (anon/service-role keys)
     or body ~ 'sk-[A-Za-z0-9_-]{20,}'                         -- OpenAI/Anthropic style keys
     or body ~ 'sb_secret_[A-Za-z0-9_-]{10,}'                  -- Supabase secret keys
     or body ~ 'AIza[0-9A-Za-z_-]{30,}'                        -- Google API keys
     or body ~ 'gh[pousr]_[A-Za-z0-9]{30,}'                    -- GitHub tokens
     or body ~ 'apify_api_[A-Za-z0-9]{20,}' then               -- Apify tokens
    raise exception 'FKAIOS: refusing to store a value that looks like a credential in %', tg_table_name;
  end if;
  return new;
end $$;

-- ── Capability registry ────────────────────────────────────────────────
create table if not exists public.capability_registry (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  kind text not null check (kind in ('ai_model','coding_worker','tool','artifact_tool','repository','connector','edge_function')),
  provider text,
  purpose text,
  endpoint text,
  capabilities text[] not null default '{}',
  operations text[] not null default '{}',
  auth_state text not null default 'unknown' check (auth_state in ('configured','missing','not_required','expired','unknown')),
  cost_state text not null default 'unknown' check (cost_state in ('free','paid_active','paid_exhausted','quota_limited','unknown')),
  availability text not null default 'unknown' check (availability in ('available','degraded','unavailable','unknown')),
  permissions text[] not null default '{}',
  limitations text,
  license text,
  health text,
  handoff_support boolean not null default false,
  priority integer not null default 100,
  last_tested_at timestamptz,
  last_success_at timestamptz,
  source text,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.capability_registry enable row level security;
drop trigger if exists capability_registry_no_secrets on public.capability_registry;
create trigger capability_registry_no_secrets before insert or update on public.capability_registry
  for each row execute function public.fkaios_reject_secrets();

-- ── Worker runs (one AI worker's stint on an objective) ────────────────
create table if not exists public.worker_runs (
  id uuid primary key default gen_random_uuid(),
  objective_id uuid references public.orchestrator_requests(id),
  worker text not null,
  provider text,
  model text,
  status text not null default 'active' check (status in ('active','handed_off','completed','failed')),
  steps integer not null default 0,
  max_steps integer,
  last_step text,
  handoff_id uuid,
  started_at timestamptz not null default now(),
  ended_at timestamptz
);
alter table public.worker_runs enable row level security;
drop trigger if exists worker_runs_no_secrets on public.worker_runs;
create trigger worker_runs_no_secrets before insert or update on public.worker_runs
  for each row execute function public.fkaios_reject_secrets();

-- ── Handoff journal ────────────────────────────────────────────────────
create table if not exists public.worker_handoffs (
  id uuid primary key default gen_random_uuid(),
  objective_id uuid references public.orchestrator_requests(id),
  from_run_id uuid references public.worker_runs(id),
  to_run_id uuid references public.worker_runs(id),
  project text,
  brand text,
  from_worker text not null,
  from_provider text,
  from_model text,
  to_worker text,
  transfer_mode text not null check (transfer_mode in ('provider_limit','controlled_test','manual')),
  reason text not null,
  status text not null default 'open' check (status in ('open','accepted','verified','cancelled')),
  current_task text,
  completed_work jsonb not null default '[]',
  partial_work jsonb not null default '[]',
  pending_work jsonb not null default '[]',
  blockers jsonb not null default '[]',
  decisions jsonb not null default '[]',
  files_changed text[] not null default '{}',
  commits text[] not null default '{}',
  deployments jsonb not null default '[]',
  database_changes jsonb not null default '[]',
  tests jsonb not null default '[]',
  evidence jsonb not null default '[]',
  current_state text,
  next_action text,
  instructions text,
  alternative_workers text[] not null default '{}',
  verification_notes text,
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  verified_at timestamptz
);
alter table public.worker_handoffs enable row level security;
drop trigger if exists worker_handoffs_no_secrets on public.worker_handoffs;
create trigger worker_handoffs_no_secrets before insert or update on public.worker_handoffs
  for each row execute function public.fkaios_reject_secrets();
alter table public.worker_runs drop constraint if exists worker_runs_handoff_id_fkey;
alter table public.worker_runs add constraint worker_runs_handoff_id_fkey foreign key (handoff_id) references public.worker_handoffs(id);

-- ── Worker router ──────────────────────────────────────────────────────
-- Candidates must advertise every required capability, must not be excluded
-- (the worker being replaced), and must not be known-unavailable. Already
-- available/free workers first, then by priority.
create or replace function public.fkaios_select_worker(required text[], exclude text[] default '{}')
returns table(name text, provider text, availability text, cost_state text, priority integer)
language sql stable as $$
  select r.name, r.provider, r.availability, r.cost_state, r.priority
  from public.capability_registry r
  where r.kind in ('coding_worker','ai_model')
    and r.handoff_support
    and r.capabilities @> required
    and not (r.name = any(exclude))
    and r.availability in ('available','degraded')
    and r.cost_state not in ('paid_exhausted')
  order by (r.availability = 'available') desc,
           (r.cost_state in ('free','paid_active')) desc,
           r.priority asc
$$;

-- ── Controlled step counter (handoff Mode B) ───────────────────────────
-- A worker calls this after each real unit of work. When max_steps is set
-- and reached, transfer_required=true and the worker must hand off.
create or replace function public.fkaios_worker_step(run_id uuid, step text)
returns jsonb language plpgsql as $$
declare r public.worker_runs;
begin
  update public.worker_runs set steps = steps + 1, last_step = left(step, 500)
    where id = run_id and status = 'active' returning * into r;
  if r.id is null then raise exception 'FKAIOS: worker run % is not active', run_id; end if;
  insert into public.execution_log(function_name, action, status, input_summary, output_summary)
    values ('fkaios-worker', 'worker_step', 'success', r.worker || ' step ' || r.steps, left(step, 500));
  return jsonb_build_object('run_id', r.id, 'steps', r.steps, 'max_steps', r.max_steps,
    'transfer_required', r.max_steps is not null and r.steps >= r.max_steps);
end $$;

-- ── Brain context ──────────────────────────────────────────────────────
-- One query answering "what do we know / what was done / what failed /
-- what is pending / what next" about a topic, from the real tables.
create or replace function public.fkaios_brain_context(topic text)
returns jsonb language sql stable as $$
  with pat as (select '%' || topic || '%' as p),
  objs as (
    select o.id, o.raw_request, o.status, o.action_taken, o.result_summary, o.created_at,
      (select count(*) from public.orchestration_projects pr where pr.request like '[objective:' || o.id || ']%') as planning_passes,
      (select jsonb_agg(jsonb_build_object('title', t.title, 'status', t.status) order by t.created_at)
         from public.orchestration_tasks t
         where t.project_id = (select pr.id from public.orchestration_projects pr
                               where pr.request like '[objective:' || o.id || ']%' order by pr.created_at desc limit 1)) as latest_tasks
    from public.orchestrator_requests o, pat
    where o.raw_request ilike pat.p or o.result_summary ilike pat.p
    order by o.created_at desc limit 10
  )
  select jsonb_build_object(
    'topic', topic,
    'generated_at', now(),
    'objectives', coalesce((select jsonb_agg(to_jsonb(objs)) from objs), '[]'),
    'brands', coalesce((select jsonb_agg(jsonb_build_object('name', b.name, 'sector', b.sector, 'status', b.status))
                        from public.brands b, pat where b.name ilike pat.p or b.sector ilike pat.p), '[]'),
    'knowledge', coalesce((select jsonb_agg(k) from (
        select f.memory_type, f.title, left(f.content, 400) as content, f.structured_content -> 'provenance' as provenance, f.created_at
        from public.fleet_memory f, pat
        where f.content ilike pat.p or f.title ilike pat.p
        order by f.created_at desc limit 15) k), '[]'),
    'research_runs', coalesce((select jsonb_agg(r) from (
        select rr.id, rr.query, rr.status, rr.result_count, rr.created_at
        from public.research_runs rr, pat where rr.query ilike pat.p
        order by rr.created_at desc limit 10) r), '[]'),
    'handoffs', coalesce((select jsonb_agg(h) from (
        select wh.id, wh.from_worker, wh.to_worker, wh.status, wh.current_state, wh.next_action, wh.created_at
        from public.worker_handoffs wh, pat
        where wh.project ilike pat.p or wh.brand ilike pat.p or wh.current_task ilike pat.p
           or wh.objective_id in (select id from objs)
        order by wh.created_at desc limit 5) h), '[]'),
    'capabilities', coalesce((select jsonb_agg(c) from (
        select cr.name, cr.kind, cr.availability, cr.auth_state, cr.cost_state
        from public.capability_registry cr, pat
        where cr.name ilike pat.p or cr.purpose ilike pat.p or array_to_string(cr.capabilities, ' ') ilike pat.p
        limit 10) c), '[]')
  )
$$;

-- ── Knowledge ingestion with provenance ────────────────────────────────
-- records: [{kind, title, content, source, source_type, source_date,
--            verification_state?, project?, brand?, objective_id?, artifact?}]
-- Deduplicates on source+title. Historical claims are 'unverified' unless
-- the caller states how they were verified.
create or replace function public.fkaios_ingest_knowledge(records jsonb)
returns jsonb language plpgsql as $$
declare
  rec jsonb; ins int := 0; dup int := 0; k text;
begin
  for rec in select * from jsonb_array_elements(records) loop
    if coalesce(rec->>'kind','') not in ('fact','decision','requirement','completed_work','pending_work',
        'architecture','business_context','objective','failure','lesson','reference','artifact') then
      raise exception 'FKAIOS: unknown knowledge kind %', rec->>'kind';
    end if;
    if coalesce(rec->>'source','') = '' or coalesce(rec->>'title','') = '' then
      raise exception 'FKAIOS: every record needs source and title';
    end if;
    k := md5((rec->>'source') || '|' || (rec->>'title'));
    if exists (select 1 from public.fleet_memory where source_department = 'FKAIOS_BRAIN' and structured_content->>'ingest_key' = k) then
      dup := dup + 1; continue;
    end if;
    insert into public.fleet_memory(source_department, memory_type, title, content, structured_content, confidence, visible_to_departments, visible_to_agents)
    values ('FKAIOS_BRAIN', rec->>'kind', left(rec->>'title', 300), rec->>'content',
      jsonb_build_object(
        'ingest_key', k,
        'provenance', jsonb_build_object(
          'source', rec->>'source', 'source_type', rec->>'source_type', 'source_date', rec->>'source_date',
          'verification_state', coalesce(rec->>'verification_state', 'unverified'),
          'verified_by', rec->>'verified_by'),
        'project', rec->>'project', 'brand', rec->>'brand',
        'objective_id', rec->>'objective_id', 'artifact', rec->>'artifact'),
      case coalesce(rec->>'verification_state','unverified') when 'verified' then 100 else 50 end,
      array['*'], '{}');
    ins := ins + 1;
  end loop;
  return jsonb_build_object('inserted', ins, 'duplicates_skipped', dup);
end $$;

revoke all on function public.fkaios_select_worker(text[], text[]) from public, anon, authenticated;
revoke all on function public.fkaios_worker_step(uuid, text) from public, anon, authenticated;
revoke all on function public.fkaios_brain_context(text) from public, anon, authenticated;
revoke all on function public.fkaios_ingest_knowledge(jsonb) from public, anon, authenticated;
