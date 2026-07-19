// ============================================================================
// founder-reassignment-cell — third independent cognitive cell
// ============================================================================
// Same pattern as founder-confidence-cell and founder-reflection-cell.
// reassignStuckWork() reads ai_jobs (status='failed') + orchestration_tasks
// + the workforce, and reassigns failed work to a different employee. It
// calls only local functions (getWorkforce, selectBestEmployee) — no
// dependency on escalateBlocked's or returnCompletedWork's output, and
// nothing in the old pipeline consumed its return value except the
// response JSON's own `reassigned` count.
//
// NOT wired to a cron yet — same posture as the other independent cells.
// ============================================================================

import { reassignStuckWork } from "../_shared/work-engine.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const result = await reassignStuckWork();
    return new Response(JSON.stringify({ cell: "reassignment", ...result }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("founder-reassignment-cell error:", msg);
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
