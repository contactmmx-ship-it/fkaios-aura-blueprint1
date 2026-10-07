-- Applied in production as version 20260707140502 (phase3_founder_notifications).
-- Exported read-only from supabase_migrations.schema_migrations on 2026-10-07 (md5 of statements: 479a1eb252dc23c788a4db2ed569eb89).
-- Record only: do not apply from this folder.

create table if not exists founder_notifications (
  id uuid primary key default gen_random_uuid(),
  type text not null,
  title text not null,
  detail text,
  department_code text,
  related_id uuid,
  amount_inr numeric,
  is_read boolean default false,
  created_at timestamptz default now()
);
alter table founder_notifications enable row level security;
create policy "service role full access" on founder_notifications for all using (true) with check (true);
