-- Applied in production as version 20260713001004 (mission_progress_engine).
-- Exported read-only from supabase_migrations.schema_migrations on 2026-10-07 (md5 of statements: 6b839c049114194e545f1b11670fb1cd).
-- Record only: do not apply from this folder.

-- ============================================================================
-- MISSION PROGRESS ENGINE (World Class Enterprise Constitution — "₹1,100 Crore
-- Progress Engine"). Answers, from REAL data only: "How close are we today?"
--
-- CRITICAL CORRECTNESS NOTE (a real trap found in production data):
-- company_revenue_milestones is HIERARCHICAL. The holding company (Bhavishya
-- Associates) carries a ₹1,100 Cr target that is the ROLLUP of the three
-- subsidiaries (Franchise Kart / Aura Tech / Rajyog Infra @ ₹366.67 Cr each).
-- A naive SUM(target_inr) over the table returns ₹2,200 Cr — DOUBLE COUNTING
-- the mission and halving the apparent gap. This function therefore sums the
-- SUBSIDIARY rows only and asserts the result reconciles to the holding target.
-- If they ever diverge, it reports the divergence rather than silently picking
-- one — a plan that disagrees with itself is a fact the Founder must see.
--
-- Revenue is money RECEIVED (company_invoices.amount_received_inr), never
-- invoiced-but-unpaid. Zero is reported as zero. Nothing is fabricated.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.compute_mission_progress()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_target_subs   numeric;   -- sum of subsidiary targets (the real mission)
  v_target_hold   numeric;   -- holding rollup target (must reconcile)
  v_reconciles    boolean;
  v_received      numeric;
  v_invoiced      numeric;
  v_deadline      date;
  v_days_left     integer;
  v_months_left   numeric;
  v_gap           numeric;
  v_pct           numeric;
  v_rev_30d       numeric;
  v_monthly_rate  numeric;
  v_forecast      text;
  v_req_monthly   numeric;
  v_req_weekly    numeric;
  v_req_daily     numeric;
  v_by_company    jsonb;
  v_pipeline      jsonb;
BEGIN
  SELECT COALESCE(SUM(m.target_inr), 0) INTO v_target_subs
  FROM company_revenue_milestones m JOIN companies c ON c.id = m.company_id
  WHERE c.company_type = 'subsidiary';

  SELECT COALESCE(SUM(m.target_inr), 0) INTO v_target_hold
  FROM company_revenue_milestones m JOIN companies c ON c.id = m.company_id
  WHERE c.company_type = 'holding';

  v_reconciles := (v_target_hold = v_target_subs);

  SELECT COALESCE(SUM(amount_received_inr), 0), COALESCE(SUM(total_inr), 0)
    INTO v_received, v_invoiced FROM company_invoices;

  SELECT COALESCE(SUM(amount_received_inr), 0) INTO v_rev_30d
  FROM company_invoices WHERE payment_received_at > now() - interval '30 days';

  SELECT COALESCE(MAX(target_date), DATE '2030-03-31') INTO v_deadline
  FROM company_revenue_milestones;

  v_days_left   := GREATEST(0, v_deadline - CURRENT_DATE);
  v_months_left := GREATEST(1, v_days_left / 30.44);
  v_gap         := GREATEST(0, v_target_subs - v_received);
  v_pct         := CASE WHEN v_target_subs > 0
                        THEN ROUND((v_received / v_target_subs) * 100, 4) ELSE 0 END;

  -- Required run-rates to still hit the mission from where we ACTUALLY are.
  v_req_monthly := ROUND(v_gap / v_months_left, 2);
  v_req_weekly  := ROUND(v_gap / GREATEST(1, v_days_left / 7.0), 2);
  v_req_daily   := ROUND(v_gap / GREATEST(1, v_days_left), 2);

  -- Forecast. Honest: with a zero run-rate the mission is NOT "behind
  -- schedule" — it is mathematically unreachable, and we say exactly that.
  v_monthly_rate := v_rev_30d;
  IF v_received >= v_target_subs THEN
    v_forecast := 'ACHIEVED';
  ELSIF v_monthly_rate <= 0 THEN
    v_forecast := 'NEVER — current revenue run-rate is ₹0/month. At this rate the mission is not late, it is unreachable. Forecast cannot be computed by division by zero, and will not be faked.';
  ELSE
    v_forecast := to_char(CURRENT_DATE + ((v_gap / v_monthly_rate) * 30.44)::integer, 'YYYY-MM-DD');
  END IF;

  SELECT COALESCE(jsonb_agg(x ORDER BY x->>'company'), '[]'::jsonb) INTO v_by_company
  FROM (
    SELECT jsonb_build_object(
      'company', c.name,
      'target_inr', COALESCE(SUM(m.target_inr), 0),
      'received_inr', COALESCE((SELECT SUM(i.amount_received_inr) FROM company_invoices i WHERE i.company_id = c.id), 0),
      'invoices', COALESCE((SELECT count(*) FROM company_invoices i WHERE i.company_id = c.id), 0),
      'pct', 0
    ) AS x
    FROM companies c JOIN company_revenue_milestones m ON m.company_id = c.id
    WHERE c.company_type = 'subsidiary'
    GROUP BY c.id, c.name
  ) t;

  -- The commercial chain that must produce the money. Exposing where it dies.
  SELECT jsonb_build_object(
    'leads_total',      (SELECT count(*) FROM leads),
    'leads_advanced',   (SELECT count(*) FROM leads WHERE stage <> 'new'),
    'leads_contactable',(SELECT count(*) FROM leads WHERE COALESCE(contact_phone,'') <> ''),
    'client_projects',  (SELECT count(*) FROM client_projects),
    'invoices',         (SELECT count(*) FROM company_invoices),
    'payments',         (SELECT count(*) FROM company_invoices WHERE COALESCE(amount_received_inr,0) > 0)
  ) INTO v_pipeline;

  RETURN jsonb_build_object(
    'computed_at',        now(),
    'target_inr',         v_target_subs,
    'target_crore',       ROUND(v_target_subs / 10000000.0, 2),
    'received_inr',       v_received,
    'invoiced_inr',       v_invoiced,
    'gap_inr',            v_gap,
    'gap_crore',          ROUND(v_gap / 10000000.0, 2),
    'pct_achieved',       v_pct,
    'deadline',           v_deadline,
    'days_remaining',     v_days_left,
    'months_remaining',   ROUND(v_months_left, 1),
    'run_rate_30d_inr',   v_rev_30d,
    'forecast_completion',v_forecast,
    'required_monthly_inr', v_req_monthly,
    'required_weekly_inr',  v_req_weekly,
    'required_daily_inr',   v_req_daily,
    'plan_reconciles',    v_reconciles,
    'plan_warning',       CASE WHEN v_reconciles THEN NULL ELSE
      format('Revenue plan does not reconcile: holding target ₹%s Cr vs subsidiary sum ₹%s Cr. Mission measured against the SUBSIDIARY sum. Naive SUM() over the whole table would report ₹%s Cr — double counting.',
        ROUND(v_target_hold/10000000.0,2), ROUND(v_target_subs/10000000.0,2), ROUND((v_target_hold+v_target_subs)/10000000.0,2)) END,
    'has_ramp',           (SELECT count(DISTINCT year) > 1 FROM company_revenue_milestones),
    'ramp_warning',       CASE WHEN (SELECT count(DISTINCT year) FROM company_revenue_milestones) <= 1
      THEN 'The plan has NO intermediate milestones — every target sits in the final year. There is nothing to be measurably on-track or behind against until then. A 2026-2029 ramp is required for this engine to grade progress rather than merely report it.' END,
    'by_company',         v_by_company,
    'pipeline',           v_pipeline
  );
END;
$$;

REVOKE ALL ON FUNCTION public.compute_mission_progress() FROM public;
GRANT EXECUTE ON FUNCTION public.compute_mission_progress() TO service_role, authenticated;
