# Phase 6A First Migration Checklist

**Date:** 2026-07-24
**Status:** Planning document only. No production function modified, nothing deployed, no migration performed while producing this document.
**Purpose:** Prepare the review for the first production migration onto `llm-router.ts`. This document does not authorize or perform any migration — it exists so the Founder can compare the two candidates before picking one.

---

## 1. Migration Goal

- Move provider-calling logic out of the function's own code and into the shared `llm-router.ts` (`callLLM()`).
- **Preserve existing prompts, tools, business logic, and outputs exactly.** The migration changes only *which code decides which provider to call* — it does not change what is asked of the LLM, what tools/schemas are offered, or what the function does with the answer. This is Preserve → Enhance → Extend applied literally, per every prior Phase 6A document.

---

## 2. First Candidate Review

### Option A: `ai-engine`

- **Why choose it:** It's the highest-volume, most general-purpose function in the priority group — a job-queue processor handling multiple job types (invoices, proposals, agent chat) on a 10-minute cron. Migrating it first would exercise the router against the widest variety of real request shapes in one go, and it's already the best-understood function in this audit (its exact defect line — the catch block re-throwing on "Anthropic API error"-prefixed messages — was directly identified from deployed source).
- **Risk:** It touches several job types at once, so a regression here could affect multiple downstream business processes simultaneously rather than one. Being cron-triggered every 10 minutes means any issue surfaces — and repeats — quickly: fast feedback, but also frequent real-world exposure while still being verified.
- **Expected learning value:** High. Validates the router against the broadest mix of real request shapes and gets verification evidence (via job status / real response inspection) quickly, given how often it runs.

### Option B: `founder-executive`

- **Why choose it:** It's JWT-gated and on-demand, not cron-triggered — a single, clear purpose (the "Command Center" Q&A/briefing interface). Blast radius per invocation is naturally smaller and more controlled, since usage is human-triggered rather than automatic.
- **Risk:** It is Founder-facing directly. A regression here is immediately visible to the Founder personally in the interface they use themselves — a different kind of risk (trust/visibility) than `ai-engine`'s, even though it's technically the more contained of the two.
- **Expected learning value:** Moderate. Confirms the router and the shared fallback-defect fix work correctly against a second real case with a simpler, single-purpose prompt/response shape — useful for proving the fix generalizes, less useful for stress-testing the router's breadth than Option A.

Both functions share the identical fallback-defect bug (documented in `FKAIOS_PHASE6A_IMPLEMENTATION_PLAN.md`), so whichever is migrated first, the same underlying fix is what's actually being proven. This document does not recommend one over the other — that choice is the Founder's to make based on which risk profile (broad-but-fast-feedback vs. narrow-but-Founder-visible) is preferred to test first.

---

## 3. Migration Steps (Simple)

1. **Capture current behavior** — record the exact live prompt, tool schema, and output shape for the chosen function before any change, so there is a real "before" to compare against.
2. **Replace provider transport only** — swap the function's own duplicated provider-calling code for a call to `callLLM()`. Nothing else in the function changes.
3. **Connect `callLLM()`** — wire the function's existing request into the shared router's `LLMRequest` shape.
4. **Test** — run the function against real conditions (or the closest safe equivalent) and confirm it behaves.
5. **Compare output** — the response produced via `callLLM()` must match the pre-migration behavior for the same input; any difference needs to be understood before proceeding, not waved through.
6. **Review logs** — confirm the structured log entry (`function_name`, `attempted_providers`, `successful_provider`, `failure_reason`, etc.) is populated correctly and reflects what actually happened.
7. **Founder approval before next function** — no second function is migrated until this one is reviewed and approved.

---

## 4. Safety Rules

- No prompt changes.
- No tool schema changes.
- No database changes.
- No migrations.
- No secrets changes.

---

## 5. Current Status

**Phase 6A:**
- ✅ Architecture approved
- ✅ Router built
- ✅ Tests passed
- ⏸ First production migration awaiting approval
