# FKAIOS worker handoff protocol

FKAIOS is the persistent system. Claude, Gemini, OpenAI and other AIs are
workers. When a worker reaches a limit, it writes a handoff journal and the
next capable worker continues the same objective.

## Where the state lives (Supabase `nrlsqshkjuuwiovthrnb`)

| What | Table / function |
|---|---|
| Objectives, plans, tasks, evidence | `orchestrator_requests`, `orchestration_projects`, `orchestration_tasks`, `ai_jobs` |
| Knowledge (with provenance) | `fleet_memory` (`source_department = 'FKAIOS_BRAIN'` for ingested records) |
| Every AI / tool / repository / connector | `capability_registry` (credential **state** only) |
| One worker's stint on an objective | `worker_runs` (`steps`, `max_steps`) |
| Handoff journal | `worker_handoffs` |
| Ask the Brain about a topic | `select fkaios_brain_context('<topic>')` |
| Pick the next worker (capacity-aware) | `select * from fkaios_select_worker(array[<capabilities>], array[<excluded workers>], <your projected usage pct or null>, <estimated task cost pct or null>, '<your own capability_registry name>')` |
| Check a projected-usage band before taking more work | `select fkaios_capacity_band(<current_pct>, <estimated_task_pct>)` — bands GREEN/NORMAL/CAUTION/HIGH_RISK/CRITICAL at 60/75/85/95; get your own real current_pct from this session's own introspection (Claude Code Remote's `get_session`, `external_metadata.context_usage` and `rate_limit_info` — real, not simulated) where available |
| Count a step (controlled limit) | `select fkaios_worker_step('<run_id>', '<what was done>')` |
| Self-generate the next worker's continuation prompt | `select fkaios_generate_continuation_instruction('<handoff_id>')` — formats the handoff row itself into ready-to-send text; do not hand-author this |
| Add knowledge | `select fkaios_ingest_knowledge('[{kind,title,content,source,source_type,source_date,verification_state,...}]')` |

A trigger rejects any registry, run or journal row that contains a
credential-shaped value. Never put keys, tokens or passwords in any of them.

## Handing off (worker A)

1. When `fkaios_worker_step` returns `transfer_required: true` (controlled
   limit, `max_steps`), `fkaios_capacity_band` recommends `reassign_if_
   alternative_exists`, or the provider reports a real limit, stop starting
   new work.
2. Commit and push everything finished; note anything partial.
3. Insert one `worker_handoffs` row: objective, completed / partial / pending
   work, blockers, decisions, files, commits, deployments, database changes,
   tests, evidence, current state, exact next action, instructions —
   plus `task_id`/`milestone_id`/`acceptance_criteria`/`capacity_state`/
   `parent_handoff_id` where they apply.
4. Call `fkaios_generate_continuation_instruction('<handoff_id>')` — do not
   hand-author the next worker's prompt; this formats it FROM the row you
   just wrote.
5. Choose the next worker with `fkaios_select_worker` (excluding yourself),
   set `to_worker`, and mark your run `handed_off`.
6. If you are a Claude Code coding-worker session and the next worker is
   also one, you can genuinely start it yourself: the Claude Code Remote
   MCP tool's `create_session` (prompt = the generated continuation
   instruction, `model` = the selected worker's name) spawns a real,
   independent session — a live spawn was tested this build (session
   `session_01KxF1bi29eyBkLZuM1MPzDj`, created from a real handoff row's
   generated instruction, no human relay; see the acceptance matrix,
   requirement #24, for whether it actually completed its assigned work).
   For a `kind=ai_model` capability, no separate session is
   needed — an edge function can call `reason()` directly (see
   `_shared/fkaios-autonomous-controller.ts`). There is still no
   HTTP-invocable path to start a coding-worker session FROM an edge
   function (only from an interactive session that holds the Claude Code
   Remote tools) — real architectural boundary, not fixed by this change.

## Taking over (worker B)

1. Read the open `worker_handoffs` row for your objective.
2. Do not trust it blindly. Check the real state: `git log` / `git status`,
   the tables and functions it names, deployed edge function versions,
   and run the relevant tests.
3. Write what you verified (and any correction) to `verification_notes`,
   set `status = 'verified'`, open your own `worker_runs` row, and link it as
   `to_run_id`.
4. Continue from the stated next action. Do not redo completed work.
5. Record your steps with `fkaios_worker_step`; hand off again the same way
   if you reach your own limit.

## Human-only boundaries

Payments or new paid providers, missing credentials, destructive production
actions, legal/licensing calls and genuinely ambiguous business decisions go
to Rajeev. Everything else continues.
