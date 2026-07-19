// ============================================================================
// founder-confidence-cell — the first real "cognitive cell"
// ============================================================================
// PLATFORM HONESTY, stated once so it governs every cell that follows:
// Supabase Edge Functions are stateless and request-triggered. There is no
// infrastructure here for a process that runs continuously and reacts to
// shared state in real time, the way a biological cell does. The honest
// engineering translation of "cells that never call each other, communicate
// only through shared state" within THIS platform is: independently
// scheduled functions, each with its own cron trigger, that read and write
// the same tables but never invoke one another directly. This is that
// pattern's first instance, not a simulation of biology — a real
// architectural change within real constraints.
//
// WHY buildIntuition() FIRST: it was the safest extraction candidate in the
// whole codebase. It only reads agent_performance_metrics and writes
// founder_memory (kind:'intuition') — it calls no other cognitive function,
// and nothing calls it expecting a synchronous return value it depends on
// (founder-brain-tick's Promise.allSettled batch used its result only for a
// count in the tick's own response JSON, never as an input to another
// decision within the same request). Removing it from that batch and
// giving it its own schedule changes WHEN it runs, not WHAT it does — the
// underlying buildIntuition() function itself is completely unchanged,
// reused as-is.
//
// NOT wired to a cron by this commit — same posture as founder-curiosity-tick
// when it was introduced: the architecture exists and is real, the actual
// schedule is the founder's decision once the base cron gap is resolved.
// ============================================================================

import { buildIntuition } from "../_shared/executive-planner.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const patterns = await buildIntuition("founder");
    return new Response(JSON.stringify({ cell: "confidence", patternsComputed: patterns.length, patterns }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("founder-confidence-cell error:", msg);
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
