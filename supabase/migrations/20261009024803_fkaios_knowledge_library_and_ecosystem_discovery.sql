-- FKAIOS knowledge library (page-exact) and ecosystem discovery.
--
-- Knowledge: every ingested document is a source; every PDF page (or
-- conversation segment) is a row that keeps BOTH the PDF page index and the
-- printed page label, how the label was established, how the text was
-- obtained (text layer, OCR, none) and how complete it is. Retrieval answers
-- "page 18 of book X" with the actual page, not a similar passage.
--
-- Discovery: daily runs over official registries/APIs record candidates
-- (deduplicated by canonical key and content hash) with relevance and risk
-- class. Candidates are metadata only: nothing discovered is installed or
-- executed by this pipeline.

create table public.fkaios_knowledge_sources (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  author text,
  edition text,
  isbn text,
  source_kind text not null check (source_kind in ('book','sop','proposal','conversation','document','test_fixture')),
  filename text,
  storage_bucket text,
  storage_path text,
  provenance text,
  sha256 text not null unique,
  mime_type text,
  page_count integer not null default 0,
  page_label_basis text check (page_label_basis in ('pdf_page_labels','printed_on_page','pdf_index_only','line_ranges')),
  copyright_class text not null default 'unknown' check (copyright_class in ('owned','licensed','public_domain','third_party_copyrighted','unknown')),
  brand text,
  project_ref text,
  ingestion_status text not null default 'ingesting' check (ingestion_status in ('ingesting','complete','partial','failed')),
  ingestion_report jsonb not null default '{}'::jsonb,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.fkaios_knowledge_pages (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.fkaios_knowledge_sources(id) on delete cascade,
  pdf_page integer not null check (pdf_page >= 1),
  printed_label text,
  label_basis text check (label_basis in ('pdf_page_labels','printed_on_page','inferred_offset','line_range')),
  line_start integer,
  line_end integer,
  text text not null default '',
  char_count integer not null default 0,
  extraction text not null check (extraction in ('text_layer','ocr','none','plain_text')),
  ocr_resource text,
  needs_ocr boolean not null default false,
  completeness text not null check (completeness in ('complete','partial','ocr_derived','uncertain')),
  fts tsvector generated always as (to_tsvector('english', coalesce(text, ''))) stored,
  created_at timestamptz not null default now(),
  unique (source_id, pdf_page)
);
create index fkaios_knowledge_pages_fts on public.fkaios_knowledge_pages using gin (fts);
create index fkaios_knowledge_pages_label on public.fkaios_knowledge_pages (source_id, printed_label);

create table public.fkaios_discovery_runs (
  id uuid primary key default gen_random_uuid(),
  trigger text not null check (trigger in ('scheduled','manual','self_test')),
  schedule_date date,
  timezone text not null default 'Asia/Kolkata',
  status text not null default 'running' check (status in ('running','completed','partial','failed')),
  sources jsonb not null default '{}'::jsonb,
  seen_count integer not null default 0,
  new_count integer not null default 0,
  updated_count integer not null default 0,
  high_value jsonb not null default '[]'::jsonb,
  evidence_id uuid,
  error text,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);
-- One scheduled run per local day; a crashed run is retried by the next tick after it is marked failed.
create unique index fkaios_discovery_runs_one_scheduled_per_day on public.fkaios_discovery_runs (schedule_date) where trigger = 'scheduled' and status <> 'failed';

create table public.fkaios_ecosystem_candidates (
  id uuid primary key default gen_random_uuid(),
  canonical_key text not null unique,
  source text not null check (source in ('mcp_registry','github','huggingface','openrouter')),
  kind text not null check (kind in ('mcp_server','repository','model','free_model')),
  name text not null,
  url text,
  description text,
  version text,
  license text,
  metrics jsonb not null default '{}'::jsonb,
  content_hash text not null,
  relevance_score numeric not null default 0,
  relevance_reasons text[] not null default '{}',
  risk_class text not null check (risk_class in ('metadata_only','executable_code','remote_service','requires_credentials')),
  status text not null default 'new' check (status in ('new','shortlisted','dismissed','under_test','adopted','rejected')),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  last_changed_at timestamptz not null default now(),
  first_run_id uuid references public.fkaios_discovery_runs(id),
  last_run_id uuid references public.fkaios_discovery_runs(id)
);
create index fkaios_ecosystem_candidates_rank on public.fkaios_ecosystem_candidates (relevance_score desc, last_changed_at desc);

alter table public.fkaios_knowledge_sources enable row level security;
alter table public.fkaios_knowledge_pages enable row level security;
alter table public.fkaios_discovery_runs enable row level security;
alter table public.fkaios_ecosystem_candidates enable row level security;
revoke all on public.fkaios_knowledge_sources, public.fkaios_knowledge_pages, public.fkaios_discovery_runs, public.fkaios_ecosystem_candidates from anon, authenticated;

-- Ranked full-text passage search with an excerpt (service role only).
create or replace function public.fkaios_search_knowledge(p_query text, p_kind text default null, p_limit integer default 5)
returns table (source_id uuid, title text, source_kind text, provenance text, pdf_page integer, printed_label text, line_start integer, line_end integer, completeness text, rank real, excerpt text)
language sql stable security definer set search_path = public as $f$
  select s.id, s.title, s.source_kind, s.provenance, p.pdf_page, p.printed_label, p.line_start, p.line_end, p.completeness,
         ts_rank_cd(p.fts, q) as rank,
         ts_headline('english', p.text, q, 'MaxFragments=2, MaxWords=40, MinWords=15, StartSel=«, StopSel=»') as excerpt
  from public.fkaios_knowledge_pages p
  join public.fkaios_knowledge_sources s on s.id = p.source_id
  cross join lateral websearch_to_tsquery('english', p_query) q
  where p.fts @@ q and (p_kind is null or s.source_kind = p_kind)
  order by rank desc, s.title, p.pdf_page
  limit greatest(1, least(coalesce(p_limit, 5), 20));
$f$;
revoke all on function public.fkaios_search_knowledge(text, text, integer) from public, anon, authenticated;

alter table public.fkaios_verification_evidence drop constraint fkaios_verification_evidence_objective_required;
alter table public.fkaios_verification_evidence add constraint fkaios_verification_evidence_objective_required
  check (objective_id is not null or requirement_key ~ '^(eval|self_test|communication|discovery|knowledge):');

-- A self-test request may name the scenarios to run (null = all).
alter table public.fkaios_self_tests add column scenarios text[];
