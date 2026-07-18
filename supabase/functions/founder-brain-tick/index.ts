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
// NOT WIRED TO A CRON SCHEDULE YET. See the accompanying migration
// (20260717000000_schedule_founder_brain_tick_cron.sql) — written but NOT
// applied. No deploy credentials in this sandbox; enabling a new recurring
// LLM-calling cron job is a founder-approval-gated action, not something to
// silently activate.
// ============================================================================

import { cognitiveTick } from "../_shared/founder-brain.ts";
import { planObjective, escalateBlocked, reflect, buildIntuition } from "../_shared/executive-planner.ts";
import { allocateProjectWork, reassignStuckWork, returnCompletedWork } from "../_shared/work-engine.ts";
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
    const result = await cognitiveTick("founder");

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

    // SPRINT 6: check for blocked work every cycle, not just when the brain
    // happens to assign something new this tick.
    let escalated = 0;
    try {
      escalated = (await escalateBlocked(result.correlationId)).escalated;
    } catch (err) {
      console.error("founder-brain-tick: escalateBlocked failed", err instanceof Error ? err.message : String(err));
    }

    // SPRINT 9: Work Engine housekeeping — runs every cycle regardless of
    // whether anything new was assigned this tick, same as escalation.
    let reassigned = 0;
    let returned = 0;
    let dispatched = 0;
    try {
      reassigned = (await reassignStuckWork()).reassigned;
    } catch (err) {
      console.error("founder-brain-tick: reassignStuckWork failed", err instanceof Error ? err.message : String(err));
    }
    try {
      // SPRINT 11: returnCompletedWork() now also reports how many
      // completions triggered a real Company OS business-action dispatch.
      const workReturn = await returnCompletedWork();
      returned = workReturn.returned;
      dispatched = workReturn.dispatched;
    } catch (err) {
      console.error("founder-brain-tick: returnCompletedWork failed", err instanceof Error ? err.message : String(err));
    }

    // SPRINT 13: company-wide Reflection every cycle — a single reason()
    // call, cheap enough for the hot loop (unlike Curiosity's paid Apify
    // dispatches, deliberately kept on a separate slower schedule).
    let reflection: { version: number; recommendedChange: string } | null = null;
    try {
      const r = await reflect("founder", result.correlationId);
      if (r) reflection = { version: r.version, recommendedChange: r.recommendedChange };
    } catch (err) {
      console.error("founder-brain-tick: reflect failed", err instanceof Error ? err.message : String(err));
    }

    // SPRINT 14: Business Intuition — pure statistical aggregation over
    // agent_performance_metrics, no LLM call, no cost concern for the hot loop.
    let intuitionPatterns = 0;
    try {
      intuitionPatterns = (await buildIntuition("founder")).length;
    } catch (err) {
      console.error("founder-brain-tick: buildIntuition failed", err instanceof Error ? err.message : String(err));
    }

    return new Response(JSON.stringify({ ...result, planned, allocated, escalated, reassigned, returned, dispatched, reflection, intuitionPatterns }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("founder-brain-tick error:", msg);
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
