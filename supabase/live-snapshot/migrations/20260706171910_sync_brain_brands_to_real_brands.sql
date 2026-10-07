-- Applied in production as version 20260706171910 (sync_brain_brands_to_real_brands).
-- Exported read-only from supabase_migrations.schema_migrations on 2026-10-07 (md5 of statements: cbcd5bffb3ac68aa9647df43ac4ae078).
-- Record only: do not apply from this folder.


-- Fix the two brands with genuinely wrong/conflicting data in brain_brands,
-- using the real `brands` table (your operational source of truth) as ground truth.
update brain_brands set name = 'Arofur', sector = 'Furniture', investment_min = 2000000, investment_max = 10000000
where name = 'Arofur';

update brain_brands set name = 'Turning Points', sector = 'Immigration', investment_min = 50000, investment_max = 200000
where name = 'Turning Point';

update brain_brands set name = 'Chawla Laboratory' where name = 'Chawla Lab';

-- Franchisee Kart (the platform itself) existed in `brands` but was missing
-- from brain_brands entirely — added so AI Brain/Business Creator context
-- includes it.
insert into brain_brands (name, sector, investment_min, investment_max)
select 'Franchisee Kart', 'Consulting', 500000, 5000000
where not exists (select 1 from brain_brands where name = 'Franchisee Kart');
