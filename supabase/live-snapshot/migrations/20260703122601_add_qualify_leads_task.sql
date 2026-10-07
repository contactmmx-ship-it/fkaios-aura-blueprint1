-- Applied in production as version 20260703122601 (add_qualify_leads_task).
-- Exported read-only from supabase_migrations.schema_migrations on 2026-10-07 (md5 of statements: 2cec8294df72f6aeff7f765954e09e85).
-- Record only: do not apply from this folder.

INSERT INTO scheduled_tasks (task_key, label, action, action_payload, interval_minutes)
SELECT 'qualify_leads', 'AI Lead Qualification', 'qualify_leads', '{}'::jsonb, 15
WHERE NOT EXISTS (SELECT 1 FROM scheduled_tasks WHERE task_key = 'qualify_leads');
