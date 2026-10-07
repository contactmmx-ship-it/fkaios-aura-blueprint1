// ============================================================================
// factory-planner v1 — SOFTWARE FACTORY PHASE 2: THE MANUFACTURING PLANNER.
//
// Approved architecture -> epics -> features -> tasks -> dependencies -> parallel
// execution WAVES -> AI employee assignment.
//
// A wave is a set of tasks with no dependency on each other, so the factory knows what
// it could run SIMULTANEOUSLY once Phase 3 exists. Wave N cannot start until wave N-1
// completes. This is the difference between a manufacturing plan and a to-do list.
//
// WHAT THIS DOES NOT DO, AND SAYS SO: it does not write code. Tasks are born 'planned'
// and nothing self-completes. The database physically REFUSES to mark a task 'done'
// without evidence (CHECK done_requires_evidence). Phase 3 does not exist yet, so
// nothing will move these tasks yet — and the factory reports that plainly instead of
// simulating progress. That is the 5,970-fake-completions lesson, encoded as a
// constraint rather than a promise.
// ============================================================================
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const MODEL = "claude-sonnet-4-6";
const RATES: Record<string, { in: number; out: number }> = { "claude-sonnet-4-6": { in: 3, out: 15 } };
const MODEL_REASON =
  "Sonnet selected for manufacturing decomposition: it must respect a real architecture, produce a correct dependency graph, and assign work to AI roles without inventing scope. Haiku produces flat task lists with broken dependencies (the failure mode that makes a plan useless); Opus cost is unjustified for a decomposition the Founder approves before any code exists.";

const db = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "", { auth: { persistSession: false } });
const KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const SECRET = Deno.env.get("HEARTBEAT_SECRET") ?? "";
const j = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });

const EMIT = {
  name: "emit_manufacturing_plan",
  description: "Emit the epics/features/tasks with dependency waves. The ONLY way to output.",
  input_schema: {
    type: "object",
    properties: {
      milestones: { type: "array", items: { type: "string" }, maxItems: 6 },
      tasks: {
        type: "array", minItems: 10, maxItems: 40,
        items: {
          type: "object",
          properties: {
            epic: { type: "string" },
            feature: { type: "string" },
            task: { type: "string", description: "One concrete unit of work. Small enough that its completion is unambiguous and evidenceable (a file, a migration, a test run)." },
            layer: { type: "string", enum: ["database","backend","frontend","integration","test","docs","security","deploy"] },
            agent_role: { type: "string", description: "e.g. Database Architect, Backend Engineer, Frontend Engineer, Testing Engineer, Security Engineer, Documentation Engineer, DevOps Engineer." },
            wave: { type: "integer", description: "Parallel execution wave. Wave 1 has NO dependencies. Wave N depends only on waves < N. Tasks in the SAME wave must be safely parallelisable." },
            depends_on: { type: "string", description: "What must exist first. Be specific." },
            effort_hours: { type: "number" },
            reuses: { type: "string", description: "The EXACT component name from the marketplace this task reuses, if any. Reuse aggressively." },
          },
          required: ["epic","feature","task","layer","agent_role","wave","effort_hours"],
        },
      },
    },
    required: ["tasks"],
  },
};

Deno.serve(async (req) => {
  const started = Date.now();
  const provided = new URL(req.url).searchParams.get("secret") ?? req.headers.get("x-heartbeat-secret");
  if (!SECRET) return j({ error: "HEARTBEAT_SECRET unset — failing closed" }, 503);
  if (provided !== SECRET) return j({ error: "unauthorized" }, 401);

  let body: any = {};
  try { body = await req.json(); } catch { /* */ }

  try {
    // Plan the named project, or the most recent planned one.
    const q = db.from("software_projects").select("*").order("created_at", { ascending: false }).limit(1);
    const { data: projects } = body.project_id
      ? await db.from("software_projects").select("*").eq("id", body.project_id).limit(1)
      : await q;
    const proj: any = (projects ?? [])[0];
    if (!proj) return j({ error: "No software project to plan. Run factory-intake first." }, 404);

    const { count: existing } = await db.from("factory_tasks")
      .select("id", { count: "exact", head: true }).eq("project_id", proj.id);
    if ((existing ?? 0) > 0 && !body.replan) {
      return j({ success: true, already_planned: true, project: proj.product_name, tasks: existing,
                 message: "This project already has a manufacturing plan. Pass replan:true to rebuild it." });
    }

    const { data: components } = await db.from("component_library").select("name, does");
    const marketplace = (components ?? []).map((c: any) => `- "${c.name}": ${c.does}`).join("\n");

    const system = [
      "You are the Software Factory Planner of Aura Tech. An APPROVED architecture enters; a manufacturing plan leaves.",
      "",
      "THE PROJECT:",
      "Product: " + (proj.product_name ?? "?"),
      "Request: " + (proj.request ?? "?"),
      "Business analysis: " + (proj.business_analysis ?? ""),
      "Architecture: " + (proj.architecture ?? ""),
      "Data model: " + (proj.data_model ?? ""),
      "API surface: " + (proj.api_surface ?? ""),
      "UI scope: " + (proj.ui_scope ?? ""),
      "Components ALREADY REUSED in the plan: " + JSON.stringify(proj.reused_components ?? []),
      "New components required: " + JSON.stringify(proj.new_components ?? []),
      "KNOWN UNKNOWNS (do NOT plan around these as if they were answered): " + JSON.stringify(proj.unknowns ?? []),
      "",
      "COMPONENT MARKETPLACE (reuse aggressively — rebuilding what we own destroys margin):",
      marketplace,
      "",
      "RULES:",
      "1. WAVES ARE THE POINT. Wave 1 tasks have NO dependencies. Wave N depends ONLY on waves < N. Tasks in the SAME wave MUST be safely parallelisable — they will one day run simultaneously. A dependency graph that is wrong makes the whole plan worthless.",
      "2. Every task must be SMALL enough that its completion is UNAMBIGUOUS and can be evidenced by an artefact — a migration, a file, a passing test. 'Implement the backend' is not a task. 'Create dealers table with RLS and indexes' is.",
      "3. Database first, then backend, then frontend, then tests and docs. Security review before deploy.",
      "4. Set `reuses` to the EXACT marketplace component name wherever a task can lean on one.",
      "5. Do NOT invent scope to cover an UNKNOWN. If something depends on an unanswered unknown, still plan it but say so in depends_on.",
      "6. Include test, security and documentation tasks. A plan without them is a plan that ships defects.",
      "",
      "Emit 12-30 tasks via emit_manufacturing_plan.",
    ].join("\n");

    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": KEY, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL, max_tokens: 8000, system,
        tools: [EMIT], tool_choice: { type: "tool", name: "emit_manufacturing_plan" },
        messages: [{ role: "user", content: "Decompose this into a wave-based manufacturing plan. Get the dependency graph right." }],
      }),
    });
    if (!resp.ok) return j({ error: "LLM failed: " + resp.status + " " + (await resp.text()).slice(0, 300) }, 502);
    const data = await resp.json();
    const tb = (data?.content ?? []).find((x: any) => x?.type === "tool_use" && x?.name === "emit_manufacturing_plan");
    if (!tb?.input?.tasks) return j({ error: "No plan emitted", stop_reason: data?.stop_reason }, 502);

    const inTok = Number(data?.usage?.input_tokens ?? 0);
    const outTok = Number(data?.usage?.output_tokens ?? 0);
    const cost = (inTok / 1e6) * RATES[MODEL].in + (outTok / 1e6) * RATES[MODEL].out;

    if (body.replan) await db.from("factory_tasks").delete().eq("project_id", proj.id);

    // Guard: a task claiming to reuse a component that does not exist is a plan built on
    // a capability we do not have. Strip the claim rather than let it through.
    const known = new Set((components ?? []).map((c: any) => String(c.name).toLowerCase()));
    const norm = (s: string) => String(s ?? "").replace(/\s*\[[^\]]*\]\s*$/, "").trim().toLowerCase();

    let inserted = 0, badReuse = 0;
    for (const t of tb.input.tasks as any[]) {
      let reuses: string | null = t.reuses ? String(t.reuses) : null;
      if (reuses && !known.has(norm(reuses))) { reuses = null; badReuse++; }
      const { error } = await db.from("factory_tasks").insert({
        project_id: proj.id,
        epic: String(t.epic ?? "General").slice(0, 160),
        feature: String(t.feature ?? "").slice(0, 200),
        task: String(t.task ?? "").slice(0, 400),
        layer: t.layer ?? "backend",
        agent_role: String(t.agent_role ?? "Backend Engineer").slice(0, 80),
        wave: Math.max(1, Number(t.wave ?? 1)),
        depends_on: t.depends_on ? String(t.depends_on).slice(0, 300) : null,
        effort_hours: Number(t.effort_hours ?? 0),
        reuses,
        status: "planned",   // Born planned. Nothing self-completes. Ever.
      });
      if (!error) inserted++;
    }

    await db.from("agent_performance_metrics").insert({
      agent_id: "factory-planner", task_type: "manufacturing_decomposition", latency_ms: Date.now() - started,
      estimated_cost_usd: cost, input_tokens: inTok, output_tokens: outTok, success: true,
      model: MODEL, provider: "anthropic", selection_reason: MODEL_REASON,
      prompt_version: "factory-planner-v1", retries: 0, department: "TECH",
      business_objective: "Software Factory Phase 2: decompose an approved architecture into a parallel, evidence-gated manufacturing plan",
    });

    const { data: plan } = await db.rpc("compute_factory_plan", { p_project: proj.id });
    return j({
      success: true, project: proj.product_name, tasks_created: inserted,
      reuse_claims_rejected: badReuse, model: MODEL, spend_usd: Number(cost.toFixed(6)),
      plan,
      automation_truth: "All tasks are PLANNED. Nothing is built. Phase 3 (code generation) does not exist yet, so nothing can move them — and the database will REFUSE to mark any task done without evidence.",
    });
  } catch (err) {
    await db.from("agent_performance_metrics").insert({
      agent_id: "factory-planner", task_type: "manufacturing_decomposition", latency_ms: Date.now() - started,
      success: false, error_message: String(err), model: MODEL, provider: "anthropic", department: "TECH",
    });
    return j({ error: String(err) }, 500);
  }
});
