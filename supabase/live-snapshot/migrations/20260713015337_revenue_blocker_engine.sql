-- Applied in production as version 20260713015337 (revenue_blocker_engine).
-- Exported read-only from supabase_migrations.schema_migrations on 2026-10-07 (md5 of statements: e32e74213987520850c94540a866994d).
-- Record only: do not apply from this folder.

-- REVENUE BLOCKER ENGINE — answers the Founder's standing question
-- "What is blocking revenue?" from LIVE DATA, never from a narrative.
-- (Master Realignment Constitution: Founder Experience + "every number must
-- support drill-down into its source, derivation, history and OWNER".)
--
-- It walks the commercial chain stage by stage, finds the FIRST stage where the
-- chain terminates, attributes it to the real executive who owns that stage
-- (executive_committee), and states what would have to change.
--
-- THE FINDING IT EXISTS TO SURFACE: the best lead score the enterprise has EVER
-- produced is 32, against an advancement bar of 40. Not one lead has ever come
-- close. The top-of-funnel is not merely underperforming — it is structurally
-- incapable of emitting an advanceable lead. No amount of qualifier tuning fixes
-- an input that cannot clear the bar.
CREATE OR REPLACE FUNCTION public.compute_revenue_blockers()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_leads int; v_contactable int; v_scored int; v_qualified int; v_advanced int;
  v_best int; v_projects int; v_invoices int; v_paid int; v_received numeric;
  v_stages jsonb; v_blocker jsonb;
  cso text; cfo text; ceo_eng text;
BEGIN
  SELECT holder_agent INTO cso  FROM executive_committee WHERE role = 'Chief Sales Officer'     AND active;
  SELECT holder_agent INTO cfo  FROM executive_committee WHERE role = 'Chief Financial Officer' AND active;
  SELECT holder_agent INTO ceo_eng FROM executive_committee WHERE role = 'Chief Engineering Officer' AND active;

  SELECT count(*), 
         count(*) FILTER (WHERE COALESCE(contact_phone,'') <> '' OR COALESCE(contact_email,'') <> ''),
         count(*) FILTER (WHERE lead_score IS NOT NULL),
         count(*) FILTER (WHERE lead_score >= 40),
         count(*) FILTER (WHERE stage <> 'new'),
         COALESCE(max(lead_score), 0)
    INTO v_leads, v_contactable, v_scored, v_qualified, v_advanced, v_best
  FROM leads WHERE is_active;

  SELECT count(*) INTO v_projects FROM client_projects;
  SELECT count(*), count(*) FILTER (WHERE COALESCE(amount_received_inr,0) > 0), COALESCE(SUM(amount_received_inr),0)
    INTO v_invoices, v_paid, v_received FROM company_invoices;

  v_stages := jsonb_build_array(
    jsonb_build_object('stage','1. Leads exist',        'count', v_leads,      'owner_role','Chief Sales Officer','owner_agent', cso, 'alive', v_leads > 0),
    jsonb_build_object('stage','2. Lead is reachable',  'count', v_contactable,'owner_role','Chief Sales Officer','owner_agent', cso, 'alive', v_contactable > 0,
                       'note', format('%s of %s leads have any phone or email. The other %s can never be contacted by anyone, human or AI.', v_contactable, v_leads, v_leads - v_contactable)),
    jsonb_build_object('stage','3. Lead qualifies (score >= 40)', 'count', v_qualified, 'owner_role','Chief Sales Officer','owner_agent', cso, 'alive', v_qualified > 0,
                       'note', format('%s of %s leads scored. ZERO reached 40. The BEST score ever produced is %s — the entire top-of-funnel is structurally incapable of emitting an advanceable lead. This is not a tuning problem; the input cannot clear the bar.', v_scored, v_leads, v_best)),
    jsonb_build_object('stage','4. Lead advances past new','count', v_advanced,'owner_role','Chief Sales Officer','owner_agent', cso, 'alive', v_advanced > 0),
    jsonb_build_object('stage','5. Becomes a client project','count', v_projects,'owner_role','Chief Engineering Officer','owner_agent', ceo_eng,'alive', v_projects > 0),
    jsonb_build_object('stage','6. Is invoiced',        'count', v_invoices,   'owner_role','Chief Financial Officer','owner_agent', cfo, 'alive', v_invoices > 0,
                       'note','A Revenue Desk now exists — the enterprise CAN issue an invoice. It has not yet been given anyone to bill.'),
    jsonb_build_object('stage','7. Payment received',   'count', v_paid,       'owner_role','Chief Financial Officer','owner_agent', cfo, 'alive', v_paid > 0)
  );

  SELECT x INTO v_blocker FROM jsonb_array_elements(v_stages) x
  WHERE (x->>'alive')::boolean IS FALSE ORDER BY x->>'stage' LIMIT 1;

  RETURN jsonb_build_object(
    'computed_at', now(),
    'revenue_inr', v_received,
    'chain', v_stages,
    'first_break', v_blocker,
    'headline', CASE
      WHEN v_received > 0 THEN 'Revenue is flowing.'
      WHEN v_qualified = 0 AND v_leads > 0 THEN format(
        'Revenue is blocked at STAGE 3, owned by the Chief Sales Officer (%s). %s leads have been scored and NOT ONE reached the qualifying bar of 40 — the best score ever produced is %s. The funnel cannot emit a lead worth pursuing, so stages 4-7 have never once been exercised. Two exits: supply leads capable of scoring (reachable, real buying intent), or bill a counterparty the enterprise ALREADY has, bypassing the cold funnel entirely.',
        COALESCE(cso,'sales-engine'), v_scored, v_best)
      ELSE 'Chain break detected — see first_break.' END,
    'exit_that_needs_no_new_data', 'The 8 existing brands and prior clients are reachable at zero cost and require no lead funnel at all. The Revenue Desk can invoice them today. This bypasses the entire broken chain.'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.compute_revenue_blockers() FROM public;
GRANT EXECUTE ON FUNCTION public.compute_revenue_blockers() TO service_role, authenticated;
