// ============================================================================
// executive-brain v1 — MULTI-EXECUTIVE INTELLIGENCE.
//
// The company has reasoned with ONE voice. A single reasoner optimising "enterprise
// value" silently averages away the tensions that actually matter. A CFO whose
// mandate is PROTECT MARGIN and a CRO whose mandate is ACQUIRE REVENUE will reach
// OPPOSITE conclusions from identical telemetry — and the disagreement is worth more
// than either conclusion.
//
// So: each executive reasons ONLY from its own narrow mandate, is FORBIDDEN from
// being balanced, and is REQUIRED to name the executive it conflicts with.
//
// The Brain does NOT resolve the conflict. It surfaces it. A genuine clash between
// two mandates is a FOUNDER decision, not an arithmetic one — averaging two
// executives produces a consensus nobody argued for, which is how boards make
// expensive mistakes that everyone later disowns.
// ============================================================================
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const MODEL = "claude-sonnet-4-6";
const RATES: Record<string, { in: number; out: number }> = { "claude-sonnet-4-6": { in: 3, out: 15 } };
const MODEL_REASON =
  "Sonnet selected for adversarial executive review: it must hold six telemetry payloads and reason from FIVE opposing mandates without collapsing into consensus. Haiku collapses into agreement (the exact failure this engine exists to prevent); Opus cost is unjustified for recommendations the Founder arbitrates anyway.";

const db = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "", { auth: { persistSession: false } });
const KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
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
  const provided = new URL(req.url).searchParams.get("secret") ?? req.headers.get("x-heartbeat-secret");
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

    const w: any = wf.data ?? {}; const b: any = blockers.data ?? {};
    const e: any = econ.data ?? {}; const m: any = mission.data ?? {};
    const l: any = library.data ?? {}; const c: any = coverage.data ?? {};

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

    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": KEY, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL, max_tokens: 4000, system,
        tools: [EMIT], tool_choice: { type: "tool", name: "emit_board" },
        messages: [{ role: "user", content: "Convene. Each executive: what do you demand, from YOUR mandate alone, and who do you conflict with? Emit now." }],
      }),
    });
    if (!resp.ok) return j({ error: "LLM failed: " + resp.status + " " + (await resp.text()).slice(0, 300) }, 502);
    const data = await resp.json();
    const tb = (data?.content ?? []).find((x: any) => x?.type === "tool_use" && x?.name === "emit_board");
    if (!tb?.input?.recommendations) return j({ error: "No board output", stop_reason: data?.stop_reason }, 502);

    const inTok = Number(data?.usage?.input_tokens ?? 0);
    const outTok = Number(data?.usage?.output_tokens ?? 0);
    const cost = (inTok / 1e6) * RATES[MODEL].in + (outTok / 1e6) * RATES[MODEL].out;

    // Supersede the previous board so the Founder reads TODAY's board, not a pile.
    await db.from("executive_recommendations").update({ status: "superseded" }).eq("status", "proposed");

    let inserted = 0, rejected = 0;
    for (const r of tb.input.recommendations as any[]) {
      if (!r.observed_evidence || String(r.observed_evidence).trim().length <= 20) { rejected++; continue; }
      const { error } = await db.from("executive_recommendations").insert({
        exec_role: r.exec_role, mandate: String(r.mandate).slice(0, 400),
        recommendation: String(r.recommendation).slice(0, 1500),
        observed_evidence: String(r.observed_evidence).slice(0, 1000),
        conflicts_with: r.conflicts_with ?? null,
        conflict_summary: r.conflict_summary ? String(r.conflict_summary).slice(0, 800) : null,
        urgency: r.urgency ?? "this_quarter",
        confidence_pct: Math.max(0, Math.min(100, Number(r.confidence_pct ?? 0))),
        blocked_by: r.blocked_by ?? null,
        status: "proposed", model: MODEL,
      });
      if (!error) inserted++; else rejected++;
    }

    await db.from("agent_performance_metrics").insert({
      agent_id: "executive-brain", task_type: "convene_board", latency_ms: Date.now() - started,
      estimated_cost_usd: cost, input_tokens: inTok, output_tokens: outTok, success: true,
      model: MODEL, provider: "anthropic", selection_reason: MODEL_REASON,
      prompt_version: "executive-brain-v1", retries: 0, department: "EXECUTIVE",
      business_objective: "Adversarial executive review: surface the tensions a single reasoner would average away",
    });

    const { data: arb } = await db.rpc("compute_brain_arbitration");
    return j({ success: true, executives: inserted, rejected, model: MODEL, spend_usd: Number(cost.toFixed(6)), arbitration: arb });
  } catch (err) {
    await db.from("agent_performance_metrics").insert({
      agent_id: "executive-brain", task_type: "convene_board", latency_ms: Date.now() - started,
      success: false, error_message: String(err), model: MODEL, provider: "anthropic", department: "EXECUTIVE",
    });
    return j({ error: String(err) }, 500);
  }
});
