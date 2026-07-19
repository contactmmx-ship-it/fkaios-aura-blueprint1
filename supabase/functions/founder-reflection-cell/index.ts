// ============================================================================
// founder-reflection-cell — second independent cognitive cell
// ============================================================================
// Same pattern as founder-confidence-cell (2b9df86), same reasoning:
// reflect() reads execution_log/agent_performance_metrics/orchestration_tasks
// and writes founder_memory (kind:'reflection') — it calls no other
// cognitive function, and within founder-brain-tick's old pipeline its
// return value was only used for the response JSON's own `reflection`
// field, never consumed as an input to another decision within the same
// request. getBrainState() already reads reflection via getReflectionHistory()
// (a shared-state read) rather than calling reflect() itself (the RPC) — so
// that half of the architecture was already correct before this extraction;
// only the pipeline coupling needed removing.
//
// NOT wired to a cron yet — same posture as founder-confidence-cell and
// founder-curiosity-tick. Architecture real, schedule is the founder's call.
// ============================================================================

import { reflect } from "../_shared/executive-planner.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const result = await reflect("founder");
    return new Response(JSON.stringify({ cell: "reflection", reflection: result }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("founder-reflection-cell error:", msg);
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
