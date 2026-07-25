# Founder Brain Tick — Cognitive Loop Status

**Date:** 2026-07-24
**Method:** Direct read of deployed source (`supabase/functions/_shared/founder-brain.ts`, `curiosity.ts`, `executive-planner.ts`, `decision-intelligence.ts` — the exact bundle currently live under `executive-intelligence` v14, fetched via `get_edge_function`) + live query of `cron.job` and `cron.job_run_details` on project `nrlsqshkjuuwiovthrnb`. No code changed, nothing activated.

---

## 1. Does the code exist?

**Yes — extensively.** This is the most mature, best-documented part of the codebase. Confirmed present and readable:

| Piece | Function(s) | File |
|---|---|---|
| Confidence | `buildIntuition()`, `getLatestConfidenceState()` | `executive-planner.ts` |
| Reflection | `reflect()`, `getReflectionHistory()` | `executive-planner.ts` |
| Importance scoring | `computeImportanceScores()`, `getImportanceScores()` | `executive-planner.ts` |
| Curiosity | `identifyKnowledgeGaps()`, `curiosityTick()` | `curiosity.ts` |
| Belief | belief-revision block inside `curiosityTick()`, `getBeliefHistory()` | `curiosity.ts` |
| Learning | `getLearningTrend()`, `founderMemory.learning.recordOutcome()` | `executive-planner.ts` / `founder-brain.ts` |
| Whole-cycle orchestration | `cognitiveTick()` | `founder-brain.ts` |
| Executive/founder decision layer | `generateFounderDecisionProfile()` and friends | `decision-intelligence.ts` |

`cognitiveTick()` in `founder-brain.ts` is the single entry point that chains all of the above: observe → think → imagine → learn(pre) → predict → evaluate against goals → decide act/wait → simulate strategies → assess risk → create task → review completed → propose constitution amendment. This is a real, wired pipeline, not a stub.

## 2. Are database tables ready?

**Yes.** Every table this code touches exists and is queried successfully elsewhere in this session: `fleet_memory`, `founder_memory`-equivalent (`fleet_memory` is the actual storage, `founder_memory` in code is an adapter object over it), `execution_log`, `agent_performance_metrics`, `orchestrator_requests`, `orchestration_tasks`, `approvals`, `founder_identity`, `founder_principles`, `brain_conversations`, `brain_messages`. No missing-table errors anywhere in this pipeline.

## 3. Are migrations applied?

**Mostly yes, with one confirmed exception.** `list_migrations` shows 78 applied migrations through `20260714153634_phase9_model_orchestration`, covering essentially everything `founder-brain.ts`/`executive-planner.ts`/`curiosity.ts` depend on. **The one migration that is NOT applied:** `supabase/migrations/20260717000000_schedule_founder_brain_tick_cron.sql` — this file exists in the repo (dated after the last migration actually applied) and its entire purpose is to `cron.schedule('fkaios-founder-brain-tick', ...)`. It was never run against the live database.

## 4. Is cron scheduled?

**No — confirmed by direct query, not inference.**

```sql
select count(*) from cron.job where jobname ilike '%founder-brain%';
-- returns 0
```

The full `cron.job` table (jobs 13–38, all currently active jobs enumerated this session) contains **zero** entries calling `founder-brain-tick`. Every other cognitive/executive cron path that exists (`executive-intelligence-daily`, `ceo-think-daily`, `enterprise-evolution-daily`, `executive-brain-daily`) is scheduled and has run history. `founder-brain-tick` specifically does not.

## 5. What prevents it from running?

Nothing structural — the prevention is purely **the absence of a schedule**. Specifically:
- The edge function `founder-brain-tick` is deployed and `ACTIVE` (confirmed in `list_edge_functions`).
- Its dependencies (`cognitiveTick()` and everything it calls) are real, wired, and use tables that exist with data in them.
- The one missing migration would have added exactly the cron job needed.
- Absent that, `founder-brain-tick` only runs if something invokes it manually via HTTP — which nothing in this codebase currently does automatically.

Secondary risk once scheduled: `cognitiveTick()`'s `reason()` calls go through `founder-brain.ts`'s Anthropic→Gemini→OpenAI fallback chain. Given the Anthropic credit exhaustion confirmed live today (2026-07-24) is breaking other Anthropic-first callers (`ai-engine`, `lead-discovery`, `evolution-engine`, `opportunity-engine`), `founder-brain-tick` would likely also hit the same Anthropic 400 on its first attempt per call — but unlike `executive-intelligence` (which was migrated to call OpenAI directly with no fallback), this pipeline's `reason()` **already has** a Gemini/OpenAI fallback built in, so it may partially self-heal *if* `GEMINI_API_KEY` or `OPENAI_API_KEY` are set as project secrets. This has not been verified — no test invocation was made (per this task's "do not activate" instruction).

## 6. What is the minimum required to activate it?

1. Apply (or replicate) the cron scheduling in `supabase/migrations/20260717000000_schedule_founder_brain_tick_cron.sql` — this is the entire gap.
2. Before flipping it on, verify at least one of `GEMINI_API_KEY` / `OPENAI_API_KEY` is actually set as a project secret (not just referenced in code), so the cycle doesn't silently fail the same way the Anthropic-dependent engines are failing right now.
3. Decide the schedule interval deliberately — the un-applied migration's own comment says "every 15 minutes," which is a lot more frequent than every other cognitive cron (`executive-intelligence-daily` is once/day). Running the full `cognitiveTick()` chain (multiple LLM calls per tick: think, imagine, predict, evaluate, decide, simulate, assess, plus curiosity's own calls) every 15 minutes has real cost and rate-limit implications that should be a deliberate choice, not an inherited default from a 2026-07-17 draft.
4. After scheduling, confirm with the same method used for the executive-intelligence fix: read `net._http_response` for the actual HTTP status of the first automated run (not just `cron.job_run_details`, which reports "succeeded" even when the downstream call 401s or 400s).

---

## Classification Summary

| Component | Status |
|---|---|
| Confidence calculation | **IMPLEMENTED** |
| Reflection engine | **IMPLEMENTED** |
| Importance scoring | **IMPLEMENTED** |
| Curiosity engine | **IMPLEMENTED** |
| Belief updates | **IMPLEMENTED** |
| Learning loop (outcome recording) | **IMPLEMENTED** |
| `cognitiveTick()` orchestration | **IMPLEMENTED** |
| Database schema/tables | **IMPLEMENTED** |
| Cron scheduling | **MISSING** (migration file exists, never applied) |
| Verified successful autonomous run | **BLOCKED** (cannot exist without the missing cron; no manual test run performed under this audit's no-activation constraint) |
| Resilience to current Anthropic outage | **UNKNOWN** — has a Gemini/OpenAI fallback in code, but whether those secrets are actually configured has not been checked |

**Overall: PARTIAL.** The intelligence is real and complete; the switch to turn it on autonomously was never installed.
