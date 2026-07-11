// governance-dashboard v3 -> Chairman's Command Center data source.
// v3 ADDS the living "workforce" layer (per-AI-employee: current objective,
// status, trust, autonomy, KPI, reasoning summary, pending work) by joining
// ai_agents + agent_intelligence_profiles (by name) + latest agent_workday
// (by id) server-side with the service role. All v1/v2 keys preserved.
// Zero mocked values — empty datasets surface as empty arrays / nulls.

import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const supabase = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "", { auth: { autoRefreshToken: false, persistSession: false } });
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization" };
const j = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: cors });
  try {
    const [summary, laws, decisions, profiles, kpiHistory, kpiLatest, cycles, predictions, auditTimeline, violations, approvalQueue,
           board, execCommittee, orgUnits, companies, market, competitors, knowledgeGrowth, delegations,
           agentsFull, workdays, departments] = await Promise.all([
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
      supabase.from("agent_task_delegations").select("from_agent,to_agent,task_description,status,created_at").order("created_at", { ascending: false }).limit(30),
      supabase.from("ai_agents").select("id,name,department,dept,status,is_active,autonomy_level,success_rate,total_tasks_completed,last_active_at,company_id").order("name"),
      supabase.from("agent_workday").select("agent_id,work_date,status,morning_plan,midday_update,midday_on_track,self_rating,tasks_planned,tasks_completed,real_activity_count").order("work_date", { ascending: false }).limit(400),
      supabase.from("departments").select("code,name,company_id,automation_level").eq("is_active", true),
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

    // --- LIVING AI WORKFORCE (v3) -------------------------------------------
    // profile by exact name match; latest workday by agent id.
    const profileByName: Record<string, any> = {};
    for (const p of profiles.data ?? []) profileByName[p.agent_name] = p;
    const latestWorkday: Record<string, any> = {};
    for (const w of workdays.data ?? []) if (!latestWorkday[w.agent_id]) latestWorkday[w.agent_id] = w; // first = most recent (ordered desc)

    const workforce = (agentsFull.data ?? []).map((a: any) => {
      const p = profileByName[a.name] || {};
      const w = latestWorkday[a.id] || {};
      const planned = Number(w.tasks_planned || 0);
      const done = Number(w.tasks_completed || 0);
      return {
        name: a.name,
        role: p.role || null,
        department: a.department || a.dept || null,
        company: a.company_id ? (companyName[a.company_id] || null) : null,
        status: a.status || "unknown",
        is_active: a.is_active ?? true,
        autonomy_level: a.autonomy_level ?? null,
        trust_level: p.trust_level || null,
        governance_score: p.governance_score ?? null,
        collaboration_quality: p.collaboration_quality ?? null,
        learning_progress: p.learning_progress || null,
        total_decisions: p.total_decisions ?? null,
        success_rate: (p.success_rate ?? a.success_rate) ?? null,
        total_tasks_completed: a.total_tasks_completed ?? null,
        last_active_at: a.last_active_at || null,
        // today's living state
        work_date: w.work_date || null,
        workday_status: w.status || null,
        current_objective: w.morning_plan || null,
        midday_update: w.midday_update || null,
        midday_on_track: w.midday_on_track ?? null,
        self_rating: w.self_rating ?? null,
        tasks_planned: planned,
        tasks_completed: done,
        pending_tasks: Math.max(0, planned - done),
        real_activity_count: Number(w.real_activity_count || 0),
      };
    });

    // department roster: agents grouped under each department for the org drill-down
    const deptRoster: Record<string, string[]> = {};
    for (const a of agentsFull.data ?? []) {
      const dcode = a.department || a.dept || "UNASSIGNED";
      (deptRoster[dcode] = deptRoster[dcode] || []).push(a.name);
    }

    return j({
      generated_at: new Date().toISOString(),
      summary: summary.data ?? null,
      constitution: { laws: laws.data ?? [], active: (laws.data ?? []).filter((l: any) => l.active).length, total: (laws.data ?? []).length },
      decisions: decisions.data ?? [],
      agent_profiles: profiles.data ?? [],
      agent_autonomy: autonomy ?? [],
      kpi_latest: latestKpi,
      kpi_history: kpiHistory.data ?? [],
      executive_cycles: cycles.data ?? [],
      executive_predictions: predictions.data ?? [],
      audit_timeline: auditTimeline.data ?? [],
      violations: violations.data ?? [],
      approval_queue: approvalQueue.data ?? [],
      board: board.data ?? [],
      executive_committee: execCommittee.data ?? [],
      org_units: (orgUnits.data ?? []).map((u: any) => ({ ...u, company: companyName[u.company_id] ?? "group" })),
      subsidiaries: companies.data ?? [],
      market_intelligence: market.data ?? [],
      competitor_intelligence: competitors.data ?? [],
      knowledge_curve: knowledgeCurve,
      knowledge_total: (knowledgeGrowth.data ?? []).length,
      department_activity: Object.entries(deptActivity).map(([dept, v]) => ({ dept, ...v })).sort((a, b) => b.total - a.total),
      recent_activity: delegations.data ?? [],
      // --- v3 living workforce + org drill-down ---
      workforce,
      departments: (departments.data ?? []).map((d: any) => ({ ...d, company: d.company_id ? (companyName[d.company_id] || null) : null, agent_count: (deptRoster[d.code] || []).length })),
      dept_roster: deptRoster,
    });
  } catch (err) {
    return j({ error: String(err) }, 500);
  }
});
