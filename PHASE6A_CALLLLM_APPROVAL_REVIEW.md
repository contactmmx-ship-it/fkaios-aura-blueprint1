# Phase 6A `callLLM()` Approval Review

**Date:** 2026-07-24
**Status:** Planning/governance document only. No code changed, no migration created, nothing deployed, no secrets touched, no cron activated while producing this document.
**Approval Status:** Founder Approval Received — Step 2 Authorized.
**Reviewed documents:** `FKAIOS_PHASE6A_EXECUTION_CHECKLIST.md`, `FKAIOS_PHASE6A_CALLLLM_SPECIFICATION.md`.

---

## 1. Summary of Approved Architecture Decisions

The following are treated as decided, per the two reviewed documents and the Founder Decision Record they build on:

- **Provider strategy is Option C — hybrid multi-provider architecture** (already approved in `FKAIOS_PHASE6_FOUNDER_DECISION_RECORD.md`). This review does not revisit that choice; it addresses the specific parameters needed to implement it.
- **`callLLM()` routes only — it does not change prompts, tool schemas, or business logic.** Migrating a function means replacing its duplicated provider-calling code with a call to the shared module, nothing else.
- **Seven failure categories are defined and their handling agreed:** credit exhaustion, rate limit, timeout, invalid request, provider outage, authentication failure, and empty/invalid AI response — each with a specific classification and whether it triggers failover.
- **Logging must capture, per call:** function name, agent/caller identity, requested provider, attempted providers, failure reason per attempt, successful provider, latency, token/cost data, and a semantic final result status — never just a raw HTTP code.
- **The five isolated tests are agreed** (Anthropic credit failure, rate limit, timeout, malformed request, successful fallback) and must run against the standalone module before any production function is connected.
- **Execution order is fixed:** shared bug fix (`ai-engine` + `founder-executive`) first, then `lead-discovery` → `evolution-engine` → `opportunity-engine` → `auto-agents-engine` one at a time, then the 10-function secondary consolidation group, each gated on the previous step's verified success — no parallel production migrations.

The five parameters left open after the above are now resolved in Section 2 below.

---

## 2. Founder Decision Freeze — Approved

### 1. Provider Routing Strategy

**APPROVED: Option C — Per-function-class intelligent routing.**

Rules: routing decisions may consider:
- AI employee role
- Workload type
- Latency requirement
- Intelligence requirement
- Cost sensitivity

Examples:
- **Founder Intelligence:** Quality first.
- **Business Decision Agents:** Reliability first.
- **Background AI Employees:** Cost efficiency first.
- **Customer-facing Agents:** Balanced quality and latency.

`callLLM()` only routes requests. It never changes prompts, business logic, or tool schemas.

---

### 2. Cost Threshold Governance

**APPROVED: Option C — Tiered cost control.**

**Warning layer:** approximately 80% budget utilization.
Actions:
- Log warning
- Update provider health information
- Make visible for governance review

**Protection layer:** 100% configured limit.
Actions:
- Mark provider temporarily unavailable
- Trigger fallback
- Never silently fail

---

### 3. Retry Policy

**APPROVED: Option C — Function-class based retry limits.**

- **Background agents:** Higher retry tolerance.
- **Interactive agents:** Lower retry tolerance.

Reason: background intelligence values completion probability. Interactive intelligence values response speed.

---

### 4. Logging Storage

**APPROVED: Option A — Extend existing `agent_performance_metrics` structure.**

Rules for Phase 6A:
- No new database table.
- No migration.
- Reuse existing performance tracking.

A dedicated `llm_call_log` table may be reconsidered during Phase 6C Security Hardening review.

---

### 5. Provider Health Scoring

**APPROVED: Hybrid explainable health scoring.**

Score inputs:
- **Reliability:** successful calls, failure frequency, fallback frequency
- **Performance:** latency, timeout frequency
- **Economics:** token cost, cost per successful completion

Rules:
- Health score assists routing.
- Health score never hides failures.
- All provider failures remain auditable.

---

## 3. Recommendations Considered (Historical Record)

The tables below reflect the options presented before the freeze in Section 2, retained here as the audit trail of what was considered and why — consistent with Evidence Over Claims. They no longer represent open decisions; Section 2 supersedes them.

### Provider Priority Order

| Option | Pros | Cons |
|---|---|---|
| A. Keep Anthropic-first (today's de facto default in most functions) | Least disruptive; matches quality behavior already validated in production over time | Anthropic is the provider currently exhausted — keeping it primary doesn't reduce the exact dependency risk Option C exists to fix |
| B. OpenAI-first | Proven stable in production right now (`executive-intelligence`); immediately removes reliance on the currently-broken provider | Unproven at scale across the other 15 functions' specific prompt/tool-calling styles |
| **C. Per-function-class ordering** *(approved)* | Matches real, already-observed usage differences (cron-scheduled vs. interactive JWT-gated functions) | More configuration surface; requires classifying functions into groups |

### Cost Threshold Policy

| Option | Pros | Cons |
|---|---|---|
| A. Hard stop at ceiling | Guarantees spend never exceeds the ceiling; simple | Could force failover onto a lower-quality provider at a critical moment purely on cost accounting |
| B. Soft warning only | Never blocks a business-critical call | Doesn't actually cap spend |
| **C. Tiered (80% warning, 100% hard stop)** *(approved)* | Balances both concerns, gives an early warning window | Most complex to implement/tune |

### Retry Limits

| Option | Pros | Cons |
|---|---|---|
| A. Fixed low cap everywhere | Tightly bounds worst-case latency | 3 of 5 configured fallback tiers become unreachable for the deepest chains |
| B. Fixed higher cap everywhere | Uses the full depth of chains already built | Worst-case latency can stack for time-sensitive interactive calls |
| **C. Per-function-class cap** *(approved)* | Matches the real usage split already visible from Verification Sweep 0 | Added configuration surface |

### Logging Storage Approach

| Option | Pros | Cons |
|---|---|---|
| **A. Extend `agent_performance_metrics`** *(approved)* | Reuses infrastructure already read by `getTokenEconomyReport()`; no new table, no new RLS surface to design from scratch this phase | Inherits whatever RLS posture that table turns out to have — flagged for Phase 6C review |
| B. New dedicated table | Clean, purpose-built schema; RLS designed correctly from day one | Requires a migration — out of scope under the current phase rules |
| C. Structured log lines only | Zero schema footprint | Much harder to query/aggregate into a provider-health view |

### Provider Health Scoring Method

| Option | Pros | Cons |
|---|---|---|
| A. Rolling success-rate per provider, reusing `getProviderPerformance()`'s pattern | A proven pattern already exists in this codebase | Reactive only |
| B. Active health probe | Could catch an outage before a real call hits it | Costs real money on every probe; adds its own scheduling/cron surface |
| **C. Hybrid (reliability + performance + economics, explainable, never hiding failures)** *(approved — expanded scope beyond the original three options)* | Ships something real immediately, reuses proven patterns, keeps every failure auditable | Still primarily reactive; predictive probing not included in this phase |

---

## 4. Confirmation

No code was changed.
No migration was created.
No deployment was performed.
No secrets were touched.
No cron jobs were activated.

This document is planning/governance only.

---

## 5. Founder Authorization

Approved. Phase 6A `callLLM()` architecture decisions are frozen as documented.

**Proceed to Step 2:** Build and isolated testing of the `callLLM()` abstraction only.

**No production AI function migration is authorized** until Step 2 verification and the next Founder checkpoint.
