-- Applied in production as version 20260708162356 (fleet_wide_shared_memory).
-- Exported read-only from supabase_migrations.schema_migrations on 2026-10-07 (md5 of statements: 886f7ccfa36c58861074c22e23ea9fd7).
-- Record only: do not apply from this folder.


create extension if not exists vector;

create table if not exists public.fleet_memory (
  id uuid primary key default gen_random_uuid(),
  source_agent_id uuid references public.ai_agents(id) on delete set null,
  source_department text,
  memory_type text not null,
  title text not null,
  content text not null,
  structured_content jsonb,
  visible_to_departments text[] default array['*']::text[],
  visible_to_agents uuid[] default '{}',
  confidence numeric default 0.7,
  embedding vector(384),
  related_lead_id uuid references public.leads(id) on delete set null,
  related_brand_id uuid references public.brands(id) on delete set null,
  expires_at timestamptz,
  created_at timestamptz default now()
);
