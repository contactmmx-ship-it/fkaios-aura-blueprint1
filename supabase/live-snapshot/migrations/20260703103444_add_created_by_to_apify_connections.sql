-- Applied in production as version 20260703103444 (add_created_by_to_apify_connections).
-- Exported read-only from supabase_migrations.schema_migrations on 2026-10-07 (md5 of statements: c891117abe0243dc2b496c956793ef53).
-- Record only: do not apply from this folder.

ALTER TABLE public.apify_connections ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES public.consultants(id) ON DELETE SET NULL;
