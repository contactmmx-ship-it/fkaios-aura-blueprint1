# FKAIOS Architecture Inventory — 2026-09-21

Forensic, read-only inventory of the orchestration/kernel layer, the
knowledge/memory systems, and the AI-workforce/frontend reality, taken as
the mandatory first step before any "operating system transformation" work.
Every claim below is grounded in a specific file/line or a live query result
at the time of writing — nothing here is aspirational.

This document does not itself change any code. It exists so that KEEP /
REFACTOR / MERGE / DEPRECATE decisions about the engines below are made
deliberately, with evidence, rather than by guessing or by silently
duplicating something that already exists.

## 1. Orchestration / kernel layer

There are at least **four independent, non-communicating "work item"
schemas**, each with its own status vocabulary:

1. **`ai_jobs`** (pending/running/completed/failed/retry) — the closest
   thing to a canonical queue. Drained by `ai-engine`'s `runJobs()` via cron.
   No `CREATE TABLE ai_jobs` exists in any migration — it predates migration
   tracking.
2. **`orchestration_projects` / `orchestration_tasks`** (own status vocab:
   working/reviewing/reworking/merging/complete/failed) — used by
   `orchestrator-engine` (a separate CEO→specialist→QA→CPO content/website
   generator) and reused by `executive-planner.ts`/`work-engine.ts` for
   business objectives. No migration defines either table — pure schema
   drift.
3. **`orchestrator_requests`** (processing/completed/failed/awaiting_approval)
   — built for `orchestrator-brain`, reused by `founder-brain.ts`'s
   `createTask()` as its "objective" table.
4. **`fleet_memory`** — `founder-brain.ts`'s own append-only memory/decision/
   belief/learning store, a fifth parallel data model.

Plus `agent_dispatch_log` + `agent_schedules` (own status vocab:
dispatched/running/completed/failed) as a fifth, separate execution-tracking
system for the cron-driven `agent-scheduler`/`orchestrator` dispatch path.

None of these read or write each other's status columns directly — they
cross-reference only via ad hoc string tags (e.g.
`orchestration_projects.request` gets a `[objective:<id>]` prefix).

**Genuine dispatchers/schedulers** (converge on `ai_jobs` as the real drain
queue): `agent-scheduler`, `orchestrator` (batch-run/process-event),
`auto-pilot`.

**Competing self-contained lifecycle systems** (own status vocab, not
`ai_jobs`): `orchestrator-engine`, `orchestrator-brain` + `founder-brain.ts`'s
`createTask`, `governance-engine`, `executive-intelligence`, `workday-engine`.

**Dormant/unwired kernel**: `founder-brain-tick` and its whole
`planObjective → work-engine → ai_jobs` chain, plus all four
`founder-*-cell` functions — architecturally real but **not on any active
cron** (the migration that would schedule `founder-brain-tick` is explicitly
marked "NOT APPLIED"). Currently non-operational in production.

**"Software factory" (factory-intake/factory-planner)**: does not exist as
edge functions. The two migrations that narrate it
(`20260714000000_software_factory_phase2_planner.sql`,
`20260714001000_factory_execution_queue.sql`) are **100% comment text, zero
executable SQL**. The real, functioning equivalent is `builder-engine`
against `build_projects` — smaller and different from what the migration
comments describe.

Only 3 of ~90 functions actually import the shared `_shared/llm-router.ts`
(`ai-engine`, `market-intelligence`, and one comment-only reference in
`executive-intelligence`). Every other orchestration-layer function hardcodes
its own Anthropic/Gemini model string and fallback logic — `claude-sonnet-4-6`
appears hardcoded independently in at least 6 files.

No table named `agent_objectives`, `factory_execution_queue`, `decision_log`,
`opportunity_backlog`, or `revenue_action_campaigns` exists anywhere in this
repo.

## 2. Knowledge / memory systems

Five knowledge-adjacent functions exist; only two are alive:

- `knowledge-engine` — real, ILIKE keyword search over
  `brain_knowledge_documents`, no embeddings.
- `knowledge-search` — **dead code**: calls OpenAI ada-002 then RPCs
  (`semantic_search_knowledge`, `log_knowledge_search`) that don't exist
  live. Confirmed dead by the file's own sync note.
- `knowledge` — alive, ILIKE/tag search over `knowledge_articles` (fed by
  the web-crawler).
- `document-ingest` — **dead code**: chunks + embeds via OpenAI ada-002 but
  writes to tables (`knowledge_sources`/`knowledge_chunks`/
  `knowledge_embeddings`) that don't exist live.
- `document-engine` — real, but just Storage signed-URL CRUD, no
  knowledge/embedding logic.

**A real RAG pipeline does exist**: `vault-engine` embeds queries with
Supabase Edge AI's on-device `gte-small` model (384-dim) and calls
`match_knowledge_chunks` (real pgvector cosine similarity over
`brain_knowledge_chunks.embedding`). This is genuinely wired into an LLM
prompt in `brain-chat` (embed → vector search → similarity filter →
citation-instructed system prompt → Claude) and also used directly by
`orchestrator-brain`.

Memory has **no schema-level FACT/DECISION/PROCEDURAL/EPISODIC separation**.
Everything is dumped into `fleet_memory` / `agent_memory`, distinguished only
by a free-text `memory_type` column (`rate_limit`, `usage`, `decision`,
`market_signal`, `cycle_assessment`, `lesson`, `goal`, `insight`,
`imagination`, `learning`, `belief`, ...). `execution_log` is the de facto
episodic log, untagged.

No import mechanism for external brand/company knowledge (e.g. "Bharat
Paints", "GoMax") was found — those names appear only as hardcoded examples
in LLM system prompts, not as ingested data.

## 3. AI workforce data model

- `ai_agents` has no `CREATE TABLE` in any migration (pre-existing,
  hand-created in production; 41 rows). It does have real
  capability-shaped columns (`tools` jsonb, `permissions`, `autonomy_level`)
  added via `ALTER TABLE`, but `ai_agents.tools` is read in exactly one place
  codebase-wide (a dashboard, display-only) and never used at execution
  time — the schema was designed for real tool-use, but tool-use isn't
  wired in.
- Real **worker-selection logic exists in exactly one place**:
  `_shared/work-engine.ts`'s `selectBestEmployee()` (filters by department,
  excludes inactive/error/offline, picks lowest active-job-count then
  highest success-rate). Everywhere else, agent assignment is still
  hardcoded (e.g. `auto-agents-engine` hardcodes `agent_id:
  'lead-qualifier'`).
- `agent_schedules` (cron/interval/event_trigger) is the real recurring
  dispatch mechanism, feeding `ai_jobs` via `agent-scheduler`.
- Departments are seeded in-repo (9 rows: EXECUTIVE, SALES, MARKETING,
  HR_TRAINING, ACCOUNTS, RND, SOFTWARE_FACTORY, OPERATIONS, SUPPORT) but
  production has 22 — repo/prod drift, not otherwise investigated here.

## 4. Frontend reality

Routed Next.js pages (`src/app`) are sparse: `/` and `/cockpit-preview`
(both render `FounderCockpit`), `/franchise` (public lead capture), and
`/products` (public catalog). **No routes exist** for `/dashboard`,
`/agents`, `/objectives`, `/missions`, `/tasks`, `/approvals`, or
`/governance`.

A much larger internal-tool component set exists under
`src/components/fkaios/` and `src/components/fkaio/AppShell.tsx` — but
`AppShell.tsx` is **never imported anywhere** (zero references). Its
components (`Dashboard`, `WorkforcePanel`, `ApprovalsPage`, `OrchestratorAI`,
`GovernanceDashboard`, `DecisionCenter`, `KnowledgeVault`, ...) are real,
DB-backed (not mocked — verified no hardcoded data arrays in any of the five
checked), but **unreachable from the live site**. `ApprovalsPage` genuinely
queries the `approvals` table and would work if mounted; it just isn't.

## 5. Immediate operational finding (acted on same day)

While investigating why two live autonomy-test jobs were not being
processed by the scheduler, found and fixed a real starvation bug: a
dormant backlog of 1,690+ `retry`-status jobs (dated July–August, from
before today's retry-draining fix existed) permanently outranked any new
job in `ai-engine`'s `ORDER BY created_at ASC` fetch, since resurrected
retries keep their original `created_at`. Fixed in
`supabase/functions/ai-engine/index.ts` (`fetchJobBatch`, commit
`75f4492`) by reserving batch slots for `retry_count = 0` jobs. Verified
live: both previously-stuck test jobs were processed on the next tick.

## 6. What this inventory does NOT do

It does not decide KEEP/REFACTOR/MERGE/DEPRECATE for any of the five
competing orchestration systems, does not touch cron, does not migrate any
data, and does not consolidate anything. Doing so — especially deprecating
or merging any of `orchestrator-engine` / `orchestrator-brain` /
`governance-engine` / `executive-intelligence` / `workday-engine` —
requires a human decision about acceptable business risk, since all five
run against live, revenue-relevant cron schedules today.

## 7. Correction (2026-09-21, later same day) — Section 3 was wrong about two functions

Section 3 above ("factory-intake / factory-planner NEITHER EXISTS as an
edge function", "executive-brain — Does NOT exist as an edge function")
was based on a repo-only search and is **incorrect**. Confirmed live via
`list_edge_functions`/`get_edge_function` against the Supabase project
directly:

- **`factory-intake`** (slug `factory-intake`, ACTIVE, v10) is real and
  deployed — a Founder-sentence-to-build-plan intake with a genuine
  reuse-vs-rebuild "hallucination guard" (normalizes and checks claimed
  reused components against a real `component_library` table, reclassifies
  unmatched claims as new rather than trusting the LLM), stamps every
  project `PLAN ONLY`, and never sets a price (files an `approvals` row
  instead). No matching cron job — invoked on demand (presumably from a
  Founder-facing UI action), not scheduled.
- **`executive-brain`** (slug `executive-brain`, ACTIVE, v9) is real,
  deployed, **and runs daily in production** — confirmed by
  `cron.job.command` for `executive-brain-daily` (jobid 38, schedule
  `30 4 * * *`, active) targeting this exact function's URL. It is a
  genuinely designed adversarial multi-executive reasoner: six LLM
  personas (CFO/CRO/CTO/COO/CMO/CPO) each argue ONLY from a narrow mandate
  against shared telemetry, are explicitly forbidden from producing
  consensus, and must name which other executive they conflict with —
  writing to `executive_recommendations` (previous batch marked
  `superseded` each run) rather than averaging into a single verdict.
- **`factory-planner`** (slug `factory-planner`, ACTIVE, v9) was not read
  in this correction pass; its existence as a deployed function is
  confirmed, its behavior is not yet verified.

None of these three are present anywhere in this git repository — this is
the same repo/deploy drift pattern documented throughout this inventory,
just larger than Section 3 originally reported. The root cause of the
original error: the subagent that produced Section 3 searched local
repository files only and never cross-checked the live deployment list.
This correction was found by that same cross-check, done here because a
separate investigation (see
`FKAIOS_KERNEL_CONSOLIDATION_PHASE1_DEPENDENCY_GRAPH.md`, Section 8) needed
to invoke `founder-brain-tick` and used `list_edge_functions` to diagnose
why it 404'd — surfacing this in passing. **Any future inventory work
should verify function existence against `list_edge_functions` directly,
never against repo file presence alone.**
