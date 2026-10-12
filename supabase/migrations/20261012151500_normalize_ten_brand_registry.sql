-- Normalize the canonical brand names from the approved FKAIOS objective and
-- add only the two explicitly named brands missing from both registries.
-- Existing brand IDs and slugs are preserved to avoid breaking references/routes.
-- No customer leads, investment figures, royalties, or CRM activity are fabricated.
do $migration$
declare
  v_franchise_company uuid;
begin
  select id into v_franchise_company from public.companies where name = 'Franchise Kart' limit 1;
  if v_franchise_company is null then
    raise exception 'Franchise Kart company row is missing; refusing to seed brand registry';
  end if;

  update public.brands set name = 'Franchise Kart', updated_at = now()
    where name = 'Franchisee Kart'
      and not exists (select 1 from public.brands where name = 'Franchise Kart');
  update public.brands set name = 'Chawla Lab', updated_at = now()
    where name = 'Chawla Laboratory'
      and not exists (select 1 from public.brands where name = 'Chawla Lab');
  update public.brands set name = 'Turning Point', updated_at = now()
    where name = 'Turning Points'
      and not exists (select 1 from public.brands where name = 'Turning Point');

  update public.brain_brands set name = 'Franchise Kart'
    where name = 'Franchisee Kart'
      and not exists (select 1 from public.brain_brands where name = 'Franchise Kart');
  update public.brain_brands set name = 'Chawla Lab'
    where name = 'Chawla Laboratory'
      and not exists (select 1 from public.brain_brands where name = 'Chawla Lab');
  update public.brain_brands set name = 'Turning Point'
    where name = 'Turning Points'
      and not exists (select 1 from public.brain_brands where name = 'Turning Point');

  insert into public.brands (name, description, vertical, status, slug, type, sector, is_active, company_id)
  select 'Kids DPS', 'NEP-style preschool curriculum for ages 2–6; Powered by Franchise Kart',
         'Preschool', 'active', 'kids-dps', 'franchise', 'Education', true, v_franchise_company
  where not exists (select 1 from public.brands where name = 'Kids DPS');

  insert into public.brands (name, vertical, status, slug, type, is_active, company_id)
  select 'Knead & Bake', 'Other', 'active', 'knead-and-bake', 'franchise', true, v_franchise_company
  where not exists (select 1 from public.brands where name = 'Knead & Bake');

  insert into public.brain_brands (name, sector)
  select 'Kids DPS', 'Education'
  where not exists (select 1 from public.brain_brands where name = 'Kids DPS');

  insert into public.brain_brands (name)
  select 'Knead & Bake'
  where not exists (select 1 from public.brain_brands where name = 'Knead & Bake');
end;
$migration$;
