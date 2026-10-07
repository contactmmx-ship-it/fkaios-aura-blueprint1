-- Applied in production as version 20260714100426 (software_factory_foundations).
-- Exported read-only from supabase_migrations.schema_migrations on 2026-10-07 (md5 of statements: 3c621d906ae1d650ccaf1809d1541b2c).
-- Record only: do not apply from this folder.

-- SOFTWARE FACTORY — FOUNDATIONS (Component Marketplace + Manufacturing Pipeline).
--
-- SCOPE HONESTY, STATED UP FRONT: this ships the INTAKE and PLANNING half of the
-- factory — the half that can be built truthfully today and verified. Autonomous
-- code generation -> test -> deploy is NOT shipped and is NOT claimed. Marking a
-- project 'deployed' that nobody deployed is exactly the fabrication that produced
-- 5,970 fake job completions. Stages the factory cannot yet perform are named
-- explicitly as NOT_AUTOMATED rather than silently skipped.
--
-- (1) COMPONENT MARKETPLACE — "always reuse before rebuilding" is unenforceable
--     without an inventory. Every component must carry EVIDENCE (a real file or
--     function). The DB refuses one that does not.
CREATE TABLE IF NOT EXISTS public.component_library (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL UNIQUE,
  kind          text NOT NULL,      -- ui | engine | schema | integration | pipeline
  does          text NOT NULL,
  evidence      text NOT NULL,      -- MANDATORY: the real file / edge function / table
  reused_count  integer NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT component_evidence_real CHECK (length(trim(evidence)) > 8)
);

INSERT INTO public.component_library (name, kind, does, evidence) VALUES
 ('Public Lead Capture', 'pipeline', 'Public form -> hard validation -> dedupe -> lead row with NULL score so the qualifier sees it.', 'edge fn: lead-capture v2; route: /franchise, /products'),
 ('BANT Qualifier', 'engine', 'LLM scores a lead 0-100 on Budget/Authority/Need/Timeline; advances at >=40. Cost + model attributed per call.', 'edge fn: auto-agents-engine v7 (qualify phase)'),
 ('Proposal Drafter', 'engine', 'Qualified lead -> scope, deliverables, ASSUMPTIONS and UNKNOWNS. Forbidden from inventing a price.', 'edge fn: proposal-engine v1; table: client_projects'),
 ('Human-Gated Invoicing', 'pipeline', 'AI drafts an invoice; Founder approves; only then is it sent. AI never moves money.', 'edge fn: invoice-engine; component: src/components/fkaios/RevenueDesk.tsx'),
 ('Data Lineage Panel', 'ui', 'Any number opens its source table, derivation, underlying rows and owner.', 'component: src/components/fkaios/LineagePanel.tsx'),
 ('LLM Cost Ledger', 'engine', 'One RPC records model, provider, why-chosen, prompt version, retries, tokens, cost, department, business objective.', 'fn: log_llm_cost(); view: v_cost_coverage; table: agent_performance_metrics'),
 ('Marketing-Safe Public API', 'integration', 'Serves ONLY hand-picked columns to anonymous clients. Prevents RLS row-level policies from leaking commercial columns (royalty, internal paths).', 'edge fn: brands-public, products-public'),
 ('Grounded Proposal Engine (LLM)', 'engine', 'LLM tool-use pattern: emit-only output, mandatory evidence field, server-computed ranking so the model cannot game its own score.', 'edge fn: opportunity-engine, evolution-engine, executive-brain'),
 ('Silent-Failure Monitor', 'engine', 'Detects work that claims success but produced nothing. Silence is never consent.', 'edge fn: silence-monitor v3; fn: compute_revenue_blockers()'),
 ('SEO Front Door', 'ui', 'Public page + metadata + JSON-LD + robots (disallow-by-default, allow-by-exception) + sitemap.', 'src/app/robots.ts, src/app/sitemap.ts, src/app/franchise/layout.tsx')
ON CONFLICT (name) DO NOTHING;

ALTER TABLE public.component_library ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS component_select ON public.component_library;
CREATE POLICY component_select ON public.component_library FOR SELECT TO authenticated USING (true);

-- (2) MANUFACTURING PIPELINE. Stages the factory can genuinely perform are marked
--     AUTOMATED. Stages it cannot are marked NOT_AUTOMATED and will say so on every
--     project, forever, until they are real.
CREATE TABLE IF NOT EXISTS public.software_projects (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request            text NOT NULL,          -- the Founder's sentence, verbatim
  product_name       text,
  stage              text NOT NULL DEFAULT 'planned'
                     CHECK (stage IN ('planned','approved','building','testing','deployed','rejected')),
  business_analysis  text,
  architecture       text,
  data_model         text,
  api_surface        text,
  ui_scope           text,
  reused_components  text[],                 -- reuse-before-rebuild, enforced
  new_components     text[],
  unknowns           text[],                 -- what we do NOT know. Mandatory honesty.
  est_build_days     integer,
  est_llm_cost_usd   numeric,
  price_inr          numeric,                -- NULL. Founder gate. Never guessed.
  pricing_status     text NOT NULL DEFAULT 'UNKNOWN — FOUNDER MUST SET',
  automation_status  text NOT NULL DEFAULT 'PLAN ONLY — code generation, testing and deployment are NOT autonomous yet. This project is planned, not built.',
  model              text,
  created_at         timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.software_projects ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sw_select ON public.software_projects;
CREATE POLICY sw_select ON public.software_projects FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS sw_update ON public.software_projects;
CREATE POLICY sw_update ON public.software_projects FOR UPDATE TO authenticated USING (true);

CREATE OR REPLACE FUNCTION public.compute_software_factory()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_projects int; v_components int; v_reuse numeric; v_list jsonb;
BEGIN
  SELECT count(*) INTO v_projects FROM software_projects;
  SELECT count(*) INTO v_components FROM component_library;
  SELECT COALESCE(ROUND(AVG(
      CASE WHEN COALESCE(array_length(reused_components,1),0) + COALESCE(array_length(new_components,1),0) = 0 THEN 0
      ELSE 100.0 * COALESCE(array_length(reused_components,1),0)
           / (COALESCE(array_length(reused_components,1),0) + COALESCE(array_length(new_components,1),0)) END), 1), 0)
    INTO v_reuse FROM software_projects;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'request', request, 'product_name', product_name, 'stage', stage,
    'reused', reused_components, 'new', new_components, 'unknowns', unknowns,
    'est_build_days', est_build_days, 'pricing_status', pricing_status,
    'automation_status', automation_status) ORDER BY created_at DESC), '[]'::jsonb)
    INTO v_list FROM software_projects;
  RETURN jsonb_build_object(
    'projects', v_projects,
    'components_in_marketplace', v_components,
    'avg_reuse_pct', v_reuse,
    'honest_scope', 'The factory can currently ANALYSE, ARCHITECT, PLAN and decide REUSE autonomously. It CANNOT yet generate code, test or deploy without engineers. No project will ever be marked deployed by a machine that did not deploy it.',
    'projects_detail', v_list);
END; $$;

REVOKE ALL ON FUNCTION public.compute_software_factory() FROM public;
GRANT EXECUTE ON FUNCTION public.compute_software_factory() TO service_role, authenticated;
