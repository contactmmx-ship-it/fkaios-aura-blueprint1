-- FKAIOS autonomy foundation, part B2 (mission 2026-10-08). See part A and docs/FKAIOS_AUTONOMY_ARCHITECTURE.md.

set local lock_timeout = '5s';

-- 4. Canonical objective state ──────────────────────────────────────────────
create table if not exists public.fkaios_objective_state (
  objective_id uuid primary key,
  phase text not null default 'understanding'
    check (phase in ('understanding','planning','executing','verifying','rectifying','completed','blocked','failed')),
  state_version integer not null default 1,
  objective text not null,
  understanding jsonb not null default '{}'::jsonb,
  success_criteria jsonb not null default '[]'::jsonb,
  plan jsonb not null default '[]'::jsonb,
  completed_work jsonb not null default '[]'::jsonb,
  remaining_work jsonb not null default '[]'::jsonb,
  artifacts jsonb not null default '[]'::jsonb,
  decisions jsonb not null default '[]'::jsonb,
  failures jsonb not null default '[]'::jsonb,
  resource_assignments jsonb not null default '{}'::jsonb,
  verification jsonb not null default '{}'::jsonb,
  last_checkpoint jsonb not null default '{}'::jsonb,
  rectification_round integer not null default 0,
  replan_count integer not null default 0,
  next_action text,
  blocked_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.fkaios_objective_state enable row level security;
do $p$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'fkaios_objective_state' and policyname = 'fkaios_objective_state_read') then
    create policy fkaios_objective_state_read on public.fkaios_objective_state for select to authenticated using (true);
  end if;
end $p$;

create table if not exists public.fkaios_objective_state_history (
  id bigserial primary key,
  objective_id uuid not null,
  state_version integer not null,
  from_phase text,
  to_phase text not null,
  reason text,
  created_at timestamptz not null default now()
);
create index if not exists fkaios_objective_state_history_idx on public.fkaios_objective_state_history(objective_id, state_version);
alter table public.fkaios_objective_state_history enable row level security;
do $p$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'fkaios_objective_state_history' and policyname = 'fkaios_objective_state_history_read') then
    create policy fkaios_objective_state_history_read on public.fkaios_objective_state_history for select to authenticated using (true);
  end if;
end $p$;

create or replace function public.fkaios_phase_transition_allowed(p_from text, p_to text)
returns boolean language sql immutable set search_path = public, extensions, pg_temp as $$
  select p_from = p_to or case p_from
    when 'understanding' then p_to in ('planning','executing','blocked','failed')
    when 'planning'      then p_to in ('executing','blocked','failed')
    when 'executing'     then p_to in ('planning','verifying','blocked','failed')
    when 'verifying'     then p_to in ('rectifying','planning','executing','completed','blocked','failed')
    when 'rectifying'    then p_to in ('executing','verifying','planning','blocked','failed')
    when 'blocked'       then p_to in ('planning','executing','verifying','failed')
    else false  -- completed and failed are terminal
  end;
$$;

-- Compare-and-swap state update. p_expected_version null = create. A stale
-- writer (older version) or a disallowed phase transition raises, so a slow
-- worker can never overwrite newer state.
create or replace function public.fkaios_objective_state_apply(
  p_objective_id uuid, p_expected_version integer, p_phase text, p_patch jsonb, p_reason text default null)
returns integer language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  cur public.fkaios_objective_state;
  new_version integer;
  allowed_keys text[] := array['objective','understanding','success_criteria','plan','completed_work','remaining_work',
    'artifacts','decisions','failures','resource_assignments','verification','last_checkpoint','rectification_round',
    'replan_count','next_action','blocked_reason'];
  k text;
begin
  for k in select jsonb_object_keys(coalesce(p_patch, '{}'::jsonb)) loop
    if not (k = any(allowed_keys)) then raise exception 'fkaios_objective_state_apply: unknown key %', k; end if;
  end loop;
  select * into cur from public.fkaios_objective_state where objective_id = p_objective_id for update;
  if not found then
    if p_expected_version is not null then raise exception 'stale_state: no state for %', p_objective_id; end if;
    insert into public.fkaios_objective_state (objective_id, phase, objective)
    values (p_objective_id, coalesce(p_phase, 'understanding'),
            coalesce(p_patch->>'objective', (select raw_request from public.orchestrator_requests where id = p_objective_id), ''));
    select * into cur from public.fkaios_objective_state where objective_id = p_objective_id for update;
    insert into public.fkaios_objective_state_history (objective_id, state_version, from_phase, to_phase, reason)
    values (p_objective_id, 1, null, cur.phase, coalesce(p_reason, 'created'));
  elsif p_expected_version is not null and cur.state_version <> p_expected_version then
    raise exception 'stale_state: expected version % but current is %', p_expected_version, cur.state_version;
  end if;
  if p_phase is not null and not public.fkaios_phase_transition_allowed(cur.phase, p_phase) then
    raise exception 'illegal_transition: % -> %', cur.phase, p_phase;
  end if;
  new_version := cur.state_version + 1;
  update public.fkaios_objective_state s set
    phase = coalesce(p_phase, s.phase),
    state_version = new_version,
    objective = coalesce(p_patch->>'objective', s.objective),
    understanding = coalesce(p_patch->'understanding', s.understanding),
    success_criteria = coalesce(p_patch->'success_criteria', s.success_criteria),
    plan = coalesce(p_patch->'plan', s.plan),
    completed_work = coalesce(p_patch->'completed_work', s.completed_work),
    remaining_work = coalesce(p_patch->'remaining_work', s.remaining_work),
    artifacts = coalesce(p_patch->'artifacts', s.artifacts),
    decisions = coalesce(p_patch->'decisions', s.decisions),
    failures = coalesce(p_patch->'failures', s.failures),
    resource_assignments = coalesce(p_patch->'resource_assignments', s.resource_assignments),
    verification = coalesce(p_patch->'verification', s.verification),
    last_checkpoint = coalesce(p_patch->'last_checkpoint', s.last_checkpoint),
    rectification_round = coalesce((p_patch->>'rectification_round')::int, s.rectification_round),
    replan_count = coalesce((p_patch->>'replan_count')::int, s.replan_count),
    next_action = case when p_patch ? 'next_action' then p_patch->>'next_action' else s.next_action end,
    blocked_reason = case when p_patch ? 'blocked_reason' then p_patch->>'blocked_reason' else s.blocked_reason end,
    updated_at = now()
  where s.objective_id = p_objective_id;
  if p_phase is not null and p_phase <> cur.phase then
    insert into public.fkaios_objective_state_history (objective_id, state_version, from_phase, to_phase, reason)
    values (p_objective_id, new_version, cur.phase, p_phase, p_reason);
  end if;
  return new_version;
end $$;
revoke execute on function public.fkaios_objective_state_apply(uuid, integer, text, jsonb, text) from public, anon, authenticated;
grant execute on function public.fkaios_objective_state_apply(uuid, integer, text, jsonb, text) to service_role;

