-- FKAIOS production-fix pass — Provider Availability (item 6).
--
-- THE GAP: llm-router.ts is deliberately stateless (no DB calls — see its own
-- header comment) and per-invocation, so a provider that is known to be
-- unavailable right now (OpenAI has zero credits in this deployment) was
-- still tried on every single job, every 5-minute ai-engine-run-jobs-5min
-- tick, forever — a guaranteed, wasted failure each time, indistinguishable
-- from a fresh outage the router had never seen before.
--
-- THE FIX: a small, explicit, cross-invocation health table that callers
-- (ai-engine) consult before building their provider candidate list, and
-- update from the router's own structured per-attempt failure categories
-- (LLMCallLogEntry.attempts — see llm-router.ts). This does NOT live inside
-- llm-router.ts itself, preserving its "no Supabase calls" architecture; the
-- calling function owns the read/write, the router stays pure.
--
-- Distinguishes outage vs credit exhaustion vs auth failure vs transient
-- failure by TTL: a durable problem (credit exhaustion, bad/missing key)
-- suppresses the provider far longer than a transient one (rate limit,
-- timeout, one-off 5xx) so recovery is automatic once the underlying issue
-- is fixed, without ever hardcoding "OpenAI is down" anywhere in code.
CREATE TABLE IF NOT EXISTS public.provider_health_state (
  provider text PRIMARY KEY,
  status text NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'degraded', 'unavailable')),
  failure_category text,
  reason text,
  -- NULL means "no suppression currently in effect". A row is read as
  -- unavailable only while now() < unavailable_until.
  unavailable_until timestamptz,
  consecutive_failures integer NOT NULL DEFAULT 0,
  last_success_at timestamptz,
  last_failure_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.provider_health_state ENABLE ROW LEVEL SECURITY;

-- Service-role only (edge functions use the service role key) — this is
-- internal routing state, not tenant data, and carries no user-facing RLS
-- shape to define.
CREATE POLICY provider_health_state_service_role_only ON public.provider_health_state
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

COMMENT ON TABLE public.provider_health_state IS
  'Cross-invocation LLM provider availability, read/written by calling functions (e.g. ai-engine) — never by llm-router.ts itself, which stays stateless. Rows recover automatically once unavailable_until passes or a call succeeds.';
