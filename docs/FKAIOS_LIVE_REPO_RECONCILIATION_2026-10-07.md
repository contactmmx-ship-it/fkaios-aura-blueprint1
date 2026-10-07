# FKAIOS: live → repo reconciliation (7 Oct 2026, 11:20 UTC)

**Sources:**
- live `supabase_migrations.schema_migrations`;
- live `pg_proc` / `pg_class`;
- snapshot branch `snapshot/production-20261007-104144`, which holds every deployed function's original source, compared byte for byte against `main`;
- `.github/workflows/deploy-supabase-functions.yml`.

**Rule:** production is never overwritten from the repo without a per-object diff review.

## LIVE → REPO RECONCILIATION TABLE

| Object | Production State | Repo State | Drift | Risk | Required Action |
|---|---|---|---|---|---|
| Migration history | 115 applied | 38 files in `supabase/migrations`; full record of the first 113 in `supabase/live-snapshot/migrations` (md5-verified) | History names differ: 14 old repo files were applied under other names or versions | Low. Every object they create exists live (22 of 22 checked: tables `approvals`, `orchestrator_requests`, `fleet_memory`…, functions `compute_*`, `detect_silences`, `match_knowledge_chunks`…) | None for the schema. Treat `supabase/live-snapshot/migrations` as the authoritative history. Never run `supabase db push` against production from this folder |
| Backlog cleanup A and C | Applied 10:48 and 10:52 as `backlog_cleanup_audit_step4_a_*` and `_c_*` | In `20261007120000_backlog_cleanup_audit_step4.sql` | None | None | None |
| Backlog cleanup B | Applied outside the migration system (not in `schema_migrations`) | Part B of the same file | History gap only | Low: the data state is verified (1 pending gate, 0 self-started `processing`) | Leave as recorded. Do not re-apply |
| Security hardening | 5 applied migrations (`security_close_anonymous_exposure_1…4`) | `20261007100000_security_close_anonymous_exposure.sql` (their union) | None | None | None |
| Core functions deployed by CI (ai-engine v115, founder-brain-tick v99, founder-objective v69, research-engine v21, builder-engine v50) | CI-built | Same source | **0 bytes** | None | Keep CI as the only deploy path |
| 13 other functions identical to `main` (apify-settings, brands-public, company-admin-engine, diagnostic-secrets-check, heartbeat-engine, invoice-engine, knowledge-engine, project-review-engine, proposal-engine, temp-key-check, vault-engine, verify-voice, whatsapp-webhook-v2) | Hand-deployed | Same source | 0 | Low | Can be added to CI later, one at a time |
| 69 functions that differ | Hand-deployed | Different source (72 entry files; shared modules: `_shared/utils.ts` ×17, `founder-brain.ts` ×7, `llm-router.ts` ×5, `metrics.ts` ×4, others) | Either side may be newer | **High if deployed from the repo blindly**: this could roll back live fixes or ship untested repo code | Reconcile one at a time with a 3-way diff (snapshot vs repo vs git history), then add to CI. Not started; ordered by business use |
| 7 functions only live (evolution-engine, executive-brain, factory-intake, factory-planner, lead-email-send, opportunity-engine, products-public) | Hand-deployed, single-file | Missing | Source absent from the repo | Medium: they can't be rebuilt from the repo | **Done:** exact live source added under `supabase/functions/<slug>/index.ts`. Not deployed (CI deploys only the 5 core functions) |
| 4 functions only in the repo (founder-confidence-cell, founder-curiosity-tick, founder-reassignment-cell, founder-reflection-cell) | Not deployed | Present | Never deployed | Low. Note that `founder-reassignment-cell` would re-queue failed work, so do not deploy it without review | Leave undeployed |
| CI coverage | 5 of 94 functions | Workflow deploys a fixed list of 5 | — | — | Widen only after each function's drift is reconciled |
