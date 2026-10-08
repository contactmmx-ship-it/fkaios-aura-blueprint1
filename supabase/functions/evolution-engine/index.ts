/// <reference lib="deno.ns" />
// ============================================================================
// evolution-engine v2 — THE CAPABILITY THAT BUILDS FUTURE CAPABILITIES.
//
// v2 (8 Oct 2026): brought into the repository from the deployed v9 and made
// resource-routed (v1 called one Anthropic model directly and has failed since
// that provider ran out of credit). FKAIOS resource selection picks the model;
// the output schema is enforced for every provider. Prompt, discipline gates
// and priority arithmetic are unchanged.
//
// It grades the company against ITSELF using live telemetry produced by the
// company's own honest engines:
//   compute_workforce_truth()      — who actually works
//   compute_revenue_blockers()     — where the money chain breaks, and who owns it
//   compute_enterprise_economics() — what we burn vs what we earn
//   compute_mission_progress()     — the Rs 5 Cr gate, graded
//   compute_product_library()      — what we own and can sell
//   ai_jobs failure classes        — what is silently breaking
//
// THE DISCIPLINE THAT KEEPS IT HONEST:
//  1. observed_defect is MANDATORY and DB-CHECK-constrained (>20 chars).
//  2. priority_score is COMPUTED HERE, not asserted by the model:
//        (enterprise_value * confidence/100) / max(effort_days,1)
//  3. Anything gated on the Founder is marked blocked_by.
// ============================================================================
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { routedStructuredCall } from "../_shared/structured-reasoning.ts";

const ENGINE = "evolution-engine";
const db = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "", { auth: { persistSession: false } });
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
            engine: { type: "string", enum: ["Revenue", "Product", "Software", "AI", "Sales", "Marketing", "Finance", "Delivery", "Research", "Strategy", "Automation", "Learning", "Governance", "CustomerSuccess"] },
            gap_type: { type: "string", enum: ["missing", "obsolete", "duplicate", "underperforming"] },
            observed_defect: { type: "string", description: "MANDATORY. Quote the MEASURED number from the telemetry that proves this gap is real. If you cannot cite a number, do NOT propose it." },
            why_it_compounds: { type: "string", description: "Does this build FUTURE capabilities, or just do a job once? Systems beat features." },
            enterprise_value: { type: "number", description: "0-100." },
            confidence_pct: { type: "integer", description: "Honest confidence 0-100. A low number is a CORRECT answer." },
            effort_days: { type: "integer" },
            blocked_by: { type: "string", description: "'founder_gate:pricing' or 'founder_gate:customer_comms' if it cannot proceed without the Founder. Otherwise omit." },
          },
          required: ["capability", "engine", "gap_type", "observed_defect", "enterprise_value", "confidence_pct", "effort_days"],
        },
      },
    },
    required: ["capabilities"],
  },
};

Deno.serve(async (req) => {
  const started = Date.now();
  const provided = req.headers.get("x-heartbeat-secret") ?? new URL(req.url).searchParams.get("secret");
  if (!SECRET) return j({ error: "HEARTBEAT_SECRET unset — failing closed" }, 503);
  if (provided !== SECRET) return j({ error: "unauthorized" }, 401);

  try {
    const [wf, blockers, econ, mission, library, existing, jobs] = await Promise.all([
      db.rpc("compute_workforce_truth"),
      db.rpc("compute_revenue_blockers"),
      db.rpc("compute_enterprise_economics"),
      db.rpc("compute_mission_progress"),
      db.rpc("compute_product_library"),
      db.from("capability_backlog").select("capability").in("status", ["proposed", "building"]),
      db.from("ai_jobs").select("status").eq("status", "failed"),
    ]);

    // deno-lint-ignore no-explicit-any
    const w: any = wf.data ?? {}; const b: any = blockers.data ?? {}; const e: any = econ.data ?? {}; const m: any = mission.data ?? {}; const l: any = library.data ?? {};
    // deno-lint-ignore no-explicit-any
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

    const r = await routedStructuredCall(db, {
      engine: ENGINE, taskClass: "reasoning", system, toolSchema: EMIT, maxTokens: 4000,
      user: "Grade the enterprise against itself. What capabilities is it structurally missing? Cite the measured defect for each. Emit now.",
    });
    if (!r.ok || !Array.isArray(r.input?.capabilities)) {
      await db.from("agent_performance_metrics").insert({ agent_id: ENGINE, task_type: "grade_enterprise", latency_ms: Date.now() - started, success: false, error_message: String(r.failure ?? "no capabilities emitted").slice(0, 500), model: r.model, provider: r.provider, department: "EXECUTIVE" });
      return j({ error: "No resource produced valid capabilities: " + (r.failure ?? "missing capabilities"), attempts: r.attempts }, 502);
    }

    let inserted = 0, rejected = 0;
    // deno-lint-ignore no-explicit-any
    for (const c of r.input.capabilities as any[]) {
      // DISCIPLINE GATE: no measured defect, no capability (the DB CHECK enforces this too).
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
        status: "proposed", source_agent: ENGINE, model: r.resourceRef,
      });
      if (!error) inserted++; else rejected++;
    }

    await db.from("agent_performance_metrics").insert({
      agent_id: ENGINE, task_type: "grade_enterprise", latency_ms: Date.now() - started,
      estimated_cost_usd: r.costUsd, input_tokens: r.inputTokens, output_tokens: r.outputTokens, success: true,
      model: r.model, provider: r.provider, selection_reason: "FKAIOS resource selection (reasoning class): policy order, health and verified learning; schema enforced for every provider",
      prompt_version: "evolution-engine-v2", retries: Math.max(0, r.attempts.length - 1), department: "EXECUTIVE",
      business_objective: "Enterprise evolution: continuously discover the capabilities that permanently increase enterprise value",
    });

    await db.from("execution_log").insert({
      function_name: ENGINE, department_code: "EXECUTIVE", action: "grade_enterprise",
      output_summary: "Evolution cycle (" + r.resourceRef + "): " + inserted + " capabilities proposed" + (rejected ? ", " + rejected + " REJECTED for citing no measured defect" : "") + ".",
      status: "completed",
    });

    const { data: next } = await db.rpc("compute_next_capability");
    return j({ success: true, proposed: inserted, rejected_ungrounded: rejected, resource: r.resourceRef, spend_usd: Number(r.costUsd.toFixed(6)), next_capability: next, attempts: r.attempts });
  } catch (err) {
    await db.from("agent_performance_metrics").insert({
      agent_id: ENGINE, task_type: "grade_enterprise", latency_ms: Date.now() - started,
      success: false, error_message: String(err), department: "EXECUTIVE",
    });
    return j({ error: String(err) }, 500);
  }
});
