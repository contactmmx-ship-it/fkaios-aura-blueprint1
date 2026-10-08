-- Applied in production as version 20261007104810 (backlog_cleanup_audit_step4_a_duplicate_approvals).
-- Exported read-only from supabase_migrations.schema_migrations on 2026-10-08 (md5 of statements: b7efa6ec2c7ca13a381d51f68e9e3d43).
-- Part A of supabase/migrations/20261007120000_backlog_cleanup_audit_step4.sql.
-- Record only: do not apply from this folder.

set local lock_timeout = '5s';
with ranked as (
  select id, row_number() over (partition by payload->>'lead_id' order by created_at desc) rn
  from public.approvals
  where status = 'pending' and action_type = 'price_and_send_proposal' and payload ? 'lead_id'
)
update public.approvals a
set status = 'expired',
    decided_by = 'system:audit-2026-10-07',
    decided_at = now(),
    reason = left('[Expired 2026-10-07: duplicate re-draft; the newest proposal for this lead is still pending] ' || coalesce(a.reason, ''), 4000)
from ranked r
where a.id = r.id and r.rn > 1;
