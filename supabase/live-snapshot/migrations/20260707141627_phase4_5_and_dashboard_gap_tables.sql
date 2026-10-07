-- Applied in production as version 20260707141627 (phase4_5_and_dashboard_gap_tables).
-- Exported read-only from supabase_migrations.schema_migrations on 2026-10-07 (md5 of statements: 5a275bf5d642281488406e2755023e00).
-- Record only: do not apply from this folder.

-- Phase 4: courier-tracking style milestone tracker on top of the already-correct
-- company_annual_targets split. Quarterly checkpoints computed via straight-line
-- pacing from the annual target — disclosed as computed pacing, not founder-set
-- milestones, so it's never presented as more precise than it is.
create table if not exists company_revenue_milestones (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  year int not null,
  quarter int not null check (quarter between 1 and 4),
  target_inr numeric not null,
  actual_inr numeric default 0,
  status text default 'pending' check (status in ('pending','on_track','at_risk','achieved','missed')),
  owning_department text,
  risk_notes text,
  recommended_action text,
  target_date date,
  updated_at timestamptz default now()
);
alter table company_revenue_milestones enable row level security;
create policy "service role full access" on company_revenue_milestones for all using (true) with check (true);

-- Phase 5: Training department real tables
create table if not exists training_curriculum (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  format text not null check (format in ('ppt','quiz','session','sop_update')),
  department_code text,
  content text,
  created_by_agent text,
  created_at timestamptz default now()
);
alter table training_curriculum enable row level security;
create policy "service role full access" on training_curriculum for all using (true) with check (true);

create table if not exists training_completions (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references ai_agents(id) on delete cascade,
  module_id uuid not null references training_curriculum(id) on delete cascade,
  completed_at timestamptz default now(),
  score numeric
);
alter table training_completions enable row level security;
create policy "service role full access" on training_completions for all using (true) with check (true);

-- Voice Agent Activity — real logging hook for sales-engine's ElevenLabs 'speak' action
create table if not exists voice_call_log (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid references leads(id),
  tone text,
  text_length int,
  status text default 'success',
  created_at timestamptz default now()
);
alter table voice_call_log enable row level security;
create policy "service role full access" on voice_call_log for all using (true) with check (true);

-- Marketing / PR campaigns
create table if not exists marketing_campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  channel text,
  department_code text default 'PR_CREATOR',
  status text default 'draft' check (status in ('draft','scheduled','sent','completed')),
  target_audience text,
  content text,
  sent_at timestamptz,
  engagement_notes text,
  created_at timestamptz default now()
);
alter table marketing_campaigns enable row level security;
create policy "service role full access" on marketing_campaigns for all using (true) with check (true);
