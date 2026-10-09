# FKAIOS gap-closure baseline — 9 Oct 2026, ~09:00 UTC

This is the starting point for the Master Execution Directive. Everything below was checked against live systems before any code change. Later progress is tracked in [the execution checkpoint](FKAIOS_EXECUTION_CHECKPOINT.md) and the [requirements register](FKAIOS_MASTER_REQUIREMENTS_REGISTER.md).

## Repository and deployment

| Item | Value | How checked |
|---|---|---|
| Branch / commit | `main` at `fcc70fa` (PR #77). Working branch `claude/new-session-8ojtzd`, reset to main, clean tree | `git log origin/main` |
| Uncommitted work to preserve | None in this checkout. The Windows checkout named in the directive is not reachable from this cloud session; any local edits there are unknown and must be committed by the founder | `git status` |
| Frontend | Vercel `fkaios-aura-blueprint1`, production `dpl_F2u9b752izxe5GRGM5v1LwZHvx8e` (commit fcc70fa), READY. `https://fkaios-aura-blueprint1.vercel.app/console` returned HTTP 200, title "FKAIOS Console" | Vercel API, fetch |
| Edge functions | Deployed only by CI (`deploy-supabase-functions.yml`) from `main`. builder-engine v52 at the time of the failure | gateway log `version: 52` |

## The live objective (preserved, not duplicated)

`20cbf892-0e6b-4689-9d1f-1a3a4030ce8f`. Submitted from the Console on 9 Oct 08:03 UTC: "Prepare a verified Kids DPS preschool franchise opportunity and 90-day action plan for India". The full text asks for a sourced research report in 7 sections.

- `fkaios_objective_state.phase = executing`, state_version 33.
- Plan (project `ef6fbcec`, `output_type = product`):
  - reuse discovery: done
  - **Build the requested product**: assigned; job `d644734c` in `retry`, error `Product builder failed: Invalid JWT`
  - Deploy the product: pending
  - Verify the live product: pending

## Root causes of the P0 blocker (two defects, not one)

1. **Wrong plan.** `classifyObjective` used substring matching. "Deliver one consolidated report…" matched "deliver", and "tools", "system" and "create … plan" matched as well, so the objective was classified `product_creation`. The planner then created a website build, deploy and verify chain. Fixing the JWT alone would have produced a website instead of the requested report.
2. **Invalid JWT.**
   - The gateway log for 08:04:02 UTC shows the caller (ai-engine's `executeProductBuild`) sending this project's modern `sb_secret_…` key. Only the prefix was inspected.
   - The gateway accepted it (`sb_api_key_compatibility: minted`, the function executed for 1156 ms).
   - builder-engine's own parser then rejected it: it splits the token on `.` and requires three parts.
   - The parser also trusted `role`/`sub` claims after decoding without verification.
   - builder-engine was also hard-wired to Anthropic `claude-sonnet-4-6`, which has no credit (`provider_health_state`). Its fallback was the unverified `gemini-2.5-flash`.

## Other verified findings at baseline

- **Cron secret exposure (P0.2, RED).** 17 active `cron.job` rows put the heartbeat secret in the URL query (`?secret=`). It therefore appears in gateway logs, e.g. the research-engine calls at 04:00 and 04:15 UTC. 1 job uses a header, 1 uses an Authorization header, and 8 are SQL-only. Rotation needs the founder (the Vault write was refused earlier).
- **Auth bypass pattern.** These functions accept a request when any `Authorization` header is present, which includes the public anon key: research-engine, lead-discovery, enrichment, lead-ingestion-engine, orchestrator-brain and linkedin-webhook. research-engine's `run` spends Apify credits.
- **Paid lead discovery.** lead-discovery calls research-engine with `?secret=` and no Authorization header. The gateway (verify_jwt on) answers 401. This is the "hunt_leads auth failure"; it is left stopped (paid, founder decision).
- **Apify token storage.** It uses XOR with `ENCRYPTION_SECRET`, falling back to a hard-coded default key. This is weak; a remediation is recorded in the register.
- **Execution is sequential by design.** objective-loop executes tasks as an evidence chain, one at a time, so acceptance test 7 (parallel tasks within one objective) is not supported by the current design. This is recorded as MISSING, not claimed.
- **Planner bug.** A product plan has 5 drafts but was truncated to 4, so "Close the objective with evidence" was never created.

## Acceptance tests at baseline

From [the acceptance matrix](FKAIOS_ACCEPTANCE_MATRIX.md), 9 Oct 04:05:
- **VERIFIED:** 2, 3 (generated books), 4 (stored artifact), 5, 8, 9, 11, 13, 15.
- **Partially verified:** 6, 7, 10 and 14.
- **Blocked:** 1 (an objective now exists, so this moves to in progress).
- **RED:** 12.

## Regression baseline

- `deno test` over `_shared/`: 151 passed, 1 failed. The failure is A7, which was failing before this work.
- Type-check: founder-brain-tick 41 and founder-objective 42.

## Needs the founder / external input

- **Heartbeat secret.** Rotate it, which is plan step 1 in `FKAIOS_P0_CRON_SECRET_PLAN.md`.
- **Approval de2aeafd.** Decide on the gemini-3.7-flash coding adoption.
- **Paid lead discovery.** Re-enable it, or deactivate its cron jobs.
- **Source documents.** Upload the Mr. Chick'n SOPs, the Healthfreek proposal and real books.
- **History exports.** Supply ChatGPT and Claude exports beyond the two TXT files.
- **Duplicate Vercel project.** Decide whether to retire `fkaios-aura-blueprint1-lmjz`.
- **Second model provider.** This is optional and paid; it is needed for independent *model* verification.
