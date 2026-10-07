-- Applied in production as version 20260709041221 (add_avatar_readonly_query_function).
-- Exported read-only from supabase_migrations.schema_migrations on 2026-10-07 (md5 of statements: 7fc75f375218e81d3e3658b6fcb2f105).
-- Record only: do not apply from this folder.

-- Read-only SQL capability for the agentic founder avatar brain.
-- Lets the LLM answer ANY business question from real data with one general
-- tool instead of a hardcoded handler per question. Guarded: single SELECT
-- only, no write/DDL keywords, 50-row cap, 4s timeout, service_role only.
create or replace function avatar_readonly_query(q text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  result jsonb;
  lowered text := lower(q);
begin
  if lowered !~ '^\s*select' then
    raise exception 'Only SELECT statements are allowed';
  end if;
  if position(';' in q) > 0 then
    raise exception 'Multiple statements are not allowed';
  end if;
  if lowered ~ '\m(insert|update|delete|drop|alter|create|grant|revoke|truncate|copy|vacuum)\M' then
    raise exception 'Write/DDL keywords are not allowed';
  end if;
  execute 'set local statement_timeout = ''4s''';
  execute 'select coalesce(jsonb_agg(row_to_json(t)), ''[]''::jsonb) from (select * from (' || q || ') inner_q limit 50) t' into result;
  return result;
end;
$$;

revoke all on function avatar_readonly_query(text) from public;
revoke all on function avatar_readonly_query(text) from anon;
revoke all on function avatar_readonly_query(text) from authenticated;
grant execute on function avatar_readonly_query(text) to service_role;
