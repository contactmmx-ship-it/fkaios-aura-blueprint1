# Phase 0.1 — Execution Truth Layer — Checkpoint

**Date:** 2026-07-27
**Scope:** `supabase/functions/ai-engine/index.ts` only. No other function, migration, UI file, or business logic touched.
**Status:** Fixed, deployed (v46 → v47), live-verified against the same job-scheduler cron that drives all production job execution.

---

## 0. Continuation map (where prior work actually stopped)

Verified against git log, live Supabase schema/rows, and the deployed function bundle — not against prior checkpoint narrative.

| State | Item | Evidence |
|---|---|---|
| ✅ Completed | ai-engine multi-provider router migration (v46) | Steady real completions since deploy; the one function on the unified LLM gateway. |
| ✅ Completed | founder-executive memory-layer fix (fleet_memory/execution_log) | 77 fleet_memory rows, 2,636 execution_log rows flowing. |
| ✅ Completed | FounderCockpit promoted to default route | `src/app/page.tsx` renders FounderCockpit; confirmed live. |
| ⚠️ Stalled | Knowledge base ingestion pipeline | Built, ran exactly enough to prove it works (2 chunks), never resumed. |
| ⚠️ Stalled | RBAC scaffolding | Roles/permissions tables created, never connected (0 role-permission mappings). |
| ⚠️ Redirected | Approved "next" LLM-router migration order (founder-executive → lead-discovery → …) | founder-executive's LLM calls route through a *separately-written* fallback in `_shared/founder-brain.ts`, not the shared router — the planned step was substituted, not completed as specified. |
| ❌ **Incorrectly marked complete** | GENERATE_INVOICE / GENERATE_PROPOSAL / SCHEDULE_MEETING | The 2026-07-13 "fabrication fix" (INCIDENT comment still at the top of `ai-engine/index.ts`) quarantined *historical* fake completions but never fixed the mechanism that kept producing new ones. This is the true next step, and this checkpoint is that fix. |

---

## 1. Problem

`ai-engine`'s job runner (`runJobs()` → `executeJob()`) has never had a persistence step for **any** job type. It calls an LLM, parses whatever JSON it returns, and writes that parsed object into `ai_jobs.result` with `status = 'completed'`. There is no check on:

- whether the JSON represents real, valid business data,
- whether it was written anywhere durable,
- or whether the JSON itself is the model reporting its own failure.

For most job types (analysis/opinion tasks) that's honest. For three types it is not, because the job type name itself promises a real business artifact:

- **GENERATE_INVOICE** — implies a real invoice now exists.
- **GENERATE_PROPOSAL** — implies a real proposal now exists.
- **SCHEDULE_MEETING** — implies a real meeting is now booked.

None of these were ever true. The system was reporting AI-generated text as verified business execution.

## 2. Evidence before fix

Queried directly against the live production database (`nrlsqshkjuuwiovthrnb`), not from prior audit narrative:

| Job type | `ai_jobs` completed (post 2026-07-13 fix) | Real table rows | Sample of what "completed" actually contained |
|---|---:|---:|---|
| GENERATE_INVOICE | 153 | `invoices`: 0, `company_invoices`: 0 | Hallucinated GSTIN, invoice dated `2023-10-01` on a 2026 system. A separate sampled job returned `{"status":"error","message":"Brand ID must be specified for invoice generation."}` and was still marked `completed`. |
| GENERATE_PROPOSAL | 153 | `proposals`: 0 | Sampled completions were internal workday-reporting configuration payloads — the job type had been repurposed for an unrelated internal task, not customer proposals. |
| SCHEDULE_MEETING | 111 | `meetings`: 0 | Hardcoded placeholder Zoom link `https://zoom.us/j/1234567890`, meeting dated `2023-10-03`. |

Same generic pattern confirmed by direct code inspection (no per-type branch exists anywhere in `ai-engine`) and spot-sampled on two more types, reported here for completeness, **not fixed** (see §8):

- `CLOSE_DEAL`: sampled completion was an LLM opinion (`close_probability`, `objection_handling` text) — no deal/contract record created anywhere.
- `MANAGE_FINANCE`: sampled completion was `{"status":"success","message":"..."}` — no financial record created anywhere.

## 3. Root cause

**File:** `supabase/functions/ai-engine/index.ts`
**Function:** `runJobs()`
**Line (pre-fix):** 258 (`supabase.from("ai_jobs").update({ status: "completed", result, ... })`)

| | Detail |
|---|---|
| Current logic (pre-fix) | `executeJob()` (line 127) calls the LLM via `callLLM()`, `JSON.parse()`s the response, and returns it. `runJobs()`'s loop (line 253) takes that return value verbatim as `result` and writes `status: "completed"` — success is defined as "the LLM's text parsed as JSON," nothing more. |
| Problem | (a) No check on whether the parsed JSON is itself an error the model reported (`{"error": "..."}`, `{"status":"error", "message": "..."}`) — these were written as `completed`. (b) No persistence step exists for job types that name a real business artifact — `GENERATE_INVOICE`/`GENERATE_PROPOSAL`/`SCHEDULE_MEETING` were marked `completed` for producing a JSON blob, with nothing written to `invoices`, `proposals`, or `meetings`. |
| Contributing factor | `agent-scheduler/index.ts` (line 110–126, `resolveEdgeFunctionName()`) and `orchestrator/index.ts` (line ~290) both define a job-type → dedicated-engine routing table (`GENERATE_INVOICE → invoice-pdf`, `SCHEDULE_MEETING → meeting-scheduler`, `GENERATE_PROPOSAL → document-engine`) that would have solved this correctly — but per an existing comment in `agent-scheduler/index.ts` (lines 179–196, dated 2026-07-08), **every dispatch was redirected to the generic `ai_jobs` → `ai-engine` path instead**, "the safe default... until each [target function] is checked individually." That check was never done. `job-scheduler/index.ts` confirms this in production: it calls `ai-engine/run_jobs` exclusively (lines 82, 149) and never touches the routing table at all. |
| Expected logic | A job can only report `completed` when its own result is not itself an error, **and**, for job types that name a real business artifact, when that artifact has actually been persisted somewhere durable. Until real persistence exists for a given type, it must fail loudly and immediately — not fabricate a lesser form of success. |

### What's actually available for real persistence, per type (investigated, not built)

| Job type | Dedicated engine exists? | What it actually does |
|---|---|---|
| SCHEDULE_MEETING | **Yes** — `meeting-scheduler/index.ts` (1,159 lines) | Real. Genuine Google Calendar integration (`getGoogleAccessToken`, `getAvailableSlots`), 9 separate real writes to the `meetings` table, actions for `schedule_meeting`/`confirm_slot`/`create_meeting`/`update_meeting`/`cancel_meeting`/`list_meetings`. Fully built, simply never wired into the live job pipeline. |
| GENERATE_INVOICE | **No** — `invoice-pdf/index.ts` (472 lines) is a *renderer*, not a creator | Confirmed by full read: it takes a complete `invoice`/`items`/`company` object in the request body and returns HTML. It has zero references to the `invoices` table anywhere in the file — it neither reads nor writes it. There is currently no function anywhere in this codebase that creates an invoice row. |
| GENERATE_PROPOSAL | **No** — `document-engine/index.ts` | Per the existing `agent-scheduler` comment (already independently verified there): "document-engine only does file upload/delete, not proposal generation." Confirmed wrong target, not a persistence engine for proposals. |

## 4. Files modified

- `supabase/functions/ai-engine/index.ts` — the only file changed. Purely additive (+67 lines, 0 deletions per `git diff --stat`).

No other file was touched. `meeting-scheduler`, `invoice-pdf`, `document-engine`, the frontend, and the Founder Brain architecture are all unmodified — confirmed via `grep` that no other function imports `ai-engine`'s internals, so this change cannot regress anything outside this one file.

## 5. Technical solution

Two additive guards inside `ai-engine/index.ts`, both routing through the **existing** honest failure path (no new status values, no new tables):

**a) `resultReportsFailure()` (generic, applies to every job type)** — after `executeJob()` returns, if the parsed result itself looks like `{"error": "..."}` or `{"status": "error", "message": "..."}`, it is thrown as a real error instead of being written as `status: "completed"`. This is a plumbing fix, not new business logic — it corrects "did JSON.parse succeed" to "does this JSON report success," which was always what the code intended (see the file's own 2026-07-13 incident comment: "an outage is visible; a fabrication is trusted").

**b) `NO_PERSISTENCE_JOB_TYPES` gate (scoped to the three named types)** — before calling the LLM at all, `GENERATE_INVOICE`/`GENERATE_PROPOSAL`/`SCHEDULE_MEETING` jobs are marked `status: "failed"` immediately, with a clear, specific error explaining why (no real persistence path exists yet) and a pointer to this checkpoint. This is terminal, not retried (`retry_count` untouched) — the failure isn't transient, so retrying would only waste LLM spend on a call whose result would be discarded regardless of what it said.

Deliberately **not** done in this pass: building real persistence for these three types (deciding the correct target table between `invoices`/`company_invoices`, wiring `SCHEDULE_MEETING` into the already-real `meeting-scheduler`, designing a proposal template/table). That is genuine business-logic work — Phase 3 (Autonomous Revenue Engine) per the roadmap — not a truth-layer fix, and doing it now would mean guessing at business rules (which table is canonical, how an invoice links to a deal, GST/tax correctness) without a clear specification. Making the failure honest now, and building the real thing deliberately later, is worth more than a rushed, undocumented implementation.

## 6. Evidence after fix

- `deno check supabase/functions/ai-engine/index.ts` — 0 errors.
- `deno lint` — 0 new issues (3 pre-existing `no-explicit-any` warnings, all in code this change didn't touch).
- `deno test supabase/functions/_shared/llm-router.test.ts` — 14/14 passed, unchanged (this change doesn't touch the router).
- Deployed via `deploy_edge_function` to project `nrlsqshkjuuwiovthrnb`. **Version 46 → 47**, same function ID (`d7bfee97-ceca-465e-b1ce-7a76ce892765`), `verify_jwt: true` preserved unchanged.
- **Live verification:** inserted a real `pending` `GENERATE_INVOICE` job (`id a528c238-eced-4eed-94f8-5552d578a67a`, payload `{"phase0_1_verification_probe": true}`) directly into production `ai_jobs`, then let the real `job-scheduler-drain` cron (`*/10 * * * *`, unmodified) pick it up exactly as it would any real job — no manual invocation, no special-cased test path. Confirmed result after the next tick (`updated_at 05:50:03`, ~10 min after insert at `05:40:21`):

  ```json
  {
    "status": "failed",
    "retry_count": 0,
    "result": {
      "error": "GENERATE_INVOICE has no real persistence path in ai-engine's job runner yet — completing it would only mean an LLM produced a document-shaped JSON blob, with nothing written to the real business table. Refusing to report this as completed. See FKAIOS_CHECKPOINT_PHASE0.1_EXECUTION_TRUTH_FIXED.md."
    }
  }
  ```

  Terminal failure, correct reason, zero retries wasted, LLM never called for it — exactly as designed. Test row deleted afterward (scoped delete on the exact ID + the `phase0_1_verification_probe` payload marker, so no risk to real data).

## 7. Remaining risks

- **Downstream signal change, not a regression:** anything that previously counted `ai_jobs.status='completed'` for these three types as evidence of real work (dashboards, KPI rollups) will now correctly see them as `failed`. This is the intended correction — those completions were never real — but it will make in-flight metrics for invoicing/proposals/meetings look worse before they look better, purely because they're now honest.
- **New GENERATE_INVOICE/GENERATE_PROPOSAL/SCHEDULE_MEETING jobs will fail 100% of the time** until Phase 3 builds real persistence. Anything upstream that queues these job types (agent schedules, orchestrator dispatch) will see a failure rate spike for these specific types — expected, not a bug, but worth knowing before checking dashboards.
- **`resultReportsFailure()`'s heuristic is shallow by design** — it only catches the two shapes actually observed in production (`error` key, `status:"error"` + `message`). A model could still return a fabricated-but-well-formed "success" object for other job types; this fix does not — and was not scoped to — solve LLM hallucination in general, only the two concrete lie patterns found in the audit.
- **The underlying architectural gap is untouched:** `agent-scheduler`'s and `orchestrator`'s job-type routing tables still point at real dedicated engines (`meeting-scheduler`, etc.) that remain unwired into the live path. This fix stops the lying; it does not close that gap.

## 8. Audit of other job types — findings only, not fixed (per instruction)

Same generic code path (`executeJob`/`runJobs`, no per-type branching anywhere in `ai-engine`) applies uniformly to every job type in the system. Spot-checked below; the rest were not individually sampled but share the identical mechanism by direct code inspection.

| Job type (user's category) | Live type name(s) | Sampled evidence | Real persistence exists? |
|---|---|---|---|
| CLOSE_DEAL | `CLOSE_DEAL` | Sampled completion: LLM opinion object (`close_probability`, `objection_handling`, `next_action`) | No — no `deals`/contract table receives this anywhere. |
| CREATE_LEAD | `CAPTURE_LEADS` | Not sampled this pass | `leads` table is real and has 133 rows, but those come from a separate ingestion path (Apify/web-crawler), not confirmed to originate from `CAPTURE_LEADS` job completions specifically. |
| ACCOUNTING jobs | `MANAGE_FINANCE`, `CALCULATE_COMMISSION`, `TRACK_ROYALTY` | `MANAGE_FINANCE` sampled: `{"status":"success","message":"..."}` — acknowledgment text only | No — no accounting/ledger table write observed. |
| PAYMENT jobs | *(none exist)* | — | There is no payment-related `ai_jobs.type` anywhere in the live data — confirms the earlier audit finding that autonomous payment collection doesn't exist even as an attempted job type. |
| DELIVERY jobs | `TRACK_COURIER` | Not sampled this pass | Shares the identical code path; no delivery/shipment table write mechanism exists in `ai-engine`. |
| CLIENT onboarding | `ONBOARD_FRANCHISEE` | Not sampled this pass | Shares the identical code path; `client_projects` sits at 0 rows. |
| REPORT generation | `GENERATE_REPORT` | Not sampled this pass | `ceo_daily_briefing` (21 rows) exists but is more likely populated by a separate mechanism (e.g. founder-brain-tick), not confirmed to correlate with `GENERATE_REPORT` job completions. |

**Recommendation, not applied:** the same two guards added in this fix (`resultReportsFailure`, and a persistence check before marking `completed`) generalize cleanly to every job type. The reason only three were fixed here is that only three have a currently-false claim of *artifact creation* baked into their name — the others are honestly "opinion/analysis" tasks where an LLM response is a legitimate result. Before extending this further, each remaining type should get the same individual verification these three received (confirm what "done" should mean, confirm whether a real target table exists) rather than a blanket rule.

## 9. Next recommended phase

Per the roadmap, this closes Phase 0.1. Recommended next: **0.2 Unified LLM Gateway** — consolidate `ai-engine`'s router usage and `_shared/founder-brain.ts`'s separately-written fallback into one implementation before any further functions are migrated onto either. Rationale: two independently-maintained failover implementations is worse than one everywhere, and it's a small, well-scoped, low-risk change (same category as this one) before touching RBAC/RLS (0.3), which is higher-risk and needs its own dedicated pass.

Not started. Waiting for approval before proceeding, per instruction.
