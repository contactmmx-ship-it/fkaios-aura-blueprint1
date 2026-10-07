-- Applied in production as version 20260714080636 (proposal_engine_money_chain).
-- Exported read-only from supabase_migrations.schema_migrations on 2026-10-07 (md5 of statements: a11148e4bd916ea7ad8fd4daa7085ac3).
-- Record only: do not apply from this folder.

-- PROPOSAL ENGINE — the missing bridge in the money chain.
-- Before this: lead -> qualified -> [NOTHING FOREVER]. 0 projects, 0 invoices ever.
-- A ₹25L franchisee could enquire, score 60, and the company would do nothing.
--
-- PRICING IS A FOUNDER APPROVAL GATE. The engine therefore drafts EVERYTHING
-- EXCEPT THE PRICE. price_inr stays NULL and price_status = 'UNKNOWN_AWAITING_FOUNDER'
-- until the Founder sets it. Per Constitution: "Unknown values must remain explicitly
-- marked UNKNOWN until verified." A proposal with an invented price is a fabricated
-- commercial commitment — the single most dangerous thing this system could produce.
CREATE TABLE IF NOT EXISTS public.proposals (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id           uuid REFERENCES public.leads(id) ON DELETE SET NULL,
  project_id        uuid REFERENCES public.client_projects(id) ON DELETE SET NULL,
  brand_id          uuid,
  client_name       text NOT NULL,
  title             text NOT NULL,
  summary           text,
  scope             jsonb,                 -- deliverables, grounded in real brand terms
  assumptions       jsonb,                 -- everything the engine could NOT verify
  -- PRICE: never invented. NULL until the Founder decides.
  price_inr         numeric,
  price_status      text NOT NULL DEFAULT 'UNKNOWN_AWAITING_FOUNDER'
                    CHECK (price_status IN ('UNKNOWN_AWAITING_FOUNDER','SET_BY_FOUNDER')),
  status            text NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft','awaiting_founder','approved','rejected','sent','won','lost')),
  grounded_in       text NOT NULL,
  model             text,
  sent_at           timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_proposals_status ON public.proposals (status, created_at DESC);

ALTER TABLE public.proposals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS proposals_select ON public.proposals;
CREATE POLICY proposals_select ON public.proposals FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS proposals_update ON public.proposals;
CREATE POLICY proposals_update ON public.proposals FOR UPDATE TO authenticated USING (true);

-- The money chain, end to end, with the break named. This is what the Founder sees.
CREATE OR REPLACE FUNCTION public.compute_money_chain()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_enq int; v_qual int; v_proj int; v_prop int; v_priced int; v_inv int; v_paid int; v_rev numeric;
BEGIN
  SELECT count(*) FILTER (WHERE source = 'inbound_enquiry'),
         count(*) FILTER (WHERE lead_score >= 40)
    INTO v_enq, v_qual FROM leads WHERE is_active;
  SELECT count(*) INTO v_proj FROM client_projects;
  SELECT count(*), count(*) FILTER (WHERE price_status = 'SET_BY_FOUNDER') INTO v_prop, v_priced FROM proposals;
  SELECT count(*), count(*) FILTER (WHERE COALESCE(amount_received_inr,0) > 0), COALESCE(SUM(amount_received_inr),0)
    INTO v_inv, v_paid, v_rev FROM company_invoices;

  RETURN jsonb_build_object(
    'computed_at', now(),
    'chain', jsonb_build_array(
      jsonb_build_object('step','1. Inbound enquiry',      'count', v_enq,  'owner','Chief Sales Officer'),
      jsonb_build_object('step','2. Qualifies (BANT >= 40)','count', v_qual, 'owner','Chief Sales Officer'),
      jsonb_build_object('step','3. Client project opened', 'count', v_proj, 'owner','Chief Engineering Officer'),
      jsonb_build_object('step','4. Proposal drafted',      'count', v_prop, 'owner','Chief Sales Officer'),
      jsonb_build_object('step','5. Price set by FOUNDER',  'count', v_priced,'owner','FOUNDER — approval gate'),
      jsonb_build_object('step','6. Invoiced',              'count', v_inv,  'owner','Chief Financial Officer'),
      jsonb_build_object('step','7. Payment received',      'count', v_paid, 'owner','Chief Financial Officer')
    ),
    'revenue_inr', v_rev,
    'headline', CASE
      WHEN v_rev > 0 THEN 'Money is flowing.'
      WHEN v_enq = 0 THEN 'The chain is COMPLETE and EMPTY. Every link now exists — enquiry, qualification, project, proposal, pricing gate, invoice, payment — and not one human has walked through the front door yet. The bottleneck is no longer capability. It is traffic.'
      WHEN v_qual = 0 THEN 'Enquiries exist but none has cleared BANT 40 yet.'
      WHEN v_priced = 0 THEN 'Proposals are drafted and waiting on the FOUNDER to set a price. Pricing is the gate; nothing moves past it without you.'
      ELSE 'Chain is moving.' END
  );
END; $$;

REVOKE ALL ON FUNCTION public.compute_money_chain() FROM public;
GRANT EXECUTE ON FUNCTION public.compute_money_chain() TO service_role, authenticated;
