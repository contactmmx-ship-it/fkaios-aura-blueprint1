# FKAIOS agent catalog

This catalog maps the mission's 20 specialist roles to what actually runs in production. Evidence comes from `ai_agents`, `agent_dispatch_log` and `ai_jobs` (7-day window to 9 Oct 2026), the code in `supabase/functions`, and the self-test and evidence tables.

## What exists today

- **`ai_agents` holds 41 rows, all `active`, across 11 departments.**
  - 35 of them show exactly 21 dispatches in 7 days, i.e. 3 per day from `agent-scheduler`.
  - Most of those dispatches are `scheduled_cron` rows that queue an `ai_jobs` row.
  - In the last 3 days, ai_jobs finished 264 completed and 96 failed. No dispatch in the window recorded LLM tokens.
  - So these are **scheduled routines, not objective-driven specialists**. Their `total_tasks_completed` counters measure routine runs, not verified outcomes.
- **Lead Qualifier AI:** 336 runs this week, all reporting "none found — nothing to qualify".
- **Lead Hunter AI:** `hunt_leads` failed 14 times (research-engine call is missing its auth header).
- **Sales Executive AI, Accounts Manager AI, Invoice AI, Meeting Scheduler AI and Proposal AI:** no dispatches in 7 days.
- **The working specialist capabilities are code paths under the Founder Agent:**
  - founder-objective (intake, voice, communications, knowledge);
  - founder-brain-tick (planner, objective loop, evaluation, self-tests, discovery);
  - the routed engines (executive-brain, opportunity-engine, evolution-engine).

## Role mapping

| # | Mission role | Implemented by | Status | Evidence / gap |
|---|---|---|---|---|
| 1 | Chief of Staff | Founder Brain tick + objective planner (`founder-brain-tick`, `objective-loop.ts`) | PARTIALLY VERIFIED | Engine paths are self-tested; no founder objective has run end to end (0 rows in `fkaios_objective_state`) |
| 2 | Research Analyst | `research-engine` | PARTIALLY VERIFIED | Deployed by CI; the auto-agent caller lacks the auth header (14 failures) |
| 3 | Project Historian | `searchKnowledge` + `history_retrieval` | PARTIALLY VERIFIED | Histories are bundled; production self-test in progress |
| 4 | Knowledge Librarian | `knowledge-library.ts` (ingest PDF/text, page labels, OCR, dedup) | PARTIALLY VERIFIED | 11 unit tests pass; production `knowledge_pages` self-test in progress |
| 5 | Software Architect | Planner (no dedicated agent) | NOT IMPLEMENTED as a separate role | — |
| 6 | Repository/Open-Source Scout | `ecosystem-discovery.ts` | **VERIFIED** (discovery) | Scheduled run 716b1eb9, 180 candidates. Candidate *testing* exists only for models (golden eval) |
| 7 | Integration Engineer | Resource registry + adapters (`llm-router`, `speech`, `communications`) | PARTIALLY VERIFIED | Only Gemini works; others are blocked by credit or not configured |
| 8 | Software Engineer | `builder-engine` (websites) | PARTIALLY VERIFIED | 11 deployed builds; 9 stuck `generating` |
| 9 | QA/Test Engineer | `self-test.ts` (11 scenarios), golden suite `fkaios_core` v1 | **VERIFIED** for engine scenarios | — |
| 10 | Independent Verifier | `objective-verifier.ts` | PARTIALLY VERIFIED | It rejects wrong deliverables, but it is the same model as the producer (`producers_unknown`), so it is not independent |
| 11 | Security Engineer | Manual (this session) | NOT IMPLEMENTED as an agent | P0 cron secret is open |
| 12 | UI/UX Quality | — | NOT IMPLEMENTED | — |
| 13 | Business/Operations Analyst | `executive-brain` (CFO/CRO/CTO/COO/CMO/CPO board) | PARTIALLY VERIFIED | Routed via structured reasoning; scheduled run due 04:30 UTC, verification pending |
| 14 | Document/Presentation | `brain_projects` iterative brief (critic loop) | PARTIALLY VERIFIED | Text deliverables only |
| 15 | Data Analyst | SQL `compute_*` RPCs | PARTIALLY VERIFIED | Deterministic metrics |
| 16 | Voice/Multimodal | `speech.ts`, `voice.ts`, OCR | **VERIFIED** | voice_turn passed twice; speech resources verified by WER |
| 17 | Automation/Scheduling | pg_cron (26 jobs) + tick | PARTIALLY VERIFIED | The secret is in URLs (P0) |
| 18 | Cost/Resource Optimizer | `resource-selection.ts`, governed adoption | **VERIFIED** | Failover self-test; golden benchmark; approval de2aeafd |
| 19 | Learning/Improvement | evaluation + adoption + rollback (`capability-evaluation.ts`) | PARTIALLY VERIFIED | The ≥5-outcome learning minimum has no real objective outcomes yet |
| 20 | Project Delivery Manager | Objective state machine | PARTIALLY VERIFIED | Same as role 1 |

## Decision

No new agent rows are added. The 41 scheduled routines stay as they are; they are not presented as verified specialists. Roles are capabilities invoked by the Founder Agent per objective, following the smallest-team rule.
