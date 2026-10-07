-- Applied in production as version 20260703100510 (aeos_event_bus_and_scheduler).
-- Exported read-only from supabase_migrations.schema_migrations on 2026-10-07 (md5 of statements: 130f9e895a531091c49f50776d0de03d).
-- Record only: do not apply from this folder.

BEGIN;

CREATE TABLE IF NOT EXISTS public.system_events (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    event_type  text NOT NULL,
    payload     jsonb NOT NULL DEFAULT '{}'::jsonb,
    processed   boolean NOT NULL DEFAULT false,
    processed_at timestamptz,
    created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_events_unprocessed ON public.system_events (processed, created_at) WHERE processed = false;

CREATE TABLE IF NOT EXISTS public.scheduled_tasks (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    task_key         text UNIQUE NOT NULL,
    label            text NOT NULL,
    action           text NOT NULL,
    action_payload   jsonb NOT NULL DEFAULT '{}'::jsonb,
    interval_minutes int NOT NULL DEFAULT 60,
    is_active        boolean NOT NULL DEFAULT true,
    last_run_at      timestamptz,
    last_status      text,
    next_run_at      timestamptz NOT NULL DEFAULT now(),
    created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_scheduled_due ON public.scheduled_tasks (is_active, next_run_at);

ALTER TABLE public.system_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scheduled_tasks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS events_select ON public.system_events;
CREATE POLICY events_select ON public.system_events FOR SELECT TO authenticated
    USING (EXISTS (SELECT 1 FROM public.consultants c WHERE c.id = auth.uid() AND c.role IN ('Founder','OpsHead')));
DROP POLICY IF EXISTS tasks_select ON public.scheduled_tasks;
CREATE POLICY tasks_select ON public.scheduled_tasks FOR SELECT TO authenticated
    USING (EXISTS (SELECT 1 FROM public.consultants c WHERE c.id = auth.uid() AND c.role IN ('Founder','OpsHead')));
DROP POLICY IF EXISTS tasks_update ON public.scheduled_tasks;
CREATE POLICY tasks_update ON public.scheduled_tasks FOR UPDATE TO authenticated
    USING (EXISTS (SELECT 1 FROM public.consultants c WHERE c.id = auth.uid() AND c.role IN ('Founder','OpsHead')));

INSERT INTO scheduled_tasks (task_key, label, action, action_payload, interval_minutes)
SELECT 'daily_briefing', 'Chief of Staff — Daily Briefing', 'chief_of_staff_briefing', '{}'::jsonb, 1440
WHERE NOT EXISTS (SELECT 1 FROM scheduled_tasks WHERE task_key = 'daily_briefing');

INSERT INTO scheduled_tasks (task_key, label, action, action_payload, interval_minutes)
SELECT 'lead_check', 'Check for new unprocessed leads', 'check_leads', '{}'::jsonb, 30
WHERE NOT EXISTS (SELECT 1 FROM scheduled_tasks WHERE task_key = 'lead_check');

COMMIT;
