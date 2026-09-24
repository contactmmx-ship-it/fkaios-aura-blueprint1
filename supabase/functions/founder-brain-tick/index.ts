// ============================================================================
// founder-brain-tick — SPRINT 2b (M1-S2b), extended SPRINT 6 (M1-S6)
// ============================================================================
// NOT a second brain. Supabase can only schedule (cron) an HTTP endpoint —
// it cannot invoke a function inside a _shared/ library file directly. This
// is the minimum wrapper required for `cognitiveTick()` (defined once, in
// ../_shared/founder-brain.ts) to be reachable on a schedule instead of only
// on a user request, per the founder's instruction: "The Founder Brain must
// remain continuously active, not only when a request is received."
//
// All thinking/prioritizing/goal-tracking/task-creation logic lives in
// _shared/founder-brain.ts. All objective→project→task breakdown and
// blocked-work escalation logic lives in _shared/executive-planner.ts. This
// file wires them together — it is the "Founder Brain should no longer stop
// after generating insights" integration point: cognitiveTick() creates an
// objective (Assign phase), then this file hands that objective straight to
// the Executive Planner instead of leaving it as an unplanned row.
//
// WIRED TO A CRON SCHEDULE (V1 Autonomous Completion mandate, 2026-09-22):
// the accompanying migration (20260717000000_schedule_founder_brain_tick_cron.sql)
// was written months earlier but never applied — the objective-continuation
// loop below had therefore never run on a schedule, only on manual
// invocation. Applied as `fkaios-founder-brain-tick` (every 15 minutes,
// cron.job jobid 39) after confirming ai_jobs is not starved (job-scheduler-
// drain already invokes ai-engine's run_jobs every 10 minutes as a side
// effect of its own processing, independent of the separately-disabled
// ai-engine-run-jobs-5min cron) and after a real, verified manual
// invocation completed a full cycle with no errors.
// ============================================================================

import { cognitiveTick, getGoals, seedGoalHierarchy } from "../_shared/founder-brain.ts";
import { planObjective, escalateBlocked } from "../_shared/executive-planner.ts";
import { allocateProjectWork, returnCompletedWork } from "../_shared/work-engine.ts";
import { autoAllocateReadyTasks, autoDispatchAiModelWork } from "../_shared/fkaios-autonomous-controller.ts";
import { runObjectiveLoop } from "../_shared/objective-loop.ts";
import { COGNITIVE_CYCLE_ACTION, cognitiveIntervalMinutes, shouldRunCognitiveCycle } from "../_shared/cognitive-budget.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    // "founder" is the single-founder placeholder used consistently with
    // founder_memory.created_by elsewhere in this codebase (no multi-user
    // concept exists yet in FKAIOS's data model).
    // EVOLUTION AUDIT FINDING (2026-07-18): seedGoalHierarchy() has existed
    // since Sprint 3 but was NEVER called anywhere in the codebase —
    // grep-confirmed only its own definition referenced it. This means
    // getGoals() has been returning [] every single cycle since Sprint 3,
    // meaning evaluateAgainstGoals(), simulateStrategies()'s scoring, and
    // Brain State's Executive Attention fallback have all been operating
    // against an EMPTY goal hierarchy this entire time — the foundation
    // "every decision must be evaluated against these goals" has silently
    // never been active. Fixed here with an idempotent guard: seed only if
    // getGoals() is currently empty, so this runs exactly once (ever), not
    // on every 15-minute tick forever — founder_memory is append-only, so
    // an unguarded call would create a new set of goal rows every cycle.
    try {
      const existingGoals = await getGoals("founder");
      if (existingGoals.length === 0) {
        await seedGoalHierarchy("founder");
        console.log(JSON.stringify({ level: "INFO", message: "Goal hierarchy was empty — seeded for the first time this session", source: "founder-brain-tick" }));
      }
    } catch (err) {
      console.error("founder-brain-tick: goal hierarchy check/seed failed (non-blocking)", err instanceof Error ? err.message : String(err));
    }

    // OBJECTIVE CONTINUATION LOOP RUNS FIRST (reliability fix, V1 mandate
    // Task #20): cognitiveTick() below makes up to 7 sequential LLM calls
    // and real Anthropic latency varies a lot in practice — observed
    // 5-30+ seconds PER call, meaning a single cognitiveTick can legitimately
    // take anywhere from ~40s to ~2 minutes. Supabase Edge Functions have a
    // wall-clock execution ceiling; when this loop ran LAST (after
    // cognitiveTick, after planning cognitiveTick's own new idea, after the
    // escalate/return parallel block), a slow cognitiveTick cycle could
    // starve it of any remaining time — a real, observed failure mode: a
    // test objective went unprocessed for multiple consecutive ticks while
    // cognitiveTick's own idea-generation consumed the whole budget. An
    // EXISTING committed objective continuing toward completion is more
    // important than the Brain generating a brand-new idea this cycle, so
    // it now runs first and gets first claim on the function's execution
    // time. runObjectiveLoop() already calls returnCompletedWork() itself
    // at its own end, so this reordering doesn't lose that step — it's
    // just no longer gated behind cognitiveTick finishing.
    let objectiveLoop: unknown[] = [];
    try {
      objectiveLoop = await runObjectiveLoop();
    } catch (err) {
      console.error("founder-brain-tick: objective loop failed", err instanceof Error ? err.message : String(err));
    }

    // LLM BUDGET (2026-09-24): cognitiveTick() costs 6-10 LLM calls per run
    // and exhausted the free Gemini daily quota by itself, starving founder
    // objectives. It now runs at most once per COGNITIVE_CYCLE_INTERVAL_MINUTES
    // (default 60); the objective loop above still runs on every tick.
    // Its own execution_log row is the record of when it last ran.
    const serviceClient = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
    const { data: lastCycle } = await serviceClient.from("execution_log").select("created_at")
      .eq("function_name", "founder-brain-tick").eq("action", COGNITIVE_CYCLE_ACTION)
      .order("created_at", { ascending: false }).limit(1).maybeSingle();
    const cognitiveGate = shouldRunCognitiveCycle(
      lastCycle?.created_at ?? null,
      new Date(),
      cognitiveIntervalMinutes(Deno.env.get("COGNITIVE_CYCLE_INTERVAL_MINUTES")),
    );
    const result = cognitiveGate.run
      ? await cognitiveTick("founder")
      : { cognitiveSkipped: cognitiveGate.reason, assigned: null as { taskId: string } | null, correlationId: crypto.randomUUID().slice(0, 8) };

    // SPRINT 6: if this cycle assigned an objective, plan it immediately —
    // best-effort, never lets a planning failure break the tick's response.
    let planned: { projectId: string | null; tasksCreated: number } | null = null;
    // SPRINT 9: and once planned, the Work Engine allocates each task to
    // the best-fit AI employee — the brain no longer just plans, it hands
    // off to a real worker in the same cycle.
    let allocated = 0;
    if (result.assigned?.taskId) {
      try {
        const client = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
        const { data: objective } = await client.from("orchestrator_requests").select("id, raw_request, department_code, status").eq("id", result.assigned.taskId).single();
        if (objective) {
          const plan = await planObjective(objective, result.correlationId);
          planned = { projectId: plan.projectId, tasksCreated: plan.tasksCreated };
          if (plan.projectId) {
            const work = await allocateProjectWork(plan.projectId);
            allocated = work.allocated;
          }
        }
      } catch (err) {
        console.error("founder-brain-tick: planObjective/allocateProjectWork failed", err instanceof Error ? err.message : String(err));
      }
    }

    // PARALLEL EXECUTION (permanent constitution rule 8): escalateBlocked,
    // returnCompletedWork, autoAllocateReadyTasks, and autoDispatchAiModelWork
    // read/write DIFFERENT data and none of their outputs feed each other's
    // inputs within this same tick.
    // ECOSYSTEM STEP (2026-07-18): buildIntuition(), reflect(), and now
    // reassignStuckWork() have all been extracted to their own independent
    // cells (founder-confidence-cell, founder-reflection-cell,
    // founder-reassignment-cell) — none run as part of this pipeline
    // anymore. Three of four batch members extracted so far.
    // AUTONOMOUS CONTROLLER (acceptance matrix requirement #49): a task
    // newly unblocked by fkaios_complete_task's dependency check, or a task
    // whose allocated capability is an ai_model, previously sat untouched
    // until a human or Claude session manually ran the next SQL call. These
    // two calls close that gap for the ai_model capability class — see
    // _shared/fkaios-autonomous-controller.ts for the exact, honestly
    // stated scope (kind='coding_worker' work still needs a human/session).
    // A newly-allocated task picked up by autoAllocateReadyTasks() this
    // tick is dispatched by autoDispatchAiModelWork() on the NEXT tick
    // (15 min later), not this same one — kept independent/parallel rather
    // than sequenced, consistent with this block's existing design.
    const parallelStartedAt = Date.now();
    const [escalateResult, returnResult, autoAllocateResult, autoDispatchResult] = await Promise.allSettled([
      escalateBlocked(result.correlationId),
      returnCompletedWork(),
      autoAllocateReadyTasks(),
      autoDispatchAiModelWork(),
    ]);
    const parallelWallClockMs = Date.now() - parallelStartedAt;
    const parallelResults = [escalateResult, returnResult, autoAllocateResult, autoDispatchResult];
    const parallelExecutionSummary = {
      tasksExecuted: parallelResults.length,
      tasksSucceeded: parallelResults.filter((r) => r.status === "fulfilled").length,
      tasksFailed: parallelResults.filter((r) => r.status === "rejected").length,
      wallClockMs: parallelWallClockMs,
    };

    // SPRINT 6: check for blocked work every cycle, not just when the brain
    // happens to assign something new this tick.
    let escalated = 0;
    if (escalateResult.status === "fulfilled") escalated = escalateResult.value.escalated;
    else console.error("founder-brain-tick: escalateBlocked failed", escalateResult.reason instanceof Error ? escalateResult.reason.message : String(escalateResult.reason));

    let returned = 0;
    let dispatched = 0;
    // SPRINT 11: returnCompletedWork() also reports how many completions
    // triggered a real Company OS business-action dispatch.
    if (returnResult.status === "fulfilled") { returned = returnResult.value.returned; dispatched = returnResult.value.dispatched; }
    else console.error("founder-brain-tick: returnCompletedWork failed", returnResult.reason instanceof Error ? returnResult.reason.message : String(returnResult.reason));

    // AUTONOMOUS CONTROLLER (requirement #49) — see
    // _shared/fkaios-autonomous-controller.ts for exact scope (ai_model
    // capability class only).
    let autoAllocated = { attempted: 0, allocated: 0, noCandidate: 0, errors: 0 };
    if (autoAllocateResult.status === "fulfilled") autoAllocated = autoAllocateResult.value;
    else console.error("founder-brain-tick: autoAllocateReadyTasks failed", autoAllocateResult.reason instanceof Error ? autoAllocateResult.reason.message : String(autoAllocateResult.reason));

    let autoDispatched = { attempted: 0, completed: 0, verificationFailed: 0, errors: 0 };
    if (autoDispatchResult.status === "fulfilled") autoDispatched = autoDispatchResult.value;
    else console.error("founder-brain-tick: autoDispatchAiModelWork failed", autoDispatchResult.reason instanceof Error ? autoDispatchResult.reason.message : String(autoDispatchResult.reason));

    return new Response(JSON.stringify({ ...result, planned, allocated, escalated, returned, dispatched, autoAllocated, autoDispatched, objectiveLoop, parallelExecutionSummary }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("founder-brain-tick error:", msg);
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
