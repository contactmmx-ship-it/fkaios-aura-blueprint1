-- This table and key row were created in production on 26 Oct 2026.
-- Keep this migration idempotent so it can be applied safely once the
-- repository/live migration-history reconciliation is complete.
create table if not exists public.fkaios_ingest_keys(
  name text primary key,
  key text not null default encode(gen_random_bytes(24),'hex'),
  created_at timestamptz default now()
);
alter table public.fkaios_ingest_keys enable row level security;
revoke all on public.fkaios_ingest_keys from anon, authenticated;
insert into public.fkaios_ingest_keys(name) values('knowledge-bulk-ingest') on conflict do nothing;
