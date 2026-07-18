// ============================================================================
// founder-curiosity-tick — SPRINT 12 (M1-S12)
// ============================================================================
// Same wrapper pattern as founder-brain-tick (Supabase can only cron an
// HTTP endpoint, not a _shared/ file) — but DELIBERATELY a separate
// function on a separate, much slower schedule.
//
// WHY NOT FOLDED INTO founder-brain-tick's 15-MIN LOOP: curiosityTick()
// dispatches through Company OS's research.run capability, which calls a
// REAL Apify actor and spends real credits per call (confirmed in
// research-engine's source — this is not a free operation). Running it
// every 15 minutes alongside the cognitive tick would mean up to 96
// paid research dispatches/day with no budget ceiling — exactly the
// "unbounded LLM/API cost" risk flagged in this project's own engineering
// assessment after Sprint 11. Curiosity runs on its own, slower cadence
// instead.
//
// NOT WIRED TO A CRON SCHEDULE. Recommended cadence: once per day, not
// more — this is a suggestion for the founder to decide and apply, not a
// default this sandbox enables. No deploy credentials here regardless.
// ============================================================================

import { curiosityTick } from "../_shared/curiosity.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const results = await curiosityTick("founder");
    return new Response(JSON.stringify({ results }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("founder-curiosity-tick error:", msg);
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
