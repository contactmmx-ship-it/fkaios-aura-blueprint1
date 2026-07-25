# FKAIOS Security Hardening Plan

**Date:** 2026-07-24
**Method:** Live `get_advisors` (security) query against project `nrlsqshkjuuwiovthrnb` (159 total lint findings), live `cron.job` inspection, and direct confirmation that the Supabase anon key is hardcoded in `src/lib/supabase.ts` inside a **public** GitHub repository (`contactmmx-ship-it/fkaios-aura-blueprint1`, confirmed public via Vercel deployment metadata).

**This document proposes fixes. It does not apply any.** No RLS policy, function, secret, or migration was changed while producing this plan.

---

## CRITICAL

### C1. 30 SECURITY DEFINER functions are directly callable by `anon` (no login required) via `/rest/v1/rpc/<name>`
Confirmed list (identical set exposed to both `anon` and `authenticated`):
`compute_enterprise_economics`, `compute_revenue_blockers`, `compute_workforce_truth`, `compute_money_chain`, `compute_mission_progress`, `compute_brain_arbitration`, `compute_cost_coverage`, `compute_factory_next_action`, `compute_factory_plan`, `compute_model_choice`, `compute_next_capability`, `compute_opportunity_backlog`, `compute_product_library`, `compute_software_factory`, `record_enterprise_memory`, `search_knowledge_documents`, `brain_chat_rpc`, `log_llm_cost`, `detect_silences`, `reap_orphaned_ai_jobs`, `handle_new_auth_user`, `get_my_role`, `get_my_consultant_id`, `is_admin`, `my_brand_ids`, `auto_qualify_new_lead`, `auto_followup_stage_change`, `auto_schedule_meeting`, `auto_generate_proposal`, `auto_invoice_onboarding`.

**Why critical, not just high:** several of these (`compute_enterprise_economics`, `compute_revenue_blockers`, `compute_workforce_truth`, `compute_money_chain`) are the exact functions the Governance Dashboard and Founder Cockpit use to show the Founder real business economics. Called directly via REST RPC with only the public anon key — which is hardcoded in a public repo, see C2 — anyone can pull this data with no authentication and no app in between. `record_enterprise_memory` also means anyone can **write** into the enterprise's shared memory/knowledge substrate that the Executive Intelligence layer reads and reasons from.

**Remediation (not applied):** Either (a) `REVOKE EXECUTE ... FROM anon` on each and require `authenticated` (or a specific service role) at minimum, or (b) convert to `SECURITY INVOKER` where the function's own logic doesn't need to bypass RLS, or (c) if some (e.g. `handle_new_auth_user`, `auto_*` webhook-style triggers) are intentionally public-callable, document that explicitly and move on — but that decision has evidently never been made; nothing in the repo states an intentional public-RPC design.

### C2. Supabase anon key is hardcoded in source, in a public GitHub repository
`src/lib/supabase.ts:4` — the anon key is a literal string, not read from an env var, committed to `contactmmx-ship-it/fkaios-aura-blueprint1` which is a **public** repo (confirmed via the Vercel deployment's `githubRepoVisibility: "public"`). Anon keys are designed to be public-safe *only if RLS is airtight*. Given C1 and C3 below, it currently is not — so this key, combined with the open RPCs, is a live, unauthenticated path to real business data for anyone who finds the repo.

**Remediation (not applied):** Move to `NEXT_PUBLIC_SUPABASE_ANON_KEY` env var (cosmetic — it'll still be public in the shipped JS bundle, that's expected for anon keys) — the actual fix is closing C1/C3 so the key being public stops mattering. Do not treat moving it to an env var as sufficient on its own.

### C3. 2 tables have RLS disabled entirely (not just weak — off)
`public.agent_aliases`, `public.model_registry` — both public, zero row-level security. Anyone with the anon key can read/write these tables directly, no policy check at all.

**Remediation (not applied):** `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` plus at least a default-deny policy on both, then add real policies as needed.

---

## HIGH

### H1. Hardcoded shared secret `kjhgfdsa` still live across ~15+ cron job command texts
Confirmed still present today in `cron.job.command` for jobs including `aeos-heartbeat`, `auto-pilot-5min`, `agent-scheduler-5min`, `workday-*`, `auto-agents-*`, `job-scheduler-drain`, `enrich-new-leads`, `ceo-think-daily`, `sales-draft-proposals-hourly`, `proposal-engine-hourly`, `enterprise-evolution-daily`, `executive-brain-daily`, and (until today's fix) `executive-intelligence-daily`. This has been flagged as an open risk since `HANDOFF.md` (2026-07-12) and never rotated. It is the literal string `kjhgfdsa` — trivially guessable, and every function checking it is only as secure as this one shared value.

**Why not critical:** these are backend-to-backend cron calls, not a public-facing credential like C2, and most of the functions behind it are additionally protected by Supabase's own gateway or by not exposing sensitive writes. But it is the single point of failure for every "internal" automation in the system.

**Remediation (not applied):** Generate a strong per-purpose secret (or reuse the new `CRON_SECRET` pattern added to `executive-intelligence` today), set it as a project secret, update each cron job's command text via `cron.alter_job`, then remove `kjhgfdsa` everywhere. This requires touching ~15 `cron.job` rows — a deliberate, auditable batch change, not a code deploy.

### H2. 9 views defined with `SECURITY DEFINER`
`v_agent_trust_dashboard`, `v_meta_governance`, `v_constitution_violations`, `v_governance_dashboard_summary`, `v_market_intelligence`, `v_enterprise_knowledge`, `v_llm_spend_by_objective`, `v_cost_coverage`, `v_model_performance`. These views run with the permissions of whoever created them, not the querying user — meaning they can leak rows across RLS boundaries by design if any of them are queryable by roles that shouldn't see everything they expose. Governance and cost-visibility views are exactly the kind of thing that should NOT quietly bypass row-level security.

**Remediation (not applied):** Audit each view's actual query; where it doesn't need elevated privileges to do its job, recreate as a normal (invoker-rights) view. Where it genuinely needs to aggregate across RLS boundaries (e.g. a cross-tenant governance summary), keep SECURITY DEFINER but add an explicit role check inside the view or wrap it in a function that checks `is_admin()`/`get_my_role()` first.

---

## MEDIUM

### M1. 66 RLS policies across 59 tables are effectively no-ops ("always true")
Full table list: `agent_activity_log`, `agent_conversations`, `agent_kpi_targets`, `agent_objectives`, `agent_role_charter`, `agent_workday`, `ai_agents`, `ai_jobs`, `ai_outcomes`, `approvals`, `brain_agent_executions`, `brain_agent_memory`, `brain_agents`, `brain_ai_audit_log`, `brain_brands`, `brain_business_ideas`, `brain_conversations`, `brain_decision_dimensions`, `brain_decisions`, `brain_knowledge_chunks`, `brain_knowledge_documents`, `brain_knowledge_folders`, `brain_learning_insights`, `brain_messages`, `brain_sessions`, `brain_staff_reports`, `capability_backlog`, `ceo_daily_briefing`, `companies`, `company_annual_targets`, `company_bank_accounts`, `company_invoices`, `company_kyc_documents`, `company_revenue_actuals`, `company_revenue_milestones`, `consultant_brands`, `departments`, `execution_log`, `executive_recommendations`, `factory_tasks`, `founder_notifications`, `founder_principles`, `knowledge_documents`, `lead_documents`, `lead_ingestion_log`, `legal_reviews`, `marketing_campaigns`, `opportunity_backlog`, `orchestrator_requests`, `project_hub`, `proposals`, `research_runs`, `software_projects`, `training_completions`, `training_curriculum`, `voice_call_log`, `work_object_links`, `work_object_versions`, `work_objects`.

These say "RLS enabled" in the dashboard (unlike C3) but the policy itself grants unconditional access to any `authenticated` user — practically equivalent to no RLS for anyone with a login. Note `company_bank_accounts` and `company_kyc_documents` are in this list, which raises this closer to HIGH for those two specifically given the Founder Constitution's "AI never moves money" principle implies financial data should be tightly scoped.

**Remediation (not applied):** These were very likely written this way deliberately during early development ("any authenticated internal user can do anything") and never tightened once real auth/roles (`get_my_role()`, `is_admin()`) existed. Each needs a real policy scoped to role/ownership; `company_bank_accounts` and `company_kyc_documents` should be prioritized first within this bucket.

### M2. 19 functions have a mutable `search_path`
Includes `get_my_role`, `get_my_consultant_id`, `is_admin`, `my_brand_ids`, `search_knowledge_documents`, `record_enterprise_memory`, `brain_chat_rpc`, and several `auto_*` triggers. A mutable search_path on a `SECURITY DEFINER` function is a known privilege-escalation vector (a malicious `search_path` can shadow a table/function the definer-rights function calls).

**Remediation (not applied):** `ALTER FUNCTION ... SET search_path = public, pg_temp` (or the specific schemas each needs) on all 19.

---

## LOW

### L1. 2 extensions installed in the `public` schema
Flagged by the linter (`extension_in_public`, 2 occurrences) — not a live exploit path, but best practice is extensions in a dedicated schema so they don't clutter/shadow the public namespace.

### L2. Leaked-password-protection is off
1 finding (`auth_leaked_password_protection`) — Supabase Auth's HaveIBeenPwned check is disabled. Low urgency given this app's auth model isn't primarily consumer-password-driven, but free to enable.

### L3. 172 performance-only advisories (not security, noted for completeness)
`unindexed_foreign_keys` (88), `unused_index` (84), `auth_rls_initplan` (76), `multiple_permissive_policies` (73). None are security risks; listed here only so they aren't lost — they belong in a performance pass, not this plan.

---

## Suggested remediation order (not a deployment plan — sequencing only)

1. **C1 + C2 together** — closing the anon-RPC exposure is what makes the public anon key stop being a live risk. Fixing one without the other leaves the door open.
2. **C3** — two tables, low effort, high exposure.
3. **H1** — secret rotation, requires touching cron rows; do this as one deliberate batch, not piecemeal (avoid repeating today's partial-fix pattern where only one function got the new `CRON_SECRET` treatment).
4. **H2** — view-by-view audit; slower because each view's actual necessity for DEFINER rights needs a real read.
5. **M1**, prioritizing `company_bank_accounts` / `company_kyc_documents` first, then the rest.
6. **M2**, mechanical and low-risk — can likely be done in one batch migration.
7. **L1–L3** — housekeeping, any time.
