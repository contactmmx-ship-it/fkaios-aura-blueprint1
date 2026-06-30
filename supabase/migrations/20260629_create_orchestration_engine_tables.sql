-- ============================================================
-- Orchestration engine tables (required by orchestrator + agent-scheduler
-- edge functions, which were deployed referencing these but the tables
-- were never created — this is why automation had never actually run)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.agent_lifecycle_stages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stage_name text NOT NULL UNIQUE,
  stage_order int NOT NULL,
  description text,
  trigger_conditions jsonb DEFAULT '{}'::jsonb,
  escalation_rules jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.lead_lifecycle (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  current_stage_id uuid REFERENCES public.agent_lifecycle_stages(id),
  entered_stage_at timestamptz DEFAULT now(),
  next_action text,
  next_action_scheduled_at timestamptz,
  blocked boolean DEFAULT false,
  blocked_reason text,
  stage_history jsonb DEFAULT '[]'::jsonb,
  assigned_agents jsonb DEFAULT '[]'::jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(lead_id)
);

CREATE TABLE IF NOT EXISTS public.agent_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid NOT NULL REFERENCES public.ai_agents(id) ON DELETE CASCADE,
  schedule_type text NOT NULL CHECK (schedule_type IN ('cron','interval','event_trigger')),
  cron_expression text,
  interval_seconds int,
  event_trigger text,
  lifecycle_stage_id uuid REFERENCES public.agent_lifecycle_stages(id),
  brand_id uuid REFERENCES public.brands(id),
  conditions jsonb DEFAULT '{}'::jsonb,
  is_active boolean DEFAULT true,
  next_run_at timestamptz,
  last_run_at timestamptz,
  run_count int DEFAULT 0,
  failure_count int DEFAULT 0,
  max_retries int DEFAULT 3,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.agent_dispatch_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id uuid REFERENCES public.agent_schedules(id) ON DELETE SET NULL,
  agent_id uuid REFERENCES public.ai_agents(id) ON DELETE SET NULL,
  lead_id uuid REFERENCES public.leads(id) ON DELETE SET NULL,
  brand_id uuid REFERENCES public.brands(id) ON DELETE SET NULL,
  lifecycle_stage_id uuid REFERENCES public.agent_lifecycle_stages(id),
  job_id uuid REFERENCES public.ai_jobs(id) ON DELETE SET NULL,
  action text NOT NULL,
  input_data jsonb DEFAULT '{}'::jsonb,
  output_data jsonb DEFAULT '{}'::jsonb,
  status text DEFAULT 'dispatched' CHECK (status IN ('dispatched','running','completed','failed')),
  error_message text,
  duration_ms int,
  tokens_used int,
  cost_usd numeric,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.apify_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_encrypted text NOT NULL,
  is_active boolean DEFAULT true,
  test_result text,
  last_tested_at timestamptz,
  created_at timestamptz DEFAULT now()
);

-- Seed the standard lead lifecycle stages used by orchestrator's
-- EVENT_STAGE_ADVANCEMENT map
INSERT INTO public.agent_lifecycle_stages (stage_name, stage_order, description) VALUES
  ('Lead Generation', 1, 'New lead captured from any channel'),
  ('Qualification', 2, 'AI qualifies budget, authority, need, timeline'),
  ('Meeting', 3, 'Discovery/demo meeting scheduled or held'),
  ('Proposal', 4, 'Proposal sent, awaiting response'),
  ('Closer', 5, 'Active negotiation / objection handling'),
  ('Onboarding', 6, 'Deal won, onboarding in progress')
ON CONFLICT (stage_name) DO NOTHING;

-- Trigger: auto-calculate next_run_at for interval-based schedules after each run
CREATE OR REPLACE FUNCTION public.update_schedule_next_run()
RETURNS trigger AS $$
BEGIN
  IF NEW.schedule_type = 'interval' AND NEW.interval_seconds IS NOT NULL THEN
    NEW.next_run_at := now() + (NEW.interval_seconds || ' seconds')::interval;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

DROP TRIGGER IF EXISTS trg_update_schedule_next_run ON public.agent_schedules;
CREATE TRIGGER trg_update_schedule_next_run
  BEFORE UPDATE OF run_count ON public.agent_schedules
  FOR EACH ROW EXECUTE FUNCTION public.update_schedule_next_run();

-- RLS
ALTER TABLE public.agent_lifecycle_stages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_lifecycle ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_dispatch_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.apify_connections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated_read_stages" ON public.agent_lifecycle_stages
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "authenticated_read_lifecycle" ON public.lead_lifecycle
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "admin_write_lifecycle" ON public.lead_lifecycle
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

CREATE POLICY "authenticated_read_schedules" ON public.agent_schedules
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "admin_write_schedules" ON public.agent_schedules
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

CREATE POLICY "authenticated_read_dispatch_log" ON public.agent_dispatch_log
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "admin_manage_apify" ON public.apify_connections
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
