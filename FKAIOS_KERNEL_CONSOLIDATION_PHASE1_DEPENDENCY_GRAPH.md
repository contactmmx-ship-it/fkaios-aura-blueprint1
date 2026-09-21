# FKAIOS Kernel Consolidation — Phase 1: Dependency / Call Graph

Companion to `FKAIOS_ARCHITECTURE_INVENTORY_2026-09-21.md`. That document
inventoried the five competing systems; this one answers, with file:line
evidence, the twelve questions needed to establish ONE canonical lifecycle,
per the agreed target model:

```
orchestrator_requests  = OBJECTIVE
orchestration_projects = PROJECT
orchestration_tasks    = TASK
ai_jobs                = EXECUTION QUEUE
ai_agents               = AI WORKERS
company-os              = ACTION/CAPABILITY LAYER
verification            = BUSINESS OUTCOME PROOF
approvals               = HUMAN GOVERNANCE GATE
memory/events           = PERSISTENT HISTORY
```

## The central fact this graph establishes

**Two structurally different paths write into `ai_jobs` today, and only one
of them is currently live.**

### Path A — the "founder objective" chain (code-complete, NOT live)

```
founder-brain.ts: cognitiveTick() → createTask()
    (_shared/founder-brain.ts:1499 → :1054)
  → INSERT orchestrator_requests                              [OBJECTIVE]
        (_shared/founder-brain.ts:1054, table orchestrator_requests)

founder-brain-tick/index.ts:79
  → planObjective(objective)  (_shared/executive-planner.ts:55)
    → INSERT orchestration_projects   (executive-planner.ts:77)  [PROJECT]
    → INSERT orchestration_tasks      (executive-planner.ts:92)  [TASK]

work-engine.ts: allocateProjectWork() (work-engine.ts:133)
  → allocateTask() (work-engine.ts:96)
    → selectBestEmployee()  (work-engine.ts:101, real worker-selection logic)
    → INSERT ai_jobs {type:"work_engine_task", payload:{task_id}}
        (work-engine.ts:104-113)                                [EXECUTION QUEUE]
```

**This chain is real, coherent, and already respects the target model
almost exactly as specified** — including its own documented anti-
duplication discipline (`work-engine.ts:161-179`: `reassignStuckWork()`
was deliberately trimmed to NOT duplicate `reap_orphaned_ai_jobs()`'s
staleness detection, only adding what that reaper doesn't do — picking a
better-fit employee on failure).

**It is dormant in production**: `founder-brain-tick` — the only entry
point that calls `planObjective()` — has **no active cron job** (confirmed:
`select * from cron.job` lists 24 active jobs; `founder-brain-tick` is not
among them, and its own scheduling migration
`20260717000000_schedule_founder_brain_tick_cron.sql` is explicitly marked
"NOT APPLIED"). `orchestrator-brain/index.ts:62` independently inserts its
own `orchestrator_requests` rows (from live user chat requests) but never
calls `planObjective()` — that objective type never becomes a project/task
at all today, it's answered or filed to `approvals` directly.

### Path B — direct-to-`ai_jobs` triggers (live, and the dominant real path)

Five `SECURITY DEFINER` trigger functions on `public.leads`
(confirmed live via `pg_trigger`/`pg_proc`, **none tracked in any repo
migration** — pure schema drift):

| Trigger | Fires on | Job type created |
|---|---|---|
| `trg_auto_qualify_new_lead` | `AFTER INSERT` | `QUALIFY_LEAD` |
| `trg_auto_followup_stage_change` | `AFTER UPDATE` | `FOLLOWUP` |
| `trg_auto_schedule_meeting` | `AFTER UPDATE` | `SCHEDULE_MEETING` |
| `trg_auto_generate_proposal` | `AFTER UPDATE` | `GENERATE_PROPOSAL` |
| `trg_auto_invoice_onboarding` | `AFTER UPDATE` | `GENERATE_INVOICE` |

Each is a plain `INSERT INTO ai_jobs (...) SELECT ... FROM ai_agents WHERE
task = '<TYPE>' AND is_active = true LIMIT 1` with **no existence check of
any kind** — no check for an already-pending/running job for the same lead,
no check for an already-satisfied business outcome. The four `UPDATE`
triggers have no `WHEN` clause restricting which column changed, so **any**
update to a `leads` row (a score recalculation, a note edit, an unrelated
field change) re-fires all four and can enqueue duplicate jobs for a lead
that already has one in flight or already has a real proposal/meeting/
invoice on file. `ai-engine`'s own idempotency checks (`existingProject`/
`existingMeeting`/`source_job_id` lookups) currently absorb the damage at
the *business-artifact* level, but duplicate `ai_jobs` rows themselves are
not prevented — a real, measurable cost (wasted LLM calls, DB churn, noise)
and the same root cause independently confirmed as the
`proposal-engine-hourly` / `sales-draft-proposals-hourly` cron duplicate
found and fixed today (identical hourly `net.http_post` to the same URL;
`sales-draft-proposals-hourly`, cron jobid 35, disabled — see below).

**This is the path that actually produces the bulk of live traffic**
(13,633 failed + 4,886 completed + ~1,700 in retry/pending as of this
writing), entirely bypassing the objective/project/task layer — a lead
update *is* the "task", self-evidently, with no founder-level planning
needed for a single well-understood CRM action.

## Answers to the twelve questions

1. **Which system creates objectives?** `founder-brain.ts:createTask()`
   (from `cognitiveTick()`) and, independently, `orchestrator-brain/index.ts:62`
   (from live chat requests). Both write `orchestrator_requests`. Neither is
   aware of the other.
2. **Which system creates projects?** `executive-planner.ts:planObjective()`
   (`orchestration_projects`, line 77) — reachable only from
   `founder-brain-tick`, which is not on any cron. `orchestrator-engine`
   *also* writes `orchestration_projects` from its own independent
   `start` action (a CEO→specialist→QA→CPO content pipeline, unrelated to
   `orchestrator_requests` objectives) — a second, structurally different
   writer of the same table.
3. **Which system creates tasks?** `executive-planner.ts:planObjective()`
   (`orchestration_tasks`, line 92), plus `orchestrator-engine`'s own
   `advance` action for its separate content pipeline.
4. **Which system creates `ai_jobs`?** (a) `work-engine.ts:allocateTask()`
   for the founder-objective chain (dormant); (b) the five `leads` triggers
   above (live, dominant); (c) `agent-scheduler` routing due
   `agent_schedules` rows into `ai_jobs` inserts (live, per its 2026-07-08
   fix); (d) `auto-pilot` queuing follow-up/approval/marketing jobs directly
   (live, deterministic, no LLM).
5. **Which scheduler consumes `ai_jobs`?** `job-scheduler-drain` (cron,
   */10 min, active) → `job-scheduler` → forwards pending + eligible-retry
   jobs to `ai-engine`. The direct `ai-engine-run-jobs-5min` cron is
   **inactive** — `job-scheduler` is the sole live consumer path today.
6. **Which engine actually executes the job?** `ai-engine`'s `runJobs()` →
   `executeJob()` (generic LLM path) or the two dedicated handlers,
   `handleGenerateProposal()`/`handleScheduleMeeting()`, which delegate to
   `proposal-engine`/`meeting-scheduler` rather than guessing JSON.
7. **Which system handles retries?** `ai-engine` classifies
   `NonRetryableJobError` vs. plain `Error` and sets `retry`/`failed`
   (`MAX_RETRY_ATTEMPTS = 3`); `job-scheduler`'s `claimEligibleRetryJobs()`
   promotes `retry` → `pending` on an exponential backoff once eligible.
8. **Which system handles reassignment?** `work-engine.ts:reassignStuckWork()`
   — but only for `type = 'work_engine_task'` rows, i.e. only Path A. Path B
   (the live traffic) has no reassignment mechanism; a `GENERATE_PROPOSAL`
   job that exhausts its retries just stays `failed`, and it stays
   assigned to whatever `ai_agents` row the trigger's `LIMIT 1` picked.
9. **Which system handles completion?** `ai-engine`'s `runJobs()` sets
   `status='completed'` and calls `recordOutcome()` (writes `ai_outcomes`).
10. **Which system verifies outcomes?** Verification is **inlined** into
    the two capability handlers themselves (`handleGenerateProposal`/
    `handleScheduleMeeting` independently re-query `client_projects`/
    `meetings` after calling the capability function, never trusting the
    HTTP response body) — there is no separate, general-purpose
    verification engine. The generic `executeJob()` path has no
    verification step beyond JSON-shape validation; it trusts the LLM's own
    claim of task completion for any job type without a dedicated
    persistence writer.
11. **Which system handles approvals?** The `approvals` table, written by
    `orchestrator-brain` (high-risk classifications), `invoice-engine`
    (draft/approve/reject), and `executive-intelligence` (capital-allocation
    proposals); read by `ApprovalsPage` (real, DB-backed, but **not mounted
    into any routed page** — see the architecture inventory) and
    `finance-engine`.
12. **Which system wakes/resumes unfinished work?**
    `reap_orphaned_ai_jobs()` (plain SQL function, cron
    `ai-jobs-orphan-reaper`, */10 min, active, **not tracked in any repo
    migration**) requeues any `ai_jobs` row stuck in `running` past 15
    minutes (→ `pending`, `retry_count+1`) or fails it outright past
    `retry_count >= 2`. This is generic across all job types (Path A and B
    alike). `escalateBlocked()` (`executive-planner.ts:140`) is the
    equivalent for stuck *projects/tasks*, but it's only reachable from the
    same dormant `founder-brain-tick` entry point as Path A.

## Fix already made during this investigation (not a design decision — a bug)

`proposal-engine-hourly` (cron jobid 36) and `sales-draft-proposals-hourly`
(jobid 35) fired an **identical** `net.http_post` to the same
`proposal-engine` URL at the same minute every hour, differing only in
timeout. Confirmed by comparing `cron.job.command` for both. Disabled
jobid 35 (`cron.alter_job(job_id:=35, active:=false)`) — reversible, and
`proposal-engine`'s own hourly coverage is unchanged since jobid 36 remains
active on the same schedule.

## 8. Genuine external blocker: `founder-brain-tick` was never deployed at all

Attempting the real end-to-end canonical-queue test (a single, monitored,
non-recurring invocation — explicitly NOT enabling the dormant cron, per
the function's own "founder-approval-gated" comment) surfaced a bigger gap
than "unscheduled": `founder-brain-tick` **does not exist in the live
Supabase project at all**. Invoking it returned HTTP 404 from `net._http_response`,
and it is absent from the full `list_edge_functions` output (90 other
functions listed, this one is not among them — confirmed, not a paging
artifact). It exists only as source in this repo; it has never been
deployed.

**What deploying it would require**: `founder-brain-tick/index.ts` imports
`_shared/founder-brain.ts` (1,562 lines — the cognitive kernel itself),
which is imported by `_shared/executive-planner.ts` (1,190 lines) and
`_shared/work-engine.ts` (287 lines), both of which also import
`_shared/company-os.ts` (218 lines, the real capability-dispatch layer
with WhatsApp/LinkedIn/etc. actions behind a `verified: true/false`
allowlist). All four `_shared` files import only `npm:@supabase/supabase-js`
beyond each other — no dependency on `_shared/llm-router.ts` (consistent
with Section on router usage in the companion inventory: founder-brain.ts
has its own separate, hardcoded 3-provider fallback chain). This is a
knowable, bounded deploy — the blocker is not technical.

**Why this is a genuine stop, not a technical gap I should quietly work
around**: a first-ever deploy-and-invoke of this chain is not a small
fix. `cognitiveTick()` makes 10+ real, currently-uncapped LLM calls per
invocation (no cost limit found anywhere in `founder-brain.ts`); a
successful tick creates a real `orchestrator_requests` objective, can
create real `orchestration_projects`/`orchestration_tasks`, allocates a
real `ai_jobs` row via `work-engine.ts`, and (on a *future* invocation,
once completed `work_engine_task` jobs exist for `returnCompletedWork()`
to find) can dispatch a real business action through `company-os.ts`
(WhatsApp, LinkedIn, etc.). `founder-brain-tick/index.ts`'s own header
comment states this outright: *"enabling a new recurring LLM-calling cron
job is a founder-approval-gated action, not something to silently
activate."* That sentence describes exactly the action a "real end-to-end
autonomous job through the canonical queue" would require here — not
scheduling, but the very first live activation of an entirely dormant
cognitive engine, for real, on production data. This is the "required
Founder decision" carve-out in this session's own operating rules, not a
place to substitute my own judgment for the codebase's explicit gate.

**What I did instead, so this isn't a dead end**: confirmed the exact,
bounded set of files a deploy would need (above), confirmed the specific
risk profile (uncapped spend, real writes, a currently-empty
`work_engine_task` backlog meaning the *first* invocation specifically
carries no risk of an unexpected `company-os` dispatch, since
`returnCompletedWork()` would have nothing completed to act on yet), and
left the function undeployed. **What's needed to unblock this**: explicit
authorization (from the Founder, or whoever owns that decision for this
project) to either (a) deploy + invoke once, manually, with results
reported before anything is scheduled, or (b) go straight to enabling the
existing-but-unapplied cron migration. Until then, task #16 (a real,
live, end-to-end objective→project→task→job→execution→verification→
completion run) cannot be honestly claimed as done — Path B (the `leads`
triggers) already provides that evidence for the *simple-task* case (see
the GENERATE_PROPOSAL/SCHEDULE_MEETING live verification in this
session's commits `75f4492`/`2091df3`), but not for a founder-level,
multi-step *objective*.

## What Phase 1 concludes

The target canonical lifecycle already exists in code as Path A and is
**architecturally sound** — it just has no live entry point. The
consolidation decision is therefore not "which of five systems wins" so
much as:

- **Keep Path B (`leads` triggers → `ai_jobs`) as the legitimate fast path**
  for simple, well-understood, single-step CRM automations. Forcing every
  lead-stage change through a founder-level objective/project/task
  decomposition would be premature abstraction for work that is already
  fully specified by the trigger firing — the trigger's `UPDATE` *is* the
  task. Phase 3 fixes its real defect (duplicate job creation), not its
  existence.
- **Path A is the correct canonical path for genuinely multi-step,
  founder-level objectives** (the ones the new 57-section directive is
  actually asking a "kernel" to handle) — software builds, campaigns,
  cross-department initiatives. Activating it means answering, before
  flipping `founder-brain-tick` onto a live cron: what stops it from
  flooding `ai_jobs` with `work_engine_task` rows the same way the `leads`
  triggers do, and what escalation/approval gate exists before a founder-
  level objective starts spending real LLM budget. That safety work is
  Phase 1/2's remaining scope (task #14), not yet done.
