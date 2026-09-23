-- Kernel consolidation Phase 3: prevent duplicate ai_jobs creation from the
-- five leads-table triggers (auto_qualify_new_lead, auto_followup_stage_change,
-- auto_schedule_meeting, auto_generate_proposal, auto_invoice_onboarding).
--
-- FINDING (FKAIOS_KERNEL_CONSOLIDATION_PHASE1_DEPENDENCY_GRAPH.md): each of
-- these SECURITY DEFINER functions is a plain INSERT INTO ai_jobs with no
-- existence check. The four UPDATE-triggered ones have no WHEN clause
-- restricting which column changed, so ANY update to a leads row (a score
-- recalculation, a note edit, an unrelated field change) re-fires all four
-- and can enqueue a duplicate job for a lead that already has one in flight,
-- or whose real business artifact (proposal/meeting/invoice) already exists.
--
-- This migration is purely additive: it does not change when a trigger
-- fires, what payload it builds, or what agent it targets -- it only adds a
-- guard so the INSERT is skipped when an equivalent job already exists for
-- that lead in a non-terminal or already-completed state. ai-engine's own
-- idempotency checks (existingProject/existingMeeting/source_job_id) still
-- apply independently and are unchanged.
--
-- Each function's original body is preserved verbatim below the guard --
-- confirmed against the live pg_proc source at the time of writing.

CREATE OR REPLACE FUNCTION auto_qualify_new_lead()
RETURNS trigger AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM ai_jobs
    WHERE type = 'QUALIFY_LEAD'
      AND payload->>'lead_id' = NEW.id::text
      AND status IN ('pending','running','retry','completed')
  ) THEN
    RETURN NEW;
  END IF;

  INSERT INTO ai_jobs (agent_id, type, payload, status)
  SELECT a.id, 'QUALIFY_LEAD',
    jsonb_build_object('lead_id', NEW.id::text, 'name', NEW.contact_name, 'investment_capacity', COALESCE(NEW.investment_capacity, ''), 'city', COALESCE(NEW.city, ''), 'source', COALESCE(NEW.source, 'Website')),
    'pending'
  FROM ai_agents a WHERE a.task = 'QUALIFY_LEAD' AND a.is_active = true LIMIT 1;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION auto_followup_stage_change()
RETURNS trigger AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM ai_jobs
    WHERE type = 'FOLLOWUP'
      AND payload->>'lead_id' = NEW.id::text
      AND status IN ('pending','running','retry')
  ) THEN
    RETURN NEW;
  END IF;

  INSERT INTO ai_jobs (agent_id, type, payload, status)
  SELECT a.id, 'FOLLOWUP',
    jsonb_build_object('lead_id', NEW.id::text, 'old_stage', OLD.stage, 'new_stage', NEW.stage, 'lead_name', NEW.contact_name),
    'pending'
  FROM ai_agents a WHERE a.task = 'FOLLOWUP' AND a.is_active = true LIMIT 1;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION auto_schedule_meeting()
RETURNS trigger AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM ai_jobs
    WHERE type = 'SCHEDULE_MEETING'
      AND payload->>'lead_id' = NEW.id::text
      AND status IN ('pending','running','retry','completed')
  ) THEN
    RETURN NEW;
  END IF;
  IF EXISTS (SELECT 1 FROM meetings WHERE lead_id = NEW.id) THEN
    RETURN NEW;
  END IF;

  INSERT INTO ai_jobs (agent_id, type, payload, status)
  SELECT a.id, 'SCHEDULE_MEETING',
    jsonb_build_object('lead_id', NEW.id::text, 'lead_name', NEW.contact_name, 'assigned_to', COALESCE(NEW.assigned_to::text, ''), 'brand_id', COALESCE(NEW.brand_id::text, '')),
    'pending'
  FROM ai_agents a WHERE a.task = 'SCHEDULE_MEETING' AND a.is_active = true LIMIT 1;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION auto_generate_proposal()
RETURNS trigger AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM ai_jobs
    WHERE type = 'GENERATE_PROPOSAL'
      AND payload->>'lead_id' = NEW.id::text
      AND status IN ('pending','running','retry','completed')
  ) THEN
    RETURN NEW;
  END IF;
  IF EXISTS (SELECT 1 FROM client_projects WHERE lead_id = NEW.id) THEN
    RETURN NEW;
  END IF;

  INSERT INTO ai_jobs (agent_id, type, payload, status)
  SELECT a.id, 'GENERATE_PROPOSAL',
    jsonb_build_object('lead_id', NEW.id::text, 'lead_name', NEW.contact_name, 'investment_capacity', COALESCE(NEW.investment_capacity, '')),
    'pending'
  FROM ai_agents a WHERE a.task = 'GENERATE_PROPOSAL' AND a.is_active = true LIMIT 1;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION auto_invoice_onboarding()
RETURNS trigger AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM ai_jobs
    WHERE type = 'GENERATE_INVOICE'
      AND payload->>'lead_id' = NEW.id::text
      AND status IN ('pending','running','retry','completed')
  ) THEN
    RETURN NEW;
  END IF;
  IF EXISTS (SELECT 1 FROM company_invoices WHERE lead_id = NEW.id) THEN
    RETURN NEW;
  END IF;

  INSERT INTO ai_jobs (agent_id, type, payload, status)
  SELECT a.id, 'GENERATE_INVOICE',
    jsonb_build_object('lead_id', NEW.id::text, 'lead_name', NEW.contact_name, 'brand_id', COALESCE(NEW.brand_id::text, ''), 'investment_capacity', COALESCE(NEW.investment_capacity, '')),
    'pending'
  FROM ai_agents a WHERE a.task = 'GENERATE_INVOICE' AND a.is_active = true LIMIT 1;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
