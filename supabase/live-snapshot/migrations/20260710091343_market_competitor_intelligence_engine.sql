-- Applied in production as version 20260710091343 (market_competitor_intelligence_engine).
-- Exported read-only from supabase_migrations.schema_migrations on 2026-10-07 (md5 of statements: 2eca9cebd9aaa978813be22696e3df5a).
-- Record only: do not apply from this folder.

-- MARKET & COMPETITOR INTELLIGENCE ENGINE
-- Addresses review objection #5: every row tagged with source_function for
-- selective purge on rollback. Objection #4: signal_verifications table gives
-- Law-14 outcome verification a real mechanism, not just confidence scores.

create table if not exists market_intelligence (
  id uuid primary key default gen_random_uuid(),
  signal_type text not null check (signal_type in ('industry_trend','opportunity','regulation','technology','economic','demographic','business_model')),
  industry text,
  headline text not null,
  detail text,
  source_url text,
  source_function text not null default 'market-intelligence',
  confidence numeric not null default 0.6,
  relevance_to_founder_vision text,
  captured_at timestamptz not null default now(),
  verified boolean,
  verified_at timestamptz
);

create table if not exists competitor_intelligence (
  id uuid primary key default gen_random_uuid(),
  competitor_name text not null,
  category text,
  observation text not null,
  implication_for_us text,
  source_url text,
  source_function text not null default 'market-intelligence',
  confidence numeric not null default 0.6,
  captured_at timestamptz not null default now()
);

-- Objection #4 (Law 14): outcome verification mechanism for captured signals.
create table if not exists signal_verifications (
  id uuid primary key default gen_random_uuid(),
  signal_id uuid,
  signal_table text not null,
  predicted_relevance text,
  actual_outcome text,
  was_useful boolean,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

-- Objection #6: KPI framework for research-engine as Chief Research Officer.
insert into agent_intelligence_profiles (agent_name, role, trust_level, knowledge_scope, learning_progress)
values ('research-engine','Chief Research Officer — external market/competitor observation feeding the enterprise cognition loop','probation',
        'web search, market_intelligence, competitor_intelligence, fleet_memory (write)',
        'KPIs: (daily) >=1 market signal captured when scheduled; (weekly) >=3 competitor observations with implication_for_us; (monthly) signal usefulness rate >=50% via signal_verifications. Starts probation; earns trust from verified signal usefulness.')
on conflict (agent_name) do update set role=excluded.role, knowledge_scope=excluded.knowledge_scope, learning_progress=excluded.learning_progress;

alter table market_intelligence enable row level security;
alter table competitor_intelligence enable row level security;
alter table signal_verifications enable row level security;
create policy "read market_intel" on market_intelligence for select using (true);
create policy "read competitor_intel" on competitor_intelligence for select using (true);
create policy "read signal_verif" on signal_verifications for select using (true);
create index if not exists idx_market_intel_captured on market_intelligence(captured_at desc);
create index if not exists idx_competitor_intel on competitor_intelligence(competitor_name, captured_at desc);

-- Enterprise knowledge view already unions fleet_memory; expose market feed too
create or replace view v_market_intelligence as
select 'market' as kind, signal_type as subtype, headline as title, detail as body, source_url, confidence, captured_at from market_intelligence
union all
select 'competitor', category, competitor_name||': '||observation, implication_for_us, source_url, confidence, captured_at from competitor_intelligence
order by captured_at desc;
