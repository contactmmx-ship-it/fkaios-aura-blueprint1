# FKAIOS Phase 0–3 Execution Control Document

**Date:** 2026-07-28
**Status:** Draft — for founder review before Phase 0 work begins.
**Nature of this document:** This is FKAIOS's Living Engineering Constitution, not the 21-volume vision bible. It documents what is real today, what the next four phases build, and the evidence required before each phase is declared done. It updates as capabilities become real — it does not get written ahead of them.

**Enforcement rule (binding on this document itself):**
No entry below may be marked **Implemented** without the same bar `FKAIOS_CAPABILITY_REALITY_REPORT.md` already established: *"A YES requires a verified, persisted, real-world outcome — not a job marked completed, not a UI screen, not a schema table."* No PR that adds a real capability merges without updating the matching entry in this document. If this rule is ever silently skipped, treat that as a regression on par with a fabricated `ai_jobs.status`.

---

## 1. Reality Baseline (as of 2026-07-28, from live code + DB audit)

| Volume | Component | Status | Evidence | Missing | Next Action |
|---|---|---|---|---|---|
| 1 | Founder Identity | Implemented (mechanism) | `founder_identity` (1 row), read by `founder-brain.ts` | Not in git — content lives only in prod DB | Phase 0, Task 1 |
| 1 | Founder Principles | Implemented, load-bearing | 13 rows, injected into every `ai-engine` LLM call via `getFounderPrinciplesBlock()` | Not in git | Phase 0, Task 1 |
| 1 | Engineering Constitution | Implemented (mechanism) | 15 rows, referenced by `governance-engine`, `v_constitution_violations` | Not in git | Phase 0, Task 1 |
| 2 | Cognitive Loop (`cognitiveTick()`) | Implemented, code-complete, never run | `founder-brain.ts` full observe→...→review chain | Activating cron migration (`20260717000000_...`) never applied | Phase 0, hold — do not activate until Phase 1 closes one loop honestly (see §6) |
| 9 | Decision Engine | Partial, confidence not real | `decision-engine/index.ts` — capture only; `overall_score` is a self-graded LLM weighted sum | Alternatives, simulation, calibrated confidence, review, outcome tracking | Phase 2 |
| 13 | Governance / Autonomy | Weak enforcement | Real forced-verdict pattern in `governance-engine`; real code-enforced gate in `customer-assistant` only | No `AutonomyLevel` code enum; every other write path unguarded | Phase 0, Task 3 |
| 11 | AI Workforce | 41 seeded, 4 active | `20260713009000_workforce_truth.sql`: "37 have NEVER completed a single task" | Real tool-calling for the general path | Phase 0 Task 2 (truth), Phase 1 (build) |
| 12 | Execution / Hands | Critical gap | 2 of ~46 job types have real persistence (`QUALIFY_LEAD`, `GENERATE_INVOICE`) | Everything else | Phase 1 |
| 4 | Memory | Partial | `fleet_memory`, `execution_log` real; `ai_evolution` doesn't exist | Typed memory, learning-to-behavior loop | Phase 2–3 |

Volumes not listed here (World Model, Imagination, Wisdom, Strategy Engine) have no code trace and are **out of scope until Phase 3 gates open** — see §5.

---

## 2. Phase 0 — Reality Alignment
**Duration:** 2 weeks. **Goal:** make the system truthful before it is extended.

### Task 1 — Database truth migration
Move `founder_identity`, `founder_principles`, `engineering_constitution` content out of the live-only production database and into version-controlled migrations.

- **Acceptance criterion:** an empty Supabase project + `supabase migration up` reproduces the same founder brain foundation (identity row, all 13 principles, all 15 constitution laws) with no manual DB edits.
- **Evidence required:** a diff showing the new migration file(s), plus a test run against a scratch project confirming row-for-row match with prod.

### Task 2 — Kill the fake workforce illusion
Replace any UI/dashboard claim of "41 AI employees" with an honest split.

- **Acceptance criterion:** `governance-dashboard` (or wherever employee count is surfaced) queries real activity (e.g. `ai_agents` joined against `ai_outcomes`/`ai_jobs` completions in the last 30 days) and renders **Active** vs **Dormant**, not a static roster count.
- **Evidence required:** screenshot or query output showing the split matches the current live numbers (expect ~4 active, ~37 dormant, subject to change as Phase 1 lands).

### Task 3 — Autonomy enforcement (enum + gate retrofit)
Two parts — the enum alone is not sufficient; the gate must be threaded through every real write path.

```ts
enum AutonomyLevel {
  OBSERVE = 0,
  RECOMMEND = 1,
  EXECUTE = 2,
  BUSINESS_ACTION = 3,
  FOUNDER_APPROVAL = 4,
}
```

- Define once, in a shared module (`_shared/autonomy.ts`), imported everywhere — not re-implemented per function. (The codebase already has a documented cautionary example of *not* doing this: `_shared/founder-brain.ts`'s separately-written LLM fallback duplicating the shared router, flagged in `FKAIOS_CHECKPOINT_PHASE0.1_EXECUTION_TRUTH_FIXED.md` as "two independently-maintained failover implementations is worse than one everywhere.")
- Build one `checkAutonomy(agentId, action)` gate function, and call it from **every** real write path currently found to write real data: `finance-engine`, `research-engine`, `ai-engine`'s `writeLeadQualificationBack()` and `writeInvoicePersistence()`, `customer-assistant` (replace its bespoke `checkEscalation()` with the shared gate, or confirm it's a deliberate stricter special case).
- **Acceptance criterion:** grep confirms every function performing a real DB write outside `ai_jobs.result` calls `checkAutonomy()` before writing. `orchestrator-brain`'s `requires_approval` field is no longer the sole gate — it becomes an input to the shared check, not the check itself.
- **Evidence required:** list of every real write path found in the AI-workforce audit, each with a confirmed `checkAutonomy()` call site (file:line).

**Phase 0 exit gate:** all three tasks pass their acceptance criteria. Do not start Phase 1 with Phase 0 partially done — this is the same "no rushed, undocumented implementation" discipline already demonstrated in the Phase 0.1 checkpoint.

---

## 3. Phase 1 — Build the Hands
**Duration:** 60 days. **Rule:** five employees, built and closed **one at a time**, not in parallel — even though Finance is already furthest along. Closing Sales completely before starting Finance preserves the evidence discipline the team already used once (Phase 0.1's deliberate refusal to bundle changes).

For each employee: workflow, real writes required, and the same evidence bar as `ai_jobs.status = completed` — a real row in a real table, not an LLM opinion.

### Employee 1 — Sales Agent (build and close first)
`Lead discovered → Research → Qualification → CRM record → Conversation → Meeting → Proposal → Follow-up → Conversion`
- Extends already-real `QUALIFY_LEAD` persistence; wires the already-built-but-unused `meeting-scheduler` into the live job pipeline; builds real `GENERATE_PROPOSAL` persistence (currently in the Phase 0.1 honest-failure state).
- **Metrics (real, queried, not self-reported):** leads contacted, meetings created, proposals sent, revenue generated.
- **Acceptance criterion:** one lead traverses the full chain with a real row created at every arrow above, verified via the same "insert a real job, let the real unmodified cron process it" method used in the GENERATE_INVOICE checkpoint.

### Employee 2 — Finance Agent (already strongest — expand, don't rebuild)
`Invoice created → Sent → Payment tracked → Reminder → Collection status → Accounting update`
- Builds on real `GENERATE_INVOICE` persistence (v52) and real WhatsApp send (`finance-engine`).
- **Acceptance criterion:** a payment status changes in a real table from a real external signal (not manually set).

### Employee 3 — Research Agent
`Market changes → Research → Knowledge update → Founder briefing`
- Wires the already-real `market-intelligence` function onto a schedule (the prepared-but-not-applied migration from `FKAIOS_BODY_COMPLETION_ROADMAP.md` — still requires founder approval to activate).
- **Acceptance criterion:** a scheduled run produces a real `market_intelligence`/`competitor_intelligence` row with `source_url` and `confidence`, on a cadence, without manual invocation.

### Employee 4 — Customer Success Agent
`Customer issue → Resolution → Feedback → Learning memory`
- Requires an actual inbound channel carrying traffic — currently WhatsApp is dormant (0 real messages, ever, either direction). This employee cannot be meaningfully closed until that external configuration gap (Meta Business Platform registration) is resolved — flagged as a blocker outside this codebase's control.

### Employee 5 — Founder Executive Assistant
`Morning: what changed / what matters / what requires decision. Evening: what happened / what worked / what failed.`
- This is the first legitimate consumer of the dormant cognitive loop (`cognitiveTick()`) — but only after the Phase 2 fix to its hardcoded `success: true` outcome bug (see §4). Do not wire this employee to the cognitive loop before that fix lands, or it inherits a fabricated learning signal on day one.

**Phase 1 exit gate:** at minimum Employees 1–3 closed with real evidence. Employees 4–5 may remain blocked/gated per the notes above without blocking Phase 2.

---

## 4. Phase 2 — Decision Intelligence
**Starts only after Phase 1 produces real outcomes to reason from.**

Build one table, not a new engine:

```
decision_id
context
problem
available_options
chosen_action
expected_result
actual_result
review_date
learning
```

- Wire `decision-engine` to write into this table instead of (or alongside) `brain_decisions`.
- Stop treating the current `overall_score` as a calibrated confidence figure — either remove it from any founder-facing UI or relabel it honestly as "model self-assessment, not calibrated."
- **Fix required before this phase can claim any learning capability:** `founder-brain.ts`'s review phase (`cognitiveTick()`) currently calls `recordOutcome({success: true, value: 1})` unconditionally, regardless of actual outcome. This must be corrected to record the real `actual_result` vs `expected_result` comparison before any "learning loop" claim is made about it.
- **Acceptance criterion:** at least one decision has a real `actual_result` recorded after its `review_date`, with a diff-able comparison against `expected_result` — not a hardcoded success flag.

---

## 5. Phase 3 — Expand the Organism
**Gated, not scheduled.** Do not start any of the below until Phase 2 has produced a non-trivial number of real decision-outcome pairs (a specific count, e.g. 50+, should be set once Phase 1's real throughput is known — not guessed now).

Only after that evidence exists: deeper world model, wisdom engine, future-simulation engine, strategy engine, higher autonomy levels. These correspond to Volumes 5–10 of the original vision document — they remain the destination, not the next task.

---

## 6. What this document is not

- **Not the 21-volume FKAIOS Architecture Bible.** That document describes the destination organism and is not cancelled — it evolves alongside real capability, one volume updated as its matching component becomes real, per §1's table format. Writing Volumes 2–10 in full (Brain, Senses, World Model, Imagination, Wisdom, Strategy) ahead of Phase 3 evidence would reproduce the documentation-mistaken-for-engineering pattern this document exists to avoid.
- **Not a calendar commitment for Phase 3.** Phases 0–2 have durations because they're scoped, evidence-bounded work. Phase 3 has no duration because it starts when evidence says it's ready, not when a calendar says so.
- **Not a license to activate the cognitive loop early.** `cognitiveTick()` stays off until Phase 2's outcome-recording fix lands — turning it on sooner would let it start "learning" from a fabricated signal.
