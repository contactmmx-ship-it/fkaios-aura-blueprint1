// governance-dashboard v5 -> Chairman's Command Center data source.
// v5 adds (Blueprint P1.2/P1.3 — exposure of EXISTING data, no new backend):
//   revenue          : real money from company_invoices (honestly 0 today).
//   alerts           : open Silence Monitor alerts from founder_notifications.
//   department_status: GO / NO-GO / UNSTAFFED per department, computed from real
//                      agent output in the last 24h. NASA Mission Control rule:
//                      nominal is silent, silence is never consent -> a staffed
//                      department producing nothing reports NO-GO.
// v4 EXPOSES existing event streams as a LIVING enterprise (no new backend):
//   activity_stream : agent_dispatch_log (agent-attributed) + execution_log
//                     (engine-attributed), normalized + time-ordered.
//   collaboration   : agent_task_delegations (from -> to -> task -> status).
//   workforce[].recent_actions : last real dispatches per employee.
// All v1/v2/v3 keys preserved. verify_jwt kept. Zero mocked values.
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const supabase = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "", { auth: { autoRefreshToken: false, persistSession: false } });
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization" };
const j = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

function summarize(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v.slice(0, 140);
  try {
    const o = typeof v === "object" ? v as Record<string, unknown> : {};
    if (typeof o.summary === "string") return o.summary.slice(0, 140);
    if (typeof o.message === "string") return o.message.slice(0, 140);
    if (typeof o.result === "string") return o.result.slice(0, 140);
    return JSON.stringify(v).slice(0, 120);
  } catch { return String(v).slice(0, 120); }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: cors });
  try {
    const [summary, laws, decisions, profiles, kpiHistory, kpiLatest, cycles, predictions, auditTimeline, violations, approvalQueue,
           board, execCommittee, orgUnits, companies, market, competitors, knowledgeGrowth, delegations,
           agentsFull, workdays, departments, dispatches, execLog, invoicesQ, silenceQ] = await Promise.all([
      supabase.from("v_governance_dashboard_summary").select("*").single(),
      supabase.from("engineering_constitution").select("law_number,name,active").order("law_number"),
      supabase.from("governed_decisions").select("id,domain,proposing_agent,title,status,review_verdict,created_at,updated_at").order("updated_at", { ascending: false }).limit(25),
      supabase.from("agent_intelligence_profiles").select("agent_name,role,trust_level,governance_score,success_rate,total_decisions,learning_progress,collaboration_quality").order("governance_score", { ascending: false }),
      supabase.from("governance_kpis").select("kpi,value,measured_at").order("measured_at", { ascending: true }).limit(400),
      supabase.from("governance_kpis").select("kpi,value,evidence,measured_at").order("measured_at", { ascending: false }).limit(40),
      supabase.from("executive_cycles").select("cycle_number,situation_assessment,opportunities,risks,capital_allocation,directives_issued,predictions_made,founder_briefing,latency_ms,created_at").order("created_at", { ascending: false }).limit(5),
      supabase.from("executive_predictions").select("metric,expected_value,measure_by,actual_value,was_correct,created_at").order("created_at", { ascending: false }).limit(20),
      supabase.from("audit_logs").select("action,resource_type,actor_type,decision_reasoning,requires_human_review,created_at").order("created_at", { ascending: false }).limit(40),
      supabase.from("v_constitution_violations").select("*").order("created_at", { ascending: false }).limit(25),
      supabase.from("approvals").select("action_type,risk_level,amount_inr,reason,created_at").eq("status", "pending").order("created_at", { ascending: false }).limit(15),
      supabase.from("board_of_directors").select("seat,holder_type,holder_name,authority,accountability,active").eq("active", true),
      supabase.from("executive_committee").select("role,holder_agent,scope,measurable_objective,reports_to,active").eq("active", true),
      supabase.from("org_units").select("unit_name,unit_type,company_id").eq("active", true),
      supabase.from("companies").select("id,name,company_type,parent_company_id,sector,status"),
      supabase.from("market_intelligence").select("signal_type,industry,headline,detail,source_url,confidence,relevance_to_founder_vision,captured_at").order("captured_at", { ascending: false }).limit(15),
      supabase.from("competitor_intelligence").select("competitor_name,category,observation,implication_for_us,source_url,confidence,captured_at").order("captured_at", { ascending: false }).limit(15),
      supabase.from("fleet_memory").select("created_at").order("created_at", { ascending: true }).limit(500),
      supabase.from("agent_task_delegations").select("from_agent,to_agent,task_description,context,status,result,requires_founder_approval,created_at").order("created_at", { ascending: false }).limit(30),
      supabase.from("ai_agents").select("id,name,department,dept,status,is_active,autonomy_level,success_rate,total_tasks_completed,last_active_at,company_id,tools,escalation_rule").order("name"),
      supabase.from("agent_workday").select("agent_id,work_date,status,morning_plan,midday_update,midday_on_track,evening_summary,self_rating,tasks_planned,tasks_completed,real_activity_count").order("work_date", { ascending: false }).limit(400),
      supabase.from("departments").select("code,name,company_id,automation_level").eq("is_active", true),
      supabase.from("agent_dispatch_log").select("agent_id,action,status,output_data,created_at").order("created_at", { ascending: false }).limit(300),
      supabase.from("execution_log").select("function_name,department_code,action,output_summary,status,created_at").order("created_at", { ascending: false }).limit(40),
      supabase.from("company_invoices").select("total_inr,amount_received_inr,status,created_at"),
      supabase.from("founder_notifications").select("type,title,detail,department_code,created_at").eq("type", "silence").eq("is_read", false).order("created_at", { ascending: false }).limit(10),
    ]);

    const { data: autonomy } = await supabase.from("ai_agents").select("name,autonomy_level,department,company_id").order("autonomy_level", { ascending: false }).limit(80);

    const latestKpi: Record<string, { value: number; evidence: unknown; measured_at: string }> = {};
    for (const row of kpiLatest.data ?? []) if (!latestKpi[row.kpi]) latestKpi[row.kpi] = { value: Number(row.value), evidence: row.evidence, measured_at: row.measured_at };

    const deptActivity: Record<string, { total: number; pending: number }> = {};
    for (const d of delegations.data ?? []) {
      const k = d.to_agent ?? "unassigned";
      deptActivity[k] = deptActivity[k] || { total: 0, pending: 0 };
      deptActivity[k].total++;
      if (d.status === "pending" || d.status === "in_progress") deptActivity[k].pending++;
    }

    const growthByDay: Record<string, number> = {};
    for (const m of knowledgeGrowth.data ?? []) { const day = String(m.created_at).slice(0, 10); growthByDay[day] = (growthByDay[day] || 0) + 1; }
    let cum = 0; const knowledgeCurve = Object.keys(growthByDay).sort().map(day => { cum += growthByDay[day]; return { day, cumulative: cum }; });

    const companyName: Record<string, string> = {};
    for (const c of companies.data ?? []) companyName[c.id] = c.name;
    const agentNameById: Record<string, string> = {};
    for (const a of agentsFull.data ?? []) agentNameById[a.id] = a.name;

    const recentByAgent: Record<string, { action: string; status: string; outcome: string; created_at: string }[]> = {};
    for (const d of dispatches.data ?? []) {
      if (!d.agent_id) continue;
      (recentByAgent[d.agent_id] = recentByAgent[d.agent_id] || []);
      if (recentByAgent[d.agent_id].length < 5) recentByAgent[d.agent_id].push({ action: d.action, status: d.status, outcome: summarize(d.output_data), created_at: d.created_at });
    }

    const profileByName: Record<string, any> = {};
    for (const p of profiles.data ?? []) profileByName[p.agent_name] = p;
    const latestWorkday: Record<string, any> = {};
    for (const w of workdays.data ?? []) if (!latestWorkday[w.agent_id]) latestWorkday[w.agent_id] = w;

    const workforce = (agentsFull.data ?? []).map((a: any) => {
      const p = profileByName[a.name] || {};
      const w = latestWorkday[a.id] || {};
      const planned = Number(w.tasks_planned || 0);
      const done = Number(w.tasks_completed || 0);
      return {
        name: a.name, role: p.role || null, department: a.department || a.dept || null,
        company: a.company_id ? (companyName[a.company_id] || null) : null,
        status: a.status || "unknown", is_active: a.is_active ?? true, autonomy_level: a.autonomy_level ?? null,
        trust_level: p.trust_level || null, governance_score: p.governance_score ?? null,
        collaboration_quality: p.collaboration_quality ?? null, learning_progress: p.learning_progress || null,
        total_decisions: p.total_decisions ?? null, success_rate: (p.success_rate ?? a.success_rate) ?? null,
        total_tasks_completed: a.total_tasks_completed ?? null, last_active_at: a.last_active_at || null,
        tools: Array.isArray(a.tools) ? a.tools : [], escalation_rule: a.escalation_rule || null,
        work_date: w.work_date || null, workday_status: w.status || null,
        current_objective: w.morning_plan || null, midday_update: w.midday_update || null,
        midday_on_track: w.midday_on_track ?? null, previous_task: w.evening_summary || null,
        self_rating: w.self_rating ?? null, tasks_planned: planned, tasks_completed: done,
        pending_tasks: Math.max(0, planned - done), real_activity_count: Number(w.real_activity_count || 0),
        recent_actions: recentByAgent[a.id] || [],
      };
    });

    const deptRoster: Record<string, string[]> = {};
    for (const a of agentsFull.data ?? []) {
      const dcode = a.department || a.dept || "UNASSIGNED";
      (deptRoster[dcode] = deptRoster[dcode] || []).push(a.name);
    }

    const stream: { ts: string; actor: string; actor_type: string; action: string; outcome: string; status: string }[] = [];
    for (const d of (dispatches.data ?? []).slice(0, 40)) {
      stream.push({ ts: d.created_at, actor: agentNameById[d.agent_id] || "Agent", actor_type: "agent", action: d.action, outcome: summarize(d.output_data), status: d.status });
    }
    for (const e of execLog.data ?? []) {
      stream.push({ ts: e.created_at, actor: e.function_name || e.department_code || "engine", actor_type: "engine", action: e.action, outcome: summarize(e.output_summary), status: e.status });
    }
    stream.sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime());
    const activity_stream = stream.slice(0, 60);

    // ---- REVENUE (real; zero is reported truthfully, never hidden) ----
    const inv = invoicesQ.data ?? [];
    const revenue = {
      invoices_total: inv.length,
      invoiced_inr: inv.reduce((s: number, i: any) => s + Number(i.total_inr || 0), 0),
      received_inr: inv.reduce((s: number, i: any) => s + Number(i.amount_received_inr || 0), 0),
      paid_invoices: inv.filter((i: any) => Number(i.amount_received_inr || 0) > 0).length,
    };

    // ---- GO / NO-GO CONSOLES (Mission Control: silence is never consent) ----
    const dayAgo = Date.now() - 24 * 3600 * 1000;
    const outputByAgentId: Record<string, number> = {};
    for (const d of dispatches.data ?? []) {
      if (!d.agent_id) continue;
      if (new Date(d.created_at).getTime() > dayAgo && (d.status === "completed" || d.status === "success")) {
        outputByAgentId[d.agent_id] = (outputByAgentId[d.agent_id] || 0) + 1;
      }
    }
    const deptOfAgent: Record<string, string> = {};
    for (const a of agentsFull.data ?? []) deptOfAgent[a.id] = a.department || a.dept || "UNASSIGNED";

    const deptAgents: Record<string, { staffed: number; output: number }> = {};
    for (const a of agentsFull.data ?? []) {
      const code = deptOfAgent[a.id];
      deptAgents[code] = deptAgents[code] || { staffed: 0, output: 0 };
      deptAgents[code].staffed++;
      deptAgents[code].output += outputByAgentId[a.id] || 0;
    }
    const department_status = (departments.data ?? []).map((d: any) => {
      const s2 = deptAgents[d.code] || { staffed: 0, output: 0 };
      const status = s2.staffed === 0 ? "UNSTAFFED" : s2.output > 0 ? "GO" : "NO_GO";
      return {
        code: d.code, name: d.name, staffed: s2.staffed, output_24h: s2.output, status,
        reason: status === "GO" ? `${s2.output} real outcomes in 24h`
              : status === "NO_GO" ? `${s2.staffed} agent(s) assigned, 0 outcomes in 24h — reporting NO-GO`
              : "no agents assigned",
      };
    }).sort((a: any, b: any) => (a.status === "NO_GO" ? -1 : 1) - (b.status === "NO_GO" ? -1 : 1));

    const alerts = (silenceQ.data ?? []).map((n: any) => ({
      title: n.title, detail: n.detail, department: n.department_code, created_at: n.created_at,
    }));

    const collaboration = (delegations.data ?? []).map((d: any) => ({
      from_agent: d.from_agent, to_agent: d.to_agent, task: d.task_description,
      status: d.status, requires_founder_approval: d.requires_founder_approval, created_at: d.created_at,
    }));

    return j({
      generated_at: new Date().toISOString(),
      summary: summary.data ?? null,
      constitution: { laws: laws.data ?? [], active: (laws.data ?? []).filter((l: any) => l.active).length, total: (laws.data ?? []).length },
      decisions: decisions.data ?? [], agent_profiles: profiles.data ?? [], agent_autonomy: autonomy ?? [],
      kpi_latest: latestKpi, kpi_history: kpiHistory.data ?? [], executive_cycles: cycles.data ?? [],
      executive_predictions: predictions.data ?? [], audit_timeline: auditTimeline.data ?? [],
      violations: violations.data ?? [], approval_queue: approvalQueue.data ?? [],
      board: board.data ?? [], executive_committee: execCommittee.data ?? [],
      org_units: (orgUnits.data ?? []).map((u: any) => ({ ...u, company: companyName[u.company_id] ?? "group" })),
      subsidiaries: companies.data ?? [], market_intelligence: market.data ?? [], competitor_intelligence: competitors.data ?? [],
      knowledge_curve: knowledgeCurve, knowledge_total: (knowledgeGrowth.data ?? []).length,
      department_activity: Object.entries(deptActivity).map(([dept, v]) => ({ dept, ...v })).sort((a, b) => b.total - a.total),
      recent_activity: delegations.data ?? [],
      workforce,
      departments: (departments.data ?? []).map((d: any) => ({ ...d, company: d.company_id ? (companyName[d.company_id] || null) : null, agent_count: (deptRoster[d.code] || []).length })),
      dept_roster: deptRoster,
      activity_stream,
      collaboration,
      revenue,
      department_status,
      alerts,
    });
  } catch (err) {
    return j({ error: String(err) }, 500);
  }
});
