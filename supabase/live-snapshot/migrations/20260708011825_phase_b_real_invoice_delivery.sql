-- Applied in production as version 20260708011825 (phase_b_real_invoice_delivery).
-- Exported read-only from supabase_migrations.schema_migrations on 2026-10-07 (md5 of statements: d81f1ed2a0e3da85441e8e321711f14f).
-- Record only: do not apply from this folder.

alter table company_invoices add column if not exists delivery_channel text;
alter table company_invoices add column if not exists delivery_status text;
