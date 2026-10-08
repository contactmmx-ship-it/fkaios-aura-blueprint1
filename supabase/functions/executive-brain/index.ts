/// <reference lib="deno.ns" />
// ============================================================================
// executive-brain v2 — MULTI-EXECUTIVE INTELLIGENCE.
//
// v2 (8 Oct 2026): brought into the repository from the deployed v9 and made
// resource-routed (v1 called one Anthropic model directly and has failed since
// that provider ran out of credit). FKAIOS resource selection picks the model;
// the output schema is enforced for every provider. Prompt and gates unchanged.
//
// Each executive reasons ONLY from its own narrow mandate, is FORBIDDEN from
// being balanced, and is REQUIRED to name the executive it conflicts with.
// The Brain does NOT resolve the conflict. It surfaces it: a genuine clash
// between two mandates is a FOUNDER decision, not an arithmetic one.
// ============================================================================
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { routedStructuredCall } from "../_shared/structured-reasoning.ts";

const ENGINE = "executive-brain";
const db = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "", { auth: { persistSession: false } });
const SECRET = Deno.env.get("HEARTBEAT_SECRET") ?? "";
const j = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });

const EMIT = {
  name: "emit_board",
  description: "Emit each executive's recommendation from its OWN mandate. The ONLY way to output.",
  input_schema: {
    type: "object",
    properties: {
      recommendations: {
        type: "array", minItems: 5, maxItems: 6,
        items: {
          type: "object",
          properties: {
            exec_role: { type: "string", enum: ["CFO", "CRO", "CTO", "COO", "CMO", "CPO"] },
            mandate: { type: "string", description: "The ONE thing this executive is FOR. Narrow. Not balanced." },
            recommendation: { type: "string", description: "What this executive demands the company do, reasoning ONLY from its mandate. Do NOT be balanced. Advocate." },
            observed_evidence: { type: "string", description: "MANDATORY. Quote the MEASURED number from telemetry that forces this position." },
            conflicts_with: { type: "string", description: "The executive whose mandate this OPPOSES. If you genuinely conflict with nobody, omit — but a board with zero conflict is usually a board that is not thinking." },
            conflict_summary: { type: "string", description: "State the tension plainly. 'The CFO wants X; I want Y; both cannot be funded.'" },
            urgency: { type: "string", enum: ["now", "this_quarter", "strategic"] },
            confidence_pct: { type: "integer" },
            blocked_by: { type: "string", description: "'founder_gate:pricing' or 'founder_gate:customer_comms' if applicable. Otherwise omit." },
          },
          required: ["exec_role", "mandate", "recommendation", "observed_evidence", "urgency", "confidence_pct"],
        },
      },
    },
    required: ["recommendations"],
  },
};

Deno.serve(async (req) => {
  const started = Date.now();
  const provided = req.headers.get("x-heartbeat-secret") ?? new URL(req.url).searchParams.get("secret");
  if (!SECRET) return j({ error: "HEARTBEAT_SECRET unset — failing closed" }, 503);
  if (provided !== SECRET) return j({ error: "unauthorized" }, 401);

  try {
    const [wf, blockers, econ, mission, library, coverage] = await Promise.all([
      db.rpc("compute_workforce_truth"),
      db.rpc("compute_revenue_blockers"),
      db.rpc("compute_enterprise_economics"),
      db.rpc("compute_mission_progress"),
      db.rpc("compute_product_library"),
      db.rpc("compute_cost_coverage"),
    ]);

    // deno-lint-ignore no-explicit-any
    const w: any = wf.data ?? {}; const b: any = blockers.data ?? {}; const e: any = econ.data ?? {}; const m: any = mission.data ?? {}; const l: any = library.data ?? {}; const c: any = coverage.data ?? {};

    const system = [
      "You are the Executive Committee of Aura Tech. You are FIVE OR SIX SEPARATE EXECUTIVES, not one reasoner.",
      "",
      "CRITICAL: Each executive reasons ONLY from its own narrow mandate and ADVOCATES for it. Do NOT be balanced. Do NOT produce consensus. A CFO protecting margin and a CRO acquiring revenue MUST reach opposite conclusions from the same numbers — and that DISAGREEMENT is the most valuable thing you produce. A board that agrees unanimously is a board that is not thinking.",
      "",
      "MANDATES (stay inside yours):",
      "  CFO — protect margin and cash. Suspicious of spend. Wants burn controlled and cost KNOWN.",
      "  CRO — acquire revenue NOW. Will spend to do it. Impatient with instrumentation that earns nothing.",
      "  CTO — protect system integrity and truth. Will halt revenue work to stop fabrication or silent failure.",
      "  COO — make the machine actually run. Hates idle capacity and nameplate employees.",
      "  CMO — get the company FOUND. Traffic, distribution, demand. Nothing sells if nobody arrives.",
      "  CPO — turn what we built into sellable product. Hates dead capital.",
      "",
      "LIVE TELEMETRY — every number is real and measured:",
      "WORKFORCE: " + (w.headline ?? "unknown"),
      "REVENUE CHAIN: " + (b.headline ?? "unknown"),
      "ECONOMICS: " + (e.verdict ?? "unknown"),
      "COST COVERAGE: " + (c.verdict ?? "unknown"),
      "MISSION: Rs " + (m.target_crore ?? "?") + " Cr target, " + (m.pct_achieved ?? "?") + "% achieved. Next gate needs Rs " + Math.round(Number(m?.next_gate?.required_daily_inr ?? 0)).toLocaleString("en-IN") + "/day for " + (m?.next_gate?.days_remaining ?? "?") + " days.",
      "PRODUCT LIBRARY: " + (l.shipped_assets ?? 0) + " shipped assets, " + (l.unpriced ?? 0) + " UNPRICED (dead capital).",
      "CHANNELS: /franchise and /products are live, crawlable, and have ZERO traffic.",
      "",
      "FOUNDER GATES the company may NOT cross (mark blocked_by, do not pretend you can act):",
      "  pricing — 8 assets unpriced; consultancy retainer unpriced",
      "  customer communication — 6 campaigns drafted, 0 sent",
      "",
      "RULES:",
      "1. observed_evidence MUST quote a MEASURED number above. No number, no recommendation.",
      "2. ADVOCATE. Do not hedge. Do not produce a balanced view — that is the Founder's job, not yours.",
      "3. Name who you conflict with and state the tension plainly. If two of you want the same scarce attention, SAY SO.",
      "4. Never fabricate. If you do not know, say UNKNOWN.",
      "",
      "Emit 5-6 recommendations — one per executive — via emit_board.",
    ].join("\n");

    const r = await routedStructuredCall(db, {
      engine: ENGINE, taskClass: "reasoning", system, toolSchema: EMIT, maxTokens: 4000,
      user: "Convene. Each executive: what do you demand, from YOUR mandate alone, and who do you conflict with? Emit now.",
    });
    if (!r.ok || !Array.isArray(r.input?.recommendations)) {
      await db.from("agent_performance_metrics").insert({ agent_id: ENGINE, task_type: "convene_board", latency_ms: Date.now() - started, success: false, error_message: String(r.failure ?? "no board output").slice(0, 500), model: r.model, provider: r.provider, department: "EXECUTIVE" });
      return j({ error: "No resource produced a valid board: " + (r.failure ?? "missing recommendations"), attempts: r.attempts }, 502);
    }

    // Supersede the previous board only once a new one exists, so the Founder reads TODAY's board.
    await db.from("executive_recommendations").update({ status: "superseded" }).eq("status", "proposed");

    let inserted = 0, rejected = 0;
    // deno-lint-ignore no-explicit-any
    for (const rec of r.input.recommendations as any[]) {
      if (!rec.observed_evidence || String(rec.observed_evidence).trim().length <= 20) { rejected++; continue; }
      const { error } = await db.from("executive_recommendations").insert({
        exec_role: rec.exec_role, mandate: String(rec.mandate).slice(0, 400),
        recommendation: String(rec.recommendation).slice(0, 1500),
        observed_evidence: String(rec.observed_evidence).slice(0, 1000),
        conflicts_with: rec.conflicts_with ?? null,
        conflict_summary: rec.conflict_summary ? String(rec.conflict_summary).slice(0, 800) : null,
        urgency: rec.urgency ?? "this_quarter",
        confidence_pct: Math.max(0, Math.min(100, Number(rec.confidence_pct ?? 0))),
        blocked_by: rec.blocked_by ?? null,
        status: "proposed", model: r.resourceRef,
      });
      if (!error) inserted++; else rejected++;
    }

    await db.from("agent_performance_metrics").insert({
      agent_id: ENGINE, task_type: "convene_board", latency_ms: Date.now() - started,
      estimated_cost_usd: r.costUsd, input_tokens: r.inputTokens, output_tokens: r.outputTokens, success: true,
      model: r.model, provider: r.provider, selection_reason: "FKAIOS resource selection (reasoning class): policy order, health and verified learning; schema enforced for every provider",
      prompt_version: "executive-brain-v2", retries: Math.max(0, r.attempts.length - 1), department: "EXECUTIVE",
      business_objective: "Adversarial executive review: surface the tensions a single reasoner would average away",
    });

    const { data: arb } = await db.rpc("compute_brain_arbitration");
    return j({ success: true, executives: inserted, rejected, resource: r.resourceRef, spend_usd: Number(r.costUsd.toFixed(6)), arbitration: arb, attempts: r.attempts });
  } catch (err) {
    await db.from("agent_performance_metrics").insert({
      agent_id: ENGINE, task_type: "convene_board", latency_ms: Date.now() - started,
      success: false, error_message: String(err), department: "EXECUTIVE",
    });
    return j({ error: String(err) }, 500);
  }
});
