-- Applied in production as version 20260706164704 (add_company_id_to_brain_tools).
-- Exported read-only from supabase_migrations.schema_migrations on 2026-10-07 (md5 of statements: cd1b2b6af8a2fe76889d7948b75ddca4).
-- Record only: do not apply from this folder.


alter table brain_decisions add column if not exists company_id uuid references companies(id);
alter table brain_staff_reports add column if not exists company_id uuid references companies(id);
alter table brain_learning_insights add column if not exists company_id uuid references companies(id);
