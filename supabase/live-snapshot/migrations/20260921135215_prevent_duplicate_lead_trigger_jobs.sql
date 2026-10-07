-- Applied in production as version 20260921135215 (prevent_duplicate_lead_trigger_jobs).
-- Exported read-only from supabase_migrations.schema_migrations on 2026-10-07 (md5 of statements: b051559b7e38584aa7682082857394ed).
-- Record only: do not apply from this folder.

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
