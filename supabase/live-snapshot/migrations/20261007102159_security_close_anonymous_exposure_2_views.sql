-- Applied in production as version 20261007102159 (security_close_anonymous_exposure_2_views).
-- Exported read-only from supabase_migrations.schema_migrations on 2026-10-07 (md5 of statements: e0559c5b898db62bcdc098c8a7096b80).
-- Record only: do not apply from this folder.

set local lock_timeout = '5s';
revoke all on table
  public.v_agent_trust_dashboard, public.v_meta_governance,
  public.v_constitution_violations, public.v_governance_dashboard_summary,
  public.v_market_intelligence, public.v_enterprise_knowledge,
  public.v_llm_spend_by_objective, public.v_cost_coverage,
  public.v_model_performance
from anon;
