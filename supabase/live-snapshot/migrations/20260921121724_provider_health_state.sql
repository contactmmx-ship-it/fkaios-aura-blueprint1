-- Applied in production as version 20260921121724 (provider_health_state).
-- Exported read-only from supabase_migrations.schema_migrations on 2026-10-07 (md5 of statements: 692efeab545f2246a0917622c09f563a).
-- Record only: do not apply from this folder.

CREATE TABLE IF NOT EXISTS public.provider_health_state (
  provider text PRIMARY KEY,
  status text NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'degraded', 'unavailable')),
  failure_category text,
  reason text,
  unavailable_until timestamptz,
  consecutive_failures integer NOT NULL DEFAULT 0,
  last_success_at timestamptz,
  last_failure_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.provider_health_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY provider_health_state_service_role_only ON public.provider_health_state
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

COMMENT ON TABLE public.provider_health_state IS
  'Cross-invocation LLM provider availability, read/written by calling functions (e.g. ai-engine) -- never by llm-router.ts itself, which stays stateless. Rows recover automatically once unavailable_until passes or a call succeeds.';
