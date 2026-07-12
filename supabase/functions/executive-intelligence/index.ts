// executive-intelligence v5 — closes the enterprise cognition loop.
// v4 already READ the last 8 fleet_memory rows in its observe phase; the WRITE
// path was missing, so memory stayed at 0 and nothing compounded. v5 deposits
// each cycle's assessment + top opportunity + top risk + prediction basis into
// the Enterprise Knowledge Network via record_enterprise_memory(). Governed
// decision 55106426 (APPROVED). Everything else identical to v4.
//
// [GIT PARITY 2026-07-12] This function existed ONLY in production and was
// never committed. Pulled into the repo as-is (Blueprint P2.4 — deployment
// discipline). SECURITY: SHARED_SECRET is hardcoded below; it must be moved
// to Deno.env.get('HEARTBEAT_SECRET') and rotated (Blueprint P1.5).

import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const SHARED_SECRET = "kjhgfdsa"; // TODO(P1.5): move to env + rotate
const supabase = createClient(supabaseUrl, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
const j = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });

async function q(sql: string): Promise<unknown> {
  const { data, error } = await supabase.rpc("avatar_readonly_query", { q: sql });
  return error ? { error: error.message } : data;
}

const CYCLE_TOOL = {
  name: "emit_cycle",
  description: "Emit the completed executive cognition cycle. This is the ONLY way to output.",
  input_schema: {
    type: "object",
    properties: {
      situation_assessment: { type: "string" },
      opportunities: { type: "array", maxItems: 3, items: { type: "object", properties: { title: { type: "string" }, rationale: { type: "string" }, owner_department: { type: "string" } }, required: ["title", "rationale"] } },
      risks: { type: "array", maxItems: 3, items: { type: "object", properties: { risk: { type: "string" }, severity: { type: "string", enum: ["low", "medium", "high"] }, mitigation: { type: "string" } }, required: ["risk", "severity"] } },
      predictions: { type: "array", maxItems: 3, items: { type: "object", properties: { metric: { type: "string" }, expected_value: { type: "string" }, measure_by: { type: "string", description: "YYYY-MM-DD" }, basis: { type: "string" } }, required: ["metric", "expected_value", "measure_by"] } },
      capital_allocation: { type: "array", maxItems: 2, items: { type: "object", properties: { recommendation: { type: "string" }, amount_inr: { type: ["number", "null"] }, why: { type: "string" } }, required: ["recommendation", "why"] } },
      directives: { type: "array", maxItems: 4, items: { type: "object", properties: { to_agent: { type: "string" }, task: { type: "string" } }, required: ["to_agent", "task"] } },
      lessons_learned: { type: "string", description: "What this cycle learned that future cycles should remember. Persisted to Enterprise Knowledge Network." },
      founder_briefing: { type: "string" },
    },
    required: ["situation_assessment", "predictions", "directives", "founder_briefing"],
  },
};

Deno.serve(async (req: Request) => {
  const started = Date.now();
  const url = new URL(req.url);
  if (url.searchParams.get("secret") !== SHARED_SECRET) return j({ error: "unauthorized" }, 401);

  try {
    const [milestones, leadsByStage, pendingApprovals, projects, trust, kpis, delegations, duePredictions, memory, board, execCommittee, orgUnits] = await Promise.all([
      q("select year, quarter, target_inr, actual_inr, status, owning_department from company_revenue_milestones order by year, quarter"),
      q("select stage, count(*) as n from leads group by stage order by n desc"),
      q("select action_type, risk_level, amount_inr, reason from approvals where status='pending' order by created_at desc limit 15"),
      q("select client_name, title, status, deadline, contract_value_inr from client_projects where status not in ('closed','lost') order by deadline nulls last limit 15"),
      q("select trust_level, count(*) as n from agent_intelligence_profiles group by trust_level"),
      q("select distinct on (kpi) kpi, value from governance_kpis order by kpi, measured_at desc"),
      q("select to_agent, task_description, status from agent_task_delegations where status in ('pending','in_progress') order by created_at desc limit 15"),
      q("select id, metric, expected_value, measure_by from executive_predictions where actual_value is null and measure_by <= current_date + 3"),
      q("select title, content, memory_type, created_at from v_enterprise_knowledge limit 10"),
      q("select seat, holder_type, holder_name, authority from board_of_directors where active"),
      q("select role, holder_agent, scope, measurable_objective from executive_committee where active"),
      q("select c.name as company, u.unit_name, u.unit_type from org_units u join companies c on c.id = u.company_id where u.active limit 40"),
    ]);
    const observed = { organizational_memory: memory, org_structure: { board, executive_committee: execCommittee, org_units: orgUnits }, milestones, leadsByStage, pendingApprovals, projects, agent_trust: trust, latest_kpis: kpis, open_delegations: delegations, predictions_due: duePredictions, observed_at: new Date().toISOString() };

    const { data: fil } = await supabase.from("founder_identity").select("content").eq("active", true).order("version", { ascending: false }).limit(1).maybeSingle();
    const { data: principles } = await supabase.from("founder_principles").select("principle").eq("active", true).order("weight", { ascending: false });

    const system = `You are the Executive Intelligence Layer of FKAIOS — the standing executive leadership of the Bhavishya Associates Artificial Enterprise (holding: Bhavishya Associates; subsidiaries: Franchise Kart, Aura Tech, Rajyog Infra), above Governance and below the Founder (Chairman/MD — he observes, reviews, approves; you run the group). You govern through a FORMAL ORG STRUCTURE in the observed state (Board, Executive Committee — address directives to its holder agents by exact agent name — and org units). CRITICAL: the observed state now includes organizational_memory — the accumulated knowledge of prior cycles. USE IT: build on prior lessons, do not repeat solved analysis, note when you are revisiting a prior theme. Reason like a group executive: per-subsidiary and group-wide, hold Executive Committee members to their measurable objectives, escalate to the Chairman only what needs his eyes. You act ONLY through constitutional channels: directives, staged capital (never execute money), measurable predictions, a Chairman briefing, and lessons_learned (persisted to organizational memory so the enterprise compounds intelligence). Never invent data — reason strictly from observed state; where data is thin or malformed, say so and direct an agent to fix or gather it.\n\nFOUNDER IDENTITY: ${String(fil?.content ?? "").slice(0, 3500)}\n\nPRINCIPLES:\n${(principles ?? []).map((p: any) => `- ${p.principle}`).join("\n").slice(0, 4000)}\n\nEvery prediction must be measurable from the database by its date. founder_briefing is a tight Chairman briefing in his direct Hinglish-friendly style. Output ONLY via emit_cycle.`;

    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
      body: JSON.stringify({ model: "claude-sonnet-5", max_tokens: 6000, system, tools: [CYCLE_TOOL], tool_choice: { type: "tool", name: "emit_cycle" }, messages: [{ role: "user", content: `OBSERVED STATE (real, current):\n${JSON.stringify(observed).slice(0, 13000)}\n\nRun one executive cognition cycle now. Build on organizational_memory.` }] }),
    });
    if (!resp.ok) return j({ error: `Executive LLM failed: ${resp.status} ${await resp.text()}` }, 502);
    const data = await resp.json();
    const toolBlock = Array.isArray(data?.content) ? data.content.find((b: any) => b?.type === "tool_use" && b?.name === "emit_cycle") : null;
    if (!toolBlock?.input) return j({ error: "No emit_cycle output; no actions taken", stop_reason: data?.stop_reason }, 502);
    const exec: any = toolBlock.input;

    const directives = Array.isArray(exec.directives) ? exec.directives.slice(0, 4) : [];
    for (const d of directives) {
      await supabase.from("agent_task_delegations").insert({ from_agent: "executive-intelligence", to_agent: String(d.to_agent ?? "unassigned"), task_description: String(d.task ?? ""), requires_founder_approval: false });
    }
    const capital = Array.isArray(exec.capital_allocation) ? exec.capital_allocation.slice(0, 2) : [];
    for (const c of capital) {
      if (c && (c.amount_inr ?? null) !== null) {
        await supabase.from("approvals").insert({ action_type: "executive_capital_allocation", risk_level: "high", amount_inr: Number(c.amount_inr), reason: `${c.recommendation}: ${c.why}`.slice(0, 900), status: "pending", department_code: "FOUNDER", payload: { source: "executive-intelligence" } });
      }
    }

    const { data: cycle, error: cErr } = await supabase.from("executive_cycles").insert({
      observed_state: observed, situation_assessment: String(exec.situation_assessment ?? ""),
      opportunities: exec.opportunities ?? [], risks: exec.risks ?? [], capital_allocation: capital, directives_issued: directives,
      predictions_made: Array.isArray(exec.predictions) ? Math.min(exec.predictions.length, 3) : 0,
      founder_briefing: String(exec.founder_briefing ?? ""), model_used: "claude-sonnet-5", latency_ms: Date.now() - started,
    }).select("id, cycle_number").single();
    if (cErr) return j({ error: `Cycle insert failed: ${cErr.message}` }, 500);

    const preds = Array.isArray(exec.predictions) ? exec.predictions.slice(0, 3) : [];
    for (const p of preds) {
      await supabase.from("executive_predictions").insert({ cycle_id: cycle.id, metric: String(p.metric ?? ""), expected_value: String(p.expected_value ?? ""), basis: String(p.basis ?? ""), measure_by: String(p.measure_by ?? new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10)) });
    }

    // CLOSE THE LOOP: deposit this cycle's knowledge into Enterprise Knowledge Network
    const memoryWrites: Promise<unknown>[] = [];
    memoryWrites.push(supabase.rpc("record_enterprise_memory", { p_source_department: "executive", p_memory_type: "cycle_assessment", p_title: `Cycle ${cycle.cycle_number} situation assessment`, p_content: String(exec.situation_assessment ?? "").slice(0, 2000), p_structured: { cycle: cycle.cycle_number }, p_confidence: 0.8, p_visible_departments: ["*"] }));
    if (exec.lessons_learned) memoryWrites.push(supabase.rpc("record_enterprise_memory", { p_source_department: "executive", p_memory_type: "lesson", p_title: `Cycle ${cycle.cycle_number} lesson`, p_content: String(exec.lessons_learned).slice(0, 2000), p_structured: { cycle: cycle.cycle_number }, p_confidence: 0.85, p_visible_departments: ["*"] }));
    const topOpp = (exec.opportunities ?? [])[0];
    if (topOpp) memoryWrites.push(supabase.rpc("record_enterprise_memory", { p_source_department: topOpp.owner_department ?? "executive", p_memory_type: "opportunity", p_title: String(topOpp.title).slice(0, 200), p_content: String(topOpp.rationale ?? "").slice(0, 2000), p_structured: { cycle: cycle.cycle_number }, p_confidence: 0.7, p_visible_departments: ["*"] }));
    const topRisk = (exec.risks ?? [])[0];
    if (topRisk) memoryWrites.push(supabase.rpc("record_enterprise_memory", { p_source_department: "risk", p_memory_type: "risk", p_title: String(topRisk.risk).slice(0, 200), p_content: `Severity ${topRisk.severity}. Mitigation: ${topRisk.mitigation ?? "none stated"}`.slice(0, 2000), p_structured: { cycle: cycle.cycle_number, severity: topRisk.severity }, p_confidence: 0.7, p_visible_departments: ["*"] }));
    await Promise.all(memoryWrites);

    await supabase.from("audit_logs").insert({ action: "executive:cognition_cycle", resource_type: "executive_cycle", actor_type: "agent", decision_reasoning: `Cycle ${cycle.cycle_number}: ${directives.length} directives, ${capital.length} capital staged, ${preds.length} predictions, ${memoryWrites.length} memories recorded to Enterprise Knowledge Network.`, requires_human_review: capital.length > 0, metadata: { cycle_id: cycle.id } });
    await supabase.from("agent_performance_metrics").insert({ agent_id: "executive-intelligence", task_type: "cognition_cycle", latency_ms: Date.now() - started, input_tokens: data?.usage?.input_tokens ?? null, output_tokens: data?.usage?.output_tokens ?? null, success: true });

    return j({ success: true, cycle_id: cycle.id, cycle_number: cycle.cycle_number, directives: directives.length, capital_staged: capital.length, predictions: preds.length, memories_recorded: memoryWrites.length, founder_briefing: exec.founder_briefing });
  } catch (err) {
    await supabase.from("agent_performance_metrics").insert({ agent_id: "executive-intelligence", task_type: "cognition_cycle", latency_ms: Date.now() - started, success: false, error_message: String(err) });
    return j({ error: String(err) }, 500);
  }
});
