-- Applied in production as version 20260707083521 (create_founder_principles).
-- Exported read-only from supabase_migrations.schema_migrations on 2026-10-07 (md5 of statements: 91027c3fc3c3dadef653a3dfc4e9f3f5).
-- Record only: do not apply from this folder.

create table if not exists founder_principles (
  id uuid primary key default gen_random_uuid(),
  principle text not null,
  category text not null default 'general',
  applies_to text[] not null default array['*'],
  source text not null default 'seeded',
  weight int not null default 5,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table founder_principles enable row level security;

create policy "service role full access" on founder_principles
  for all
  using (true)
  with check (true);
