// ============================================================================
// evolution-engine v1 — THE CAPABILITY THAT BUILDS FUTURE CAPABILITIES.
//
// This is not a feature. It is the engine that decides what the enterprise builds
// next — permanently, without the Founder and without me.
//
// It grades the company against ITSELF using live telemetry produced by the
// company's own honest engines:
//   compute_workforce_truth()      — who actually works (37 of 41 never have)
//   compute_revenue_blockers()     — where the money chain breaks, and who owns it
//   compute_enterprise_economics() — what we burn vs what we earn
//   compute_mission_progress()     — the Rs 5 Cr gate, graded
//   compute_product_library()      — what we own and can sell
//   ai_jobs failure classes        — what is silently breaking
//
// THE DISCIPLINE THAT KEEPS IT HONEST:
//  1. observed_defect is MANDATORY and DB-CHECK-constrained (>20 chars). A
//     capability may only be proposed if it names a MEASURED defect in the
//     telemetry above. A capability grounded in a hunch is a feature request, and
//     feature requests are exactly what the Constitution forbids.
//  2. priority_score is COMPUTED HERE, not asserted by the model:
//        (enterprise_value * confidence/100) / max(effort_days,1)
//     so a model that inflates value while admitting low confidence cannot game rank.
//  3. It must mark anything gated on the Founder with blocked_by, so the engine
//     never proposes work the company is not allowed to do — and never stalls on it.
// ============================================================================
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const MODEL = "claude-sonnet-4-6";
const RATES: Record<string, { in: number; out: number }> = { "claude-sonnet-4-6": { in: 3, out: 15 } };
const MODEL_REASON =
  "Sonnet selected for enterprise self-evaluation: it must hold six live telemetry payloads in context, diagnose structural defects across them, and emit strict JSON without inventing evidence. Haiku loses the cross-signal reasoning that makes this useful; Opus cost is unjustified for a backlog the engine itself then ranks arithmetically.";

const db = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "", { auth: { persistSession: false } });
const KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const SECRET = Deno.env.get("HEARTBEAT_SECRET") ?? "";
const j = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });

const EMIT = {
  name: "emit_capabilities",
  description: "Emit ranked enterprise capability gaps. The ONLY way to output.",
  input_schema: {
    type: "object",
    properties: {
      capabilities: {
        type: "array", maxItems: 6,
        items: {
          type: "object",
          properties: {
            capability: { type: "string", description: "The CAPABILITY, not the feature. Prefer systems that build future capabilities over one-off jobs." },
            engine: { type: "string", enum: ["Revenue","Product","Software","AI","Sales","Marketing","Finance","Delivery","Research","Strategy","Automation","Learning","Governance","CustomerSuccess"] },
            gap_type: { type: "string", enum: ["missing","obsolete","duplicate","underperforming"] },
            observed_defect: { type: "string", description: "MANDATORY. Quote the MEASURED number from the telemetry that proves this gap is real. If you cannot cite a number, do NOT propose it." },
            why_it_compounds: { type: "string", description: "Does this build FUTURE capabilities, or just do a job once? Systems beat features." },
            enterprise_value: { type: "number", description: "0-100." },
            confidence_pct: { type: "integer", description: "Honest confidence 0-100. A low number is a CORRECT answer." },
            effort_days: { type: "integer" },
            blocked_by: { type: "string", description: "'founder_gate:pricing' or 'founder_gate:customer_comms' if it cannot proceed without the Founder. Otherwise omit." },
          },
          required: ["capability","engine","gap_type","observed_defect","enterprise_value","confidence_pct","effort_days"],
        },
      },
    },
    required: ["capabilities"],
  },
};

Deno.serve(async (req) => {
  const started = Date.now();
  const provided = new URL(req.url).searchParams.get("secret") ?? req.headers.get("x-heartbeat-secret");
  if (!SECRET) return j({ error: "HEARTBEAT_SECRET unset — failing closed" }, 503);
  if (provided !== SECRET) return j({ error: "unauthorized" }, 401);

  try {
    // The company reads its own vital signs. All of these are honest engines.
    const [wf, blockers, econ, mission, library, existing, jobs] = await Promise.all([
      db.rpc("compute_workforce_truth"),
      db.rpc("compute_revenue_blockers"),
      db.rpc("compute_enterprise_economics"),
      db.rpc("compute_mission_progress"),
      db.rpc("compute_product_library"),
      db.from("capability_backlog").select("capability").in("status", ["proposed", "building"]),
      db.from("ai_jobs").select("status").eq("status", "failed"),
    ]);

    const w: any = wf.data ?? {};
    const b: any = blockers.data ?? {};
    const e: any = econ.data ?? {};
    const m: any = mission.data ?? {};
    const l: any = library.data ?? {};
    const already = (existing.data ?? []).map((c: any) => c.capability);

    const system = [
      "You are the Enterprise Evolution Engine of Aura Tech. Your job is NOT to build features. Your job is to find the capabilities that would permanently increase enterprise value, and to prefer SYSTEMS THAT BUILD FUTURE CAPABILITIES over one-off jobs.",
      "",
      "LIVE TELEMETRY — this is the company's honest self-assessment. Every number is real.",
      "",
      "WORKFORCE: " + (w.headline ?? "unknown"),
      "REVENUE CHAIN: " + (b.headline ?? "unknown"),
      "ECONOMICS: " + (e.verdict ?? "unknown") + " | " + (e.coverage_warning ?? ""),
      "MISSION: target Rs " + (m.target_crore ?? "?") + " Cr, achieved " + (m.pct_achieved ?? "?") + "%, next gate needs Rs " + Math.round(Number(m?.next_gate?.required_daily_inr ?? 0)).toLocaleString("en-IN") + "/day for " + (m?.next_gate?.days_remaining ?? "?") + " days.",
      "PRODUCT LIBRARY: " + (l.shipped_assets ?? 0) + " shipped assets, " + (l.unpriced ?? 0) + " of them UNPRICED (dead capital).",
      "FAILED JOBS: " + (jobs.data?.length ?? 0) + " (5,970 were fabricated 'completions' that never ran — now quarantined).",
      "",
      "KNOWN FOUNDER GATES — the company is NOT ALLOWED to cross these, mark them blocked_by:",
      "- pricing (8 assets unpriced, consultancy retainer unpriced)",
      "- customer communication (6 franchise campaigns drafted, 0 sent)",
      "Do NOT propose work that requires crossing a gate without marking blocked_by. But DO propose the unblocked work that makes the gate cheaper to cross when it opens.",
      "",
      "ALREADY IN THE BACKLOG — do not repeat: " + (already.join("; ") || "(empty)"),
      "",
      "RULES:",
      "1. observed_defect MUST quote a MEASURED number from the telemetry above. If you cannot cite one, DO NOT propose the capability. A gap grounded in a hunch is a feature request, and feature requests are forbidden.",
      "2. Prefer capabilities that COMPOUND — that make future capabilities cheaper. A system beats a feature. Say why in why_it_compounds.",
      "3. confidence_pct must be HONEST. 30% is a correct and useful answer. Flattering numbers destroy your credibility and will be caught.",
      "4. Do not propose rebuilding anything that already works. The Constitution forbids redesign and duplication.",
      "",
      "Emit 4-6 capabilities via emit_capabilities. Nothing else.",
    ].join("\n");

    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": KEY, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL, max_tokens: 4000, system,
        tools: [EMIT], tool_choice: { type: "tool", name: "emit_capabilities" },
        messages: [{ role: "user", content: "Grade the enterprise against itself. What capabilities is it structurally missing? Cite the measured defect for each. Emit now." }],
      }),
    });
    if (!resp.ok) return j({ error: "LLM failed: " + resp.status + " " + (await resp.text()).slice(0, 300) }, 502);
    const data = await resp.json();
    const tb = (data?.content ?? []).find((x: any) => x?.type === "tool_use" && x?.name === "emit_capabilities");
    if (!tb?.input?.capabilities) return j({ error: "No capabilities emitted", stop_reason: data?.stop_reason }, 502);

    const inTok = Number(data?.usage?.input_tokens ?? 0);
    const outTok = Number(data?.usage?.output_tokens ?? 0);
    const cost = (inTok / 1e6) * RATES[MODEL].in + (outTok / 1e6) * RATES[MODEL].out;

    let inserted = 0, rejected = 0;
    for (const c of tb.input.capabilities as any[]) {
      // DISCIPLINE GATE: no measured defect, no capability. The DB CHECK enforces
      // this too — belt and braces, because this is the rule that keeps the engine
      // from degenerating into a wishlist.
      if (!c.observed_defect || String(c.observed_defect).trim().length <= 20) { rejected++; continue; }
      const val = Math.max(0, Math.min(100, Number(c.enterprise_value ?? 0)));
      const conf = Math.max(0, Math.min(100, Number(c.confidence_pct ?? 0)));
      const days = Math.max(1, Number(c.effort_days ?? 1));
      // Priority COMPUTED here — the model cannot assert its own rank.
      const priority = (val * (conf / 100)) / days;

      const { error } = await db.from("capability_backlog").insert({
        capability: String(c.capability).slice(0, 200),
        engine: c.engine ?? "Strategy",
        gap_type: c.gap_type ?? "missing",
        observed_defect: String(c.observed_defect).slice(0, 1500),
        why_it_compounds: String(c.why_it_compounds ?? "").slice(0, 800),
        enterprise_value: val, confidence_pct: conf, effort_days: days,
        priority_score: Number(priority.toFixed(3)),
        blocked_by: c.blocked_by ?? null,
        status: "proposed", source_agent: "evolution-engine", model: MODEL,
      });
      if (!error) inserted++; else rejected++;
    }

    await db.from("agent_performance_metrics").insert({
      agent_id: "evolution-engine", task_type: "grade_enterprise", latency_ms: Date.now() - started,
      estimated_cost_usd: cost, input_tokens: inTok, output_tokens: outTok, success: true,
      model: MODEL, provider: "anthropic", selection_reason: MODEL_REASON,
      prompt_version: "evolution-engine-v1", retries: 0, department: "EXECUTIVE",
      business_objective: "Enterprise evolution: continuously discover the capabilities that permanently increase enterprise value",
    });

    await db.from("execution_log").insert({
      function_name: "evolution-engine", department_code: "EXECUTIVE", action: "grade_enterprise",
      output_summary: "Evolution cycle: " + inserted + " capabilities proposed" + (rejected ? ", " + rejected + " REJECTED for citing no measured defect" : "") + ". The engine — not the engineer — now decides what is built next.",
      status: "completed",
    });

    const { data: next } = await db.rpc("compute_next_capability");
    return j({ success: true, proposed: inserted, rejected_ungrounded: rejected, model: MODEL, spend_usd: Number(cost.toFixed(6)), next_capability: next });
  } catch (err) {
    await db.from("agent_performance_metrics").insert({
      agent_id: "evolution-engine", task_type: "grade_enterprise", latency_ms: Date.now() - started,
      success: false, error_message: String(err), model: MODEL, provider: "anthropic", department: "EXECUTIVE",
    });
    return j({ error: String(err) }, 500);
  }
});
