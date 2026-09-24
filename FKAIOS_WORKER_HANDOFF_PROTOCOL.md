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
| Pick the next worker | `select * from fkaios_select_worker(array[<capabilities>], array[<excluded workers>])` |
| Count a step (controlled limit) | `select fkaios_worker_step('<run_id>', '<what was done>')` |
| Add knowledge | `select fkaios_ingest_knowledge('[{kind,title,content,source,source_type,source_date,verification_state,...}]')` |

A trigger rejects any registry, run or journal row that contains a
credential-shaped value. Never put keys, tokens or passwords in any of them.

## Handing off (worker A)

1. When `fkaios_worker_step` returns `transfer_required: true` (controlled
   limit, `max_steps`), or the provider reports a real limit, stop starting
   new work.
2. Commit and push everything finished; note anything partial.
3. Insert one `worker_handoffs` row: objective, completed / partial / pending
   work, blockers, decisions, files, commits, deployments, database changes,
   tests, evidence, current state, exact next action, instructions.
4. Choose the next worker with `fkaios_select_worker` (excluding yourself),
   start it, set `to_worker`, and mark your run `handed_off`.

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
