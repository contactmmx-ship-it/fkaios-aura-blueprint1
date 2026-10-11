/// <reference lib="deno.ns" />
// governance-dashboard v6 -> Chairman's Command Center data source.
// v6 adds (World Class Enterprise Constitution — "1100 Crore Progress Engine"):
//   mission : public.compute_mission_progress() — the single answer to
//             "How close are we to Rs 1,100 Cr today?" Real money received vs
//             the SUBSIDIARY target sum (the holding row is a ROLLUP of the
//             three subsidiaries; a naive SUM would double-count to Rs 2,200 Cr).
//             Reports required daily/weekly/monthly run-rate, and an honest
//             forecast of NEVER while the run-rate is Rs 0/month.
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
           agentsFull, workdays, departments, dispatches, execLog, invoicesQ, silenceQ, leadsQ] = await Promise.all([
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
      supabase.from("agent_task_delegations").select("from_agent,to_agent,task_description,context,status,result,requires_founder_approval,created_at").order("requires_founder_approval", { ascending: false }).order("created_at", { ascending: false }).limit(100),
      supabase.from("ai_agents").select("id,name,department,dept,status,is_active,autonomy_level,success_rate,total_tasks_completed,last_active_at,company_id,tools,escalation_rule").order("name"),
      supabase.from("agent_workday").select("agent_id,work_date,status,morning_plan,midday_update,midday_on_track,evening_summary,self_rating,tasks_planned,tasks_completed,real_activity_count").order("work_date", { ascending: false }).limit(400),
      supabase.from("departments").select("code,name,company_id,automation_level").eq("is_active", true),
      supabase.from("agent_dispatch_log").select("agent_id,action,status,output_data,created_at").order("created_at", { ascending: false }).limit(300),
      supabase.from("execution_log").select("function_name,department_code,action,output_summary,status,created_at").order("created_at", { ascending: false }).limit(40),
      supabase.from("company_invoices").select("total_inr,amount_received_inr,status,created_at"),
      supabase.from("founder_notifications").select("type,title,detail,department_code,created_at").eq("type", "silence").eq("is_read", false).order("created_at", { ascending: false }).limit(100),
      supabase.from("leads").select("stage,lead_score,created_at,contact_phone,contact_email").eq("is_active", true).limit(1000),
    ]);
    if (leadsQ.error) throw new Error("Could not read active lead rows for Command Center truth: " + leadsQ.error.message);

    const { data: autonomy } = await supabase.from("ai_agents").select("name,autonomy_level,department,company_id").order("autonomy_level", { ascending: false }).limit(80);

    // 1100 Crore Progress Engine. Computed server-side in SQL so the mission
    // number can never drift from the money. Failure is surfaced, not hidden.
    const { data: missionData, error: missionErr } = await supabase.rpc("compute_mission_progress");
    const mission = missionErr ? { error: missionErr.message } : missionData;

    // FKAIOS Phase 0 Task 2 ("kill the fake workforce illusion"): ai_agents.is_active/
    // status/last_active_at are unconditionally fabricated (always true/active).
    // compute_workforce_truth() grades every agent from completed ai_jobs /
    // reconciled lifetime task evidence into PRODUCING/DORMANT/NAMEPLATE/BURNING —
    // that verdict, not the fake columns, is what workforce[].is_active must reflect.
    const { data: workforceTruthData, error: workforceTruthErr } = await supabase.rpc("compute_workforce_truth");
    const workforceTruth = workforceTruthErr ? null : workforceTruthData;

    // Exact counts are separate from the bounded activity feed below. The feed
    // is deliberately capped for payload size and must never be used as a total.
    const since24h = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const [dispatchTotalQ, execTotalQ, dispatchDiscoverQ, execDiscoverQ,
      dispatchQualifyQ, execQualifyQ, dispatchFailQ, execFailQ] = await Promise.all([
      supabase.from("agent_dispatch_log").select("id", { count: "exact", head: true }).gte("created_at", since24h),
      supabase.from("execution_log").select("id", { count: "exact", head: true }).gte("created_at", since24h),
      supabase.from("agent_dispatch_log").select("id", { count: "exact", head: true }).gte("created_at", since24h).or("action.ilike.%hunt%,action.ilike.%discover%"),
      supabase.from("execution_log").select("id", { count: "exact", head: true }).gte("created_at", since24h).or("action.ilike.%hunt%,action.ilike.%discover%,function_name.ilike.%hunt%,function_name.ilike.%discover%"),
      supabase.from("agent_dispatch_log").select("id", { count: "exact", head: true }).gte("created_at", since24h).ilike("action", "%qualify%"),
      supabase.from("execution_log").select("id", { count: "exact", head: true }).gte("created_at", since24h).or("action.ilike.%qualify%,function_name.ilike.%qualify%"),
      supabase.from("agent_dispatch_log").select("id", { count: "exact", head: true }).gte("created_at", since24h).in("status", ["failed", "error"]),
      supabase.from("execution_log").select("id", { count: "exact", head: true }).gte("created_at", since24h).in("status", ["failed", "error"]),
    ]);
    const activityCountErrors = [dispatchTotalQ, execTotalQ, dispatchDiscoverQ, execDiscoverQ,
      dispatchQualifyQ, execQualifyQ, dispatchFailQ, execFailQ].filter((q) => q.error);
    if (activityCountErrors.length) {
      throw new Error("Exact Command Center activity counts unavailable: " +
        activityCountErrors.map((q) => q.error?.message).join("; "));
    }
    const since48h = new Date(Date.now() - 48 * 3600 * 1000).toISOString();
    const [pendingApprovalCountQ, agedApprovalCountQ, gatedDelegationCountQ, agedGatedDelegationCountQ] = await Promise.all([
      supabase.from("approvals").select("id", { count: "exact", head: true }).eq("status", "pending"),
      supabase.from("approvals").select("id", { count: "exact", head: true }).eq("status", "pending").lt("created_at", since48h),
      supabase.from("agent_task_delegations").select("id", { count: "exact", head: true }).eq("requires_founder_approval", true).not("status", "in", '("completed","rejected","cancelled")'),
      supabase.from("agent_task_delegations").select("id", { count: "exact", head: true }).eq("requires_founder_approval", true).not("status", "in", '("completed","rejected","cancelled")').lt("created_at", since48h),
    ]);
    const approvalCountErrors = [pendingApprovalCountQ, agedApprovalCountQ, gatedDelegationCountQ, agedGatedDelegationCountQ].filter((q) => q.error);
    if (approvalCountErrors.length) {
      throw new Error("Exact Command Center approval counts unavailable: " +
        approvalCountErrors.map((q) => q.error?.message).join("; "));
    }
    const approvalTotals = {
      approval_records_pending: pendingApprovalCountQ.count ?? 0,
      approval_records_aged_48h: agedApprovalCountQ.count ?? 0,
      gated_delegations_pending: gatedDelegationCountQ.count ?? 0,
      gated_delegations_aged_48h: agedGatedDelegationCountQ.count ?? 0,
    };
    const leadRows = leadsQ.data ?? [];
    const leadTotals = {
      active: leadRows.length,
      new: leadRows.filter((l: any) => l.stage === "new").length,
      new_aged_48h: leadRows.filter((l: any) => l.stage === "new" && String(l.created_at) < since48h).length,
      qualified_40_plus: leadRows.filter((l: any) => Number(l.lead_score ?? 0) >= 40).length,
      scored: leadRows.filter((l: any) => l.lead_score !== null && l.lead_score !== undefined).length,
      advanced: leadRows.filter((l: any) => l.stage !== "new").length,
      contactable: leadRows.filter((l: any) => Boolean(l.contact_phone || l.contact_email)).length,
    };
    const activityTotals24h = {
      total: (dispatchTotalQ.count ?? 0) + (execTotalQ.count ?? 0),
      discovered: (dispatchDiscoverQ.count ?? 0) + (execDiscoverQ.count ?? 0),
      qualified: (dispatchQualifyQ.count ?? 0) + (execQualifyQ.count ?? 0),
      failures: (dispatchFailQ.count ?? 0) + (execFailQ.count ?? 0),
      dispatch_events: dispatchTotalQ.count ?? 0,
      execution_events: execTotalQ.count ?? 0,
    };
    const verdictByName: Record<string, string> = {};
    for (const e of (workforceTruth?.employees ?? [])) verdictByName[e.name] = e.verdict;

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
        status: a.status || "unknown",
        is_active: verdictByName[a.name] === "PRODUCING",
        verdict: verdictByName[a.name] || null,
        autonomy_level: a.autonomy_level ?? null,
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
    // Department production uses the same verified ai_jobs evidence as
    // compute_workforce_truth(), not agent_dispatch_log, which records dispatch
    // rather than completed execution in this pipeline.
    const outputByAgentName: Record<string, number> = {};
    for (const e of (workforceTruth?.employees ?? [])) {
      outputByAgentName[e.name] = Number(e.output_24h || 0);
    }
    const deptOfAgent: Record<string, string> = {};
    for (const a of agentsFull.data ?? []) deptOfAgent[a.id] = a.department || a.dept || "UNASSIGNED";

    const deptAgents: Record<string, { staffed: number; output: number }> = {};
    for (const a of agentsFull.data ?? []) {
      const code = deptOfAgent[a.id];
      deptAgents[code] = deptAgents[code] || { staffed: 0, output: 0 };
      deptAgents[code].staffed++;
      deptAgents[code].output += outputByAgentName[a.name] || 0;
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

    // Notifications are historical events, not live truth. Deduplicate repeated
    // silence alerts by title and refresh the details that can be grounded in the
    // current source rows. Preserve other alert types with their last-observed time.
    const latestSilenceByTitle = new Map<string, any>();
    for (const n of silenceQ.data ?? []) {
      if (!latestSilenceByTitle.has(n.title)) latestSilenceByTitle.set(n.title, n);
    }
    const liveAlertDetail: Record<string, string> = {
      "Approvals aging": approvalTotals.approval_records_aged_48h + " approval records and " +
        approvalTotals.gated_delegations_aged_48h + " founder-gated delegations are older than 48h. These are separate queues; inspect source rows before treating them as distinct decisions.",
      "Leads stalled in New": leadTotals.new_aged_48h + " active leads remain in stage=new for more than 48h (of " + leadTotals.active + " active leads).",
      "Zero conversion": leadTotals.active + " active leads: " + leadTotals.scored + " have stored scores, " +
        leadTotals.qualified_40_plus + " score >= 40, and " + leadTotals.advanced +
        " have advanced beyond stage=new. Qualification score and stage transition are separate checks.",
      "Invoices never paid": revenue.invoices_total + " invoices totalling ₹" +
        Number(revenue.invoiced_inr).toLocaleString("en-IN") + "; ₹" +
        Number(revenue.received_inr).toLocaleString("en-IN") + " received across " +
        revenue.paid_invoices + " invoices with money received.",
      "Qualifier producing nothing": activityTotals24h.qualified === 0
        ? "No qualification invocation was recorded in the last 24h in the activity logs. The current lead table has " +
          leadTotals.qualified_40_plus + " scores >= 40 and " + leadTotals.advanced +
          " leads advanced beyond stage=new; this alert's old invocation/score count is not current evidence."
        : activityTotals24h.qualified + " qualification-related activity events were recorded in the last 24h. Current lead table: " +
          leadTotals.qualified_40_plus + " scores >= 40, " + leadTotals.advanced + " advanced beyond stage=new.",
    };
    const alerts = Array.from(latestSilenceByTitle.values()).map((n: any) => ({
      title: n.title === "Qualifier producing nothing" ? "Lead qualification status" : n.title,
      detail: liveAlertDetail[n.title] ?? n.detail,
      department: n.department_code,
      created_at: n.created_at,
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
      activity_totals_24h: activityTotals24h,
      approval_totals: approvalTotals,
      lead_totals: leadTotals,
      collaboration,
      revenue,
      department_status,
      alerts,
      mission,
    });
  } catch (err) {
    return j({ error: String(err) }, 500);
  }
});
