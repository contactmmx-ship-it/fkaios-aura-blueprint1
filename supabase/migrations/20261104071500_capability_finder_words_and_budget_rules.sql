-- 4 Nov 2026 (approved by Rajeev: "APPROVE SCHEMA").
--
-- 1) fkaios_find_capability: match by WORDS, not the whole sentence.
--    Before: "make an excel spreadsheet of the dealer plan" matched 0 rows (the full sentence had to appear
--    inside a name/purpose), so the brain missed tools it has and logged false "missing capability" gaps.
--    Now: the need is split into words (3+ letters, common words dropped); each registry row is scored by how
--    many words hit its name / purpose / capabilities; best score first, then priority. Same return shape,
--    same gap logging when nothing matches. Rollback: previous definition is in git history (live 4 Nov).
--
-- 2) Budget rules (design reused from Paperclip, MIT: budget_policies + budget_incidents).
--    Founder sets RULES, not per-request approvals: a limit per scope (all / provider / model / agent) per
--    day or month, warn at a percent, optional hard stop. fkaios_budget_status() compares live usage from
--    agent_performance_metrics (already logged for every AI call) with each rule and records an incident
--    once per rule per window when warn/limit is crossed. Service-role only. No rules are created here —
--    amounts are the founder's decision.

create or replace function public.fkaios_find_capability(need text)
 returns jsonb
 language plpgsql
 set search_path to 'public', 'extensions', 'pg_temp'
as $function$
declare
  matches jsonb;
  gap_id uuid;
  words text[];
begin
  select coalesce(array_agg(distinct w), '{}') into words
  from regexp_split_to_table(lower(coalesce(need, '')), '[^a-z0-9]+') w
  where length(w) >= 3
    and w not in ('the','and','for','with','from','into','that','this','make','create','give','get','need','want',
                  'please','our','all','any','can','use','using','build','new','one','off','out','per','via','who','how','what');

  select coalesce(jsonb_agg(m order by (m->>'score')::int desc, (m->>'priority')::int asc), '[]'::jsonb) into matches from (
    select jsonb_build_object(
      'name', cr.name, 'kind', cr.kind, 'provider', cr.provider, 'purpose', cr.purpose,
      'capabilities', cr.capabilities, 'availability', cr.availability, 'auth_state', cr.auth_state,
      'cost_state', cr.cost_state, 'limitations', cr.limitations, 'priority', cr.priority, 'score', s.score
    ) as m
    from public.capability_registry cr
    cross join lateral (
      select count(*)::int as score
      from unnest(words) w
      where lower(cr.name || ' ' || coalesce(cr.purpose, '') || ' ' || array_to_string(cr.capabilities, ' ')) ~ ('\m' || w)
    ) s
    where s.score > 0
       or cr.name ilike '%' || need || '%'
    order by s.score desc, cr.priority asc
    limit 20
  ) x;

  if jsonb_array_length(matches) = 0 then
    select id into gap_id from public.capability_backlog
      where source_agent = 'fkaios_find_capability' and capability = need and status = 'proposed'
      order by created_at desc limit 1;
    if gap_id is null then
      insert into public.capability_backlog (capability, engine, gap_type, observed_defect, source_agent, status)
      values (
        need, 'FKAIOS_BRAIN', 'missing',
        'fkaios_find_capability(''' || replace(need, '''', '''''') || ''') matched zero of the ' ||
          (select count(*) from public.capability_registry) ||
          ' capability_registry rows on ' || to_char(now(), 'YYYY-MM-DD') ||
          '; no AI, tool, repository or connector currently advertises this capability.',
        'fkaios_find_capability', 'proposed'
      )
      returning id into gap_id;
    end if;
  end if;

  return jsonb_build_object('need', need, 'matches', matches, 'gap_id', gap_id);
end $function$;

create table if not exists public.fkaios_budget_policies (
  id uuid primary key default gen_random_uuid(),
  scope_type text not null default 'all' check (scope_type in ('all','provider','model','agent','department')),
  scope_value text,                                   -- null for 'all'; else provider/model/agent/department name
  metric text not null check (metric in ('usd','input_tokens','calls')),
  window_kind text not null check (window_kind in ('day','month')),
  amount numeric not null check (amount > 0),
  warn_percent int not null default 80 check (warn_percent between 1 and 100),
  hard_stop boolean not null default false,           -- true = callers must stop/route elsewhere at 100%
  is_active boolean not null default true,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((scope_type = 'all') = (scope_value is null))
);
create unique index if not exists fkaios_budget_policies_scope_uq
  on public.fkaios_budget_policies (scope_type, coalesce(scope_value, ''), metric, window_kind) where is_active;

create table if not exists public.fkaios_budget_incidents (
  id uuid primary key default gen_random_uuid(),
  policy_id uuid not null references public.fkaios_budget_policies(id) on delete cascade,
  window_start timestamptz not null,
  threshold text not null check (threshold in ('warn','limit')),
  amount_limit numeric not null,
  amount_observed numeric not null,
  status text not null default 'open' check (status in ('open','resolved')),
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  unique (policy_id, window_start, threshold)
);

alter table public.fkaios_budget_policies enable row level security;
alter table public.fkaios_budget_incidents enable row level security;
revoke all on public.fkaios_budget_policies, public.fkaios_budget_incidents from public, anon, authenticated;
grant all on public.fkaios_budget_policies, public.fkaios_budget_incidents to service_role;

create or replace function public.fkaios_budget_status()
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  r record;
  res_out jsonb := '[]'::jsonb;
  w_start timestamptz;
  used numeric;
  pct numeric;
begin
  for r in select * from public.fkaios_budget_policies where is_active loop
    w_start := date_trunc(r.window_kind, now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata';
    select case r.metric
             when 'usd' then coalesce(sum(m.estimated_cost_usd), 0)
             when 'input_tokens' then coalesce(sum(m.input_tokens), 0)
             else count(*) end
      into used
      from public.agent_performance_metrics m
     where m.created_at >= w_start
       and (r.scope_type = 'all'
         or (r.scope_type = 'provider'   and m.provider   = r.scope_value)
         or (r.scope_type = 'model'      and m.model      = r.scope_value)
         or (r.scope_type = 'agent'      and m.agent_id   = r.scope_value)
         or (r.scope_type = 'department' and m.department = r.scope_value));
    pct := round(100 * used / r.amount, 1);
    if pct >= 100 then
      insert into public.fkaios_budget_incidents (policy_id, window_start, threshold, amount_limit, amount_observed)
      values (r.id, w_start, 'limit', r.amount, used) on conflict do nothing;
    elsif pct >= r.warn_percent then
      insert into public.fkaios_budget_incidents (policy_id, window_start, threshold, amount_limit, amount_observed)
      values (r.id, w_start, 'warn', r.amount, used) on conflict do nothing;
    end if;
    res_out := res_out || jsonb_build_object(
      'policy_id', r.id, 'scope', r.scope_type || coalesce(':' || r.scope_value, ''), 'metric', r.metric,
      'window', r.window_kind, 'window_start', w_start, 'limit', r.amount, 'used', used, 'percent', pct,
      'state', case when pct >= 100 then case when r.hard_stop then 'stopped' else 'over' end
                    when pct >= r.warn_percent then 'warn' else 'ok' end);
  end loop;
  return res_out;
end $function$;
revoke all on function public.fkaios_budget_status() from public, anon, authenticated;
grant execute on function public.fkaios_budget_status() to service_role;
