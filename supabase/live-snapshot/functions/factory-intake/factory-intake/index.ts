// ============================================================================
// factory-intake v2 — SOFTWARE FACTORY: Founder sentence -> real build plan.
//
// v2 FIXES A FALSE POSITIVE IN MY OWN GUARD (caught on the first real run):
//   The prompt lists components as "- Public Lead Capture [pipeline]: ...", so the
//   model echoed names WITH the [kind] suffix. My exact-match guard then declared all
//   TEN REAL components "DOES NOT EXIST" and reclassified them as new. Left alone, the
//   factory would report 0% reuse FOREVER and rebuild everything the company already
//   owns — destroying the exact margin this system exists to protect.
//   Names are now NORMALISED (strip trailing [kind], trim, case-insensitive).
//   The hallucination guard remains — it just no longer fires on my own formatting.
//
// SCOPE HONESTY — THE MOST IMPORTANT LINES IN THIS FILE:
// This is the INTAKE and PLANNING half of the factory. It does NOT generate code, it
// does NOT test, and it does NOT deploy. Every project is stamped 'PLAN ONLY'. A
// machine will never mark a project 'deployed' that it did not deploy — that is the
// fabrication that produced 5,970 fake job completions.
//
// REUSE BEFORE REBUILD is enforced, not encouraged. PRICE is never invented.
// ============================================================================
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
const MODEL = "claude-sonnet-4-6";
const RATES = {
  "claude-sonnet-4-6": {
    in: 3,
    out: 15
  }
};
const MODEL_REASON = "Sonnet selected for manufacturing intake: it must hold the real component marketplace in context, decide reuse-vs-build, and produce an architecture without inventing facts. Haiku under-reasons on architecture and over-claims reuse; Opus cost is unjustified for a plan the Founder must price and approve before a line of code exists.";
const db = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "", {
  auth: {
    persistSession: false
  }
});
const KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const SECRET = Deno.env.get("HEARTBEAT_SECRET") ?? "";
const j = (b, s = 200)=>new Response(JSON.stringify(b), {
    status: s,
    headers: {
      "Content-Type": "application/json"
    }
  });
// Normalise a component name so the guard tests IDENTITY, not formatting.
// "Public Lead Capture [pipeline]" -> "public lead capture"
const norm = (s)=>String(s ?? "").replace(/\s*\[[^\]]*\]\s*$/, "").trim().toLowerCase();
const EMIT = {
  name: "emit_build_plan",
  description: "Emit the manufacturing plan for this request. The ONLY way to output.",
  input_schema: {
    type: "object",
    properties: {
      product_name: {
        type: "string"
      },
      business_analysis: {
        type: "string",
        description: "Who is this for, what problem, what does commercial success look like."
      },
      architecture: {
        type: "string",
        description: "Concrete. Stack, services, boundaries. No hand-waving."
      },
      data_model: {
        type: "string",
        description: "Core tables and relationships."
      },
      api_surface: {
        type: "string"
      },
      ui_scope: {
        type: "string"
      },
      reused_components: {
        type: "array",
        items: {
          type: "string"
        },
        description: "EXACT names from the marketplace (no [kind] suffix). Reuse aggressively — rebuilding what we own destroys margin."
      },
      new_components: {
        type: "array",
        items: {
          type: "string"
        },
        description: "Only what genuinely does not exist. For each, why no existing component fits."
      },
      unknowns: {
        type: "array",
        items: {
          type: "string"
        },
        maxItems: 8,
        description: "MANDATORY. What you do NOT know and need from the Founder or customer. Be exhaustive."
      },
      est_build_days: {
        type: "integer"
      },
      est_llm_cost_usd: {
        type: "number"
      }
    },
    required: [
      "product_name",
      "business_analysis",
      "architecture",
      "data_model",
      "reused_components",
      "new_components",
      "unknowns",
      "est_build_days"
    ]
  }
};
Deno.serve(async (req)=>{
  const started = Date.now();
  const provided = new URL(req.url).searchParams.get("secret") ?? req.headers.get("x-heartbeat-secret");
  if (!SECRET) return j({
    error: "HEARTBEAT_SECRET unset — failing closed"
  }, 503);
  if (provided !== SECRET) return j({
    error: "unauthorized"
  }, 401);
  let body = {};
  try {
    body = await req.json();
  } catch  {}
  const request = String(body.request ?? "").trim();
  if (!request) return j({
    error: "Missing 'request' — the Founder's sentence, e.g. 'Build a Dealer CRM.'"
  }, 400);
  try {
    const { data: components } = await db.from("component_library").select("name, kind, does, evidence");
    const marketplace = (components ?? []).map((c)=>`- "${c.name}" (${c.kind}): ${c.does}`).join("\n") || "(marketplace empty)";
    const system = [
      "You are the Software Factory of Aura Tech. A Founder sentence enters; a manufacturing plan leaves.",
      "",
      "THE COMPONENT MARKETPLACE — these ALREADY EXIST and are PROVEN in production. Reuse them aggressively. An enterprise that rebuilds what it already owns is destroying its own margin.",
      marketplace,
      "",
      "RULES:",
      "1. REUSE BEFORE REBUILD. In reused_components put the component name EXACTLY as quoted above — no type suffix, no decoration. Every entry in new_components must be justified: say WHY no existing component fits. Never invent a reused component that is not listed.",
      "2. UNKNOWNS ARE MANDATORY and are the most valuable part of this plan. What has the Founder not told you? Who is the customer? What integrations? What data source? If you do not know, SAY SO. Never fill a gap with a plausible guess.",
      "3. NEVER set a price. Pricing is a Founder Approval Gate.",
      "4. NEVER claim this will be built, deployed or delivered. You produce a PLAN. Code generation, testing and deployment are NOT automated in this factory yet, and pretending otherwise is forbidden.",
      "5. Be concrete. An architecture that could describe any product describes none.",
      "",
      "Emit via emit_build_plan. Nothing else."
    ].join("\n");
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": KEY,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 4000,
        system,
        tools: [
          EMIT
        ],
        tool_choice: {
          type: "tool",
          name: "emit_build_plan"
        },
        messages: [
          {
            role: "user",
            content: "Founder request: \"" + request + "\"\n\nProduce the manufacturing plan. Reuse what we own. Tell me what you do not know."
          }
        ]
      })
    });
    if (!resp.ok) return j({
      error: "LLM failed: " + resp.status + " " + (await resp.text()).slice(0, 300)
    }, 502);
    const data = await resp.json();
    const tb = (data?.content ?? []).find((x)=>x?.type === "tool_use" && x?.name === "emit_build_plan");
    if (!tb?.input) return j({
      error: "No plan emitted",
      stop_reason: data?.stop_reason
    }, 502);
    const p = tb.input;
    const inTok = Number(data?.usage?.input_tokens ?? 0);
    const outTok = Number(data?.usage?.output_tokens ?? 0);
    const cost = inTok / 1e6 * RATES[MODEL].in + outTok / 1e6 * RATES[MODEL].out;
    // HALLUCINATION GUARD (v2): identity, not formatting. A hallucinated reuse is WORSE
    // than a rebuild — it produces a plan that silently assumes a capability we lack.
    const canonical = new Map();
    for (const c of components ?? [])canonical.set(norm(c.name), c.name);
    const claimed = Array.isArray(p.reused_components) ? p.reused_components : [];
    const validReuse = [];
    const hallucinated = [];
    for (const raw of claimed){
      const hit = canonical.get(norm(raw));
      if (hit) {
        if (!validReuse.includes(hit)) validReuse.push(hit);
      } else hallucinated.push(raw);
    }
    const newComponents = (Array.isArray(p.new_components) ? p.new_components : []).concat(hallucinated.map((n)=>n + " (claimed reusable but NOT in the marketplace — reclassified as NEW)"));
    const { data: proj, error } = await db.from("software_projects").insert({
      request,
      product_name: String(p.product_name ?? "").slice(0, 200),
      stage: "planned",
      business_analysis: String(p.business_analysis ?? "").slice(0, 3000),
      architecture: String(p.architecture ?? "").slice(0, 3000),
      data_model: String(p.data_model ?? "").slice(0, 3000),
      api_surface: String(p.api_surface ?? "").slice(0, 2000),
      ui_scope: String(p.ui_scope ?? "").slice(0, 2000),
      reused_components: validReuse,
      new_components: newComponents,
      unknowns: Array.isArray(p.unknowns) ? p.unknowns : [],
      est_build_days: Number(p.est_build_days ?? 0),
      est_llm_cost_usd: Number(p.est_llm_cost_usd ?? 0),
      price_inr: null,
      model: MODEL
    }).select("id").single();
    if (error) return j({
      error: "insert failed: " + error.message
    }, 500);
    await db.from("approvals").insert({
      action_type: "approve_software_build",
      payload: {
        project_id: proj.id,
        product: p.product_name,
        request,
        reused: validReuse,
        new: newComponents,
        unknowns: p.unknowns,
        est_build_days: p.est_build_days,
        price_inr: "UNKNOWN — FOUNDER MUST SET"
      },
      risk_level: "medium",
      amount_inr: null,
      reason: "SOFTWARE FACTORY — build plan for '" + String(p.product_name ?? request).slice(0, 80) + "'. " + validReuse.length + " existing components REUSED, " + newComponents.length + " new required. " + (Array.isArray(p.unknowns) ? p.unknowns.length : 0) + " UNKNOWNS need your answers before anyone builds. " + "NOTHING HAS BEEN BUILT — code generation and deployment are not autonomous yet.",
      status: "pending",
      department_code: "TECH"
    });
    await db.from("agent_performance_metrics").insert({
      agent_id: "factory-intake",
      task_type: "manufacturing_plan",
      latency_ms: Date.now() - started,
      estimated_cost_usd: cost,
      input_tokens: inTok,
      output_tokens: outTok,
      success: true,
      model: MODEL,
      provider: "anthropic",
      selection_reason: MODEL_REASON,
      prompt_version: "factory-intake-v2",
      retries: 0,
      department: "TECH",
      business_objective: "Software Factory: turn a Founder sentence into a costed, reuse-maximised build plan"
    });
    const total = validReuse.length + newComponents.length;
    return j({
      success: true,
      project_id: proj.id,
      product: p.product_name,
      reused_components: validReuse,
      new_components: newComponents,
      reuse_pct: total ? Math.round(validReuse.length / total * 100) : 0,
      hallucinated_reuse: hallucinated,
      unknowns: p.unknowns,
      est_build_days: p.est_build_days,
      model: MODEL,
      spend_usd: Number(cost.toFixed(6)),
      automation_status: "PLAN ONLY — code generation, testing and deployment are NOT autonomous. Nothing has been built.",
      price: "UNKNOWN — Founder gate."
    });
  } catch (err) {
    await db.from("agent_performance_metrics").insert({
      agent_id: "factory-intake",
      task_type: "manufacturing_plan",
      latency_ms: Date.now() - started,
      success: false,
      error_message: String(err),
      model: MODEL,
      provider: "anthropic",
      department: "TECH"
    });
    return j({
      error: String(err)
    }, 500);
  }
});
