-- Applied in production as version 20260713001045 (mission_progress_reconcile_tolerance).
-- Exported read-only from supabase_migrations.schema_migrations on 2026-10-07 (md5 of statements: 5c8df9b55c3e24585e4944b0d65145f0).
-- Record only: do not apply from this folder.

-- Fix a FALSE POSITIVE in compute_mission_progress(): the reconciliation check
-- used exact equality, so a ₹1 rounding artifact (3 × ₹366.67 Cr = ₹11,000,000,001
-- vs the holding's ₹11,000,000,000) reported the revenue plan as "not reconciling".
-- A warning that fires on a ₹1 discrepancy trains the Founder to ignore warnings —
-- the same self-inflicted false-alarm failure Silence Monitor v3 had to fix.
-- Tolerance: ₹100 absolute. Anything larger is a REAL plan disagreement and still fires.
CREATE OR REPLACE FUNCTION public.compute_mission_progress()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_target_subs numeric; v_target_hold numeric; v_reconciles boolean;
  v_received numeric; v_invoiced numeric; v_deadline date;
  v_days_left integer; v_months_left numeric; v_gap numeric; v_pct numeric;
  v_rev_30d numeric; v_monthly_rate numeric; v_forecast text;
  v_req_monthly numeric; v_req_weekly numeric; v_req_daily numeric;
  v_by_company jsonb; v_pipeline jsonb;
BEGIN
  SELECT COALESCE(SUM(m.target_inr), 0) INTO v_target_subs
  FROM company_revenue_milestones m JOIN companies c ON c.id = m.company_id
  WHERE c.company_type = 'subsidiary';

  SELECT COALESCE(SUM(m.target_inr), 0) INTO v_target_hold
  FROM company_revenue_milestones m JOIN companies c ON c.id = m.company_id
  WHERE c.company_type = 'holding';

  -- ₹100 tolerance: rounding noise is not a plan disagreement.
  v_reconciles := (abs(v_target_hold - v_target_subs) <= 100);

  SELECT COALESCE(SUM(amount_received_inr), 0), COALESCE(SUM(total_inr), 0)
    INTO v_received, v_invoiced FROM company_invoices;
  SELECT COALESCE(SUM(amount_received_inr), 0) INTO v_rev_30d
  FROM company_invoices WHERE payment_received_at > now() - interval '30 days';
  SELECT COALESCE(MAX(target_date), DATE '2030-03-31') INTO v_deadline
  FROM company_revenue_milestones;

  v_days_left   := GREATEST(0, v_deadline - CURRENT_DATE);
  v_months_left := GREATEST(1, v_days_left / 30.44);
  v_gap         := GREATEST(0, v_target_subs - v_received);
  v_pct         := CASE WHEN v_target_subs > 0 THEN ROUND((v_received / v_target_subs) * 100, 4) ELSE 0 END;
  v_req_monthly := ROUND(v_gap / v_months_left, 2);
  v_req_weekly  := ROUND(v_gap / GREATEST(1, v_days_left / 7.0), 2);
  v_req_daily   := ROUND(v_gap / GREATEST(1, v_days_left), 2);

  v_monthly_rate := v_rev_30d;
  IF v_received >= v_target_subs THEN v_forecast := 'ACHIEVED';
  ELSIF v_monthly_rate <= 0 THEN
    v_forecast := 'NEVER — current revenue run-rate is ₹0/month. At this rate the mission is not late, it is unreachable. A forecast cannot be computed by dividing by zero, and will not be faked.';
  ELSE v_forecast := to_char(CURRENT_DATE + ((v_gap / v_monthly_rate) * 30.44)::integer, 'YYYY-MM-DD');
  END IF;

  SELECT COALESCE(jsonb_agg(x ORDER BY x->>'company'), '[]'::jsonb) INTO v_by_company
  FROM (
    SELECT jsonb_build_object(
      'company', c.name,
      'target_inr', COALESCE(SUM(m.target_inr), 0),
      'target_crore', ROUND(COALESCE(SUM(m.target_inr), 0)/10000000.0, 2),
      'received_inr', COALESCE((SELECT SUM(i.amount_received_inr) FROM company_invoices i WHERE i.company_id = c.id), 0),
      'invoices', COALESCE((SELECT count(*) FROM company_invoices i WHERE i.company_id = c.id), 0)
    ) AS x
    FROM companies c JOIN company_revenue_milestones m ON m.company_id = c.id
    WHERE c.company_type = 'subsidiary'
    GROUP BY c.id, c.name
  ) t;

  SELECT jsonb_build_object(
    'leads_total',      (SELECT count(*) FROM leads),
    'leads_advanced',   (SELECT count(*) FROM leads WHERE stage <> 'new'),
    'leads_contactable',(SELECT count(*) FROM leads WHERE COALESCE(contact_phone,'') <> ''),
    'client_projects',  (SELECT count(*) FROM client_projects),
    'invoices',         (SELECT count(*) FROM company_invoices),
    'payments',         (SELECT count(*) FROM company_invoices WHERE COALESCE(amount_received_inr,0) > 0)
  ) INTO v_pipeline;

  RETURN jsonb_build_object(
    'computed_at', now(),
    'target_inr', v_target_subs, 'target_crore', ROUND(v_target_subs / 10000000.0, 2),
    'received_inr', v_received, 'invoiced_inr', v_invoiced,
    'gap_inr', v_gap, 'gap_crore', ROUND(v_gap / 10000000.0, 2),
    'pct_achieved', v_pct, 'deadline', v_deadline,
    'days_remaining', v_days_left, 'months_remaining', ROUND(v_months_left, 1),
    'run_rate_30d_inr', v_rev_30d, 'forecast_completion', v_forecast,
    'required_monthly_inr', v_req_monthly, 'required_weekly_inr', v_req_weekly, 'required_daily_inr', v_req_daily,
    'plan_reconciles', v_reconciles,
    'plan_warning', CASE WHEN v_reconciles THEN NULL ELSE
      format('Revenue plan does not reconcile: holding target ₹%s Cr vs subsidiary sum ₹%s Cr (difference ₹%s). Mission is measured against the SUBSIDIARY sum; a naive SUM() over the whole table would report ₹%s Cr — double counting.',
        ROUND(v_target_hold/10000000.0,2), ROUND(v_target_subs/10000000.0,2),
        abs(v_target_hold - v_target_subs), ROUND((v_target_hold+v_target_subs)/10000000.0,2)) END,
    'has_ramp', (SELECT count(DISTINCT year) > 1 FROM company_revenue_milestones),
    'ramp_warning', CASE WHEN (SELECT count(DISTINCT year) FROM company_revenue_milestones) <= 1
      THEN 'The revenue plan has NO intermediate milestones — every target sits in the final year (2030). Until a 2026–2029 ramp exists there is nothing to be measurably on-track or behind against, so this engine can report progress but cannot grade it.' END,
    'by_company', v_by_company, 'pipeline', v_pipeline
  );
END;
$$;

REVOKE ALL ON FUNCTION public.compute_mission_progress() FROM public;
GRANT EXECUTE ON FUNCTION public.compute_mission_progress() TO service_role, authenticated;
