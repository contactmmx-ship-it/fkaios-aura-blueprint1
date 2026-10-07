-- Applied in production as version 20260707232551 (phase7_8_ingestion_pr_legal).
-- Exported read-only from supabase_migrations.schema_migrations on 2026-10-07 (md5 of statements: 7b03a82a7ac293bf330cfb7312114300).
-- Record only: do not apply from this folder.

-- Phase 7 support: generic lead ingestion log, one row per inbound platform
-- event, so once real API keys/webhooks are added the pipeline just works.
create table if not exists lead_ingestion_log (
  id uuid primary key default gen_random_uuid(),
  platform text not null check (platform in ('instagram','facebook','whatsapp','google','youtube','twitter','linkedin','manual')),
  raw_payload jsonb,
  lead_id uuid references leads(id),
  status text default 'received' check (status in ('received','normalized','duplicate','failed')),
  error text,
  created_at timestamptz default now()
);
alter table lead_ingestion_log enable row level security;
create policy "service role full access" on lead_ingestion_log for all using (true) with check (true);

-- Phase 8 support: Legal department real reviews
create table if not exists legal_reviews (
  id uuid primary key default gen_random_uuid(),
  contract_text text not null,
  contract_title text,
  risk_flags jsonb,
  summary text,
  reviewed_by_agent text default 'legal-engine',
  created_at timestamptz default now()
);
alter table legal_reviews enable row level security;
create policy "service role full access" on legal_reviews for all using (true) with check (true);
