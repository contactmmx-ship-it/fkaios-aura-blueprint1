-- Chairman's Command Center truth reconciliation.
--
-- Root causes verified against production on 2026-10-11:
-- 1. The execution pipeline records actual job outcomes in ai_jobs, while
--    agent_dispatch_log records dispatch events and does not receive completed
--    statuses for the current agent-scheduler -> ai_jobs -> ai-engine path.
--    Reading agent_dispatch_log therefore falsely grades every employee dormant
--    and every department NO-GO despite completed ai_jobs.
-- 2. compute_revenue_blockers() hard-coded a stale historical note claiming no
--    lead scored >= 40. Production currently has 5 such leads (max score 62),
--    but none has advanced beyond stage='new'. The actual break is stage 4.
--
-- This migration changes only the two truth-computation functions. It does not
-- alter lead stages, invoice/payment data, approvals, routing, or cron schedules.

CREATE OR REPLACE FUNCTION public.compute_workforce_truth()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_total int;
  v_producing int;
  v_nameplate int;
  v_burning int;
  v_dormant int;
  v_agents jsonb;
  v_spend numeric;
BEGIN
  WITH out24 AS (
    SELECT j.agent_id, count(*) AS jobs_24h
    FROM public.ai_jobs j
    WHERE j.created_at > now() - interval '24 hours'
      AND j.status = 'completed'
      AND j.agent_id IS NOT NULL
    GROUP BY j.agent_id
  ),
  spend AS (
    -- agent_performance_metrics keys on agent NAME (text), ai_agents on uuid.
    SELECT m.agent_id AS agent_name,
           COALESCE(SUM(m.estimated_cost_usd), 0) AS usd,
           count(*) AS llm_calls,
           count(*) FILTER (WHERE NOT m.success) AS llm_failures
    FROM public.agent_performance_metrics m
    GROUP BY m.agent_id
  ),
  graded AS (
    SELECT
      a.id,
      a.name,
      COALESCE(a.department, a.dept, 'UNASSIGNED') AS department,
      COALESCE(a.total_tasks_completed, 0) AS lifetime_tasks,
      COALESCE(o.jobs_24h, 0) AS output_24h,
      COALESCE(s.usd, 0) AS spend_usd,
      COALESCE(s.llm_calls, 0) AS llm_calls,
      COALESCE(s.llm_failures, 0) AS llm_failures,
      a.last_active_at,
      CASE
        WHEN COALESCE(o.jobs_24h, 0) > 0 THEN 'PRODUCING'
        WHEN COALESCE(a.total_tasks_completed, 0) = 0 AND COALESCE(s.usd, 0) > 0 THEN 'BURNING'
        WHEN COALESCE(a.total_tasks_completed, 0) = 0 THEN 'NAMEPLATE'
        ELSE 'DORMANT'
      END AS verdict
    FROM public.ai_agents a
    LEFT JOIN out24 o ON o.agent_id = a.id
    LEFT JOIN spend s ON s.agent_name = a.name
  )
  SELECT
    count(*),
    count(*) FILTER (WHERE verdict = 'PRODUCING'),
    count(*) FILTER (WHERE verdict = 'NAMEPLATE'),
    count(*) FILTER (WHERE verdict = 'BURNING'),
    count(*) FILTER (WHERE verdict = 'DORMANT'),
    COALESCE(SUM(spend_usd), 0),
    COALESCE(jsonb_agg(jsonb_build_object(
      'name', name,
      'department', department,
      'verdict', verdict,
      'lifetime_tasks', lifetime_tasks,
      'output_24h', output_24h,
      'spend_usd', ROUND(spend_usd::numeric, 4),
      'llm_calls', llm_calls,
      'llm_failures', llm_failures,
      'last_active_at', last_active_at
    ) ORDER BY (verdict = 'BURNING') DESC, output_24h DESC, lifetime_tasks DESC), '[]'::jsonb)
  INTO v_total, v_producing, v_nameplate, v_burning, v_dormant, v_spend, v_agents
  FROM graded;

  RETURN jsonb_build_object(
    'computed_at', now(),
    'total_employees', v_total,
    'producing_24h', v_producing,
    'dormant', v_dormant,
    'nameplate', v_nameplate,
    'burning', v_burning,
    'total_llm_spend_usd', ROUND(v_spend::numeric, 4),
    'headline', format(
      '%s AI employees on the roster. %s produced verified completed jobs in the last 24h. %s have NEVER completed a single task. "%s employees" is a vanity metric until that gap closes.',
      v_total, v_producing, v_nameplate + v_burning, v_total),
    'burning_warning', CASE WHEN v_burning > 0 THEN format(
      '%s employee(s) have SPENT MONEY and produced NOTHING, ever. This is the worst class: cost without output.', v_burning) END,
    'employees', v_agents
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.compute_revenue_blockers()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_leads int;
  v_contactable int;
  v_scored int;
  v_qualified int;
  v_advanced int;
  v_best int;
  v_projects int;
  v_invoices int;
  v_paid int;
  v_received numeric;
  v_stages jsonb;
  v_blocker jsonb;
  cso text;
  cfo text;
  ceo_eng text;
BEGIN
  SELECT holder_agent INTO cso FROM public.executive_committee
   WHERE role = 'Chief Sales Officer' AND active;
  SELECT holder_agent INTO cfo FROM public.executive_committee
   WHERE role = 'Chief Financial Officer' AND active;
  SELECT holder_agent INTO ceo_eng FROM public.executive_committee
   WHERE role = 'Chief Engineering Officer' AND active;

  SELECT count(*),
         count(*) FILTER (WHERE COALESCE(contact_phone, '') <> '' OR COALESCE(contact_email, '') <> ''),
         count(*) FILTER (WHERE lead_score IS NOT NULL),
         count(*) FILTER (WHERE lead_score >= 40),
         count(*) FILTER (WHERE stage <> 'new'),
         COALESCE(max(lead_score), 0)
    INTO v_leads, v_contactable, v_scored, v_qualified, v_advanced, v_best
  FROM public.leads
  WHERE is_active;

  SELECT count(*) INTO v_projects FROM public.client_projects;
  SELECT count(*),
         count(*) FILTER (WHERE COALESCE(amount_received_inr, 0) > 0),
         COALESCE(SUM(amount_received_inr), 0)
    INTO v_invoices, v_paid, v_received
  FROM public.company_invoices;

  v_stages := jsonb_build_array(
    jsonb_build_object(
      'stage', '1. Leads exist', 'count', v_leads,
      'owner_role', 'Chief Sales Officer', 'owner_agent', cso, 'alive', v_leads > 0
    ),
    jsonb_build_object(
      'stage', '2. Lead is reachable', 'count', v_contactable,
      'owner_role', 'Chief Sales Officer', 'owner_agent', cso, 'alive', v_contactable > 0,
      'note', format('%s of %s leads have a phone or email; %s have no recorded contact channel.',
        v_contactable, v_leads, v_leads - v_contactable)
    ),
    jsonb_build_object(
      'stage', '3. Lead qualifies (score >= 40)', 'count', v_qualified,
      'owner_role', 'Chief Sales Officer', 'owner_agent', cso, 'alive', v_qualified > 0,
      'note', format(
        '%s of %s active leads have a stored score; %s meet the score threshold of 40 (best score %s). %s leads have advanced beyond stage=new. Qualification score and pipeline advancement are separate checks.',
        v_scored, v_leads, v_qualified, v_best, v_advanced)
    ),
    jsonb_build_object(
      'stage', '4. Lead advances past new', 'count', v_advanced,
      'owner_role', 'Chief Sales Officer', 'owner_agent', cso, 'alive', v_advanced > 0,
      'note', CASE
        WHEN v_qualified > 0 AND v_advanced = 0 THEN format(
          '%s leads meet score >= 40, but none has advanced past stage=new. Investigate the qualification-to-stage-transition path; do not describe this as zero qualified leads.',
          v_qualified)
        ELSE format('%s active leads have advanced beyond stage=new.', v_advanced)
      END
    ),
    jsonb_build_object(
      'stage', '5. Becomes a client project', 'count', v_projects,
      'owner_role', 'Chief Engineering Officer', 'owner_agent', ceo_eng, 'alive', v_projects > 0
    ),
    jsonb_build_object(
      'stage', '6. Is invoiced', 'count', v_invoices,
      'owner_role', 'Chief Financial Officer', 'owner_agent', cfo, 'alive', v_invoices > 0,
      'note', 'A Revenue Desk exists; invoice presence does not itself prove that the invoice was sent or paid.'
    ),
    jsonb_build_object(
      'stage', '7. Payment received', 'count', v_paid,
      'owner_role', 'Chief Financial Officer', 'owner_agent', cfo, 'alive', v_paid > 0
    )
  );

  SELECT x INTO v_blocker
  FROM jsonb_array_elements(v_stages) WITH ORDINALITY AS stage_rows(x, ord)
  WHERE (x->>'alive')::boolean IS FALSE
  ORDER BY ord
  LIMIT 1;

  RETURN jsonb_build_object(
    'computed_at', now(),
    'revenue_inr', v_received,
    'chain', v_stages,
    'first_break', v_blocker,
    'headline', CASE
      WHEN v_received > 0 THEN 'Revenue is flowing.'
      WHEN v_leads = 0 THEN 'Revenue is blocked before lead discovery: there are no active leads in the CRM.'
      WHEN v_qualified = 0 THEN format(
        'Revenue is blocked at STAGE 3, owned by the Chief Sales Officer (%s). %s leads have stored scores; none reached the threshold of 40 (best score %s). Improve the quality of reachable lead inputs or use the existing-client route.',
        COALESCE(cso, 'sales-engine'), v_scored, v_best)
      WHEN v_advanced = 0 THEN format(
        'Revenue is blocked at STAGE 4, owned by the Chief Sales Officer (%s). %s leads meet the score threshold of 40, but none has advanced beyond stage=new. The immediate defect is the qualification-to-stage-transition path, not a lack of scored leads.',
        COALESCE(cso, 'sales-engine'), v_qualified)
      ELSE 'Revenue is blocked downstream of lead qualification; see first_break for the first failing stage and owner.'
    END,
    'exit_that_needs_no_new_data',
      'Existing brands and prior clients may be invoiced only after confirming the actual contracting entity, agreed scope, price, tax treatment, and billing details. The Revenue Desk is a mechanism, not evidence that a customer owes an amount.'
  );
END;
$function$;

-- Keep these governance computations callable only by trusted backend roles.
REVOKE ALL ON FUNCTION public.compute_workforce_truth() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.compute_workforce_truth() TO service_role, authenticated;
REVOKE ALL ON FUNCTION public.compute_revenue_blockers() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.compute_revenue_blockers() TO service_role, authenticated;
