-- Defense in depth: an RLS-enabled table with no policies denies all rows,
-- but broad API grants still expose an unnecessary permission surface. These
-- tables are not currently usable by anon/authenticated through RLS; remove
-- the redundant grants until explicit policies are reviewed and added.
-- Service-role and owner access are intentionally preserved.
do $migration$
declare
  r record;
begin
  for r in
    select n.nspname as schema_name, c.relname as table_name
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r', 'p')
      and c.relrowsecurity
      and not exists (
        select 1
        from pg_policies p
        where p.schemaname = n.nspname
          and p.tablename = c.relname
      )
  loop
    execute format(
      'revoke all privileges on table %I.%I from public, anon, authenticated',
      r.schema_name,
      r.table_name
    );
  end loop;
end;
$migration$;
