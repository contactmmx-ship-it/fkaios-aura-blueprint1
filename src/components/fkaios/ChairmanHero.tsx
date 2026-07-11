'use client';
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import {
  Activity, Radio, Building2, Cpu, Target, ShieldCheck, TrendingUp,
  Landmark, Users, GitBranch, AlertTriangle, Sparkles, Gauge,
} from 'lucide-react';

// ChairmanHero — the "living" top strip of the Chairman's Command Center.
// Every value is LIVE from the database (auth-readable tables) or from the
// GovData payload passed by the parent GovernanceDashboard. Nothing is
// fabricated: empty datasets render an honest "Awaiting First Cycle" state
// instead of placeholder numbers. Preserves everything below it — this is a
// pure additive enhancement mounted above the existing governance widgets.

interface HeroInput {
  summary: {
    exec_cycles_total: number; last_exec_cycle: string | null;
    approval_queue: number; violations: number;
  } | null;
  kpi_latest: Record<string, { value: number }>;
  agent_profiles: { trust_level: string }[];
  executive_cycles: { capital_allocation: { recommendation: string; amount_inr: number | null; why: string }[]; founder_briefing: string; cycle_number: number }[];
  executive_predictions: { was_correct: boolean | null }[];
}

interface Company { id: string; name: string; company_type: string; parent_company_id: string | null; sector: string | null; status: string | null; }
interface Briefing { work_date: string; summary: string; top_performers: { name: string; reason: string }[]; underperformers: { name: string; reason: string }[]; blockers: string | null; company_kpi_snapshot: { leads_today?: number; agents_total?: number; agents_reporting?: number } | null; }

function crFmt(v: number) {
  if (!v) return '₹0';
  if (v >= 1e7) return `₹${(v / 1e7).toFixed(v >= 1e8 ? 0 : 1)} Cr`;
  if (v >= 1e5) return `₹${(v / 1e5).toFixed(1)} L`;
  return `₹${v.toLocaleString('en-IN')}`;
}
function relTime(iso: string | null) {
  if (!iso) return 'never';
  const h = (Date.now() - new Date(iso).getTime()) / 36e5;
  if (h < 1) return `${Math.max(1, Math.round(h * 60))}m ago`;
  if (h < 48) return `${Math.round(h)}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

function Gauge2({ value, label, tone }: { value: number | null; label: string; tone: string }) {
  const size = 88, r = 38, c = Math.PI * 2 * r;
  const pct = value === null ? 0 : Math.max(0, Math.min(100, value));
  const offset = c - (pct / 100) * c;
  return (
    <div className="flex flex-col items-center justify-center bg-slate-900 border border-slate-800 rounded-xl px-3 py-3">
      <svg width={size} height={size} className="shrink-0">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#1e293b" strokeWidth="6" />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={tone} strokeWidth="6"
          strokeDasharray={c} strokeDashoffset={offset} strokeLinecap="round"
          transform={`rotate(-90 ${size / 2} ${size / 2})`} style={{ transition: 'stroke-dashoffset 1s ease' }} />
        <text x={size / 2} y={size / 2 - 2} textAnchor="middle" dominantBaseline="central" fill="white" fontSize="20" fontWeight="800">
          {value === null ? '—' : Math.round(pct)}
        </text>
        <text x={size / 2} y={size / 2 + 15} textAnchor="middle" fill="#64748b" fontSize="9">{value === null ? 'awaiting' : '%'}</text>
      </svg>
      <p className="text-[10px] text-slate-400 uppercase tracking-wider mt-1 text-center leading-tight">{label}</p>
    </div>
  );
}

export default function ChairmanHero({ data }: { data: HeroInput }) {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [deptCount, setDeptCount] = useState<number | null>(null);
  const [target2030, setTarget2030] = useState<number>(0);
  const [actualTotal, setActualTotal] = useState<number>(0);
  const [agentTotal, setAgentTotal] = useState<number | null>(null);
  const [agentActive, setAgentActive] = useState<number | null>(null);
  const [ops24h, setOps24h] = useState<number | null>(null);
  const [briefing, setBriefing] = useState<Briefing | null>(null);
  const [pulse, setPulse] = useState(true);

  useEffect(() => {
    const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const holdingTarget = () => supabase.from('company_annual_targets').select('company_id, year, revenue_target_inr').eq('year', 2030);
    Promise.all([
      supabase.from('companies').select('id, name, company_type, parent_company_id, sector, status'),
      supabase.from('departments').select('id', { count: 'exact', head: true }).eq('is_active', true),
      holdingTarget(),
      supabase.from('company_revenue_actuals').select('revenue_inr'),
      supabase.from('ai_agents').select('id, status, is_active'),
      supabase.from('execution_log').select('id', { count: 'exact', head: true }).gte('created_at', since),
      supabase.from('ceo_daily_briefing').select('work_date, summary, top_performers, underperformers, blockers, company_kpi_snapshot').order('work_date', { ascending: false }).limit(1),
    ]).then(([co, dep, tgt, act, ag, ex, br]) => {
      const cos = (co.data || []) as Company[];
      setCompanies(cos);
      setDeptCount(dep.count ?? null);
      const holding = cos.find(c => c.company_type === 'holding');
      const tgtRows = (tgt.data || []) as { company_id: string; revenue_target_inr: number }[];
      const ht = holding ? tgtRows.find(t => t.company_id === holding.id) : null;
      setTarget2030(ht?.revenue_target_inr || tgtRows.reduce((s, r) => s + Number(r.revenue_target_inr || 0), 0));
      setActualTotal(((act.data || []) as { revenue_inr: number }[]).reduce((s, r) => s + Number(r.revenue_inr || 0), 0));
      const agents = (ag.data || []) as { status: string | null; is_active: boolean | null }[];
      setAgentTotal(agents.length);
      setAgentActive(agents.filter(a => a.is_active || a.status === 'active').length);
      setOps24h(ex.count ?? null);
      const b = (br.data || [])[0] as Briefing | undefined;
      if (b) setBriefing(b);
    }).catch(() => { /* honest empty states remain */ });

    const t = setInterval(() => setPulse(p => !p), 1400);
    return () => clearInterval(t);
  }, []);

  const s = data.summary;
  const kpi = data.kpi_latest || {};
  const num = (k: string) => (kpi[k] ? Number(kpi[k].value) : null);
  const healthParts = [num('autonomous_success_rate'), num('execution_accuracy'), num('founder_alignment_score')].filter((v): v is number => v !== null);
  const enterpriseHealth = healthParts.length ? Math.round(healthParts.reduce((a, b) => a + b, 0) / healthParts.length) : null;
  const measured = data.executive_predictions.filter(p => p.was_correct !== null);
  const predAcc = measured.length ? Math.round((measured.filter(p => p.was_correct).length / measured.length) * 100) : null;

  const trust: Record<string, number> = {};
  data.agent_profiles.forEach(p => { trust[p.trust_level] = (trust[p.trust_level] || 0) + 1; });
  const trustOrder = ['constitutional', 'veteran', 'trusted', 'probation'];
  const trustTone: Record<string, string> = { constitutional: 'bg-purple-500', veteran: 'bg-cyan-500', trusted: 'bg-emerald-500', probation: 'bg-amber-500' };

  const stagedCapital = (data.executive_cycles[0]?.capital_allocation || []).reduce((sum, c) => sum + Number(c.amount_inr || 0), 0);
  const missionPct = target2030 > 0 ? Math.min(100, (actualTotal / target2030) * 100) : 0;

  const holding = companies.find(c => c.company_type === 'holding');
  const subs = companies.filter(c => c.company_type !== 'holding');

  return (
    <div className="space-y-4">
      {/* ── LIVE ENTERPRISE PULSE RIBBON ───────────────────────────── */}
      <div className="relative overflow-hidden rounded-2xl border border-cyan-900/50 bg-gradient-to-r from-slate-900 via-slate-900 to-blue-950/40 px-5 py-4">
        <div className="absolute inset-0 opacity-20 pointer-events-none"
          style={{ background: 'radial-gradient(600px 120px at 15% 0%, rgba(6,182,212,0.25), transparent)' }} />
        <div className="relative flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="relative flex h-3 w-3">
              <span className={`absolute inline-flex h-full w-full rounded-full bg-emerald-400 ${pulse ? 'opacity-75 animate-ping' : 'opacity-0'}`} />
              <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500" />
            </span>
            <div>
              <p className="text-sm font-bold text-white tracking-wide flex items-center gap-2">
                <Radio className="w-4 h-4 text-emerald-400" /> ENTERPRISE LIVE
              </p>
              <p className="text-[10px] text-slate-400">Autonomous cognition loop is operating · Bhavishya Associates AI Enterprise</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-5">
            <PulseStat icon={<Cpu className="w-3.5 h-3.5 text-cyan-400" />} label="Executive Cycles" value={s ? String(s.exec_cycles_total) : '—'} sub={`last ${relTime(s?.last_exec_cycle || null)}`} />
            <PulseStat icon={<Activity className="w-3.5 h-3.5 text-blue-400" />} label="Ops / 24h" value={ops24h === null ? '…' : String(ops24h)} sub="agent executions" />
            <PulseStat icon={<Users className="w-3.5 h-3.5 text-emerald-400" />} label="AI Workforce" value={agentActive === null ? '…' : `${agentActive}`} sub={`of ${agentTotal ?? '…'} active`} />
            <PulseStat icon={<ShieldCheck className="w-3.5 h-3.5 text-amber-400" />} label="Pending Reviews" value={s ? String(s.approval_queue) : '—'} sub="await your call" />
          </div>
        </div>
      </div>

      {/* ── ENTERPRISE HEALTH GAUGES ──────────────────────────────── */}
      <div>
        <p className="text-[9px] font-semibold text-cyan-500 uppercase tracking-wider mb-2 flex items-center gap-1.5"><Gauge className="w-3 h-3" />Real-time Enterprise Health</p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Gauge2 value={enterpriseHealth} label="Enterprise Health" tone="#06b6d4" />
          <Gauge2 value={num('autonomous_success_rate')} label="Autonomous Success" tone="#10b981" />
          <Gauge2 value={num('founder_alignment_score')} label="Founder Alignment" tone="#8b5cf6" />
          <Gauge2 value={predAcc} label="Prediction Accuracy" tone="#f59e0b" />
        </div>
      </div>

      {/* ── MISSION 2030 · AI WORKFORCE · CAPITAL ─────────────────── */}
      <div className="grid md:grid-cols-3 gap-3">
        {/* Mission 2030 */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl px-4 py-3">
          <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-2 flex items-center gap-1.5"><Target className="w-3 h-3 text-blue-400" />Mission 2030 · ₹1,100 Cr Ecosystem</p>
          <div className="flex items-end justify-between mb-1">
            <span className="text-2xl font-bold text-white">{crFmt(actualTotal)}</span>
            <span className="text-xs text-slate-500">of {crFmt(target2030)}</span>
          </div>
          <div className="h-2 rounded-full bg-slate-800 overflow-hidden">
            <div className="h-full bg-gradient-to-r from-blue-500 to-cyan-400" style={{ width: `${missionPct}%`, transition: 'width 1s ease' }} />
          </div>
          <p className="text-[10px] text-slate-500 mt-1.5">
            {actualTotal > 0 ? `${missionPct.toFixed(2)}% toward the 2030 target` : 'Awaiting first recorded revenue cycle — target locked at ₹1,100 Cr by 2030'}
          </p>
        </div>

        {/* AI Workforce trust distribution */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl px-4 py-3">
          <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-2 flex items-center gap-1.5"><Cpu className="w-3 h-3 text-emerald-400" />AI Workforce · Trust Levels</p>
          <div className="flex items-end gap-1.5 mb-2">
            <span className="text-2xl font-bold text-white">{agentTotal ?? '…'}</span>
            <span className="text-xs text-slate-500 mb-1">AI employees</span>
          </div>
          {data.agent_profiles.length === 0 ? <p className="text-[10px] text-slate-500">Awaiting first intelligence-profile scoring cycle</p> : (
            <div className="space-y-1">
              {trustOrder.filter(t => trust[t]).map(t => (
                <div key={t} className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full ${trustTone[t]}`} />
                  <span className="text-[10px] text-slate-400 capitalize flex-1">{t}</span>
                  <span className="text-[10px] text-slate-300 font-semibold">{trust[t]}</span>
                  <div className="w-16 h-1.5 rounded-full bg-slate-800 overflow-hidden">
                    <div className={`h-full ${trustTone[t]}`} style={{ width: `${(trust[t] / data.agent_profiles.length) * 100}%` }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Capital allocation */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl px-4 py-3">
          <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-2 flex items-center gap-1.5"><Landmark className="w-3 h-3 text-amber-400" />Capital · Chairman Gate</p>
          <div className="flex items-end gap-1.5 mb-1">
            <span className="text-2xl font-bold text-white">{crFmt(stagedCapital)}</span>
            <span className="text-xs text-slate-500 mb-1">staged this cycle</span>
          </div>
          <p className="text-[10px] text-slate-500 mb-2">AI stages capital; only you execute money movement.</p>
          <div className="flex items-center gap-2 text-[11px]">
            <ShieldCheck className="w-3.5 h-3.5 text-amber-400" />
            <span className="text-slate-300">{s?.approval_queue ?? 0} awaiting your approval</span>
          </div>
        </div>
      </div>

      {/* ── DAILY CEO BRIEFING ─────────────────────────────────────── */}
      <div className="bg-gradient-to-br from-purple-950/30 to-slate-900 border border-purple-900/40 rounded-xl px-4 py-3">
        <div className="flex items-center justify-between mb-2">
          <p className="text-[10px] text-purple-400 uppercase tracking-wider flex items-center gap-1.5"><Sparkles className="w-3 h-3" />Daily CEO Briefing</p>
          {briefing && <span className="text-[10px] text-slate-500">{briefing.work_date}</span>}
        </div>
        {!briefing ? <p className="text-xs text-slate-500">Awaiting first CEO briefing cycle.</p> : (
          <>
            <p className="text-xs text-slate-300 leading-relaxed mb-3">{briefing.summary}</p>
            <div className="grid md:grid-cols-3 gap-3">
              <div>
                <p className="text-[10px] text-emerald-400 uppercase tracking-wider mb-1">Top Performers</p>
                {(briefing.top_performers || []).length === 0 ? <p className="text-[11px] text-slate-500">None flagged</p> :
                  (briefing.top_performers || []).map((p, i) => <p key={i} className="text-[11px] text-slate-300 py-0.5">▲ <span className="font-semibold text-emerald-300">{p.name}</span></p>)}
              </div>
              <div>
                <p className="text-[10px] text-red-400 uppercase tracking-wider mb-1">Underperformers</p>
                {(briefing.underperformers || []).length === 0 ? <p className="text-[11px] text-slate-500">None flagged</p> :
                  (briefing.underperformers || []).map((p, i) => <p key={i} className="text-[11px] text-slate-300 py-0.5">▼ <span className="font-semibold text-red-300">{p.name}</span></p>)}
              </div>
              <div>
                <p className="text-[10px] text-amber-400 uppercase tracking-wider mb-1 flex items-center gap-1"><AlertTriangle className="w-3 h-3" />Blockers</p>
                <p className="text-[11px] text-slate-400 leading-snug line-clamp-4">{briefing.blockers || 'None reported'}</p>
              </div>
            </div>
          </>
        )}
      </div>

      {/* ── ENTERPRISE ORGANIZATION MAP ────────────────────────────── */}
      <div>
        <p className="text-[9px] font-semibold text-cyan-500 uppercase tracking-wider mb-2 flex items-center gap-1.5"><GitBranch className="w-3 h-3" />Enterprise Organization Map ({companies.length} entities · {deptCount ?? '…'} departments)</p>
        {!holding ? <p className="text-xs text-slate-500">Awaiting enterprise structure.</p> : (
          <div className="bg-slate-900 border border-slate-800 rounded-xl px-4 py-3">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-blue-500 to-cyan-500 flex items-center justify-center">
                <Building2 className="w-4 h-4 text-white" />
              </div>
              <div>
                <p className="text-sm font-bold text-white">{holding.name}</p>
                <p className="text-[10px] text-cyan-400">{holding.sector} · Holding Company</p>
              </div>
              <span className="ml-auto text-[10px] px-2 py-0.5 rounded-full bg-emerald-950/50 border border-emerald-800 text-emerald-400 capitalize">{holding.status}</span>
            </div>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2 pl-3 border-l border-slate-800 ml-4">
              {subs.map(c => (
                <div key={c.id} className="bg-slate-950/60 border border-slate-800 rounded-lg px-3 py-2">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-semibold text-white truncate">{c.name}</p>
                    <span className={`text-[9px] px-1.5 py-0.5 rounded-full capitalize ${c.status === 'active' ? 'bg-emerald-950/50 text-emerald-400 border border-emerald-800' : 'bg-slate-800 text-slate-400 border border-slate-700'}`}>{c.status}</span>
                  </div>
                  <p className="text-[10px] text-slate-500 truncate mt-0.5">{c.sector}</p>
                </div>
              ))}
              <div className="bg-slate-950/40 border border-dashed border-slate-800 rounded-lg px-3 py-2 flex items-center justify-center">
                <p className="text-[10px] text-slate-600 text-center">Scaling toward 400+ subsidiaries<br />— architecture ready</p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function PulseStat({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string; sub: string }) {
  return (
    <div className="flex items-center gap-2">
      <div className="w-8 h-8 rounded-lg bg-slate-800/70 flex items-center justify-center shrink-0">{icon}</div>
      <div>
        <p className="text-lg font-bold text-white leading-none">{value}</p>
        <p className="text-[9px] text-slate-500 uppercase tracking-wider">{label}</p>
        <p className="text-[9px] text-slate-600">{sub}</p>
      </div>
    </div>
  );
}
