# FKAIOS Phase 6 Roadmap — Intelligence Reliability First

**Date:** 2026-07-24
**Status:** Proposed. No implementation started. Ordering reflects the Founder Constitution's "no cosmetic work before core intelligence works" and "preserve → enhance → extend."

Phase 5C shipped the Founder Cockpit UI wired to real tables. This audit found that the UI is largely honest (see the Cockpit Truth Audit), but the *intelligence underneath it* has three concrete, verified gaps: an AI-provider outage silently breaking several agents, a fully-built cognitive loop that was never scheduled, and security exposure around the data these systems produce. Phase 6 fixes what already exists before anything new is built.

---

## Phase 6A — Intelligence Reliability

**Goal:** Make daily autonomous thinking reliable and observably correct — not "the cron says succeeded," but "the expected row landed with a real status code."

**Includes:**
- **Executive cron validation.** Today's fix (verify_jwt + CRON_SECRET on `executive-intelligence`, now v14, cycle 18 confirmed) needs to survive its first real unattended 02:00 UTC run before being called closed. Check `net._http_response` for that run specifically, not just `cron.job_run_details`.
- **AI provider stability.** The Anthropic credit exhaustion is live right now and is confirmed breaking `ai-engine`, `lead-discovery`, `evolution-engine`, `opportunity-engine` (per today's `net._http_response` bodies). Two independent decisions are needed here, not one: (a) resolve the Anthropic billing block itself, and/or (b) decide, function-by-function, which of these get the same OpenAI-migration treatment `executive-intelligence` already got. Doing (b) without (a) just repeats today's fix four more times; doing (a) alone leaves the codebase dependent on a single provider with no fallback for the next billing incident. `brain-engine`, `brain-chat`, `sales-engine` need the same provider-dependency check before being assumed fine — flagged as unverified in this pass, addressed by the parallel AI Provider Dependency Audit.
- **Error handling that distinguishes "queued" from "succeeded."** The core lesson from today's diagnosis: `cron.job_run_details.status = 'succeeded'` only means pg_net accepted the HTTP request, not that the function returned 2xx. Any cron-triggered intelligence function should be checkable the same way `executive-intelligence` now was — a lightweight convention (e.g. a shared "last real run" view over `net._http_response` keyed by function name) would make this a five-second check instead of a manual investigation next time.

**Exit criteria:** every daily/hourly intelligence cron has a confirmed 2xx from its own HTTP response, not just a "succeeded" pg_cron row, for at least 3 consecutive scheduled (not manual) runs.

---

## Phase 6B — Memory & Learning Activation

**Goal:** Turn on the cognitive loop that already exists in code but has never run autonomously.

**Includes:**
- **`founder-brain-tick` activation decision.** Per `FOUNDER_BRAIN_TICK_STATUS.md`: the code (Confidence, Reflection, Importance, Curiosity, Belief, Learning, and the `cognitiveTick()` orchestration) is fully implemented and reads/writes real tables. The only missing piece is the cron schedule — the migration for it exists in the repo, dated 2026-07-17, and was never applied. This is a real product decision (what interval? what LLM-cost budget?), not just a migration to run.
- **Reflection loop** and **curiosity loop** as first-class scheduled processes once 6A's provider-stability work confirms which LLM path they should use — activating them onto a still-flaky Anthropic dependency would just create a second silently-broken cron, so this explicitly follows 6A rather than running in parallel.
- Verification method: same discipline as the executive-intelligence fix — trigger once, read the real HTTP status, confirm the expected row lands (a `fleet_memory` row of `kind: 'reflection'`/`'belief'`/`'intuition'` etc.), *then* schedule it.

**Exit criteria:** `founder-brain-tick` (or its constituent parts) runs on a real schedule with at least one verified autonomous cycle producing a real `fleet_memory` write, confirmed by direct query, not by the cron's own status field.

---

## Phase 6C — Security Hardening

**Goal:** Protect the intelligence system's data and decision substrate before it's trusted to run with less supervision.

Full detail in `FKAIOS_SECURITY_HARDENING_PLAN.md`. Summary of what this phase closes:
- 30 SECURITY DEFINER functions (including the ones computing enterprise economics and revenue blockers) currently callable by anyone with the public anon key, no login required.
- The anon key itself is hardcoded in a public repo — safe only once the above is closed.
- 2 tables with RLS fully disabled.
- The shared `kjhgfdsa` secret still live across ~15 cron jobs.
- 9 SECURITY DEFINER views and 66 no-op ("always true") RLS policies, including on `company_bank_accounts` and `company_kyc_documents`.

This is placed *after* 6A/6B rather than first because the immediate live incidents (broken crons) are actively costing the Founder visibility today, whereas the security gaps, while serious, are not actively being exploited as far as this audit found. Placed *before* 6D because expanding the autonomous workforce onto a system with these RLS/RPC gaps would just multiply the exposure.

**Exit criteria:** all CRITICAL and HIGH items in the hardening plan closed; MEDIUM items at least scheduled.

---

## Phase 6D — Autonomous Workforce Expansion

**Goal:** Only after 6A–6C are done. Not started, not designed here.

Per the Founder Constitution's "no cosmetic work before core intelligence works" and this audit's own finding (from the earlier codebase-mapping pass) that ~70 of the ~90 deployed edge functions were never traced to any UI caller or confirmed cron trigger this session — expanding the workforce onto an intelligence layer that isn't yet proven reliable would compound the same problem this whole Phase 6 preparation exists to fix. This phase is a placeholder marking sequence, not a plan.

---

## Recommended order

**6A → 6B → 6C → 6D**, strictly sequential gates, not parallel tracks — each phase's exit criteria should be independently verified (query the database, read the real HTTP response) before starting the next, the same way this audit verified the executive-intelligence fix rather than trusting the cron's self-report.
