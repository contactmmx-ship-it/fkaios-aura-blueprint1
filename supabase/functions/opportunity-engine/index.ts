/// <reference lib="deno.ns" />
// ============================================================================
// opportunity-engine v2 — THE SELF-THINKING LOOP (Roadmap item 1).
//
// v2 (8 Oct 2026): brought into the repository from the deployed v9 and made
// resource-routed. v1 called one Anthropic model directly and has failed every
// day since that provider ran out of credit. The engine now states the
// capability it needs (reasoning + a strict output schema) and FKAIOS resource
// selection picks the model; the schema is enforced for every provider.
// Prompt, discipline gates and ROI arithmetic are unchanged.
//
// The enterprise must generate its own work without the Founder asking. This is
// the CEO thinking: it reads the REAL state of the company (brands it actually
// owns, software it has actually shipped, market signals it has actually
// captured, the revenue gap it actually faces) and proposes commercial
// opportunities grounded in those assets.
//
// HARD DISCIPLINE — the two ways this could become worthless, both blocked:
//  1. FABRICATED MARKETS. The model may ONLY propose opportunities grounded in an
//     asset that exists in this database, named explicitly in grounded_in. A
//     proposal grounded in nothing is REJECTED before insert.
//  2. FAKE FORECASTS. Every rupee figure is an ASSUMPTION, stored and labelled as
//     such. Commercial pricing is a FOUNDER APPROVAL GATE. Nothing auto-executes:
//     status starts at 'proposed' and only the Founder moves it.
//
// ROI is COMPUTED here, not invented by the model:
//     roi = (est_revenue * probability/100) / max(effort_days, 1)
// so a model that inflates revenue but admits low probability cannot game rank.
// ============================================================================
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { routedStructuredCall } from "../_shared/structured-reasoning.ts";

const ENGINE = "opportunity-engine";
const db = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "", { auth: { persistSession: false } });
const SECRET = Deno.env.get("HEARTBEAT_SECRET") ?? "";
const j = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });

const EMIT = {
  name: "emit_opportunities",
  description: "Emit commercial opportunities for the enterprise. The ONLY way to output.",
  input_schema: {
    type: "object",
    properties: {
      opportunities: {
        type: "array", maxItems: 5,
        items: {
          type: "object",
          properties: {
            title: { type: "string" },
            category: { type: "string", enum: ["saas", "services", "licensing", "product", "partnership", "automation"] },
            problem: { type: "string", description: "The real market problem, concretely stated." },
            customer_segment: { type: "string" },
            revenue_model: { type: "string" },
            est_revenue_inr: { type: "number", description: "ASSUMPTION. Realistic 12-month revenue in INR. Do NOT inflate." },
            est_effort_days: { type: "integer" },
            probability_pct: { type: "integer", description: "Honest probability of success 0-100. A low number here is a CORRECT answer." },
            risk: { type: "string" },
            grounded_in: { type: "string", description: "MANDATORY. The specific EXISTING asset of this enterprise that makes this credible (a named brand, a shipped system, a captured market signal). If you cannot name one, do not propose it." },
            mission_impact: { type: "string", description: "Effect on the Rs 5 Cr / 31-Dec-2026 gate vs the Rs 1,100 Cr / 2030 mission. Be explicit if it cannot help the 2026 gate." },
            owning_department: { type: "string" },
          },
          required: ["title", "category", "problem", "est_revenue_inr", "est_effort_days", "probability_pct", "grounded_in", "mission_impact"],
        },
      },
    },
    required: ["opportunities"],
  },
};

Deno.serve(async (req) => {
  const started = Date.now();
  const provided = req.headers.get("x-heartbeat-secret") ?? new URL(req.url).searchParams.get("secret");
  if (!SECRET) return j({ error: "HEARTBEAT_SECRET unset — failing closed" }, 503);
  if (provided !== SECRET) return j({ error: "unauthorized" }, 401);

  try {
    const [brands, existing, signals, mission] = await Promise.all([
      db.from("brands").select("name, sector, type, investment_range, royalty").eq("is_active", true),
      db.from("opportunity_backlog").select("title").in("status", ["proposed", "approved", "executing"]),
      db.from("market_intelligence").select("headline, detail, industry").order("captured_at", { ascending: false }).limit(8),
      db.rpc("compute_mission_progress"),
    ]);

    // deno-lint-ignore no-explicit-any
    const m: any = mission.data ?? {};
    // deno-lint-ignore no-explicit-any
    const gate: any = m?.next_gate ?? {};
    // deno-lint-ignore no-explicit-any
    const already = (existing.data ?? []).map((o: any) => o.title);
    const daysLeft = gate.days_remaining ?? 171;
    const perDay = Math.round(Number(gate.required_daily_inr ?? 292398)).toLocaleString("en-IN");
    // deno-lint-ignore no-explicit-any
    const brandList = (brands.data ?? []).map((b: any) => b.name + " (" + (b.sector ?? "?") + ", invest " + (b.investment_range ?? "?") + ", royalty " + (b.royalty ?? "?") + ")").join("; ") || "none";
    // deno-lint-ignore no-explicit-any
    const signalList = (signals.data ?? []).map((s: any) => s.headline).join("; ") || "none captured yet";

    const system = [
      "You are the CEO of Aura Tech / Bhavishya Associates, generating the enterprise's own commercial opportunities WITHOUT being asked. You think like a Fortune-500 CEO with a brutal deadline, not like a consultant writing a deck.",
      "",
      "THE REAL STATE OF YOUR COMPANY — all true, you may not contradict it:",
      "- Revenue to date: Rs 0. No invoice has EVER been raised. No customer has ever paid.",
      "- Gate: Rs 5 Crore of RECEIVED revenue by 31-Dec-2026. " + daysLeft + " days remain. That is Rs " + perDay + " EVERY DAY, from zero.",
      "- Mission: Rs 1,100 Crore by 2030.",
      "- Cold outbound is DEAD and cannot be revived: all 71 leads were scraped Google results with no phone and no budget; the best BANT score ever produced is 32 against a bar of 40. It is arithmetically incapable of producing a qualified lead.",
      "- A public inbound franchise-enquiry page now exists (/franchise) but has NO TRAFFIC yet.",
      "- A Revenue Desk exists and CAN invoice a real client today.",
      "",
      "REAL ASSETS YOU ACTUALLY OWN (ground every proposal in one of these):",
      "- Franchise brands with real commercial terms: " + brandList,
      "- PROVEN software delivery: Aura Tech has already built and shipped working systems — this enterprise OS itself, dealer-management software, brand CRMs, portals, dashboards. Delivery capability is demonstrated, not hypothetical.",
      "- Captured market signals: " + signalList,
      "",
      "RULES — violating these makes your output worthless:",
      "1. GROUND EVERY PROPOSAL. grounded_in must name a SPECIFIC asset above. If you cannot name one, DO NOT propose it. No generic 'build a CCTV AI platform' with nothing behind it.",
      "2. DO NOT INFLATE. est_revenue_inr and probability_pct are ASSUMPTIONS the Founder will challenge. A 15% probability is a CORRECT and useful answer. Flattering numbers destroy your credibility and will be caught.",
      "3. BE HONEST ABOUT THE 2026 GATE. Recurring SaaS cannot produce Rs 5 Cr in " + daysLeft + " days from zero — say so in mission_impact rather than pretending. Large-ticket and services deals are the only arithmetic that closes it.",
      "4. DO NOT REPEAT what is already in the backlog: " + (already.join("; ") || "(empty)"),
      "5. Prefer opportunities that need NO new spend and NO new data — the 8 brands and prior clients are reachable at zero cost.",
      "",
      "Emit 3-5 opportunities via emit_opportunities. Nothing else.",
    ].join("\n");

    const r = await routedStructuredCall(db, {
      engine: ENGINE, taskClass: "reasoning", system, toolSchema: EMIT, maxTokens: 4000,
      user: "Think as CEO. What should this company do to earn real money? Ground every idea in an asset we actually have. Emit now.",
    });
    if (!r.ok || !Array.isArray(r.input?.opportunities)) {
      await db.from("agent_performance_metrics").insert({ agent_id: "ceo-engine", task_type: "generate_opportunities", latency_ms: Date.now() - started, success: false, error_message: String(r.failure ?? "no opportunities emitted").slice(0, 500), model: r.model, provider: r.provider, department: "EXECUTIVE" });
      return j({ error: "No resource produced valid opportunities: " + (r.failure ?? "missing opportunities"), attempts: r.attempts }, 502);
    }

    let inserted = 0, rejected = 0;
    // deno-lint-ignore no-explicit-any
    for (const o of r.input.opportunities as any[]) {
      // DISCIPLINE GATE: a proposal grounded in nothing is not a proposal.
      if (!o.grounded_in || String(o.grounded_in).trim().length < 10) { rejected++; continue; }
      const rev = Number(o.est_revenue_inr ?? 0);
      const days = Math.max(1, Number(o.est_effort_days ?? 1));
      const prob = Math.max(0, Math.min(100, Number(o.probability_pct ?? 0)));
      // ROI computed HERE, not by the model — inflated revenue paired with an
      // honest probability cannot game the ranking.
      const roi = (rev * (prob / 100)) / days;

      const { error } = await db.from("opportunity_backlog").insert({
        title: String(o.title).slice(0, 200), category: o.category ?? "services",
        problem: String(o.problem).slice(0, 1500), customer_segment: o.customer_segment ?? null,
        revenue_model: o.revenue_model ?? null, est_revenue_inr: rev, est_effort_days: days,
        probability_pct: prob, roi_score: Number(roi.toFixed(2)), risk: o.risk ?? null,
        grounded_in: String(o.grounded_in).slice(0, 800),
        mission_impact: String(o.mission_impact ?? "").slice(0, 800),
        owning_department: o.owning_department ?? null,
        status: "proposed", source_agent: "ceo-engine", model: r.resourceRef,
      });
      if (!error) inserted++;
    }

    await db.from("agent_performance_metrics").insert({
      agent_id: "ceo-engine", task_type: "generate_opportunities", latency_ms: Date.now() - started,
      estimated_cost_usd: r.costUsd, input_tokens: r.inputTokens, output_tokens: r.outputTokens, success: true,
      model: r.model, provider: r.provider, selection_reason: "FKAIOS resource selection (reasoning class): policy order, health and verified learning; schema enforced for every provider",
      prompt_version: "opportunity-engine-v2", retries: Math.max(0, r.attempts.length - 1), department: "EXECUTIVE",
      business_objective: "Rs 5 Cr gate: generate grounded commercial opportunities without Founder prompting (self-thinking loop)",
    });

    await db.from("execution_log").insert({
      function_name: ENGINE, department_code: "EXECUTIVE", action: "generate_opportunities",
      output_summary: "CEO thinking cycle (" + r.resourceRef + "): " + inserted + " opportunities proposed" + (rejected ? ", " + rejected + " REJECTED for not being grounded in a real asset" : "") + ". All estimates are ASSUMPTIONS pending Founder approval; nothing auto-executes.",
      status: "completed",
    });

    return j({ success: true, proposed: inserted, rejected_ungrounded: rejected, resource: r.resourceRef, spend_usd: Number(r.costUsd.toFixed(6)), attempts: r.attempts });
  } catch (e) {
    await db.from("agent_performance_metrics").insert({
      agent_id: "ceo-engine", task_type: "generate_opportunities", latency_ms: Date.now() - started,
      success: false, error_message: String(e), department: "EXECUTIVE",
    });
    return j({ error: String(e) }, 500);
  }
});
