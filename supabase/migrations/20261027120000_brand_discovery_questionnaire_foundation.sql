-- Brand Discovery Questionnaire: secure persistence foundation.
-- This migration is intentionally isolated on feature/brand-discovery-foundation.
-- It is NOT applied to the live database by this commit.

create table if not exists public.brand_discovery_questionnaire_versions (
  id uuid primary key default gen_random_uuid(),
  slug text not null,
  version integer not null check (version > 0),
  brand_category text not null,
  title text not null,
  locale text not null default 'hi-en',
  questionnaire jsonb not null,
  status text not null default 'draft' check (status in ('draft','active','retired')),
  created_at timestamptz not null default now(),
  created_by uuid null references auth.users(id) on delete set null,
  unique (slug, version)
);

create table if not exists public.brand_discovery_sessions (
  id uuid primary key default gen_random_uuid(),
  questionnaire_version_id uuid not null references public.brand_discovery_questionnaire_versions(id),
  brand_id uuid null references public.brands(id) on delete set null,
  brand_name text not null,
  brand_category text not null,
  respondent_name text null,
  respondent_email text null,
  locale text not null default 'hi-en',
  status text not null default 'invited' check (status in ('invited','in_progress','submitted','expired','withdrawn')),
  current_section integer not null default 0 check (current_section >= 0),
  current_question integer not null default 0 check (current_question >= 0),
  resume_token_hash text unique,
  resume_token_expires_at timestamptz,
  last_saved_at timestamptz,
  started_at timestamptz,
  submitted_at timestamptz,
  consented_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists brand_discovery_sessions_status_updated_idx
  on public.brand_discovery_sessions (status, updated_at desc);
create index if not exists brand_discovery_sessions_brand_created_idx
  on public.brand_discovery_sessions (brand_id, created_at desc);

create table if not exists public.brand_discovery_answers (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.brand_discovery_sessions(id) on delete cascade,
  question_id text not null,
  section_id text not null,
  answer jsonb not null,
  answered_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (session_id, question_id)
);

create index if not exists brand_discovery_answers_session_section_idx
  on public.brand_discovery_answers (session_id, section_id);

-- Private FK-only output. Never expose this table to the respondent endpoint.
create table if not exists public.brand_discovery_private_reports (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null unique references public.brand_discovery_sessions(id) on delete cascade,
  analysis jsonb not null default '{}'::jsonb,
  execution_plan jsonb not null default '{}'::jsonb,
  generation_status text not null default 'pending' check (generation_status in ('pending','running','complete','failed')),
  generated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.brand_discovery_questionnaire_versions enable row level security;
alter table public.brand_discovery_sessions enable row level security;
alter table public.brand_discovery_answers enable row level security;
alter table public.brand_discovery_private_reports enable row level security;

-- No anon/authenticated policies are added. Access must go through reviewed
-- Edge Functions that validate resume tokens or FK staff authorization.
revoke all on public.brand_discovery_questionnaire_versions from anon, authenticated;
revoke all on public.brand_discovery_sessions from anon, authenticated;
revoke all on public.brand_discovery_answers from anon, authenticated;
revoke all on public.brand_discovery_private_reports from anon, authenticated;

grant all on public.brand_discovery_questionnaire_versions to service_role;
grant all on public.brand_discovery_sessions to service_role;
grant all on public.brand_discovery_answers to service_role;
grant all on public.brand_discovery_private_reports to service_role;
