-- Applied in production as version 20260710082535 (enterprise_knowledge_network_activation).
-- Exported read-only from supabase_migrations.schema_migrations on 2026-10-07 (md5 of statements: cc14242eca2ea81b6628e30f70647f83).
-- Record only: do not apply from this folder.

-- ENTERPRISE KNOWLEDGE NETWORK activation (governed decision 55106426, APPROVED).
-- Extends the existing empty fleet_memory; builds no parallel store.

-- Retrieval view: organizational knowledge, freshest first, non-expired.
create or replace view v_enterprise_knowledge as
select id, source_department, memory_type, title, content, structured_content,
       confidence, visible_to_departments, related_lead_id, related_brand_id, created_at
from fleet_memory
where expires_at is null or expires_at > now()
order by created_at desc;

-- Write helper: any engine can deposit organizational knowledge in one call.
-- Embedding is optional — if generation fails, memory still persists (degrades
-- to recency retrieval, never loses the knowledge). Law 9 made operational.
create or replace function record_enterprise_memory(
  p_source_department text,
  p_memory_type text,
  p_title text,
  p_content text,
  p_structured jsonb default '{}'::jsonb,
  p_confidence numeric default 0.7,
  p_visible_departments text[] default array['*']
) returns uuid language plpgsql security definer as $$
declare new_id uuid;
begin
  insert into fleet_memory (source_department, memory_type, title, content, structured_content, confidence, visible_to_departments)
  values (p_source_department, p_memory_type, p_title, p_content, p_structured, p_confidence, p_visible_departments)
  returning id into new_id;
  return new_id;
end; $$;

grant execute on function record_enterprise_memory to service_role;
