-- Applied in production as version 20260714082105 (aura_tech_product_library).
-- Exported read-only from supabase_migrations.schema_migrations on 2026-10-07 (md5 of statements: 54bcd7246e21f18bf4dcd51b8bc1e1af).
-- Record only: do not apply from this folder.

-- AURA TECH PRODUCT LIBRARY (Product Factory — mandated highest-priority division).
--
-- WHY THIS IS COMMERCIAL, NOT ADMINISTRATIVE: Aura Tech has already BUILT working
-- systems. None of them were listed as sellable assets, so every one is dead capital.
-- You cannot sell what you cannot list. This turns shipped work into a resellable /
-- white-labelable portfolio — Strategy B (services) and Strategy C (licensing) in the
-- board pack both depend on it.
--
-- TRUTH POLICY ENFORCED IN THE SCHEMA: every asset MUST carry `evidence` — the actual
-- edge-function slug, table, or repo path that proves it exists. An asset with no
-- evidence cannot be inserted. Nothing is catalogued that cannot be pointed at.
-- Commercial values are NOT invented: list_price_inr is NULL and pricing is a Founder
-- Approval Gate.
CREATE TABLE IF NOT EXISTS public.product_library (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text NOT NULL,
  category        text NOT NULL,
  what_it_does    text NOT NULL,
  sellable_as     text,                       -- white-label | module | service | saas
  target_buyer    text,
  evidence        text NOT NULL,              -- MANDATORY proof this exists
  status          text NOT NULL DEFAULT 'shipped'
                  CHECK (status IN ('shipped','in_build','proposed','retired')),
  reusable        boolean NOT NULL DEFAULT true,
  list_price_inr  numeric,                    -- UNKNOWN. Founder gate. Never guessed.
  pricing_status  text NOT NULL DEFAULT 'UNKNOWN — FOUNDER MUST SET',
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT evidence_must_be_real CHECK (length(trim(evidence)) > 8)
);

ALTER TABLE public.product_library ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS product_library_select ON public.product_library;
CREATE POLICY product_library_select ON public.product_library FOR SELECT TO authenticated USING (true);

-- Seed ONLY with assets provable in this repo / this Supabase project, verified today.
INSERT INTO public.product_library (name, category, what_it_does, sellable_as, target_buyer, evidence, status)
VALUES
('Inbound Franchise Enquiry Funnel', 'Franchise Tech',
 'Public enquiry page + hard-validated capture + AI BANT scoring. Captures phone, city, investment capacity and timeline — the four axes a scraped lead can never supply.',
 'white-label', 'Any franchisor or franchise consultancy acquiring franchisees',
 'edge fn: lead-capture v2, brands-public v1; route: /franchise (verified HTTP 200 live); fn: auto-agents-engine qualify phase', 'shipped'),

('AI Revenue Desk (Invoicing)', 'Finance Tech',
 'Draft → Founder approval → send invoicing. AI drafts, a human approves, only then does anything leave the building. Money is never moved by AI.',
 'module', 'SMEs and consultancies who want AI-assisted billing with a human gate',
 'edge fn: invoice-engine; component: src/components/fkaios/RevenueDesk.tsx; table: company_invoices', 'shipped'),

('Governance & Silence Monitor', 'Enterprise Governance',
 'Detects silent failure across an AI workforce — 9 detection classes. Reports NO-GO when a staffed department produces nothing. Silence is never treated as consent.',
 'module', 'Any company running autonomous AI agents in production',
 'edge fn: silence-monitor v3; table: founder_notifications; fn: compute_revenue_blockers()', 'shipped'),

('LLM Cost & Execution Graph', 'AI Ops',
 'Records model, provider, why-selected, prompt version, retries, tokens, cost, department and business objective for every LLM call. Answers "what did we spend, and what did it buy?"',
 'module', 'Any business running LLMs at scale that cannot currently answer that question',
 'table: agent_performance_metrics (model/provider/selection_reason/business_objective); view: v_llm_spend_by_objective; fn: compute_enterprise_economics()', 'shipped'),

('Mission Progress Engine', 'Executive Intelligence',
 'Grades a revenue mission against real received money. Detects hierarchical double-counting in the target plan. Reports NEVER rather than dividing by a zero run-rate.',
 'module', 'Founder-led companies with a hard revenue target and no honest tracker',
 'fn: compute_mission_progress(); table: company_revenue_milestones; component: FounderStory mission bar', 'shipped'),

('Data Lineage Layer', 'Executive Intelligence',
 'Every number on screen opens its source table, its derivation, the actual underlying rows, and the executive who owns it. A figure is a claim until you can walk it back to the row.',
 'module', 'Any exec dashboard where the numbers are not trusted',
 'component: src/components/fkaios/LineagePanel.tsx; wired across FounderStory', 'shipped'),

('CEO Opportunity Engine', 'Executive Intelligence',
 'Generates commercial opportunities daily, grounded only in assets the company actually owns. Rejects any proposal it cannot tie to a real asset. Computes ROI server-side so inflated revenue cannot game the ranking.',
 'module', 'Holding companies and consultancies needing a permanent, honest opportunity backlog',
 'edge fn: opportunity-engine v1; table: opportunity_backlog; cron: ceo-think-daily (jobid 34)', 'shipped'),

('Proposal Engine', 'Sales Tech',
 'Turns a qualified lead into a drafted proposal with an explicit UNKNOWNS list, and raises a pricing gate. Forbidden from inventing a price — a guessed fee is a fabricated commercial commitment.',
 'module', 'Consultancies converting inbound enquiries into priced proposals',
 'edge fn: proposal-engine v1; table: client_projects; cron: proposal-engine-hourly (jobid 36)', 'shipped')
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION public.compute_product_library()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v jsonb; n int; unpriced int;
BEGIN
  SELECT count(*), count(*) FILTER (WHERE list_price_inr IS NULL)
    INTO n, unpriced FROM product_library WHERE status = 'shipped';
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'name', name, 'category', category, 'what_it_does', what_it_does,
    'sellable_as', sellable_as, 'target_buyer', target_buyer,
    'evidence', evidence, 'pricing_status', pricing_status) ORDER BY category), '[]'::jsonb)
    INTO v FROM product_library WHERE status = 'shipped';
  RETURN jsonb_build_object(
    'shipped_assets', n,
    'unpriced', unpriced,
    'commercial_note', 'These are REAL, shipped, reusable assets — each carries evidence (an edge function, table or file that proves it exists). They are currently DEAD CAPITAL: none has a price and none has been offered to a buyer. Pricing is a Founder Approval Gate.',
    'assets', v);
END; $$;

REVOKE ALL ON FUNCTION public.compute_product_library() FROM public;
GRANT EXECUTE ON FUNCTION public.compute_product_library() TO service_role, authenticated;
