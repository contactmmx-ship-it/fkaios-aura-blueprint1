// ============================================================================
// founder-brain-state — read-only Brain State endpoint
// ============================================================================
// NOT a new capability. getBrainState() (executive-planner.ts) already
// exists as of the previous commit — this is the minimum wrapper required
// for the UI to actually call it, same infrastructure reason
// founder-brain-tick and founder-curiosity-tick exist as separate thin
// endpoints (Supabase can only expose an HTTP function, not a _shared/
// library function, directly to a browser).
//
// DELIBERATELY NOT called from inside founder-brain-tick's Promise.allSettled
// batch: that batch already runs buildIntuition() and reads reflection
// history every cycle. getBrainState() independently re-fetches both —
// wiring it into the same tick would mean computing buildIntuition() twice
// per cycle, which is exactly the "duplicate cognition" the constitution
// forbids. Brain State is an on-demand read instead: the UI asks for the
// Brain's current state when it needs it, rather than it being force-fit
// into a schedule that would waste a redundant computation every 15 minutes.
// ============================================================================

import { getBrainState } from "../_shared/executive-planner.ts";
import { getBeliefHistory } from "../_shared/curiosity.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    // Belief lives in curiosity.ts, which already imports FROM
    // executive-planner.ts (getReflectionHistory) — pulling Belief INTO
    // executive-planner.ts's getBrainState() would create a circular
    // import. Merged here instead, at the leaf endpoint, which both
    // modules can safely feed without either importing the other.
    const [state, recentBeliefs] = await Promise.all([
      getBrainState("founder"),
      getBeliefHistory(3),
    ]);
    return new Response(JSON.stringify({ ...state, recentBeliefs }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("founder-brain-state error:", msg);
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
