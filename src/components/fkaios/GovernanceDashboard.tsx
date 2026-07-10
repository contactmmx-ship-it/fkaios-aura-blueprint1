'use client';
import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { Scale, ShieldCheck, Brain, Activity, AlertTriangle, RefreshCw } from 'lucide-react';

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
      setData(d as GovData);
      setError(null);
      setLastUpdated(new Date().toLocaleTimeString());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load governance data');
    }
    setLoading(false);
  }, []);

  // Auto-refresh every 30s — live dashboard, no manual refresh required.
  useEffect(() => { load(); const t = setInterval(load, 30000); return () => clearInterval(t); }, [load]);

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
      {/* Header */}
      <div className="flex items-center justify-between bg-slate-900/50 border border-slate-800 rounded-xl px-4 py-2">
        <div className="flex items-center gap-2">
          <Scale className="w-4 h-4 text-purple-400" />
          <h2 className="text-sm font-semibold text-white">Founder Governance Dashboard</h2>
          <span className="text-[10px] text-slate-500">Supreme Constitutional Authority · live from governance tables</span>
        </div>
        <div className="flex items-center gap-3 text-[10px] text-slate-500">
          <span>Updated {lastUpdated} · auto-refresh 30s</span>
          <button onClick={load} className="flex items-center gap-1 text-cyan-400 hover:text-cyan-300"><RefreshCw className="w-3 h-3" />Refresh</button>
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

      {/* SECTION 4: Agent Intelligence */}
      <div>
        <p className="text-[9px] font-semibold text-purple-500 uppercase tracking-wider mb-2">Agent Intelligence (agent_intelligence_profiles · Law 13: autonomy is earned)</p>
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
    </div>
  );
}
