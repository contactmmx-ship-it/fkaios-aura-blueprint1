-- Applied in production as version 20261007105223 (backlog_cleanup_audit_step4_c_archive_stale_projects).
-- Exported read-only from supabase_migrations.schema_migrations on 2026-10-08 (md5 of statements: 1cc81fe00184ef8743b01a449268d9b7).
-- Part C of supabase/migrations/20261007120000_backlog_cleanup_audit_step4.sql.
-- Record only: do not apply from this folder.

set local lock_timeout = '5s';
with stale as (
  select p.id, r.id as objective_id, r.status as objective_status
  from public.orchestration_projects p
  join public.orchestrator_requests r
    on r.id::text = substring(p.request from '^\[objective:([0-9a-f-]{36})\]')
  where p.status in ('planning', 'working', 'reviewing', 'reworking', 'merging')
    and (r.status = 'failed'
         or (r.status = 'completed' and exists (
               select 1 from public.orchestration_projects c
               where c.request like '[objective:' || r.id || ']%' and c.status = 'complete')))
)
update public.orchestration_projects p
set status = 'failed',
    error_message = left('Archived 2026-10-07 (audit step 4): objective ' || s.objective_id || ' is ' || s.objective_status
      || '; this project was left ' || p.status || '. ' || coalesce(p.error_message, ''), 4000)
from stale s
where p.id = s.id;
