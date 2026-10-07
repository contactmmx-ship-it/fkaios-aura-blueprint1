-- Applied in production as version 20260714094908 (cost_identity_reconciliation_v2).
-- Exported read-only from supabase_migrations.schema_migrations on 2026-10-07 (md5 of statements: c1071ba0f45c2ace51fb8d195af98395).
-- Record only: do not apply from this folder.

-- Column order changed, so the view must be dropped and recreated (Postgres refuses
-- an in-place rename via CREATE OR REPLACE). compute_cost_coverage() reads it by name,
-- so it is unaffected.
DROP VIEW IF EXISTS public.v_cost_coverage;

CREATE TABLE IF NOT EXISTS public.agent_aliases (
  slug        text PRIMARY KEY,
  agent_name  text,
  is_engine   boolean NOT NULL DEFAULT true,
  note        text
);

INSERT INTO public.agent_aliases (slug, agent_name, is_engine, note) VALUES
  ('lead-qualifier',         'Lead Qualifier AI', false, 'BANT scorer. Instrumented 2026-07-13.'),
  ('ceo-engine',             'CEO AI',            false, 'Opportunity generation (self-thinking loop).'),
  ('founder-avatar',          NULL,               true,  'Founder-facing service, not a roster employee. 100% of measured spend to date and NO revenue path.'),
  ('executive-intelligence',  NULL,               true,  'Executive cognition loop. LOGS but does NOT cost — spend UNKNOWN.'),
  ('research-engine',         NULL,               true,  'Market research. LOGS but does NOT cost — spend UNKNOWN.'),
  ('evolution-engine',        NULL,               true,  'Grades the enterprise against itself; chooses what gets built.'),
  ('proposal-engine',         NULL,               true,  'Drafts proposals; forbidden from inventing a price.'),
  ('ai-engine',               NULL,               true,  'Generic job runner. Fabrication path removed v42.')
ON CONFLICT (slug) DO NOTHING;

GRANT SELECT ON public.agent_aliases TO service_role, authenticated;

CREATE VIEW public.v_cost_coverage AS
WITH dispatched AS (
  SELECT a.name AS agent_name, count(*) AS dispatches
  FROM agent_dispatch_log d
  JOIN ai_agents a ON a.id = d.agent_id
  GROUP BY a.name
),
costed AS (
  SELECT COALESCE(al.agent_name, m.agent_id) AS agent_name,
         count(*) AS cost_rows,
         COALESCE(SUM(m.estimated_cost_usd), 0) AS spend_usd,
         count(*) FILTER (WHERE m.estimated_cost_usd IS NULL) AS unknown_cost_rows
  FROM agent_performance_metrics m
  LEFT JOIN agent_aliases al ON al.slug = m.agent_id
  GROUP BY COALESCE(al.agent_name, m.agent_id)
)
SELECT
  COALESCE(d.agent_name, c.agent_name)                            AS agent,
  COALESCE(d.dispatches, 0)                                       AS dispatches,
  COALESCE(c.cost_rows, 0)                                        AS cost_rows,
  ROUND(COALESCE(c.spend_usd, 0)::numeric, 4)                     AS known_spend_usd,
  COALESCE(c.unknown_cost_rows, 0)                                AS rows_with_unknown_cost,
  GREATEST(0, COALESCE(d.dispatches,0) - COALESCE(c.cost_rows,0)) AS uncosted_dispatches,
  CASE WHEN COALESCE(d.dispatches,0) = 0 THEN 100
       ELSE ROUND(100.0 * LEAST(COALESCE(c.cost_rows,0), d.dispatches) / d.dispatches, 1)
  END                                                             AS coverage_pct
FROM dispatched d
FULL OUTER JOIN costed c ON c.agent_name = d.agent_name
ORDER BY uncosted_dispatches DESC;

GRANT SELECT ON public.v_cost_coverage TO service_role, authenticated;
