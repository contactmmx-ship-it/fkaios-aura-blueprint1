-- Applied in production as version 20260707140358 (phase3_revenue_chain_support).
-- Exported read-only from supabase_migrations.schema_migrations on 2026-10-07 (md5 of statements: 543c7829b04df256774248648ac56fcc).
-- Record only: do not apply from this folder.

-- Extend company_invoices to track collection, closing the loop to Accounts
alter table company_invoices add column if not exists amount_received_inr numeric default 0;
alter table company_invoices add column if not exists payment_received_at timestamptz;
alter table company_invoices add column if not exists lead_id uuid references leads(id);
alter table company_invoices add column if not exists approval_id uuid references approvals(id);

-- status values used by the new chain: draft -> pending_approval -> approved -> sent -> paid -> rejected
