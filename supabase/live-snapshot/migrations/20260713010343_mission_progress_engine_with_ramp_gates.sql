-- Applied in production as version 20260713010343 (mission_progress_engine_with_ramp_gates).
-- Exported read-only from supabase_migrations.schema_migrations on 2026-10-07 (md5 of statements: c66bbf47e722dd3e041ca126bc8fd315).
-- Record only: do not apply from this folder.

-- compute_mission_progress() v2 — now MILESTONE-AWARE (Realignment Directive).
--
-- Two horizons, both real:
--   MISSION   = final-year (2030) SUBSIDIARY rows  → ₹1,100 Cr
--   NEXT GATE = nearest未-passed ramp milestone     → ₹5 Cr by 31-Dec-2026
--
-- The reconciliation check (holding rollup vs subsidiary sum) is now scoped to
-- the FINAL YEAR ONLY. Ramp rows live at holding level and would otherwise have
-- tripped a FALSE "plan does not reconcile" alarm the moment the ₹5 Cr milestone
-- was added. Fixing this BEFORE it fires, not after.
--
-- The gate is GRADED: on-track vs behind is now computable, which it was not
-- before, because there was nothing to be on-track against.
CREATE OR REPLACE FUNCTION public.compute_mission_progress()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_final_year integer;
  v_target_subs numeric; v_target_hold numeric; v_reconciles boolean;
  v_received numeric; v_invoiced numeric; v_deadline date;
  v_days_left integer; v_months_left numeric; v_gap numeric; v_pct numeric;
  v_rev_30d numeric; v_forecast text;
  v_req_monthly numeric; v_req_weekly numeric; v_req_daily numeric;
  v_by_company jsonb; v_pipeline jsonb; v_gate jsonb;
  g_target numeric; g_date date; g_days integer; g_gap numeric; g_pct numeric; g_req_daily numeric;
BEGIN
  SELECT MAX(year) INTO v_final_year FROM company_revenue_milestones;

  SELECT COALESCE(SUM(m.target_inr), 0) INTO v_target_subs
  FROM company_revenue_milestones m JOIN companies c ON c.id = m.company_id
  WHERE c.company_type = 'subsidiary' AND m.year = v_final_year;

  SELECT COALESCE(SUM(m.target_inr), 0) INTO v_target_hold
  FROM company_revenue_milestones m JOIN companies c ON c.id = m.company_id
  WHERE c.company_type = 'holding' AND m.year = v_final_year;

  v_reconciles := (abs(v_target_hold - v_target_subs) <= 100);

  SELECT COALESCE(SUM(amount_received_inr), 0), COALESCE(SUM(total_inr), 0)
    INTO v_received, v_invoiced FROM company_invoices;
  SELECT COALESCE(SUM(amount_received_inr), 0) INTO v_rev_30d
  FROM company_invoices WHERE payment_received_at > now() - interval '30 days';

  SELECT COALESCE(MAX(target_date), DATE '2030-03-31') INTO v_deadline
  FROM company_revenue_milestones WHERE year = v_final_year;

  v_days_left   := GREATEST(0, v_deadline - CURRENT_DATE);
  v_months_left := GREATEST(1, v_days_left / 30.44);
  v_gap         := GREATEST(0, v_target_subs - v_received);
  v_pct         := CASE WHEN v_target_subs > 0 THEN ROUND((v_received / v_target_subs) * 100, 4) ELSE 0 END;
  v_req_monthly := ROUND(v_gap / v_months_left, 2);
  v_req_weekly  := ROUND(v_gap / GREATEST(1, v_days_left / 7.0), 2);
  v_req_daily   := ROUND(v_gap / GREATEST(1, v_days_left), 2);

  IF v_received >= v_target_subs THEN v_forecast := 'ACHIEVED';
  ELSIF v_rev_30d <= 0 THEN
    v_forecast := 'NEVER — current revenue run-rate is ₹0/month. At this rate the mission is not late, it is unreachable. A forecast cannot be computed by dividing by zero, and will not be faked.';
  ELSE v_forecast := to_char(CURRENT_DATE + ((v_gap / v_rev_30d) * 30.44)::integer, 'YYYY-MM-DD');
  END IF;

  -- ---- NEXT GATE: the nearest ramp milestone still ahead of us ----
  SELECT m.target_inr, m.target_date
    INTO g_target, g_date
  FROM company_revenue_milestones m
  WHERE m.year < v_final_year AND m.target_date >= CURRENT_DATE
  ORDER BY m.target_date ASC
  LIMIT 1;

  IF g_target IS NOT NULL THEN
    g_days     := GREATEST(1, g_date - CURRENT_DATE);
    g_gap      := GREATEST(0, g_target - v_received);
    g_pct      := CASE WHEN g_target > 0 THEN ROUND((v_received / g_target) * 100, 4) ELSE 0 END;
    g_req_daily:= ROUND(g_gap / g_days, 2);
    v_gate := jsonb_build_object(
      'exists', true,
      'target_inr', g_target,
      'target_crore', ROUND(g_target / 10000000.0, 2),
      'target_date', g_date,
      'days_remaining', g_days,
      'received_inr', v_received,
      'gap_inr', g_gap,
      'pct_achieved', g_pct,
      'required_daily_inr', g_req_daily,
      'required_monthly_inr', ROUND(g_gap / GREATEST(1, g_days / 30.44), 2),
      'on_track', (v_rev_30d * (g_days / 30.44)) >= g_gap,
      'verdict', CASE
        WHEN v_received >= g_target THEN 'Gate met.'
        WHEN v_rev_30d <= 0 THEN format(
          'BEHIND — and not by a little. %s%% achieved with %s days left. Hitting this gate requires ₹%s per day starting today, from a standing start of ₹0/day. Nothing in the current pipeline can produce it.',
          ROUND(g_pct, 2), g_days, to_char(g_req_daily, 'FM99,99,99,999'))
        ELSE format('Behind: needs ₹%s/day for %s days.', to_char(g_req_daily, 'FM99,99,99,999'), g_days) END
    );
  ELSE
    v_gate := jsonb_build_object('exists', false);
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
    WHERE c.company_type = 'subsidiary' AND m.year = v_final_year
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
      format('Revenue plan does not reconcile for %s: holding rollup ₹%s Cr vs subsidiary sum ₹%s Cr.',
        v_final_year, ROUND(v_target_hold/10000000.0,2), ROUND(v_target_subs/10000000.0,2)) END,
    'has_ramp', (SELECT count(*) > 0 FROM company_revenue_milestones WHERE year < v_final_year),
    'ramp_warning', CASE WHEN (SELECT count(*) FROM company_revenue_milestones WHERE year < v_final_year) = 0
      THEN 'No intermediate milestones exist; progress can be reported but not graded.' END,
    'next_gate', v_gate,
    'by_company', v_by_company, 'pipeline', v_pipeline
  );
END;
$$;

REVOKE ALL ON FUNCTION public.compute_mission_progress() FROM public;
GRANT EXECUTE ON FUNCTION public.compute_mission_progress() TO service_role, authenticated;
