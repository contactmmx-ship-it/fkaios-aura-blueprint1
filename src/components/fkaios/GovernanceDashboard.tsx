'use client';
import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { Scale, ShieldCheck, Brain, Activity, AlertTriangle, RefreshCw } from 'lucide-react';
import ChairmanHero from './ChairmanHero';
import WorkforcePanel, { WorkforceMember } from './WorkforcePanel';
import FounderStory from './FounderStory';

// Founder Governance Dashboard — every widget reads LIVE data from the
// governance-dashboard edge function (service-role reads over the real
// governance tables). Zero mocked values: empty tables render honest
// empty states, never fabricated numbers. Auto-refreshes every 30s.

interface GovData {
  generated_at: string;
  summary: {
    active_laws: number; constitution_version: number; governed_total: number;
    pending_reviews: number; approved: number; rejected: number; executing: number;
    completed: number; violations: number; exec_cycles_total: number;
    exec_cycles_today: number; last_exec_cycle: string | null; approval_queue: number; rollbacks: number;
  } | null;
  constitution: { laws: { law_number: number; name: string; active: boolean }[]; active: number; total: number };
  decisions: { id: string; domain: string; proposing_agent: string; title: string; status: string; review_verdict: string | null; updated_at: string }[];
  agent_profiles: { agent_name: string; role: string | null; trust_level: string; governance_score: number; success_rate: number | null; total_decisions: number; learning_progress: string | null; collaboration_quality: number | null }[];
  agent_autonomy: { name: string; autonomy_level: number; department: string | null }[];
  kpi_latest: Record<string, { value: number; evidence: unknown; measured_at: string }>;
  kpi_history: { kpi: string; value: number; measured_at: string }[];
  executive_cycles: { cycle_number: number; situation_assessment: string; opportunities: { title: string; rationale: string }[]; risks: { risk: string; severity: string; mitigation?: string }[]; capital_allocation: { recommendation: string; amount_inr: number | null; why: string }[]; directives_issued: { to_agent: string; task: string }[]; predictions_made: number; founder_briefing: string; latency_ms: number; created_at: string }[];
  executive_predictions: { metric: string; expected_value: string; measure_by: string; actual_value: string | null; was_correct: boolean | null }[];
  audit_timeline: { action: string; resource_type: string | null; actor_type: string | null; decision_reasoning: string | null; requires_human_review: boolean; created_at: string }[];
  violations: { created_at: string; actor: string; attempted_action: string; violation_message: string; kind: string }[];
  approval_queue: { action_type: string; risk_level: string; amount_inr: number | null; reason: string; created_at: string }[];
  board: { seat: string; holder_type: string; holder_name: string; authority: string; accountability: string }[];
  executive_committee: { role: string; holder_agent: string; scope: string; measurable_objective: string; reports_to: string }[];
  org_units: { unit_name: string; unit_type: string; company: string }[];
  subsidiaries: { id: string; name: string; company_type: string; sector: string | null; status: string | null }[];
  market_intelligence: { signal_type: string; industry: string | null; headline: string; detail: string | null; source_url: string | null; confidence: number; relevance_to_founder_vision: string | null; captured_at: string }[];
  competitor_intelligence: { competitor_name: string; category: string | null; observation: string; implication_for_us: string | null; source_url: string | null; confidence: number; captured_at: string }[];
  knowledge_curve: { day: string; cumulative: number }[];
  knowledge_total: number;
  department_activity: { dept: string; total: number; pending: number }[];
  recent_activity: { from_agent: string; to_agent: string; task_description: string; status: string; created_at: string }[];
  workforce?: WorkforceMember[];
  workforce_truth?: {
    total_employees: number; producing_24h: number; dormant: number; nameplate: number;
    burning: number; total_llm_spend_usd: number; headline: string; burning_warning: string | null;
    employees: { name: string; department: string; verdict: string; lifetime_tasks: number;
      output_24h: number; spend_usd: number; llm_calls: number; llm_failures: number; last_active_at: string | null }[];
  };
  blockers?: {
    revenue_inr: number; headline: string; exit_that_needs_no_new_data: string;
    chain: { stage: string; count: number; owner_role: string; owner_agent: string; alive: boolean; note?: string }[];
    first_break?: { stage: string; count: number; owner_role: string; owner_agent: string; note?: string };
  };
  economics?: {
    measured_spend_usd: number; revenue_inr: number; llm_calls_costed: number;
    spend_on_founder_avatar_usd: number; spend_on_revenue_work_usd: number;
    pct_spend_on_founder_avatar: number; agents_logging_cost: number; agents_total: number;
    untracked_llm_dispatches: number; model_unknown_rows: number; spend_is_a_floor: boolean;
    coverage_warning: string | null; traceability_warning: string | null; verdict: string;
    by_agent: { agent: string; calls: number; spend_usd: number; failed: number }[];
  };
  departments?: { code: string; name: string; company: string | null; automation_level: number | null; agent_count: number }[];
}

const trustColor: Record<string, string> = { constitutional: 'text-purple-400 bg-purple-950/40 border-purple-800', veteran: 'text-cyan-400 bg-cyan-950/40 border-cyan-800', trusted: 'text-emerald-400 bg-emerald-950/40 border-emerald-800', probation: 'text-amber-400 bg-amber-950/40 border-amber-800' };
const statusColor: Record<string, string> = { review: 'text-amber-400', approved: 'text-emerald-400', rejected: 'text-red-400', executing: 'text-cyan-400', completed: 'text-emerald-300', draft: 'text-slate-400', verifying: 'text-cyan-300', rolled_back: 'text-red-300' };
const kpiLabels: Record<string, string> = { autonomous_success_rate: 'Autonomous Success Rate', decision_approval_rate: 'Decision Accuracy', execution_accuracy: 'Execution Accuracy', founder_alignment_score: 'Founder Alignment', learning_effectiveness: 'Learning Effectiveness', prediction_accuracy: 'Prediction Accuracy' };

function Sparkline({ points }: { points: number[] }) {
  if (points.length < 2) return <span className="text-[10px] text-slate-600">needs ≥2 snapshots for a trend</span>;
  const min = Math.min(...points), max = Math.max(...points), range = max - min || 1;
  const coords = points.map((v, i) => `${(i / (points.length - 1)) * 100},${28 - ((v - min) / range) * 24}`).join(' ');
  return <svg viewBox="0 0 100 30" className="w-24 h-7"><polyline points={coords} fill="none" stroke="#22d3ee" strokeWidth="2" /></svg>;
}

function Counter({ label, value, tone }: { label: string; value: number | string; tone?: string }) {
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl px-4 py-3">
      <p className={`text-2xl font-bold ${tone || 'text-white'}`}>{value}</p>
      <p className="text-[10px] text-slate-500 uppercase tracking-wider mt-0.5">{label}</p>
    </div>
  );
}

export default function GovernanceDashboard() {
  const [data, setData] = useState<GovData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);

  // SPRINT 5 (M1-S5) — Founder Workspace. Command Center is the screen the
  // founder actually lands on (see AppShell's activePage default). This is
  // the Founder Brain's own output, read from tables it already owns
  // (founder_memory / orchestrator_requests / approvals — Sprints 2-4),
  // additive to the existing governance-dashboard fetch below, not a
  // replacement of it.
  // SPRINT 6 (M1-S6): extended with the Executive Planner's output —
  // orchestration_projects/orchestration_tasks (the existing orchestrator's
  // own tables, reused, not a new "projects" system) and escalated
  // approvals (blockers now share the same pending-approvals list).
  const [brainBrief, setBrainBrief] = useState<{
    priorities: any[]; observations: any[]; learning: any[]; recommendations: any[];
    assignedWork: any[]; pendingApprovals: any[]; activeProjects: any[]; departments: any[]; workforce: any[];
    velocity: { last24h: number; last7d: number };
  } | null>(null);
  const [brainBriefLoading, setBrainBriefLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const [memRes, workRes, apprRes, projRes, deptRes, deptObjRes, agentRes, velocity24Res, velocity7Res] = await Promise.all([
          supabase.from('founder_memory').select('content, updated_at').order('updated_at', { ascending: false }).limit(50),
          supabase.from('orchestrator_requests').select('id, raw_request, department_code, status, created_at').eq('requested_by', 'founder-brain').order('created_at', { ascending: false }).limit(6),
          supabase.from('approvals').select('id, action_type, reason, risk_level, created_at').eq('status', 'pending').order('created_at', { ascending: false }).limit(6),
          supabase.from('orchestration_projects').select('id, request, status').like('request', '[objective:%').order('id', { ascending: false }).limit(6),
          supabase.from('departments').select('code, name, automation_level').eq('is_active', true),
          supabase.from('orchestrator_requests').select('department_code, status').eq('requested_by', 'founder-brain'),
          supabase.from('ai_agents').select('id, name, department, dept, status, is_active, autonomy_level, success_rate, total_tasks_completed').eq('is_active', true).order('name').limit(30),
          // SPRINT 9 (M1-S9) — Work Engine velocity: real completed-job counts, not a fabricated trend.
          supabase.from('ai_jobs').select('id', { count: 'exact', head: true }).eq('status', 'completed').eq('type', 'work_engine_task').gte('updated_at', new Date(Date.now() - 86400000).toISOString()),
          supabase.from('ai_jobs').select('id', { count: 'exact', head: true }).eq('status', 'completed').eq('type', 'work_engine_task').gte('updated_at', new Date(Date.now() - 7 * 86400000).toISOString()),
        ]);
        const mem = (memRes.data || []).map((r: any) => r.content).filter(Boolean);
        // Progress per project — real aggregation from orchestration_tasks, not a fabricated number.
        const projects = projRes.data || [];
        const activeProjects = await Promise.all(projects.map(async (p: any) => {
          const { data: tasks } = await supabase.from('orchestration_tasks').select('status').eq('project_id', p.id);
          const total = tasks?.length || 0;
          const done = (tasks || []).filter((t: any) => t.status === 'done' || t.status === 'approved').length;
          return { ...p, total, done, percent: total > 0 ? Math.round((done / total) * 100) : 0 };
        }));
        // SPRINT 7 (M1-S7) — AI Departments workload: real counts of what the
        // Founder Brain has actually assigned to each department, traced
        // from orchestrator_requests.department_code (no new table).
        const deptObjectives = deptObjRes.data || [];
        const departments = (deptRes.data || []).map((d: any) => {
          const own = deptObjectives.filter((o: any) => o.department_code === d.code);
          return { ...d, active: own.filter((o: any) => o.status === 'processing').length, total: own.length };
        });
        // SPRINT 8 (M1-S8) — AI Employees: the existing ai_agents workforce,
        // grouped by department. Not a new table — same one 15+ engines
        // already write to (ai-engine, auto-agents-engine, orchestrator...).
        const workforce = agentRes.data || [];
        setBrainBrief({
          priorities: mem.filter((c: any) => c.kind === 'goal'),
          observations: mem.filter((c: any) => c.kind === 'insight' || c.kind === 'imagination').slice(0, 3),
          learning: mem.filter((c: any) => c.kind === 'world_learning').slice(0, 3),
          recommendations: mem.filter((c: any) => c.kind === 'constitution_amendment').slice(0, 3),
          assignedWork: workRes.data || [],
          pendingApprovals: apprRes.data || [],
          activeProjects,
          departments,
          workforce,
          velocity: { last24h: velocity24Res.count || 0, last7d: velocity7Res.count || 0 },
        });
      } catch (e) {
        console.error('Founder Brain brief load failed:', e);
      } finally {
        setBrainBriefLoading(false);
      }
    })();
  }, []);

  const load = useCallback(async () => {
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      const res = await fetch('https://nrlsqshkjuuwiovthrnb.supabase.co/functions/v1/governance-dashboard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({}),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'governance-dashboard failed');
      // ENTERPRISE ECONOMICS (Constitution Addendum — the CEO's standing mandate
      // is to reduce cost and grow revenue; it could do neither while spend and
      // revenue were never stated in the same place). Read directly via RPC —
      // no edge-function redeploy needed, the function is granted to authenticated.
      const { data: econ } = await supabase.rpc('compute_enterprise_economics');
      // "What is blocking revenue?" — answered from live data, with the OWNING
      // executive named. The Founder should never have to ask this twice.
      const { data: blockers } = await supabase.rpc('compute_revenue_blockers');
      // EXECUTIVE KPI: grade the workforce against real evidence. "41 AI employees"
      // is a vanity metric if 37 of them have never completed a task.
      const { data: workforceTruth } = await supabase.rpc('compute_workforce_truth');
      setData({ ...(d as GovData), economics: econ ?? undefined, blockers: blockers ?? undefined, workforce_truth: workforceTruth ?? undefined });
      setError(null);
      setLastUpdated(new Date().toLocaleTimeString());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load governance data');
    }
    setLoading(false);
  }, []);

  // Auto-refresh every 30s — live dashboard, no manual refresh required.
  useEffect(() => { load(); const t = setInterval(load, 30000); return () => clearInterval(t); }, [load]);
  // Progressive disclosure: Level 1 (Founder Story) shows on load; the full
  // cockpit is opt-in so the Founder is never overwhelmed.
  const [showDetail, setShowDetail] = useState(false);

  if (loading) return <div className="p-6 text-sm text-slate-400">Loading live governance data…</div>;
  if (error) return <div className="m-6 bg-red-950/40 border border-red-900 rounded-xl px-4 py-3 text-xs text-red-300">Governance dashboard error: {error}</div>;
  if (!data?.summary) return <div className="p-6 text-sm text-slate-400">No governance data returned.</div>;

  const s = data.summary;
  const latestCycle = data.executive_cycles[0] || null;
  const hoursSinceCycle = s.last_exec_cycle ? (Date.now() - new Date(s.last_exec_cycle).getTime()) / 36e5 : null;
  const eilStatus = hoursSinceCycle === null ? 'NEVER RAN' : hoursSinceCycle < 26 ? 'LIVE' : 'STALE';
  const constitutionHealth = data.constitution.total > 0 ? Math.round((data.constitution.active / data.constitution.total) * 100) : 0;
  const successHistory = data.kpi_history.filter(k => k.kpi === 'autonomous_success_rate').map(k => Number(k.value));
  const measuredPreds = data.executive_predictions.filter(p => p.was_correct !== null);

  return (
    <div className="p-6 space-y-6">
      {!brainBriefLoading && brainBrief && (
        <div className="bg-gradient-to-br from-slate-900 to-slate-950 border border-blue-900/40 rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-white flex items-center gap-2"><Brain size={16} className="text-blue-400" /> Founder Brain Brief</h2>
            <div className="text-xs text-slate-400">Work velocity: <span className="text-emerald-400">{brainBrief.velocity.last24h}</span>/24h · <span className="text-emerald-400">{brainBrief.velocity.last7d}</span>/7d</div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 text-xs">
            <div>
              <div className="text-slate-500 uppercase tracking-wide mb-1.5">Today's priorities</div>
              {brainBrief.priorities.length === 0 ? <div className="text-slate-600">No goals seeded yet</div> :
                brainBrief.priorities.map((g: any, i: number) => <div key={i} className="text-slate-300 mb-1">• {g.description} {g.deadline ? <span className="text-slate-500">({g.deadline})</span> : null}</div>)}
            </div>
            <div>
              <div className="text-slate-500 uppercase tracking-wide mb-1.5">Assigned work</div>
              {brainBrief.assignedWork.length === 0 ? <div className="text-slate-600">Nothing assigned yet</div> :
                brainBrief.assignedWork.slice(0, 4).map((w: any) => <div key={w.id} className="text-slate-300 mb-1 truncate">• {w.raw_request} <span className="text-slate-500">[{w.department_code || '—'}/{w.status}]</span></div>)}
            </div>
            <div>
              <div className="text-slate-500 uppercase tracking-wide mb-1.5">Pending approvals</div>
              {brainBrief.pendingApprovals.length === 0 ? <div className="text-slate-600">None pending</div> :
                brainBrief.pendingApprovals.slice(0, 4).map((a: any) => <div key={a.id} className="text-amber-400/90 mb-1 truncate">• {a.action_type} <span className="text-slate-500">({a.risk_level})</span></div>)}
            </div>
            <div>
              <div className="text-slate-500 uppercase tracking-wide mb-1.5">Recent observations</div>
              {brainBrief.observations.length === 0 ? <div className="text-slate-600">Nothing observed yet</div> :
                brainBrief.observations.map((o: any, i: number) => <div key={i} className="text-slate-300 mb-1 line-clamp-2">• {(o.text || '').slice(0, 140)}</div>)}
            </div>
            <div>
              <div className="text-slate-500 uppercase tracking-wide mb-1.5">Recent learning</div>
              {brainBrief.learning.length === 0 ? <div className="text-slate-600">Nothing learned yet</div> :
                brainBrief.learning.map((l: any, i: number) => <div key={i} className="text-slate-300 mb-1 line-clamp-2">• [{l.source}] {(l.text || '').slice(0, 120)}</div>)}
            </div>
            <div>
              <div className="text-slate-500 uppercase tracking-wide mb-1.5">Strategic recommendations</div>
              {brainBrief.recommendations.length === 0 ? <div className="text-slate-600">No amendments proposed yet</div> :
                brainBrief.recommendations.map((r: any, i: number) => <div key={i} className="text-slate-300 mb-1 line-clamp-2">• v{r.version} [{r.area}] {(r.change || '').slice(0, 120)}</div>)}
            </div>
            <div>
              <div className="text-slate-500 uppercase tracking-wide mb-1.5">Active projects (Executive Planner)</div>
              {brainBrief.activeProjects.length === 0 ? <div className="text-slate-600">No projects planned yet</div> :
                brainBrief.activeProjects.map((p: any) => (
                  <div key={p.id} className="mb-1.5">
                    <div className="text-slate-300 truncate">• {p.request.replace(/^\[objective:[^\]]+\]\s*/, '')} <span className="text-slate-500">[{p.status}]</span></div>
                    <div className="h-1 bg-slate-800 rounded-full mt-0.5 overflow-hidden">
                      <div className="h-full bg-blue-500" style={{ width: `${p.percent}%` }} />
                    </div>
                    <div className="text-slate-600 text-[10px]">{p.done}/{p.total} tasks done</div>
                  </div>
                ))}
            </div>
          </div>
          <div className="pt-2 border-t border-slate-800">
            <div className="text-slate-500 uppercase tracking-wide mb-1.5 text-xs">AI Departments</div>
            {brainBrief.departments.length === 0 ? <div className="text-slate-600 text-xs">No active departments configured</div> : (
              <div className="flex flex-wrap gap-2">
                {brainBrief.departments.map((d: any) => (
                  <div key={d.code} className="bg-slate-900/60 border border-slate-800 rounded-lg px-3 py-1.5 text-xs">
                    <span className="text-slate-300 font-medium">{d.name}</span>
                    <span className="text-slate-600"> · L{d.automation_level}</span>
                    {d.total > 0 && <span className="text-blue-400"> · {d.active} active / {d.total} total</span>}
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="pt-2 border-t border-slate-800">
            <div className="text-slate-500 uppercase tracking-wide mb-1.5 text-xs">AI Employees</div>
            {brainBrief.workforce.length === 0 ? <div className="text-slate-600 text-xs">No active employees found</div> : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-1.5">
                {brainBrief.workforce.map((e: any) => (
                  <div key={e.id} className="bg-slate-900/60 border border-slate-800 rounded-lg px-2.5 py-1.5 text-[11px] flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-slate-300 truncate">{e.name}</div>
                      <div className="text-slate-600 truncate">{e.department || e.dept || '—'} · {e.status || 'idle'}</div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-blue-400">{e.success_rate != null ? `${Math.round(e.success_rate)}%` : '—'}</div>
                      <div className="text-slate-600">{e.total_tasks_completed ?? 0} done</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between bg-slate-900/50 border border-slate-800 rounded-xl px-4 py-2">
        <div className="flex items-center gap-2">
          <Scale className="w-4 h-4 text-purple-400" />
          <h2 className="text-sm font-semibold text-white">Chairman's Command Center</h2>
          <span className="text-[10px] text-slate-500">Bhavishya Associates Artificial Enterprise · live enterprise intelligence</span>
        </div>
        <div className="flex items-center gap-3 text-[10px] text-slate-500">
          <span>Updated {lastUpdated} · auto-refresh 30s</span>
          <button onClick={load} className="flex items-center gap-1 text-cyan-400 hover:text-cyan-300"><RefreshCw className="w-3 h-3" />Refresh</button>
        </div>
      </div>

      {/* LEVEL 1 — Founder Story: plain-language "what's happening", live
          activity stream, collaboration, and what needs you. Full cockpit is
          opt-in below (progressive disclosure — nothing removed). */}
      <FounderStory data={data} expanded={showDetail} onToggle={() => setShowDetail(v => !v)} />

      {showDetail && (<>
      {/* LIVING COMMAND CENTER HERO — Enterprise Pulse, Health, Mission 2030,
          AI Workforce, Capital, CEO Briefing, Organization Map (all live). */}
      <ChairmanHero data={data} />

      {/* ENTERPRISE: Board & Executive Committee */}
      <div>
        <p className="text-[9px] font-semibold text-cyan-500 uppercase tracking-wider mb-2">Enterprise Leadership (board_of_directors · executive_committee)</p>
        <div className="grid md:grid-cols-2 gap-3">
          <div className="bg-slate-900 border border-slate-800 rounded-xl px-4 py-3">
            <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-2">Board of Directors ({data.board.length} seats)</p>
            {data.board.length === 0 ? <p className="text-xs text-slate-500">No board seats yet</p> : data.board.map((b, i) => (
              <div key={i} className="py-1.5 border-b border-slate-800/60 last:border-0">
                <p className="text-xs text-white">{b.seat} <span className={`text-[9px] px-1.5 py-0.5 rounded ml-1 ${b.holder_type === 'human' ? 'bg-amber-950/50 text-amber-400' : 'bg-cyan-950/50 text-cyan-400'}`}>{b.holder_name}</span></p>
                <p className="text-[10px] text-slate-500 truncate">{b.authority}</p>
              </div>
            ))}
          </div>
          <div className="bg-slate-900 border border-slate-800 rounded-xl px-4 py-3">
            <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-2">Executive Committee ({data.executive_committee.length} officers)</p>
            {data.executive_committee.map((e, i) => (
              <div key={i} className="py-1.5 border-b border-slate-800/60 last:border-0">
                <p className="text-xs text-white">{e.role} <span className="text-cyan-400 text-[10px]">· {e.holder_agent}</span></p>
                <p className="text-[10px] text-slate-500 truncate">Target: {e.measurable_objective}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ENTERPRISE: Subsidiaries & Org Structure */}
      <div>
        <p className="text-[9px] font-semibold text-cyan-500 uppercase tracking-wider mb-2">Holding Structure (companies · org_units)</p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {data.subsidiaries.map(c => (
            <div key={c.id} className="bg-slate-900 border border-slate-800 rounded-xl px-4 py-3">
              <p className="text-sm font-semibold text-white">{c.name}</p>
              <p className="text-[10px] text-cyan-400 uppercase">{c.company_type}</p>
              <p className="text-[10px] text-slate-500">{c.sector || '—'}</p>
              <p className="text-[10px] text-slate-600 mt-1">{data.org_units.filter(u => u.company === c.name).length} departments</p>
            </div>
          ))}
        </div>
      </div>

      {/* ENTERPRISE: Live Activity — what the org is doing right now */}
      <div>
        <p className="text-[9px] font-semibold text-cyan-500 uppercase tracking-wider mb-2">Real-Time Enterprise Activity (agent_task_delegations)</p>
        <div className="bg-slate-900 border border-slate-800 rounded-xl px-4 py-3 max-h-48 overflow-y-auto">
          {data.recent_activity.length === 0 ? <p className="text-xs text-slate-500">No enterprise activity yet</p> : data.recent_activity.map((a, i) => (
            <div key={i} className="flex items-center justify-between py-1 border-b border-slate-800/60 last:border-0 text-xs">
              <span className="text-slate-300 truncate"><span className="text-cyan-400">{a.from_agent}</span> → <span className="text-purple-400">{a.to_agent}</span>: {a.task_description}</span>
              <span className={`ml-2 shrink-0 text-[10px] uppercase ${a.status === 'pending' ? 'text-amber-400' : a.status === 'in_progress' ? 'text-cyan-400' : 'text-emerald-400'}`}>{a.status}</span>
            </div>
          ))}
        </div>
        <div className="mt-2 grid grid-cols-3 md:grid-cols-6 gap-2">
          {data.department_activity.slice(0, 6).map(d => (
            <div key={d.dept} className="bg-slate-900 border border-slate-800 rounded-lg px-2 py-1.5">
              <p className="text-sm font-bold text-white">{d.total}</p>
              <p className="text-[9px] text-slate-500 truncate">{d.dept}</p>
              {d.pending > 0 && <p className="text-[9px] text-amber-400">{d.pending} active</p>}
            </div>
          ))}
        </div>
      </div>

      {/* ENTERPRISE: Market & Competitor Intelligence */}
      <div>
        <p className="text-[9px] font-semibold text-cyan-500 uppercase tracking-wider mb-2">Market &amp; Competitor Intelligence (market_intelligence · competitor_intelligence)</p>
        <div className="grid md:grid-cols-2 gap-3">
          <div className="bg-slate-900 border border-slate-800 rounded-xl px-4 py-3 max-h-64 overflow-y-auto">
            <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">Market Signals ({data.market_intelligence.length})</p>
            {data.market_intelligence.length === 0 ? <p className="text-xs text-slate-500">No market signals captured yet</p> : data.market_intelligence.map((m, i) => (
              <div key={i} className="py-1.5 border-b border-slate-800/60 last:border-0">
                <p className="text-xs text-white">{m.headline} <span className="text-[9px] text-slate-500">[{m.signal_type}] conf {m.confidence}</span></p>
                {m.relevance_to_founder_vision && <p className="text-[10px] text-emerald-400/70 truncate">↳ {m.relevance_to_founder_vision}</p>}
                {m.source_url && <a href={m.source_url} target="_blank" rel="noreferrer" className="text-[9px] text-cyan-500 hover:underline">source</a>}
              </div>
            ))}
          </div>
          <div className="bg-slate-900 border border-slate-800 rounded-xl px-4 py-3 max-h-64 overflow-y-auto">
            <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">Competitor Landscape ({data.competitor_intelligence.length})</p>
            {data.competitor_intelligence.length === 0 ? <p className="text-xs text-slate-500">No competitor intelligence yet</p> : data.competitor_intelligence.map((c, i) => (
              <div key={i} className="py-1.5 border-b border-slate-800/60 last:border-0">
                <p className="text-xs text-white">{c.competitor_name} <span className="text-[9px] text-slate-500">conf {c.confidence}</span></p>
                <p className="text-[10px] text-slate-400 truncate">{c.observation}</p>
                {c.implication_for_us && <p className="text-[10px] text-amber-400/70 truncate">↳ us: {c.implication_for_us}</p>}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ENTERPRISE: Knowledge Growth */}
      <div>
        <p className="text-[9px] font-semibold text-cyan-500 uppercase tracking-wider mb-2">Enterprise Knowledge Network (fleet_memory)</p>
        <div className="bg-slate-900 border border-slate-800 rounded-xl px-4 py-3 flex items-center gap-4">
          <div><p className="text-2xl font-bold text-white">{data.knowledge_total}</p><p className="text-[10px] text-slate-500 uppercase tracking-wider">Organizational memories</p></div>
          <div className="flex-1"><Sparkline points={data.knowledge_curve.map(k => k.cumulative)} /><p className="text-[9px] text-slate-600 mt-0.5">cumulative knowledge growth · compounds every cycle</p></div>
        </div>
      </div>

      {/* SECTION 1: Governance Overview */}
      <div>
        <p className="text-[9px] font-semibold text-purple-500 uppercase tracking-wider mb-2">Governance Overview</p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Counter label={`Constitution Status (${data.constitution.active}/${data.constitution.total} laws active)`} value={data.constitution.active === data.constitution.total ? 'ENFORCED' : 'DEGRADED'} tone="text-purple-400" />
          <Counter label="Constitution Health (active laws %)" value={`${constitutionHealth}%`} tone={constitutionHealth === 100 ? 'text-emerald-400' : 'text-amber-400'} />
          <Counter label="Constitution Violations (all sources)" value={s.violations} tone={s.violations > 0 ? 'text-red-400' : 'text-emerald-400'} />
          <Counter label="Active Governance Version" value={`Law 1–${s.constitution_version}`} tone="text-cyan-400" />
        </div>
        <div className="mt-3 bg-slate-900 border border-slate-800 rounded-xl px-4 py-3">
          <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-2">Constitutional Laws (engineering_constitution)</p>
          <div className="flex flex-wrap gap-1.5">
            {data.constitution.laws.map(l => (
              <span key={l.law_number} title={l.name} className={`text-[10px] px-2 py-0.5 rounded border ${l.active ? 'text-emerald-400 border-emerald-900 bg-emerald-950/30' : 'text-slate-500 border-slate-800'}`}>L{l.law_number} {l.name}</span>
            ))}
          </div>
        </div>
      </div>

      {/* SECTION 2: Decision Governance */}
      <div>
        <p className="text-[9px] font-semibold text-purple-500 uppercase tracking-wider mb-2">Decision Governance (governed_decisions)</p>
        <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
          <Counter label="Total Governed Decisions" value={s.governed_total} />
          <Counter label="Pending Reviews" value={s.pending_reviews} tone="text-amber-400" />
          <Counter label="Approved" value={s.approved} tone="text-emerald-400" />
          <Counter label="Rejected" value={s.rejected} tone="text-red-400" />
          <Counter label="Executing" value={s.executing} tone="text-cyan-400" />
          <Counter label="Completed" value={s.completed} tone="text-emerald-300" />
        </div>
        <div className="mt-3 bg-slate-900 border border-slate-800 rounded-xl px-4 py-3 max-h-56 overflow-y-auto">
          {data.decisions.length === 0 ? <p className="text-xs text-slate-500">No governed decisions yet</p> : data.decisions.map(d => (
            <div key={d.id} className="flex items-center justify-between py-1.5 border-b border-slate-800/60 last:border-0 text-xs">
              <div className="min-w-0"><span className="text-slate-300">{d.title}</span><span className="text-slate-600 ml-2">[{d.domain}] by {d.proposing_agent}</span></div>
              <span className={`ml-3 shrink-0 font-semibold uppercase text-[10px] ${statusColor[d.status] || 'text-slate-400'}`}>{d.status}</span>
            </div>
          ))}
        </div>
      </div>

      {/* SECTION 3: Executive Intelligence */}
      <div>
        <p className="text-[9px] font-semibold text-purple-500 uppercase tracking-wider mb-2">Executive Intelligence (executive_cycles)</p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Counter label="Executive Intelligence Status" value={eilStatus} tone={eilStatus === 'LIVE' ? 'text-emerald-400' : 'text-red-400'} />
          <Counter label="Last Executive Cycle" value={s.last_exec_cycle ? new Date(s.last_exec_cycle).toLocaleString() : 'never'} tone="text-slate-300" />
          <Counter label="Executive Cycles Today" value={s.exec_cycles_today} tone="text-cyan-400" />
          <Counter label="Total Cycles" value={s.exec_cycles_total} />
        </div>
        {latestCycle ? (
          <div className="mt-3 grid md:grid-cols-2 gap-3">
            <div className="bg-slate-900 border border-slate-800 rounded-xl px-4 py-3">
              <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1 flex items-center gap-1"><Brain className="w-3 h-3 text-purple-400" />Founder Briefing — Cycle #{latestCycle.cycle_number}</p>
              <p className="text-xs text-slate-300 whitespace-pre-wrap max-h-48 overflow-y-auto">{latestCycle.founder_briefing}</p>
            </div>
            <div className="space-y-3">
              <div className="bg-slate-900 border border-slate-800 rounded-xl px-4 py-3">
                <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">Strategic Opportunities</p>
                {(latestCycle.opportunities || []).length === 0 ? <p className="text-xs text-slate-500">None identified this cycle</p> : (latestCycle.opportunities || []).map((o, i) => <p key={i} className="text-xs text-emerald-300 py-0.5">▲ {o.title} <span className="text-slate-500">— {o.rationale}</span></p>)}
              </div>
              <div className="bg-slate-900 border border-slate-800 rounded-xl px-4 py-3">
                <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">Active Risks</p>
                {(latestCycle.risks || []).length === 0 ? <p className="text-xs text-slate-500">None identified this cycle</p> : (latestCycle.risks || []).map((r, i) => <p key={i} className="text-xs py-0.5"><span className={r.severity === 'high' ? 'text-red-400' : r.severity === 'medium' ? 'text-amber-400' : 'text-slate-400'}>⚠ [{r.severity}]</span> <span className="text-slate-300">{r.risk}</span></p>)}
              </div>
              <div className="bg-slate-900 border border-slate-800 rounded-xl px-4 py-3">
                <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">Executive Recommendations (directives + staged capital)</p>
                {(latestCycle.directives_issued || []).map((d, i) => <p key={i} className="text-xs text-cyan-300 py-0.5">→ {d.to_agent}: <span className="text-slate-300">{d.task}</span></p>)}
                {(latestCycle.capital_allocation || []).map((c, i) => <p key={`c${i}`} className="text-xs text-amber-300 py-0.5">₹ {c.recommendation} {c.amount_inr ? `(₹${Number(c.amount_inr).toLocaleString('en-IN')} — staged, awaiting your approval)` : ''}</p>)}
              </div>
            </div>
          </div>
        ) : <p className="mt-3 text-xs text-slate-500">No executive cycles yet</p>}
      </div>

      {/* SECTION 3.5: Living AI Workforce — each employee as an expandable executive */}
      <div>
        <p className="text-[9px] font-semibold text-emerald-500 uppercase tracking-wider mb-2 flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
          AI Workforce — Living Executives (ai_agents · agent_intelligence_profiles · agent_workday)
        </p>
        <WorkforcePanel workforce={data.workforce ?? []} />
      </div>

      {/* SECTION 4: Agent Intelligence */}
      <div>
        <p className="text-[9px] font-semibold text-purple-500 uppercase tracking-wider mb-2">Agent Governance Grid — compact trust &amp; autonomy ledger (agent_intelligence_profiles · Law 13: autonomy is earned)</p>
        <div className="bg-slate-900 border border-slate-800 rounded-xl px-4 py-3 max-h-64 overflow-y-auto">
          <table className="w-full text-xs">
            <thead><tr className="text-[10px] text-slate-500 uppercase tracking-wider text-left"><th className="py-1">Agent</th><th>Trust Level</th><th>Autonomy</th><th>Governance Score</th><th>Reliability</th><th>Learning Progress</th><th>Collaboration</th></tr></thead>
            <tbody>
              {data.agent_profiles.map(p => {
                const auto = data.agent_autonomy.find(a => a.name === p.agent_name);
                return (
                  <tr key={p.agent_name} className="border-t border-slate-800/60">
                    <td className="py-1.5 text-slate-300">{p.agent_name}</td>
                    <td><span className={`text-[10px] px-1.5 py-0.5 rounded border ${trustColor[p.trust_level] || ''}`}>{p.trust_level}</span></td>
                    <td className="text-slate-400">{auto ? `L${auto.autonomy_level}` : '—'}</td>
                    <td className="text-cyan-300">{Number(p.governance_score).toFixed(2)}</td>
                    <td className="text-slate-400">{p.total_decisions > 0 && p.success_rate !== null ? `${p.success_rate}% (${p.total_decisions})` : 'unproven'}</td>
                    <td className="text-slate-500 max-w-[180px] truncate">{p.learning_progress || 'no history yet'}</td>
                    <td className="text-slate-400">{p.collaboration_quality !== null ? Number(p.collaboration_quality).toFixed(2) : 'unmeasured'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* SECTION 5: Intelligence Analytics */}
      <div>
        <p className="text-[9px] font-semibold text-purple-500 uppercase tracking-wider mb-2">Intelligence Analytics (governance_kpis · executive_predictions)</p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {Object.entries(kpiLabels).map(([key, label]) => {
            const k = data.kpi_latest[key];
            return (
              <div key={key} className="bg-slate-900 border border-slate-800 rounded-xl px-4 py-3">
                <p className="text-2xl font-bold text-white">{k ? `${Number(k.value).toFixed(1)}%` : '—'}</p>
                <p className="text-[10px] text-slate-500 uppercase tracking-wider mt-0.5">{label}</p>
                <p className="text-[9px] text-slate-600 mt-0.5">{k ? `measured ${new Date(k.measured_at).toLocaleDateString()}` : 'no real data yet — requires history'}</p>
              </div>
            );
          })}
          <div className="bg-slate-900 border border-slate-800 rounded-xl px-4 py-3">
            <p className="text-lg font-bold text-white flex items-center gap-2"><Activity className="w-4 h-4 text-cyan-400" /><Sparkline points={successHistory} /></p>
            <p className="text-[10px] text-slate-500 uppercase tracking-wider mt-0.5">Intelligence Growth Trend (autonomous success over time)</p>
          </div>
          <div className="bg-slate-900 border border-slate-800 rounded-xl px-4 py-3">
            <p className="text-2xl font-bold text-white">{measuredPreds.length > 0 ? `${Math.round((measuredPreds.filter(p => p.was_correct).length / measuredPreds.length) * 100)}%` : '—'}</p>
            <p className="text-[10px] text-slate-500 uppercase tracking-wider mt-0.5">Prediction Accuracy</p>
            <p className="text-[9px] text-slate-600 mt-0.5">{measuredPreds.length > 0 ? `${measuredPreds.length} measured` : `${data.executive_predictions.length} pending measurement — none due yet`}</p>
          </div>
          <div className="bg-slate-900 border border-slate-800 rounded-xl px-4 py-3">
            <p className="text-2xl font-bold text-white">—</p>
            <p className="text-[10px] text-slate-500 uppercase tracking-wider mt-0.5">Business Impact</p>
            <p className="text-[9px] text-slate-600 mt-0.5">not yet measurable — requires completed decisions with verified outcomes (Law 14)</p>
          </div>
        </div>
        {data.executive_predictions.length > 0 && (
          <div className="mt-3 bg-slate-900 border border-slate-800 rounded-xl px-4 py-3">
            <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">Open Executive Predictions (Law 14 — measured against reality on due date)</p>
            {data.executive_predictions.map((p, i) => (
              <p key={i} className="text-xs py-0.5 text-slate-300">{p.metric}: <span className="text-cyan-300">{p.expected_value}</span> <span className="text-slate-500">by {p.measure_by}</span> {p.was_correct === null ? <span className="text-amber-400">· pending</span> : p.was_correct ? <span className="text-emerald-400">· correct</span> : <span className="text-red-400">· wrong</span>}</p>
            ))}
          </div>
        )}
      </div>

      {/* SECTION 6: Audit & Compliance */}
      <div>
        <p className="text-[9px] font-semibold text-purple-500 uppercase tracking-wider mb-2">Audit &amp; Compliance (audit_logs · v_constitution_violations · approvals)</p>
        <div className="grid md:grid-cols-2 gap-3">
          <div className="bg-slate-900 border border-slate-800 rounded-xl px-4 py-3 max-h-72 overflow-y-auto">
            <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">Live Audit Timeline</p>
            {data.audit_timeline.length === 0 ? <p className="text-xs text-slate-500">No audit events yet</p> : data.audit_timeline.map((a, i) => (
              <div key={i} className="py-1.5 border-b border-slate-800/60 last:border-0">
                <p className="text-xs"><span className="text-cyan-300">{a.action}</span> <span className="text-slate-600">· {a.actor_type} · {new Date(a.created_at).toLocaleString()}</span>{a.requires_human_review && <span className="text-amber-400 text-[10px] ml-1">needs your review</span>}</p>
                {a.decision_reasoning && <p className="text-[10px] text-slate-500 truncate">{a.decision_reasoning}</p>}
              </div>
            ))}
          </div>
          <div className="space-y-3">
            <div className="bg-slate-900 border border-slate-800 rounded-xl px-4 py-3 max-h-40 overflow-y-auto">
              <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1 flex items-center gap-1"><AlertTriangle className="w-3 h-3 text-red-400" />Constitutional Violations ({s.violations})</p>
              {data.violations.length === 0 ? <p className="text-xs text-emerald-400">No constitutional violations recorded</p> : data.violations.map((v, i) => (
                <p key={i} className="text-xs py-0.5 text-red-300">{v.actor}: {v.attempted_action} <span className="text-slate-500">— {v.violation_message}</span></p>
              ))}
            </div>
            <div className="bg-slate-900 border border-slate-800 rounded-xl px-4 py-3 max-h-40 overflow-y-auto">
              <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1 flex items-center gap-1"><ShieldCheck className="w-3 h-3 text-amber-400" />Approval Queue ({s.approval_queue} pending your decision)</p>
              {data.approval_queue.length === 0 ? <p className="text-xs text-slate-500">Approval queue is empty</p> : data.approval_queue.map((a, i) => (
                <p key={i} className="text-xs py-0.5 text-slate-300">[{a.risk_level}] {a.action_type}{a.amount_inr ? ` · ₹${Number(a.amount_inr).toLocaleString('en-IN')}` : ''} <span className="text-slate-500">— {a.reason?.slice(0, 100)}</span></p>
              ))}
            </div>
            <div className="bg-slate-900 border border-slate-800 rounded-xl px-4 py-3">
              <p className="text-[10px] text-slate-500 uppercase tracking-wider">Rollback History</p>
              <p className="text-xs text-slate-300 mt-1">{s.rollbacks === 0 ? 'No rollbacks recorded' : `${s.rollbacks} rolled-back decision(s)`}</p>
            </div>
          </div>
        </div>
      </div>
      </>)}
    </div>
  );
}
