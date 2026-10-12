-- Correct service-role-only policies accidentally scoped to PUBLIC.
-- This migration is intentionally limited to the 11 policies whose names
-- explicitly say "service role full access". RLS stays enabled on every table.
DO $$
DECLARE
  tbl text;
  tables text[] := ARRAY[
    'agent_kpi_targets',
    'company_revenue_milestones',
    'founder_notifications',
    'founder_principles',
    'lead_documents',
    'lead_ingestion_log',
    'legal_reviews',
    'marketing_campaigns',
    'training_completions',
    'training_curriculum',
    'voice_call_log'
  ];
BEGIN
  FOREACH tbl IN ARRAY tables LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'service role full access', tbl);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true)',
      'service role full access', tbl
    );
  END LOOP;
END $$;
