-- Applied in production as version 20260706162748 (link_brands_to_companies).
-- Exported read-only from supabase_migrations.schema_migrations on 2026-10-07 (md5 of statements: f61d174dab60e2ccc3473119f33b75ab).
-- Record only: do not apply from this folder.


alter table brands add column if not exists company_id uuid references companies(id);

update brands set company_id = (select id from companies where name = 'Franchise Kart')
where company_id is null;

alter table leads add column if not exists company_id uuid references companies(id);

update leads l set company_id = b.company_id
from brands b where l.brand_id = b.id and l.company_id is null;
