-- P0 revenue-chain safety fixes: preserve qualification outcomes and only
-- enqueue downstream work when the lead lifecycle actually transitions.
-- No existing lead or invoice rows are modified by this migration.

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS qualification_disposition text;

COMMENT ON COLUMN public.leads.qualification_disposition IS
  'Latest AI qualification disposition. May be research_required even while CRM lifecycle stage remains new; never conflate disposition with lifecycle stage.';

CREATE OR REPLACE FUNCTION public.auto_followup_stage_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
BEGIN
  IF NEW.stage IS NOT DISTINCT FROM OLD.stage THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.ai_jobs
    WHERE type = 'FOLLOWUP'
      AND payload->>'lead_id' = NEW.id::text
      AND status IN ('pending','running','retry')
  ) THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.ai_jobs (agent_id, type, payload, status)
  SELECT a.id, 'FOLLOWUP',
    jsonb_build_object('lead_id', NEW.id::text, 'old_stage', OLD.stage, 'new_stage', NEW.stage, 'lead_name', NEW.contact_name),
    'pending'
  FROM public.ai_agents a WHERE a.task = 'FOLLOWUP' AND a.is_active = true LIMIT 1;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.auto_generate_proposal()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
BEGIN
  IF NEW.stage IS NOT DISTINCT FROM OLD.stage OR NEW.stage <> 'qualified' THEN
    RETURN NEW;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.ai_jobs
    WHERE type = 'GENERATE_PROPOSAL'
      AND payload->>'lead_id' = NEW.id::text
      AND status IN ('pending','running','retry','completed')
  ) OR EXISTS (SELECT 1 FROM public.client_projects WHERE lead_id = NEW.id) THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.ai_jobs (agent_id, type, payload, status)
  SELECT a.id, 'GENERATE_PROPOSAL',
    jsonb_build_object('lead_id', NEW.id::text, 'lead_name', NEW.contact_name, 'investment_capacity', COALESCE(NEW.investment_capacity, '')),
    'pending'
  FROM public.ai_agents a WHERE a.task = 'GENERATE_PROPOSAL' AND a.is_active = true LIMIT 1;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.auto_invoice_onboarding()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
BEGIN
  IF NEW.stage IS NOT DISTINCT FROM OLD.stage OR NEW.stage <> 'won' THEN
    RETURN NEW;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.ai_jobs
    WHERE type = 'GENERATE_INVOICE'
      AND payload->>'lead_id' = NEW.id::text
      AND status IN ('pending','running','retry','completed')
  ) OR EXISTS (SELECT 1 FROM public.company_invoices WHERE lead_id = NEW.id) THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.ai_jobs (agent_id, type, payload, status)
  SELECT a.id, 'GENERATE_INVOICE',
    jsonb_build_object('lead_id', NEW.id::text, 'lead_name', NEW.contact_name, 'brand_id', COALESCE(NEW.brand_id::text, ''), 'investment_capacity', COALESCE(NEW.investment_capacity, '')),
    'pending'
  FROM public.ai_agents a WHERE a.task = 'GENERATE_INVOICE' AND a.is_active = true LIMIT 1;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.auto_schedule_meeting()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
BEGIN
  IF NEW.stage IS NOT DISTINCT FROM OLD.stage OR NEW.stage NOT IN ('contacted','qualified') THEN
    RETURN NEW;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.ai_jobs
    WHERE type = 'SCHEDULE_MEETING'
      AND payload->>'lead_id' = NEW.id::text
      AND status IN ('pending','running','retry','completed')
  ) OR EXISTS (SELECT 1 FROM public.meetings WHERE lead_id = NEW.id) THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.ai_jobs (agent_id, type, payload, status)
  SELECT a.id, 'SCHEDULE_MEETING',
    jsonb_build_object('lead_id', NEW.id::text, 'lead_name', NEW.contact_name, 'assigned_to', COALESCE(NEW.assigned_to::text, ''), 'brand_id', COALESCE(NEW.brand_id::text, '')),
    'pending'
  FROM public.ai_agents a WHERE a.task = 'SCHEDULE_MEETING' AND a.is_active = true LIMIT 1;
  RETURN NEW;
END;
$$;
