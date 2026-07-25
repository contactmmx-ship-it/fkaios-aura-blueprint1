# FKAIOS Phase 6A Execution Checklist

**Date:** 2026-07-24
**Status:** Planning document only. No code changed, no migration created, nothing deployed, no secrets touched, no cron activated while producing this document.
**Built from:** `FKAIOS_PHASE6A_IMPLEMENTATION_PLAN.md` (incl. its "Phase 6A Scope Update — Post Verification Sweep 0" section), `FKAIOS_PHASE6_FOUNDER_DECISION_RECORD.md`, and the Founder Constitution principles (Truth Before Beauty, Evidence Over Claims, Preserve → Enhance → Extend, No Fake Intelligence).

**Approved scope this checklist executes against** (per the Decision Record): Phase 6A approved to begin; AI provider strategy = **Option C, hybrid multi-provider architecture**; Founder Brain Tick = planning only, no activation; Security Hardening (6C) approved but gated behind 6A/6B; no UI redesign, no new dashboards, no cosmetic changes.

**Verification coverage note:** Verification Sweep 0 reviewed 26 AI-relevant functions/components through the sweep process. Additional previously tracked components (the 8 named in the original Implementation Plan audit — `executive-intelligence`, `ai-engine`, `lead-discovery`, `evolution-engine`, `opportunity-engine`, `brain-engine`, `brain-chat`, `sales-engine`) brought total AI dependency review coverage to **34 components**. This document does not refer to "26 functions" without this context.

---

## 1. Exact Execution Steps

**Step 0:**
Verification Sweep 0 complete.

**Step 1:**
Design shared `callLLM()` abstraction specification.

Include:
- Provider routing strategy
- Failure detection
- Cost awareness
- Logging structure

No production integration.

---

**Step 2:**
Build and unit-test `callLLM()` abstraction.

Test simulated failures:
- Anthropic credit exhaustion
- Rate limit
- Timeout
- Malformed request

No production function connected.

---

**Step 3:**
Apply shared fallback defect fix.

Functions:
- `ai-engine`
- `founder-executive`

Reason: Both contain the same defect — a working fallback exists in code, but the catch logic prevents it from ever executing when Anthropic returns an error message beginning `"Anthropic API error..."`, which is the exact message shape produced by the current credit-exhaustion failure. One fix, applied identically to both.

---

**Step 4:**
Migrate `lead-discovery`.

---

**Step 5:**
Migrate `evolution-engine`.

---

**Step 6:**
Migrate `opportunity-engine`.

---

**Step 7:**
Migrate `auto-agents-engine`.

---

**Step 8:**
Monitor `executive-intelligence`.

Requirement: 3 consecutive automated successful cycles. Manual execution does not count. Runs on its own calendar timeline in parallel with Steps 3–7; cannot be shortened by finishing migration work early.

---

**Step 9:**
Begin secondary consolidation.

Migrate one function at a time:
- `brain-engine`
- `brain-chat`
- `sales-engine`
- `learning-engine`
- `business-engine`
- `builder-engine`
- `agent-engine`
- `orchestrator-engine`
- `orchestrator-brain`
- `training-engine`

---

**Step 10:**
Repair `orchestrator-engine` degraded provider tiers.

Verify:
- GLM provider health
- DeepSeek provider health
- Fallback sequence
- Failure injection test

---

**Step 11:**
Complete Phase 6A exit review.

Verify all success criteria before Phase 6B.

---

## 2. Files / Functions Affected

### Phase 6A Priority Migration Group (6 functions):

1. `ai-engine`
2. `founder-executive`
3. `lead-discovery`
4. `evolution-engine`
5. `opportunity-engine`
6. `auto-agents-engine`

Affected file paths: `supabase/functions/ai-engine/index.ts`, `supabase/functions/founder-executive/index.ts`, `supabase/functions/lead-discovery/index.ts`, `supabase/functions/evolution-engine/index.ts`, `supabase/functions/opportunity-engine/index.ts`, `supabase/functions/auto-agents-engine/index.ts`.

**New (at implementation time, not yet created):**
- One shared module, e.g. `supabase/functions/_shared/llm-router.ts`.

**Secondary consolidation group (Step 9–10):**
- `supabase/functions/brain-engine/index.ts`, `brain-chat/index.ts`, `sales-engine/index.ts`, `learning-engine/index.ts`, `business-engine/index.ts`, `builder-engine/index.ts`, `agent-engine/index.ts`, `orchestrator-engine/index.ts`, `orchestrator-brain/index.ts`, `training-engine/index.ts`.

**Explicitly not affected by this checklist:**
- `executive-intelligence` (already fixed, monitored only per Step 8).
- `whatsapp-webhook-v2` (live external webhook with real customer-facing side effects — its no-fallback issue needs separate, careful handling, out of scope here).
- The 8 remaining zero-fallback, non-priority functions (`closer-engine`, `mis-engine`, `market-intelligence`, `governance-engine`, `avatar-orchestrator`, `knowledge-engine`, `project-review-engine`, `heartbeat-engine`) — latent risk, not active incidents; revisit after the Priority Migration Group is proven stable.
- `founder-brain-tick`, `pr-engine`, `legal-engine` (Autonomous Capability Inventory — Phase 6B territory per the Decision Record, not 6A).
- Anything under Security Hardening (secrets, RLS, function permissions) — Phase 6C, gated behind this phase.

---

## 3. Implementation Order

Dependency-gated, one verified function at a time — no parallel migration of multiple Priority Migration Group functions:

| Step | Item | Gated on |
|---|---|---|
| 0 | Verification Sweep 0 | Complete |
| 1 | Shared abstraction design | Step 0 complete |
| 2 | Shared abstraction build + isolated unit test | Step 1 complete |
| 3 | `ai-engine` + `founder-executive` shared bug fix | Step 2 complete |
| 4 | `lead-discovery` | Step 3 verified |
| 5 | `evolution-engine` | Step 4 verified |
| 6 | `opportunity-engine` | Step 5 verified |
| 7 | `auto-agents-engine` | Step 6 verified |
| 8 | `executive-intelligence` 3-cycle monitoring | Runs independently from Step 3 onward, own schedule |
| 9 | Secondary group consolidation (10 functions, one at a time) | Steps 3–7 stable for a Founder-agreed observation period |
| 10 | `orchestrator-engine` degraded-tier repair | Occurs as part of Step 9 for that function specifically |
| 11 | Phase 6A exit-criteria review | Steps 3–9 complete, Step 8 confirmed |

---

## 4. Testing Requirements

For **every** function touched, Priority Migration Group or secondary group:

1. **Source-level review** — confirm the migration preserves the function's existing prompt structure and tool-calling shape exactly (e.g. `executive-intelligence`'s `emit_cycle` schema is the reference case); the abstraction routes, it does not rewrite prompts.
2. **Manual trigger matching the real caller** — replicate the exact `net.http_post` call for cron-triggered functions (same pattern used to verify the original executive-intelligence fix), or the real request shape for JWT-gated/webhook functions.
3. **Direct HTTP status verification** via `net._http_response` (cron-triggered) or the direct function response (others) — `cron.job_run_details.status = 'succeeded'` is never accepted alone as proof.
4. **No test is considered complete based on absence of errors alone** — a silent empty response is a failure under "No Fake Intelligence," not a pass.

**`orchestrator-engine` migration is incomplete until:**
- GLM provider availability is verified.
- DeepSeek provider availability is verified.
- Provider fallback order is tested.
- Failure injection confirms fallback execution.
- Real output is generated successfully.

---

## 5. Failure Injection Tests

Distinct from normal-path testing — each migrated function must be deliberately broken once, on purpose, to prove the fallback actually works rather than assuming it does:

1. Temporarily deprioritize the primary provider in the abstraction's config (test-time only, reverted immediately after) and confirm the next provider in line is actually invoked, not just configured.
2. Confirm the resulting output is a real, usable result from the fallback provider — not an error swallowed into an empty success response.
3. Specifically test the exact failure signature seen live in production ("Anthropic API error...credit balance too low") against the fixed `ai-engine`/`founder-executive` catch-block logic, since this is the precise defect that let both go undetected.
4. For the 10-function secondary group: this is the test that was never done before this audit — it is how `orchestrator-engine`'s degraded GLM tier and DeepSeek billing issue were found. Every consolidated function must pass this test individually; a working primary provider is not evidence the fallback tiers behind it also work.
5. Record each injection test's result (which provider failed, which one caught it, real output produced) in the same logging shape defined in the Implementation Plan's Section 2 (Hybrid AI Architecture Proposal).

---

## 6. Database Verification Requirements

For every migrated function, after each test trigger:

1. Confirm the expected row actually lands in the table the function claims to write — e.g. a new `executive_cycles` row, a new lead record in `leads`, a new capability-backlog entry — not just a 200 status code.
2. Confirm no unexpected duplicate or partial rows were written during failover (a retry that succeeds on the second provider should not also leave a half-written row from the first attempt).
3. If a new logging table/view is introduced for the shared abstraction's call records (an open design decision, not committed to here — see Implementation Plan, Database Impact), verify it is populated correctly for both success and failure paths before relying on it for Section 7's rollback triggers.
4. No existing table's data is altered by this checklist. `agent_performance_metrics`, `executive_cycles`, `fleet_memory`, and every other table read/written by the affected functions keep their current shape and existing rows untouched.

---

## 7. Rollback Strategy

- **Per-function, independent redeploys** — Supabase edge functions version independently (confirmed empirically: `executive-intelligence` moved v12 → v13 → v14 without touching any other function).
- **Save the exact pre-migration source before touching each function** — the same discipline used for the executive-intelligence fix, so a byte-identical redeploy is always available regardless of what platform version-history features are or aren't confirmed to exist.
- **Rollback trigger condition:** if a migrated function's real HTTP response shows a new failure mode not present before migration, stop, redeploy the saved prior version for that function, and do not proceed to the next step until resolved.
- **No rollback is needed today** — nothing has been deployed yet; this section is the discipline to follow once implementation begins.

---

## 8. Deployment Gates

- **Before Step 4 (first migration beyond the shared bug fix):** Step 3's fix must show a confirmed real fallback firing under Section 5's injection test, not just a clean deploy.
- **Before each subsequent Priority Migration Group function (Steps 5–7):** the previous function's migration must pass Sections 4–6 in full before the next one starts.
- **Before Step 9 (secondary consolidation group):** the full Priority Migration Group must be stable — no new failure modes — for a Founder-agreed observation period, since the 10 secondary functions are not currently broken and consolidating them carries its own regression risk for no urgent gain.
- **Before declaring Phase 6A complete (Step 11):** all six Success Criteria in `FKAIOS_PHASE6A_IMPLEMENTATION_PLAN.md` Section 5 must be independently confirmed, including Step 8's 3-consecutive-automated-cycles check, which cannot be rushed by finishing migration work early.
- **Before Phase 6B begins:** per the Founder Decision Record, no Founder Brain Tick planning work converts into activation, and no other Phase 6B item starts, until Phase 6A's exit criteria are met and reviewed.
- **Before Phase 6C begins:** Security Hardening remains gated behind 6A and 6B completion, per the Decision Record — nothing in this checklist changes that sequencing.

---

## 9. Founder Approval Checkpoints

1. **After Step 1–2** (abstraction designed and unit-tested, nothing live yet) — confirm the design matches the hybrid Option C direction approved in the Decision Record before any production function is touched.
2. **After Step 3** (shared fallback-defect fix deployed to `ai-engine` and `founder-executive`) — present the failure-injection test evidence before proceeding to the remaining Priority Migration Group functions.
3. **After Step 7** (full Priority Migration Group migrated) — present all 6 functions' verification results side by side before starting the secondary consolidation group.
4. **After Step 11** (Phase 6A exit criteria fully met) — formal checkpoint, in the same structure as `FKAIOS_PHASE6_APPROVAL_CHECKPOINT.md`, required before Phase 6B implementation planning begins. **This is Founder Approval Checkpoint 1.**

---

## 10. Confirmation

No code was changed.
No migration was created.
No deployment was performed.
No secrets were touched.
No cron jobs were activated.

This document is a planning artifact only and awaits Founder Approval Checkpoint 1 before implementation begins.
