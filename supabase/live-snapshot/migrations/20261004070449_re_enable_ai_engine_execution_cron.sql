-- Applied in production as version 20261004070449 (re_enable_ai_engine_execution_cron).
-- Exported read-only from supabase_migrations.schema_migrations on 2026-10-07 (md5 of statements: 7c7ae956b808c5f7aeb0d0e5a11ce192).
-- Record only: do not apply from this folder.

select cron.alter_job(27, active := true);
