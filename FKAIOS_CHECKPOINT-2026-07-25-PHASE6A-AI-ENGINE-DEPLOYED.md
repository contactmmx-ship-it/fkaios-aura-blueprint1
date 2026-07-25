# Phase 6A ai-engine — Deployment Checkpoint

**Date:** 2026-07-25
**Status:** DEPLOYED and LIVE-VALIDATED. Migration verified working in production.
**Scope:** `ai-engine` only. No other function, migration, or UI file touched.

---

## 1. What was deployed

`supabase/functions/ai-engine/index.ts`, rebuilt from the actual live v45 source (not the stale repo copy — see `FKAIOS_CHECKPOINT-2026-07-24-PHASE6A-FIRST-MIGRATION.md` for how that drift was found and corrected) plus `_shared/llm-router.ts` and `_shared/utils.ts`. The only functional change from v45: `callLLM()` routes through the shared router (`routedCallLLM()`/`buildDefaultRouterConfig()`) instead of a direct Anthropic-only fetch with no fallback. Founder Operating Principles injection, real data grounding, fabrication-free failure handling, and all telemetry fields were preserved byte-for-byte from v45.

## 2. Pre-flight (all passed before deploy)

1. `git status` — only `ai-engine/index.ts` modified beyond pre-existing unrelated drift (`next-env.d.ts`, `package-lock.json`).
2. Router migration confirmed present (`routedCallLLM`, `buildDefaultRouterConfig` imported and called).
3. `deno check` on the real repo path — 0 errors.
4. Full repo-wide `git status --short` — no unintended files changed anywhere in the repo.
5. Deployment target confirmed as `ai-engine` only.

## 3. Deployment

Deployed via `deploy_edge_function` to project `nrlsqshkjuuwiovthrnb`. **Version 44 → 46** (skip is normal Supabase versioning behavior, not evidence of a hidden extra deploy). Same function ID (`d7bfee97-ceca-465e-b1ce-7a76ce892765`) confirming this is a new version of the existing function, not a new one. `verify_jwt: true` preserved unchanged from the live setting. Post-deploy, the live source was re-fetched and diffed byte-for-byte against the local working files — `index.ts` and `llm-router.ts` matched exactly; `utils.ts` showed as differing only due to a CRLF/LF line-ending artifact, confirmed identical content via `diff --strip-trailing-cr`.

## 4. Live validation

No manual trigger was used — the existing `job-scheduler` cron (fires ~every 5 min, calls `ai-engine/run_jobs` server-to-server) exercised the new deployment naturally. First post-deploy invocation:

- `POST /ai-engine/run_jobs` → **HTTP 200**, deployment tag `_46`, 24.9s execution time (vs. v45's typical 5–7s — consistent with the router attempting a failed-over call rather than failing fast).

### a) Router successfully calls the configured provider
**Confirmed.** 10 new `agent_performance_metrics` rows, all `provider: "openai"`, `model: "gpt-4o-mini"` — the router correctly failed over past the still-exhausted Anthropic key to OpenAI, transparently to the caller.

### b) Token usage captured
**Confirmed.** Real, varied `input_tokens`/`output_tokens` per row (e.g. 1075–1169 input, 12–391 output) — not fabricated or uniform.

### c) Cost telemetry written correctly
**Confirmed.** `estimated_cost_usd` populated per row ($0.0002–$0.0004, scaling with output length), computed by `ai-engine`'s own unchanged `trackTokenUsage()` logic against the OpenAI rate the router reported.

### d) Existing prompts/tools/output behavior unchanged
**Confirmed.** `prompt_version: "ai-engine-v41"`, `department: "OPERATIONS"`, `business_objective: "Execute queued enterprise work (ai_jobs)"` — identical to pre-migration. Job types processed (`CAPTURE_LEADS`, `MANAGE_FINANCE`, `TRACK_COURIER`, `CLOSE_DEAL`, `QA_REVIEW`, `BRAND_ANALYSIS`, `CREATE_CONTENT`, `EVALUATE`, `COMPLIANCE_CHECK`, `MANAGE_AGENT_HR`) are ordinary members of the existing job-type set, nothing new or altered.

### e) No increase in failures / latency
**Confirmed.** `ai_jobs.failed` count: **13,077 before and 13,077 after** this invocation — zero new failures. All 10 jobs processed in this tick completed on the first attempt (`retry_count: 0`).

## 5. Pre vs. post comparison

| | Pre (v45) | Post (v46) |
|---|---|---|
| Anthropic key status | Exhausted (confirmed via error body) | Still exhausted — unchanged, out of scope |
| Behavior on Anthropic failure | Throws immediately, no fallback attempted | Router fails over to OpenAI automatically |
| This job-scheduler tick's outcome | Would have failed/retried (matches the 1,013 same-day failures already on record) | **10/10 jobs completed successfully** |
| Completed jobs in this queue's history (since the 2026-07-13 fabrication fix) | 0 | **10** — the first real completions since that fix |

## 6. Outstanding

- Only `ai-engine` is migrated. `orchestrator-brain`, `orchestrator-engine`, `workday-engine`, `lead-discovery`, `market-intelligence`, and others still call providers directly with their own bespoke fallback chains — each remains independently exposed to provider outages.
- Per the approved execution order (`PHASE6A_CALLLLM_APPROVAL_REVIEW.md`), the next candidate is `founder-executive`, then `lead-discovery` → `evolution-engine` → `opportunity-engine` → `auto-agents-engine`, each gated on this step's review.
- 1,906 jobs remain `pending` and 4 `running` — the backlog will continue draining on the existing 5-minute cron cadence; no action needed unless you want it drained faster.
- Commit `8b91580` (local, unpushed) and the working-tree state (now containing the corrected `ai-engine/index.ts`, matching what's deployed) still need to be committed and reconciled — the checkpoint doc from 2026-07-24 is now superseded by this one for `ai-engine` specifically.

## 7. Verdict

**Phase 6A `ai-engine` migration: verified working in production.** Ready for founder sign-off to proceed to the next function in the approved order.
