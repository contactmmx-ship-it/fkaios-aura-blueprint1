# FKAIOS audit steps 2–5: progress (7 Oct 2026)

Follows `docs/FKAIOS_AUDIT_2026-10-07.md`. Step 1 (restore an LLM provider) is Rajeev's.

## Step 2: security ✅ done, applied live, verified

- Migration `20261007100000_security_close_anonymous_exposure.sql`. It was applied live as 5 migrations at 10:21–10:24 UTC.
- What changed:
  - Anonymous EXECUTE revoked on 31 SECURITY DEFINER functions.
  - Anonymous access revoked on 9 definer views.
  - RLS plus a signed-in read policy on `agent_aliases` and `model_registry`.
  - `search_path` pinned on 43 functions.
- Verified after applying:
  - 0 anon-executable definer functions;
  - 0 mutable search paths;
  - 0 anon view grants;
  - no public table without RLS.
- Signed-in users and the service role are unaffected.
- **Still Rajeev's to do:**
  - rotate `HEARTBEAT_SECRET` and the cron `secret=` values;
  - turn on leaked-password protection (Auth settings).

## Step 3: repo ↔ production 🟡 recorded; reconciliation still needed

- **Migrations:** all 113 applied migrations were exported, each checked against its live md5 (0 mismatches), with secrets redacted. They are in `supabase/live-snapshot/migrations/`, a record only that is never applied from there.
- **Functions:** the `Snapshot FKAIOS production state` workflow, a manual and read-only GitHub Action, exports every live function's original source.
  - It writes to a `snapshot/production-*` branch.
  - Latest run: `snapshot/production-20261007-104144` (94 functions, 0 export failures).
- **Exact drift** (byte-for-byte against `main`):
  - **18 identical:** ai-engine, apify-settings, brands-public, builder-engine, company-admin-engine, diagnostic-secrets-check, **founder-brain-tick (live v98)**, founder-objective, heartbeat-engine, invoice-engine, knowledge-engine, project-review-engine, proposal-engine, research-engine, temp-key-check, vault-engine, verify-voice, whatsapp-webhook-v2.
  - **69 differ.** In 72 entry files and in some shared modules (`_shared/utils.ts` ×17, `founder-brain.ts` ×7, `llm-router.ts` ×5, …), production and the repo have diverged. Either side may be newer.
  - **7 live only, with no source in the repo:** evolution-engine, executive-brain, factory-intake, factory-planner, lead-email-send, opportunity-engine, products-public.
  - **4 repo only, never deployed:** founder-confidence-cell, founder-curiosity-tick, founder-reassignment-cell, founder-reflection-cell.
- **Rule from now on:**
  - CI (`deploy-supabase-functions.yml`) is the only deploy path.
  - A function may be added to CI only after its live source and repo source have been reconciled, using the snapshot branch.
  - Never hand-deploy. Never deploy a "differs" function from the repo blindly: it could overwrite newer live code.
- The CI token cannot use the database-query API (403), which is why migrations were exported through the Supabase connector instead.

## Step 4: backlog 🟡 code and data migration written; waiting to ship

- **Code:** Founder-Brain-generated objectives (`cognitiveTick`, `founderAgent`) now always wait for founder approval in the Decision Center, whatever their assessed risk. A founder's own high-risk objective is no longer swallowed by an unrelated pending proposal.
- **Data migration `20261007120000_backlog_cleanup_audit_step4.sql`** (dry-run counts from live). It is to be applied **after** the code deploys:
  - **A:** expires 264 duplicate pricing-proposal approvals. A loop re-drafted the same proposal for the same lead every ~30 minutes (18–22 Sep). The newest approval per lead (5) stays pending.
  - **B:** the 5 Brain objectives that started themselves on 6–7 Oct (`39dd2cf8`, `352317c0`, `51f3531c`, `1d372b3c`, `a44e6eac`) → the newest becomes a pending proposal; the other 4 are superseded.
  - **C:** archives about 199 projects left `working` under ended objectives (status `failed`, with the reason recorded).
  - It touches no `ai_jobs`, no tasks and no completed work.
- **Remaining approvals for Rajeev** after A (not decided by engineering):
  - 37 `executive_capital_allocation` (Jul–Sep). Likely obsolete, e.g. "Allocate INR 5,000,000 towards LinkedIn integration".
  - 16 lead-qualification `research_required`.
  - 5 pricing proposals (one per lead).
  - 7 franchise campaigns.
  - 5 strategies A–E.
  - 2 software builds.
  - 1 Founder Brain task; 1 July accounts action.
- **Found:** GoMax objective `6217332e` was set to `failed` ("superseded by newer active gate") on about 5 Oct by a one-off. No code in the repo or the database does this now.

## Step 5: verification 🟡 code written; waiting to ship

- Completing an objective now writes a `fkaios_verification_evidence` row (`completion_gate:all_tasks_verified`), with each task's status and capability dispatch. This happens before anything is marked complete, and a failed write blocks the completion.
- `final_output` now stores the verdict plus every completed task's actual work product, not only the one-line summary. HTML products keep their own output.
- `agent_runs`:
  - every failed attempt now closes its run (retries used to leave runs in `running`; 68 such rows on 7 Oct);
  - a reaper in ai-engine closes runs open more than 30 minutes, matching each to its job's real outcome.
- Tests: `objective-rerun.test.ts` 15/15 pass. `deno check` shows no new type errors (ai-engine 0; founder-brain-tick has only the 41 already on `main`).
