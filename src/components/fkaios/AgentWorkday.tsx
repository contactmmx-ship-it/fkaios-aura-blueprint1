'use client';
import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';

interface Charter {
  agent_id: string;
  job_title: string;
  responsibilities: string[];
  kpi_name: string;
  kpi_target: number;
  kpi_unit: string;
  agent_name?: string;
}
interface Workday {
  agent_id: string;
  work_date: string;
  status: 'planned' | 'midday_checked' | 'submitted';
  morning_plan: string | null;
  midday_update: string | null;
  midday_on_track: boolean | null;
  evening_summary: string | null;
  self_rating: number | null;
  manager_rating: number | null;
  manager_feedback: string | null;
  tasks_planned: number;
  tasks_completed: number;
  real_activity_count: number;
}
interface Briefing {
  work_date: string;
  summary: string;
  blockers: string | null;
  top_performers: { agent_id: string; name: string; reason: string }[];
  underperformers: { agent_id: string; name: string; reason: string }[];
  company_kpi_snapshot: { agents_reporting: number; agents_total: number; leads_today: number };
}

const PHASES = [
  { key: 'morning', label: 'Morning Plan', time: '9:00 AM IST' },
  { key: 'midday', label: 'Midday Check-in', time: '2:00 PM IST' },
  { key: 'evening', label: 'Evening Submission', time: '7:00 PM IST' },
  { key: 'ceo', label: 'CEO Roll-up', time: '7:15 PM IST' },
] as const;

function todayIST(): string {
  const now = new Date(Date.now() + 5.5 * 3600 * 1000);
  return now.toISOString().slice(0, 10);
}

function RatingPill({ value, label }: { value: number | null; label: string }) {
  if (value === null) return <span className="text-[10px] text-slate-600">{label}: —</span>;
  const color = value >= 7 ? 'text-emerald-400 bg-emerald-500/10' : value >= 4 ? 'text-amber-400 bg-amber-500/10' : 'text-rose-400 bg-rose-500/10';
  return <span className={`text-[10px] px-1.5 py-0.5 rounded ${color}`}>{label}: {value}/10</span>;
}

export default function AgentWorkday() {
  const [charters, setCharters] = useState<Charter[]>([]);
  const [workdays, setWorkdays] = useState<Record<string, Workday>>({});
  const [briefing, setBriefing] = useState<Briefing | null>(null);
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState<string | null>(null);
  const [runMsg, setRunMsg] = useState<string | null>(null);
  const date = todayIST();

  const refresh = useCallback(async () => {
    const [{ data: c }, { data: w }, { data: b }] = await Promise.all([
      supabase.from('agent_role_charter').select('agent_id, job_title, responsibilities, kpi_name, kpi_target, kpi_unit, ai_agents!agent_role_charter_agent_id_fkey(name)'),
      supabase.from('agent_workday').select('*').eq('work_date', date),
      supabase.from('ceo_daily_briefing').select('*').eq('work_date', date).maybeSingle(),
    ]);
    if (c) setCharters(c.map((x: any) => ({ ...x, agent_name: x.ai_agents?.name ?? 'Unknown' })));
    if (w) setWorkdays(Object.fromEntries(w.map((x: any) => [x.agent_id, x])));
    setBriefing(b ?? null);
    setLoading(false);
  }, [date]);

  useEffect(() => { refresh(); }, [refresh]);

  const runPhase = async (phase: string) => {
    setRunning(phase); setRunMsg(null);
    try {
      const { data, error } = await supabase.functions.invoke('workday-engine', { body: { phase } });
      if (error || data?.error) throw new Error(data?.error || error?.message || 'Phase run failed');
      setRunMsg(`${phase}: ${data.done ?? data.agents_reviewed ?? 0} processed${data.failed ? `, ${data.failed} failed` : ''}.`);
      await refresh();
    } catch (e) {
      setRunMsg(e instanceof Error ? `⚠ ${e.message}` : '⚠ Phase run failed');
    } finally {
      setRunning(null);
    }
  };

  const selected = selectedAgent ? charters.find(c => c.agent_id === selectedAgent) : null;
  const selectedWd = selectedAgent ? workdays[selectedAgent] : null;

  if (loading) return <div className="text-sm text-slate-500 p-6">Loading agent workdays…</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <h1 className="text-lg font-bold text-white">Agent Workday</h1>
          <span className="text-[10px] px-2 py-0.5 bg-indigo-500/10 text-indigo-400 rounded-full">{date} · {Object.keys(workdays).length}/{charters.length} reporting</span>
        </div>
        <div className="flex gap-2 flex-wrap">
          {PHASES.map(p => (
            <button key={p.key} onClick={() => runPhase(p.key)} disabled={running !== null}
              title={`Runs automatically at ${p.time}`}
              className="px-2.5 py-1.5 bg-slate-800 border border-slate-700 text-slate-300 text-[11px] rounded-lg hover:bg-slate-700 disabled:opacity-50">
              {running === p.key ? 'Running…' : `Run ${p.label}`}
            </button>
          ))}
        </div>
      </div>
      {runMsg && <p className={`text-xs ${runMsg.startsWith('⚠') ? 'text-rose-400' : 'text-emerald-400'}`}>{runMsg}</p>}

      {/* CEO daily briefing */}
      {briefing ? (
        <div className="bg-slate-900 border border-indigo-500/30 rounded-2xl p-4 space-y-3">
          <p className="text-xs font-semibold text-indigo-400 uppercase tracking-wider">CEO Daily Briefing — {briefing.work_date}</p>
          <p className="text-sm text-slate-200">{briefing.summary}</p>
          {briefing.blockers && <p className="text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2">⚠ {briefing.blockers}</p>}
          <div className="flex gap-4 text-[11px] text-slate-500">
            <span>{briefing.company_kpi_snapshot.agents_reporting}/{briefing.company_kpi_snapshot.agents_total} agents reported</span>
            <span>{briefing.company_kpi_snapshot.leads_today} real leads today</span>
          </div>
          {(briefing.top_performers.length > 0 || briefing.underperformers.length > 0) && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2">
              {briefing.top_performers.length > 0 && (
                <div>
                  <p className="text-[10px] font-semibold text-emerald-400 uppercase mb-1">Top performers</p>
                  {briefing.top_performers.map((p, i) => <p key={i} className="text-xs text-slate-400"><span className="text-slate-200">{p.name}</span> — {p.reason}</p>)}
                </div>
              )}
              {briefing.underperformers.length > 0 && (
                <div>
                  <p className="text-[10px] font-semibold text-rose-400 uppercase mb-1">Needs attention</p>
                  {briefing.underperformers.map((p, i) => <p key={i} className="text-xs text-slate-400"><span className="text-slate-200">{p.name}</span> — {p.reason}</p>)}
                </div>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 text-xs text-slate-500">
          No CEO briefing for today yet — it's generated after all agents submit their evening report (7:15 PM IST), or run it manually above once agents have reported.
        </div>
      )}

      {/* Roster grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {charters.map(c => {
          const wd = workdays[c.agent_id];
          const stepIndex = !wd ? -1 : wd.status === 'planned' ? 0 : wd.status === 'midday_checked' ? 1 : 2;
          return (
            <button key={c.agent_id} onClick={() => setSelectedAgent(c.agent_id)}
              className="text-left bg-slate-900 border border-slate-800 hover:border-slate-700 rounded-xl p-4 transition-all">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-white">{c.agent_name}</h3>
                <div className="flex gap-1">
                  {['Plan', 'Mid', 'Eve'].map((s, i) => (
                    <span key={s} className={`w-1.5 h-1.5 rounded-full ${i <= stepIndex ? 'bg-indigo-400' : 'bg-slate-700'}`} title={s} />
                  ))}
                </div>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">{c.job_title}</p>
              <p className="text-[11px] text-slate-600 mt-2">KPI: {c.kpi_target} {c.kpi_unit}</p>
              {wd ? (
                <div className="flex gap-2 mt-2 flex-wrap">
                  <RatingPill value={wd.self_rating} label="Self" />
                  <RatingPill value={wd.manager_rating} label="Mgr" />
                  <span className="text-[10px] text-slate-600">Activity: {wd.real_activity_count}</span>
                </div>
              ) : (
                <p className="text-[11px] text-slate-600 mt-2 italic">No plan yet today</p>
              )}
            </button>
          );
        })}
      </div>

      {/* Agent detail modal */}
      {selected && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={() => setSelectedAgent(null)}>
          <div className="bg-slate-900 border border-slate-700 rounded-xl w-full max-w-2xl max-h-[85vh] overflow-y-auto p-5" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-1">
              <h2 className="text-base font-bold text-white">{selected.agent_name}</h2>
              <button onClick={() => setSelectedAgent(null)} className="text-slate-400 hover:text-white text-lg">✕</button>
            </div>
            <p className="text-xs text-slate-500 mb-4">{selected.job_title} · KPI: {selected.kpi_target} {selected.kpi_unit}</p>

            <div className="mb-4">
              <p className="text-[10px] font-semibold text-slate-500 uppercase mb-1">Responsibilities</p>
              <ul className="text-xs text-slate-400 list-disc list-inside space-y-0.5">
                {selected.responsibilities.map((r, i) => <li key={i}>{r}</li>)}
              </ul>
            </div>

            {selectedWd ? (
              <div className="space-y-3">
                <div className="bg-slate-800/50 rounded-lg p-3">
                  <p className="text-[10px] font-semibold text-blue-400 uppercase mb-1">Morning Plan</p>
                  <p className="text-xs text-slate-300">{selectedWd.morning_plan || '—'}</p>
                </div>
                {selectedWd.midday_update && (
                  <div className="bg-slate-800/50 rounded-lg p-3">
                    <p className="text-[10px] font-semibold text-amber-400 uppercase mb-1">Midday Check-in {selectedWd.midday_on_track === false && '⚠ Behind'}</p>
                    <p className="text-xs text-slate-300">{selectedWd.midday_update}</p>
                  </div>
                )}
                {selectedWd.evening_summary && (
                  <div className="bg-slate-800/50 rounded-lg p-3">
                    <p className="text-[10px] font-semibold text-emerald-400 uppercase mb-1">Evening Submission</p>
                    <p className="text-xs text-slate-300">{selectedWd.evening_summary}</p>
                    <div className="flex gap-2 mt-2">
                      <RatingPill value={selectedWd.self_rating} label="Self-rating" />
                      <span className="text-[10px] text-slate-500">{selectedWd.tasks_completed}/{selectedWd.tasks_planned} tasks · {selectedWd.real_activity_count} real activity events</span>
                    </div>
                  </div>
                )}
                {selectedWd.manager_feedback && (
                  <div className="bg-indigo-500/10 border border-indigo-500/20 rounded-lg p-3">
                    <p className="text-[10px] font-semibold text-indigo-400 uppercase mb-1">Manager Feedback</p>
                    <p className="text-xs text-slate-300">{selectedWd.manager_feedback}</p>
                    <RatingPill value={selectedWd.manager_rating} label="Manager rating" />
                  </div>
                )}
              </div>
            ) : (
              <p className="text-xs text-slate-500 italic">No workday started yet for {date}. Run "Morning Plan" above to start the cycle.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
