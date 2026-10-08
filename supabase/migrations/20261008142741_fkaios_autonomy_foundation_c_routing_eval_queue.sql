-- FKAIOS autonomy foundation, part C (mission 2026-10-08). See part A and docs/FKAIOS_AUTONOMY_ARCHITECTURE.md.

set local lock_timeout = '5s';

-- 5. Versioned routing ──────────────────────────────────────────────────────
create table if not exists public.fkaios_routing_policies (
  id uuid primary key default gen_random_uuid(),
  task_class text not null,
  version integer not null,
  resource_refs text[] not null check (cardinality(resource_refs) > 0),
  status text not null default 'active' check (status in ('active','superseded','rolled_back')),
  reason text not null,
  evidence jsonb not null default '{}'::jsonb,
  adoption_proposal_id uuid references public.capability_adoption_proposals(id) on delete set null,
  approval_id uuid references public.approvals(id) on delete set null,
  rollback_to_id uuid references public.fkaios_routing_policies(id) on delete set null,
  created_by text not null,
  effective_at timestamptz not null default now(),
  monitor_until timestamptz,
  created_at timestamptz not null default now(),
  unique (task_class, version)
);
create unique index if not exists fkaios_routing_policies_one_active on public.fkaios_routing_policies(task_class) where status = 'active';
alter table public.fkaios_routing_policies enable row level security;
do $p$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'fkaios_routing_policies' and policyname = 'fkaios_routing_policies_read') then
    create policy fkaios_routing_policies_read on public.fkaios_routing_policies for select to authenticated using (true);
  end if;
end $p$;

insert into public.fkaios_routing_policies (task_class, version, resource_refs, reason, created_by, evidence)
select c, 1,
       array['model:gemini:gemini-3.5-flash-lite','model:anthropic:claude-haiku-4-5-20251001','model:openai:gpt-5.6-luna'],
       'Baseline: the router''s live default fallback chain on 2026-10-08 (gemini, then anthropic, then openai).',
       'fkaios_autonomy_foundation', jsonb_build_object('source','llm-router getConfiguredDefaultProviders + get*Model defaults')
from unnest(array['reasoning','extraction','planning','writing','verification','coding','research_synthesis','general']) c
where not exists (select 1 from public.fkaios_routing_policies p where p.task_class = c);

-- 6. Golden evaluation cases ────────────────────────────────────────────────
create table if not exists public.fkaios_eval_cases (
  id uuid primary key default gen_random_uuid(),
  suite text not null,
  suite_version integer not null,
  case_key text not null,
  task_class text not null,
  system_prompt text not null,
  prompt text not null,
  checks jsonb not null,
  weight numeric not null default 1,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (suite, suite_version, case_key)
);
alter table public.fkaios_eval_cases enable row level security;
do $p$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'fkaios_eval_cases' and policyname = 'fkaios_eval_cases_read') then
    create policy fkaios_eval_cases_read on public.fkaios_eval_cases for select to authenticated using (true);
  end if;
end $p$;

-- 7. Leased test queue ──────────────────────────────────────────────────────
alter table public.capability_test_queue
  add column if not exists task_class text,
  add column if not exists lease_owner text,
  add column if not exists lease_expires_at timestamptz,
  add column if not exists max_attempts integer not null default 3,
  add column if not exists budget_usd numeric not null default 0,
  add column if not exists incumbent_resource_key text,
  add column if not exists last_error text;

-- Claim one test: expired leases are reclaimed first (crash recovery), then the
-- highest-priority queued row. SKIP LOCKED keeps concurrent ticks apart.
create or replace function public.fkaios_claim_capability_test(p_owner text, p_lease_seconds integer default 600)
returns setof public.capability_test_queue language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare picked uuid;
begin
  select q.id into picked from public.capability_test_queue q
  where (q.status = 'queued' or (q.status = 'running' and q.lease_expires_at < now()))
    and q.attempt < q.max_attempts
  order by (q.status = 'running') desc, q.priority desc, q.requested_at
  limit 1 for update skip locked;
  if picked is null then return; end if;
  return query update public.capability_test_queue q set
    status = 'running', lease_owner = p_owner, lease_expires_at = now() + make_interval(secs => p_lease_seconds),
    attempt = q.attempt + 1, started_at = coalesce(q.started_at, now())
  where q.id = picked returning q.*;
end $$;

-- Finish a claimed test. Only the current lease owner can finish it, so a
-- worker whose lease expired cannot overwrite the result of its replacement.
create or replace function public.fkaios_finish_capability_test(p_id uuid, p_owner text, p_status text, p_evidence jsonb, p_error text default null)
returns boolean language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare n integer;
begin
  if p_status not in ('passed','failed','queued','cancelled') then raise exception 'bad status %', p_status; end if;
  update public.capability_test_queue set
    status = p_status, evidence = coalesce(p_evidence, evidence), last_error = p_error,
    completed_at = case when p_status in ('passed','failed','cancelled') then now() else null end,
    lease_owner = null, lease_expires_at = null
  where id = p_id and lease_owner = p_owner and status = 'running';
  get diagnostics n = row_count;
  return n = 1;
end $$;
revoke execute on function public.fkaios_claim_capability_test(text, integer) from public, anon, authenticated;
revoke execute on function public.fkaios_finish_capability_test(uuid, text, text, jsonb, text) from public, anon, authenticated;
grant execute on function public.fkaios_claim_capability_test(text, integer) to service_role;
grant execute on function public.fkaios_finish_capability_test(uuid, text, text, jsonb, text) to service_role;
