'use client';
import { useState, useMemo } from 'react';
import { ChevronDown, ChevronRight, Cpu, Target, Activity, Brain, Clock, Search } from 'lucide-react';

// Living AI Workforce — each AI employee as an expandable executive card, not
// a statistic. Collapsed: identity, status, trust, autonomy, today's task
// throughput. Expanded: current objective (its real morning plan), midday
// reasoning, self-rating, governance/collaboration/learning, decisions, last
// activity. 100% from the workforce payload (ai_agents + intelligence profile
// + latest workday, joined server-side). Empty fields render "—", never faked.

export interface WorkforceMember {
  name: string; role: string | null; department: string | null; company: string | null;
  status: string; is_active: boolean; autonomy_level: number | null;
  trust_level: string | null; governance_score: number | null; collaboration_quality: number | null;
  learning_progress: string | null; total_decisions: number | null; success_rate: number | null;
  total_tasks_completed: number | null; last_active_at: string | null;
  work_date: string | null; workday_status: string | null; current_objective: string | null;
  midday_update: string | null; midday_on_track: boolean | null; self_rating: number | null;
  tasks_planned: number; tasks_completed: number; pending_tasks: number; real_activity_count: number;
}

const trustBadge: Record<string, string> = {
  constitutional: 'text-purple-300 bg-purple-950/50 border-purple-800',
  veteran: 'text-cyan-300 bg-cyan-950/50 border-cyan-800',
  trusted: 'text-emerald-300 bg-emerald-950/50 border-emerald-800',
  probation: 'text-amber-300 bg-amber-950/50 border-amber-800',
};
function rel(iso: string | null) {
  if (!iso) return '—';
  const h = (Date.now() - new Date(iso).getTime()) / 36e5;
  if (h < 1) return `${Math.max(1, Math.round(h * 60))}m ago`;
  if (h < 48) return `${Math.round(h)}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

function AgentCard({ m }: { m: WorkforceMember }) {
  const [open, setOpen] = useState(false);
  const live = m.is_active && m.status === 'active';
  return (
    <div className="bg-slate-950/60 border border-slate-800 rounded-lg overflow-hidden">
      <button onClick={() => setOpen(o => !o)} className="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-slate-900/60 transition-colors">
        <span className={`w-2 h-2 rounded-full shrink-0 ${live ? 'bg-emerald-500' : 'bg-slate-600'} ${live ? 'animate-pulse' : ''}`} />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold text-white truncate">{m.name}</p>
          <p className="text-[10px] text-slate-500 truncate">{m.role || m.department || 'AI Employee'}</p>
        </div>
        {m.trust_level && <span className={`text-[9px] px-1.5 py-0.5 rounded-full border capitalize hidden sm:inline ${trustBadge[m.trust_level] || 'text-slate-400 bg-slate-800 border-slate-700'}`}>{m.trust_level}</span>}
        {m.autonomy_level !== null && <span className="text-[9px] text-slate-400 bg-slate-800 rounded px-1.5 py-0.5 shrink-0">L{m.autonomy_level}</span>}
        <span className="text-[10px] text-slate-400 shrink-0 tabular-nums hidden md:inline">{m.tasks_completed}/{m.tasks_planned}</span>
        {open ? <ChevronDown className="w-3.5 h-3.5 text-slate-500 shrink-0" /> : <ChevronRight className="w-3.5 h-3.5 text-slate-500 shrink-0" />}
      </button>
      {open && (
        <div className="px-3 pb-3 pt-1 border-t border-slate-800/70 space-y-2">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
            <Stat label="Autonomy" value={m.autonomy_level !== null ? `L${m.autonomy_level}` : '—'} />
            <Stat label="Governance" value={m.governance_score !== null ? String(m.governance_score) : '—'} />
            <Stat label="Success" value={m.success_rate !== null ? `${Math.round(Number(m.success_rate))}%` : '—'} />
            <Stat label="Decisions" value={m.total_decisions !== null ? String(m.total_decisions) : '—'} />
          </div>
          <div>
            <p className="text-[9px] text-blue-400 uppercase tracking-wider mb-0.5 flex items-center gap-1"><Target className="w-3 h-3" />Current Objective {m.work_date ? `· ${m.work_date}` : ''}</p>
            <p className="text-[11px] text-slate-300 leading-snug">{m.current_objective || 'Awaiting today\u2019s work plan.'}</p>
          </div>
          {m.midday_update && (
            <div>
              <p className="text-[9px] text-cyan-400 uppercase tracking-wider mb-0.5 flex items-center gap-1"><Brain className="w-3 h-3" />Midday Reasoning {m.midday_on_track === false ? '· off-track' : m.midday_on_track ? '· on-track' : ''}</p>
              <p className="text-[11px] text-slate-400 leading-snug">{m.midday_update}</p>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] text-slate-500">
            <span className="flex items-center gap-1"><Activity className="w-3 h-3 text-emerald-400" />Pending: <span className="text-slate-300">{m.pending_tasks}</span></span>
            <span>Real activity: <span className="text-slate-300">{m.real_activity_count}</span></span>
            {m.self_rating !== null && <span>Self-rating: <span className="text-slate-300">{m.self_rating}/10</span></span>}
            {m.collaboration_quality !== null && <span>Collab: <span className="text-slate-300">{m.collaboration_quality}</span></span>}
            <span className="flex items-center gap-1"><Clock className="w-3 h-3" />Active {rel(m.last_active_at)}</span>
          </div>
          {m.learning_progress && <p className="text-[10px] text-purple-300/80 leading-snug"><span className="text-purple-400 uppercase tracking-wider">Learning: </span>{m.learning_progress}</p>}
        </div>
      )}
    </div>
  );
}
function Stat({ label, value }: { label: string; value: string }) {
  return <div className="bg-slate-900 rounded-md py-1.5"><p className="text-sm font-bold text-white leading-none">{value}</p><p className="text-[9px] text-slate-500 uppercase tracking-wider mt-0.5">{label}</p></div>;
}

export default function WorkforcePanel({ workforce }: { workforce: WorkforceMember[] }) {
  const [q, setQ] = useState('');
  const [grouped, setGrouped] = useState(true);

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    return workforce.filter(m => !t || m.name.toLowerCase().includes(t) || (m.role || '').toLowerCase().includes(t) || (m.department || '').toLowerCase().includes(t) || (m.company || '').toLowerCase().includes(t));
  }, [workforce, q]);

  const byCompany = useMemo(() => {
    const g: Record<string, WorkforceMember[]> = {};
    for (const m of filtered) (g[m.company || 'Group / Unassigned'] = g[m.company || 'Group / Unassigned'] || []).push(m);
    return g;
  }, [filtered]);

  const activeCount = workforce.filter(m => m.is_active && m.status === 'active').length;
  const workingToday = workforce.filter(m => m.current_objective).length;

  if (workforce.length === 0) return <p className="text-xs text-slate-500">Awaiting first AI workforce roster.</p>;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 text-[11px] text-slate-400">
          <span className="text-white font-semibold">{workforce.length}</span> AI employees ·
          <span className="text-emerald-400 font-semibold">{activeCount}</span> active ·
          <span className="text-cyan-400 font-semibold">{workingToday}</span> with a plan today
        </div>
        <div className="ml-auto flex items-center gap-2">
          <div className="flex items-center gap-1.5 bg-slate-900 border border-slate-800 rounded-lg px-2 py-1">
            <Search className="w-3 h-3 text-slate-500" />
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search employees…" className="bg-transparent text-[11px] text-slate-200 placeholder-slate-600 outline-none w-32" />
          </div>
          <button onClick={() => setGrouped(g => !g)} className="text-[10px] text-slate-400 hover:text-white border border-slate-800 rounded-lg px-2 py-1">{grouped ? 'Flat view' : 'Group by company'}</button>
        </div>
      </div>

      {grouped ? (
        Object.entries(byCompany).map(([company, members]) => (
          <div key={company}>
            <p className="text-[10px] text-cyan-400 uppercase tracking-wider mb-1.5 flex items-center gap-1.5"><Cpu className="w-3 h-3" />{company} <span className="text-slate-600">({members.length})</span></p>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {members.map(m => <AgentCard key={m.name} m={m} />)}
            </div>
          </div>
        ))
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
          {filtered.map(m => <AgentCard key={m.name} m={m} />)}
        </div>
      )}
    </div>
  );
}
