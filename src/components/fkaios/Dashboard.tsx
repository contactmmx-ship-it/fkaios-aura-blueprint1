'use client';
import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import {
  Users, DollarSign, Activity,
  ArrowUpRight, ArrowDownRight, Clock, CheckCircle,
  Target, BarChart3, PieChart, Zap
} from 'lucide-react';

// Real stage values — must match the `leads.stage` check constraint exactly.
const STAGES = ['new', 'contacted', 'qualified', 'proposal_sent', 'negotiation', 'closed'];
const STAGE_LABELS: Record<string, string> = {
  new: 'New', contacted: 'Contacted', qualified: 'Qualified',
  proposal_sent: 'Proposal Sent', negotiation: 'Negotiation', closed: 'Closed (Won)', lost: 'Lost',
};
const STAGE_COLORS: Record<string, string> = {
  new: '#6366f1', contacted: '#0ea5e9', qualified: '#3b82f6',
  proposal_sent: '#f59e0b', negotiation: '#f97316', closed: '#10b981', lost: '#ef4444',
};
const BRAND_PALETTE = ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316', '#6366f1'];

function formatCurrency(val: number) {
  if (val >= 10000000) return `₹${(val / 10000000).toFixed(1)}Cr`;
  if (val >= 100000) return `₹${(val / 100000).toFixed(1)}L`;
  return `₹${val.toLocaleString('en-IN')}`;
}

function ScoreRing({ score, size = 36 }: { score: number; size?: number }) {
  const r = (size - 4) / 2;
  const c = Math.PI * 2 * r;
  const offset = c - (score / 100) * c;
  const color = score >= 80 ? '#10b981' : score >= 60 ? '#f59e0b' : '#ef4444';
  return (
    <svg width={size} height={size} className="shrink-0">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#1e293b" strokeWidth="3" />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth="3"
        strokeDasharray={c} strokeDashoffset={offset} strokeLinecap="round"
        transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      <text x={size / 2} y={size / 2} textAnchor="middle" dominantBaseline="central"
        fill="white" fontSize={size < 30 ? 8 : 10} fontWeight="700">{score}</text>
    </svg>
  );
}

function Sparkline({ data, color, width = 80, height = 28 }: { data: number[]; color: string; width?: number; height?: number }) {
  if (!data || data.length < 2) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * width},${height - ((v - min) / range) * (height - 4) - 2}`).join(' ');
  return (
    <svg width={width} height={height} className="inline-block">
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

interface Lead {
  id: string;
  brand_id: string | null;
  company_id: string | null;
  company_name: string;
  contact_name: string | null;
  city: string | null;
  state: string | null;
  lead_source: string | null;
  source: string | null;
  stage: string;
  lead_score: number | null;
  created_at: string;
}
interface Brand { id: string; name: string; sector: string | null; investment_range: string | null; royalty: string | null; company_id: string | null; }
interface Invoice { id: string; lead_id: string | null; amount: number | null; status: string; }
interface Company { id: string; name: string; company_type: string | null; }

export default function Dashboard() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'overview' | 'pipeline' | 'brands'>('overview');
  const [companies, setCompanies] = useState<Company[]>([]);
  const [selectedCompanyId, setSelectedCompanyId] = useState<string>('all');
  const [targets, setTargets] = useState<any[]>([]);
  const [actuals, setActuals] = useState<any[]>([]);

  // SPRINT 5 (M1-S5) — Founder Workspace. This is the Founder Brain's own
  // output (founder_memory / orchestrator_requests / approvals /
  // departments / ai_agents — all tables the brain already reads/writes,
  // per Sprint 2-4), surfaced here so Dashboard becomes the home screen the
  // founder actually asked for, instead of a new "Founder Workspace"
  // component. No new table, no new backend call, no new file.
  const [brainBrief, setBrainBrief] = useState<{
    priorities: any[]; observations: any[]; learning: any[]; recommendations: any[];
    assignedWork: any[]; pendingApprovals: any[]; activeDepartments: number; activeAgents: number;
  } | null>(null);
  const [brainBriefLoading, setBrainBriefLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const [memRes, workRes, apprRes, deptRes, agentRes] = await Promise.all([
          supabase.from('founder_memory').select('content, updated_at').order('updated_at', { ascending: false }).limit(50),
          supabase.from('orchestrator_requests').select('id, raw_request, department_code, status, created_at').eq('requested_by', 'founder-brain').order('created_at', { ascending: false }).limit(8),
          supabase.from('approvals').select('id, action_type, reason, risk_level, created_at').eq('status', 'pending').order('created_at', { ascending: false }).limit(8),
          supabase.from('departments').select('id', { count: 'exact', head: true }).eq('is_active', true),
          supabase.from('ai_agents').select('id', { count: 'exact', head: true }).eq('is_active', true),
        ]);
        const mem = (memRes.data || []).map((r: any) => r.content).filter(Boolean);
        setBrainBrief({
          // "Today's priorities" — the goal hierarchy the brain evaluates every decision against (Sprint 3).
          priorities: mem.filter((c: any) => c.kind === 'goal'),
          // Risks/opportunities the brain has actually surfaced — real insight/imagination entries, not a fabricated split the data doesn't support.
          observations: mem.filter((c: any) => c.kind === 'insight' || c.kind === 'imagination').slice(0, 4),
          // "Recent learning" — real worldLearn() output (Sprint 3), only ever written when genuinely new (deduped before storage).
          learning: mem.filter((c: any) => c.kind === 'world_learning').slice(0, 4),
          // "Strategic recommendations" — versioned, explainable Constitution amendments (Sprint 3's proposeAmendment()).
          recommendations: mem.filter((c: any) => c.kind === 'constitution_amendment').slice(0, 4),
          assignedWork: workRes.data || [],
          pendingApprovals: apprRes.data || [],
          activeDepartments: deptRes.count || 0,
          activeAgents: agentRes.count || 0,
        });
      } catch (e) {
        console.error('Founder Brain brief load failed:', e);
      } finally {
        setBrainBriefLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    supabase.from('companies').select('id, name, company_type').then(({ data }) => setCompanies(data || []));
    supabase.from('company_annual_targets').select('company_id, year, revenue_target_inr').then(({ data }) => setTargets(data || []));
    supabase.from('company_revenue_actuals').select('company_id, year, month, revenue_inr').then(({ data }) => setActuals(data || []));
  }, []);

  useEffect(() => {
    Promise.all([
      supabase.from('leads').select('id, brand_id, company_id, company_name, contact_name, city, state, lead_source, source, stage, lead_score, created_at'),
      supabase.from('brands').select('id, name, sector, investment_range, royalty, company_id').eq('is_active', true),
      supabase.from('invoices').select('id, lead_id, amount, status'),
    ]).then(([l, b, i]) => {
      if (l.data) setLeads(l.data as Lead[]);
      if (b.data) setBrands(b.data as Brand[]);
      if (i.data) setInvoices(i.data as Invoice[]);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  // Real AI-operations pulse from execution_log (last 24h) — no simulated data.
  const [ops, setOps] = useState<{ calls: number; costInr: number; fallbacks: number; lastAction: string } | null>(null);
  useEffect(() => {
    const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    supabase.from('execution_log')
      .select('cost_estimate_inr, status, action, created_at')
      .gte('created_at', since).order('created_at', { ascending: false }).limit(500)
      .then(({ data }) => {
        if (!data) return;
        setOps({
          calls: data.length,
          costInr: data.reduce((s2, r) => s2 + (Number(r.cost_estimate_inr) || 0), 0),
          fallbacks: data.filter(r => r.status === 'success_fallback').length,
          lastAction: data[0] ? `${data[0].action} · ${new Date(data[0].created_at).toLocaleTimeString()}` : '—',
        });
      });
  }, []);

  // ---- Executive Command Center panel — real dashboard-engine v2 data ----
  // (Founder Vision Audit Phase A: health score, risk indicators, milestone
  // tracker, invoice breakdown, agent activity feed — all real, computed
  // server-side from the same tables this page already queries directly.)
  interface DashboardEngineData {
    business_health_score: number;
    generated_at?: string;
    revenue: { today_inr: number; week_inr: number; mtd_inr: number; qtd_inr: number; ytd_inr: number };
    risk_indicators: { area: string; risk: string; severity: 'low' | 'medium' | 'high' }[];
    critical_alerts: { severity: 'high' | 'medium'; message: string }[];
    milestone_tracker: { company_id: string; year: number; quarter: number; target_inr: number; actual_inr: number; status: string }[];
    invoice_status_breakdown: Record<string, { count: number; total_inr: number }>;
    agent_activity_feed: { agent_id: string | null; action: string; status: string; created_at: string }[];
    pending_invoice_approvals: unknown[];
  }
  const [ecc, setEcc] = useState<DashboardEngineData | null>(null);
  const [eccError, setEccError] = useState<string | null>(null);
  const [eccLoading, setEccLoading] = useState(true);

  async function loadExecCommandCenter() {
    setEccLoading(true);
    setEccError(null);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      const res = await fetch('https://nrlsqshkjuuwiovthrnb.supabase.co/functions/v1/dashboard-engine', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: 'get_dashboard' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'dashboard-engine failed');
      setEcc(data as DashboardEngineData);
    } catch (e) {
      setEccError(e instanceof Error ? e.message : 'Failed to load Executive Command Center data');
    }
    setEccLoading(false);
  }
  useEffect(() => { loadExecCommandCenter(); }, []);

  // CEO Daily Briefing moved to the Chairman's Command Center (de-duplicated).


  const healthColor = (score: number) => (score >= 70 ? '#10b981' : score >= 40 ? '#f59e0b' : '#ef4444');
  const currentYearMilestones = (ecc?.milestone_tracker || []).filter((m) => m.year === new Date().getFullYear());


  // Invoice amount per lead — real deal value only exists once an invoice is drafted.
  // A lead with no invoice contributes ₹0, and is labeled "no invoice yet" rather than
  // shown as a fabricated deal size.
  const invoicedByLead = new Map<string, number>();
  for (const inv of invoices) {
    if (!inv.lead_id || inv.status === 'cancelled') continue;
    invoicedByLead.set(inv.lead_id, (invoicedByLead.get(inv.lead_id) || 0) + (Number(inv.amount) || 0));
  }
  const wonInvoiceTotal = invoices.filter(i => i.status === 'paid').reduce((s, i) => s + (Number(i.amount) || 0), 0);

  const scopedBrands = selectedCompanyId === 'all' ? brands : brands.filter(b => b.company_id === selectedCompanyId);
  const scopedLeads = selectedCompanyId === 'all' ? leads : leads.filter(l => l.company_id === selectedCompanyId);

  const brandById = new Map<string, Brand & { color: string }>(
    scopedBrands.map((b, i) => [b.id, { ...b, color: BRAND_PALETTE[i % BRAND_PALETTE.length] }])
  );
  const brandName = (id: string | null) => (id && brandById.get(id)?.name) || 'Unassigned';

  const activeLeads = scopedLeads.filter(l => !['closed', 'lost'].includes(l.stage));
  const wonLeads = scopedLeads.filter(l => l.stage === 'closed');
  const lostLeads = scopedLeads.filter(l => l.stage === 'lost');
  const avgScore = activeLeads.length > 0 ? Math.round(activeLeads.reduce((s, l) => s + (l.lead_score || 0), 0) / activeLeads.length) : 0;
  const conversionRate = scopedLeads.length > 0 ? Math.round((wonLeads.length / scopedLeads.length) * 100) : 0;

  const funnelData = STAGES.map(stage => ({
    stage, label: STAGE_LABELS[stage],
    count: scopedLeads.filter(l => l.stage === stage).length,
  }));

  const brandData = scopedBrands.map((b, i) => {
    const bLeads = scopedLeads.filter(l => l.brand_id === b.id);
    const bWon = bLeads.filter(l => l.stage === 'closed');
    return {
      ...b,
      color: BRAND_PALETTE[i % BRAND_PALETTE.length],
      leads: bLeads.length,
      activeLeads: bLeads.filter(l => !['closed', 'lost'].includes(l.stage)).length,
      wonLeads: bWon.length,
      wonRevenue: bWon.reduce((s, l) => s + (invoicedByLead.get(l.id) || 0), 0),
    };
  });

  const sources = [...new Set(scopedLeads.map(l => l.lead_source || l.source).filter(Boolean))].map(src => {
    const sLeads = scopedLeads.filter(l => (l.lead_source || l.source) === src);
    return { source: src as string, count: sLeads.length, won: sLeads.filter(l => l.stage === 'closed').length };
  }).sort((a, b) => b.count - a.count);

  const recentLeads = [...scopedLeads].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()).slice(0, 5);
  const topLeads = [...activeLeads].sort((a, b) => (b.lead_score || 0) - (a.lead_score || 0)).slice(0, 5);

  const revenueSparkline = (() => {
    const byMonth = new Map<string, number>();
    for (const l of wonLeads) {
      if (!l.created_at) continue;
      const k = String(l.created_at).slice(0, 7);
      byMonth.set(k, (byMonth.get(k) || 0) + (invoicedByLead.get(l.id) || 0));
    }
    const keys = [...byMonth.keys()].sort();
    return keys.map(k => byMonth.get(k) as number);
  })();

  const selectedCompanyName = selectedCompanyId === 'all' ? 'All Companies' : (companies.find(c => c.id === selectedCompanyId)?.name || '—');
  const groupTarget = targets.find(t => companies.find(c => c.id === t.company_id)?.company_type === 'holding');
  const relevantTargets = selectedCompanyId === 'all' ? targets : targets.filter(t => t.company_id === selectedCompanyId);
  const relevantActuals = selectedCompanyId === 'all' ? actuals : actuals.filter(a => a.company_id === selectedCompanyId);
  const totalActualToDate = relevantActuals.reduce((s, a) => s + (Number(a.revenue_inr) || 0), 0);
  const displayTarget = selectedCompanyId === 'all' ? groupTarget : relevantTargets[0];

  return (
    <div className="space-y-6">
      {/* SPRINT 5 (M1-S5) — Founder Brain Brief. This is the home-screen
          content the founder asked for: what the brain currently thinks
          deserves attention, surfaced from real data the brain itself
          already writes (Sprints 2-4) — not a new dashboard, not a mock. */}
      {!brainBriefLoading && brainBrief && (
        <div className="bg-gradient-to-br from-slate-900 to-slate-950 border border-blue-900/40 rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-white flex items-center gap-2">
              <Zap size={16} className="text-blue-400" /> Founder Brain Brief
            </h2>
            <div className="flex gap-4 text-xs text-slate-400">
              <span>{brainBrief.activeDepartments} active departments</span>
              <span>{brainBrief.activeAgents} active AI employees</span>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 text-xs">
            <div>
              <div className="text-slate-500 uppercase tracking-wide mb-1.5">Today's priorities (goal hierarchy)</div>
              {brainBrief.priorities.length === 0 ? <div className="text-slate-600">No goals seeded yet</div> :
                brainBrief.priorities.map((g: any, i: number) => (
                  <div key={i} className="text-slate-300 mb-1">• {g.description} {g.deadline ? <span className="text-slate-500">({g.deadline})</span> : null}</div>
                ))}
            </div>
            <div>
              <div className="text-slate-500 uppercase tracking-wide mb-1.5">Assigned work (this cycle)</div>
              {brainBrief.assignedWork.length === 0 ? <div className="text-slate-600">Nothing assigned yet</div> :
                brainBrief.assignedWork.slice(0, 4).map((w: any) => (
                  <div key={w.id} className="text-slate-300 mb-1 truncate">• {w.raw_request} <span className="text-slate-500">[{w.department_code || '—'}/{w.status}]</span></div>
                ))}
            </div>
            <div>
              <div className="text-slate-500 uppercase tracking-wide mb-1.5">Pending approvals</div>
              {brainBrief.pendingApprovals.length === 0 ? <div className="text-slate-600">None pending</div> :
                brainBrief.pendingApprovals.slice(0, 4).map((a: any) => (
                  <div key={a.id} className="text-amber-400/90 mb-1 truncate">• {a.action_type} <span className="text-slate-500">({a.risk_level})</span></div>
                ))}
            </div>
            <div>
              <div className="text-slate-500 uppercase tracking-wide mb-1.5">Recent observations</div>
              {brainBrief.observations.length === 0 ? <div className="text-slate-600">Nothing observed yet</div> :
                brainBrief.observations.map((o: any, i: number) => (
                  <div key={i} className="text-slate-300 mb-1 line-clamp-2">• {(o.text || '').slice(0, 140)}</div>
                ))}
            </div>
            <div>
              <div className="text-slate-500 uppercase tracking-wide mb-1.5">Recent learning</div>
              {brainBrief.learning.length === 0 ? <div className="text-slate-600">Nothing learned yet</div> :
                brainBrief.learning.map((l: any, i: number) => (
                  <div key={i} className="text-slate-300 mb-1 line-clamp-2">• [{l.source}] {(l.text || '').slice(0, 120)}</div>
                ))}
            </div>
            <div>
              <div className="text-slate-500 uppercase tracking-wide mb-1.5">Strategic recommendations</div>
              {brainBrief.recommendations.length === 0 ? <div className="text-slate-600">No amendments proposed yet</div> :
                brainBrief.recommendations.map((r: any, i: number) => (
                  <div key={i} className="text-slate-300 mb-1 line-clamp-2">• v{r.version} [{r.area}] {(r.change || '').slice(0, 120)}</div>
                ))}
            </div>
          </div>
          <div className="text-[10px] text-slate-600">Revenue, leads, and company health are below — this brief is the Founder Brain's own reasoning, not a duplicate of it.</div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button onClick={() => setSelectedCompanyId('all')}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer ${selectedCompanyId === 'all' ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-400 hover:text-white'}`}>
          All Companies
        </button>
        {companies.filter(c => c.company_type !== 'holding').map(c => (
          <button key={c.id} onClick={() => setSelectedCompanyId(c.id)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer ${selectedCompanyId === c.id ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-400 hover:text-white'}`}>
            {c.name}
          </button>
        ))}
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-xl px-4 py-3 flex flex-wrap items-center gap-4 text-xs">
        <span className="text-slate-300 font-semibold">{selectedCompanyName}</span>
        <span className="text-slate-500">2030 target: <span className="text-white font-semibold">{displayTarget?.revenue_target_inr ? formatCurrency(Number(displayTarget.revenue_target_inr)) : 'not yet set'}</span></span>
        <span className="text-slate-500">Recorded actual to date: <span className="text-emerald-400 font-semibold">{formatCurrency(totalActualToDate)}</span></span>
        {selectedCompanyId !== 'all' && scopedLeads.length === 0 && scopedBrands.length === 0 && (
          <span className="text-amber-400/80 ml-auto">No CRM/lead data tracked for this company yet</span>
        )}
      </div>

      <div className="flex gap-1 bg-slate-900 rounded-xl p-1 w-fit">
        {(['overview', 'pipeline', 'brands'] as const).map(tab => (
          <button key={tab} onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 rounded-lg text-xs font-medium transition-all cursor-pointer ${activeTab === tab ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'}`}>
            {tab === 'overview' ? 'Overview' : tab === 'pipeline' ? 'Pipeline' : 'Brands'}
          </button>
        ))}
      </div>

      {ops && (
        <div className="flex flex-wrap gap-4 bg-slate-900 border border-slate-800 rounded-xl px-4 py-3 text-xs">
          <span className="text-slate-400">AI ops (24h): <span className="text-white font-semibold">{ops.calls} calls</span></span>
          <span className="text-slate-400">Cost: <span className="text-emerald-400 font-semibold">₹{ops.costInr.toFixed(2)}</span></span>
          <span className="text-slate-400">Gemini fallbacks: <span className={ops.fallbacks > 0 ? 'text-amber-400 font-semibold' : 'text-white font-semibold'}>{ops.fallbacks}</span></span>
          <span className="text-slate-500 ml-auto">Last: {ops.lastAction}</span>
        </div>
      )}

      {/* Executive Command Center — real dashboard-engine v2 data */}
      <div className="flex items-center justify-between bg-slate-900/50 border border-slate-800 rounded-xl px-4 py-2">
        <span className="text-[11px] text-slate-500">
          {ecc ? `Live data as of ${new Date(ecc.generated_at ?? Date.now()).toLocaleTimeString()} — CEO briefing only regenerates once/day (~12:45am IST), everything else here is real-time on refresh` : 'Loading…'}
        </span>
        <button onClick={() => { loadExecCommandCenter(); }} className="flex items-center gap-1 text-[11px] text-blue-400 hover:text-blue-300">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/></svg>
          Refresh
        </button>
      </div>
      {eccError && (
        <div className="bg-red-950/40 border border-red-900 rounded-xl px-4 py-3 text-xs text-red-300">
          Executive Command Center data failed to load: {eccError}
        </div>
      )}

      {!eccLoading && ecc && (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          {([
            ['Today', ecc.revenue.today_inr],
            ['This Week', ecc.revenue.week_inr],
            ['MTD', ecc.revenue.mtd_inr],
            ['QTD', ecc.revenue.qtd_inr],
            ['YTD', ecc.revenue.ytd_inr],
          ] as const).map(([label, val]) => (
            <div key={label} className="bg-slate-900 rounded-xl border border-slate-800 p-3">
              <p className="text-[10px] text-slate-500 uppercase tracking-wider">{label} Revenue</p>
              <p className="text-lg font-bold text-white mt-1">{formatCurrency(val)}</p>
              {val === 0 && <p className="text-[9px] text-slate-600 mt-0.5">No payments collected yet</p>}
            </div>
          ))}
        </div>
      )}

      {/* CEO Daily Briefing intentionally lives in the Chairman's Command Center
          (strategic/enterprise intelligence), not here. This Dashboard is the
          operational-execution surface — no duplicated strategic widgets. */}

      {!eccLoading && ecc && (
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
          <div className="bg-slate-900 rounded-xl border border-slate-800 p-4 flex flex-col items-center justify-center">
            <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-2">Business Health</p>
            <div className="relative w-16 h-16">
              <svg width="64" height="64">
                <circle cx="32" cy="32" r="27" fill="none" stroke="#1e293b" strokeWidth="5" />
                <circle cx="32" cy="32" r="27" fill="none" stroke={healthColor(ecc.business_health_score)} strokeWidth="5"
                  strokeDasharray={2 * Math.PI * 27} strokeDashoffset={2 * Math.PI * 27 * (1 - ecc.business_health_score / 100)}
                  strokeLinecap="round" transform="rotate(-90 32 32)" />
              </svg>
              <span className="absolute inset-0 flex items-center justify-center text-sm font-bold text-white">{ecc.business_health_score}</span>
            </div>
          </div>

          <div className="lg:col-span-2 bg-slate-900 rounded-xl border border-slate-800 p-4">
            <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-2">Risk Indicators</p>
            {ecc.risk_indicators.length === 0 ? (
              <p className="text-xs text-slate-500">No risks flagged right now.</p>
            ) : (
              <div className="space-y-1.5 max-h-28 overflow-y-auto">
                {ecc.risk_indicators.map((r, i) => (
                  <div key={i} className="flex items-center justify-between text-xs">
                    <span className="text-slate-300 truncate">{r.area}: {r.risk}</span>
                    <span className={`text-[9px] uppercase font-semibold px-1.5 py-0.5 rounded-full shrink-0 ml-2 ${r.severity === 'high' ? 'bg-red-500/20 text-red-400' : r.severity === 'medium' ? 'bg-amber-500/20 text-amber-400' : 'bg-slate-700 text-slate-400'}`}>{r.severity}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="bg-slate-900 rounded-xl border border-slate-800 p-4">
            <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-2">Invoices by Status</p>
            <div className="space-y-1">
              {Object.entries(ecc.invoice_status_breakdown).length === 0 ? (
                <p className="text-xs text-slate-500">No invoices yet.</p>
              ) : (
                Object.entries(ecc.invoice_status_breakdown).map(([status, v]) => (
                  <div key={status} className="flex items-center justify-between text-xs">
                    <span className="text-slate-400 capitalize">{status.replace('_', ' ')}</span>
                    <span className="text-white font-medium">{v.count} · {formatCurrency(v.total_inr)}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {!eccLoading && ecc && currentYearMilestones.length > 0 && (
        <div className="bg-slate-900 rounded-xl border border-slate-800 p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-white">₹1,100 Cr Milestone Tracker — {new Date().getFullYear()}</h3>
            <span className="text-[10px] text-slate-500">Computed pacing from annual target, not a founder-set checkpoint</span>
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {currentYearMilestones.map((m, i) => {
              const pct = m.target_inr > 0 ? Math.min(100, Math.round((m.actual_inr / m.target_inr) * 100)) : 0;
              return (
                <div key={i} className="bg-slate-800/50 rounded-lg p-3">
                  <p className="text-[10px] text-slate-500">Q{m.quarter} {m.year}</p>
                  <p className="text-sm font-bold text-white mt-1">{formatCurrency(m.actual_inr)} <span className="text-slate-500 font-normal">/ {formatCurrency(m.target_inr)}</span></p>
                  <div className="h-1.5 bg-slate-700 rounded-full overflow-hidden mt-2">
                    <div className="h-full bg-blue-500/70 rounded-full" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {!eccLoading && ecc && ecc.agent_activity_feed.length > 0 && (
        <div className="bg-slate-900 rounded-xl border border-slate-800 p-5">
          <h3 className="text-sm font-semibold text-white mb-3">Recent Agent Activity</h3>
          <div className="space-y-1.5 max-h-48 overflow-y-auto">
            {ecc.agent_activity_feed.slice(0, 10).map((a, i) => (
              <div key={i} className="flex items-center justify-between text-xs">
                <span className="text-slate-300">{a.action}</span>
                <span className={`${a.status === 'failed' || a.status === 'error' ? 'text-red-400' : 'text-slate-500'}`}>{a.status} · {new Date(a.created_at).toLocaleTimeString()}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {loading && <div className="text-xs text-slate-500">Loading real data from Supabase…</div>}

      {!loading && activeTab === 'overview' && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <KPICard icon={DollarSign} label="Revenue Won (Invoiced)" value={formatCurrency(wonInvoiceTotal)}
              change={`${wonLeads.length} closed deals`} positive sparkline={revenueSparkline} color="#10b981" />
            <KPICard icon={Users} label="Active Leads" value={activeLeads.length.toString()}
              change={`${scopedLeads.length} total`} positive sparkline={[]} color="#3b82f6" />
            <KPICard icon={Target} label="Avg. Lead Score" value={`${avgScore}/100`}
              change={`${activeLeads.length} scored`} positive sparkline={[]} color="#f59e0b" />
            <KPICard icon={Activity} label="Conversion Rate" value={`${conversionRate}%`}
              change={`${lostLeads.length} lost`} positive={false} sparkline={[]} color="#8b5cf6" />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="lg:col-span-2 bg-slate-900 rounded-xl border border-slate-800 p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold text-white">Sales Pipeline Funnel</h3>
                <span className="text-[10px] text-slate-500">{scopedLeads.length} total leads</span>
              </div>
              <div className="space-y-2">
                {funnelData.map(f => {
                  const maxCount = Math.max(...funnelData.map(d => d.count), 1);
                  return (
                    <div key={f.stage} className="flex items-center gap-3">
                      <div className="w-24 text-right"><span className="text-[11px] text-slate-400">{f.label}</span></div>
                      <div className="flex-1 relative h-7">
                        <div className="absolute inset-0 bg-slate-800 rounded-md overflow-hidden">
                          <div className="h-full rounded-md transition-all duration-500 flex items-center pl-3"
                            style={{ width: `${Math.max((f.count / maxCount) * 100, f.count > 0 ? 15 : 0)}%`, backgroundColor: STAGE_COLORS[f.stage] + '30', borderLeft: `3px solid ${STAGE_COLORS[f.stage]}` }}>
                            <span className="text-[11px] font-semibold text-white">{f.count}</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="mt-3 pt-3 border-t border-slate-800 flex justify-between text-[11px]">
                <span className="text-slate-400">Lost: <span className="text-red-400 font-semibold">{lostLeads.length}</span></span>
                <span className="text-slate-400">Won (Invoiced): <span className="text-emerald-400 font-semibold">{formatCurrency(wonInvoiceTotal)}</span></span>
              </div>
            </div>

            <div className="bg-slate-900 rounded-xl border border-slate-800 p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold text-white">Top Leads</h3>
                <Target className="w-4 h-4 text-slate-500" />
              </div>
              <div className="space-y-3">
                {topLeads.length === 0 && <p className="text-[11px] text-slate-500">No active leads yet.</p>}
                {topLeads.map((lead, i) => (
                  <div key={lead.id || i} className="flex items-center gap-3">
                    <ScoreRing score={lead.lead_score || 0} size={34} />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-white truncate">{lead.contact_name || lead.company_name}</p>
                      <p className="text-[10px] text-slate-500">{brandName(lead.brand_id)} &middot; {lead.city || '—'}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs font-semibold text-white">
                        {invoicedByLead.has(lead.id) ? formatCurrency(invoicedByLead.get(lead.id)!) : <span className="text-slate-600">no invoice</span>}
                      </p>
                      <span className="text-[9px] px-1.5 py-0.5 rounded-full" style={{ backgroundColor: STAGE_COLORS[lead.stage] + '20', color: STAGE_COLORS[lead.stage] }}>
                        {STAGE_LABELS[lead.stage] || lead.stage}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="bg-slate-900 rounded-xl border border-slate-800 p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold text-white">Brand Performance</h3>
                <PieChart className="w-4 h-4 text-slate-500" />
              </div>
              <div className="space-y-3">
                {brandData.length === 0 && <p className="text-[11px] text-slate-500">No active brands found.</p>}
                {brandData.map(b => (
                  <div key={b.id} className="flex items-center gap-3 p-3 rounded-lg bg-slate-800/50 border border-slate-700/50">
                    <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ backgroundColor: b.color + '20' }}>
                      <BarChart3 className="w-4 h-4" style={{ color: b.color }} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-white">{b.name}</p>
                      <p className="text-[10px] text-slate-500">{b.sector || '—'}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs font-semibold text-white">{b.activeLeads} active</p>
                      <p className="text-[10px] text-emerald-400">{formatCurrency(b.wonRevenue)} won</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-slate-900 rounded-xl border border-slate-800 p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold text-white">Lead Sources</h3>
                <Zap className="w-4 h-4 text-slate-500" />
              </div>
              <div className="space-y-2 mb-5">
                {sources.length === 0 && <p className="text-[11px] text-slate-500">No source data yet.</p>}
                {sources.map(s => (
                  <div key={s.source} className="flex items-center gap-3">
                    <div className="flex-1">
                      <div className="flex justify-between mb-1">
                        <span className="text-[11px] text-slate-300">{s.source}</span>
                        <span className="text-[11px] text-slate-400">{s.count} leads &middot; {s.won} won</span>
                      </div>
                      <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
                        <div className="h-full bg-blue-500/60 rounded-full transition-all" style={{ width: `${(s.count / scopedLeads.length) * 100}%` }} />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <div className="border-t border-slate-800 pt-4">
                <h4 className="text-xs font-semibold text-white mb-3">Recent Activity</h4>
                <div className="space-y-2">
                  {recentLeads.length === 0 && <p className="text-[11px] text-slate-500">No leads yet.</p>}
                  {recentLeads.map((lead, i) => (
                    <div key={lead.id || i} className="flex items-center gap-2 text-[11px]">
                      <div className={`w-5 h-5 rounded-full flex items-center justify-center ${lead.stage === 'closed' ? 'bg-emerald-500/20' : 'bg-blue-500/20'}`}>
                        {lead.stage === 'closed' ? <CheckCircle className="w-3 h-3 text-emerald-400" /> : <Clock className="w-3 h-3 text-blue-400" />}
                      </div>
                      <span className="text-slate-300 flex-1 truncate"><span className="text-white font-medium">{lead.contact_name || lead.company_name}</span> — {brandName(lead.brand_id)}</span>
                      <span className="text-slate-500">{String(lead.created_at).slice(0, 10)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </>
      )}

      {!loading && activeTab === 'pipeline' && (
        <div className="bg-slate-900 rounded-xl border border-slate-800 overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-white">All Leads ({scopedLeads.length})</h3>
            <div className="flex gap-2 flex-wrap">
              {STAGES.concat('lost').map(stage => (
                <span key={stage} className="text-[10px] px-2 py-1 rounded-full" style={{ backgroundColor: STAGE_COLORS[stage] + '20', color: STAGE_COLORS[stage] }}>
                  {STAGE_LABELS[stage]}: {scopedLeads.filter(l => l.stage === stage).length}
                </span>
              ))}
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-slate-500 text-[10px] uppercase border-b border-slate-800">
                  <th className="text-left px-5 py-3 font-medium">Lead</th>
                  <th className="text-left px-3 py-3 font-medium">Brand</th>
                  <th className="text-left px-3 py-3 font-medium">City</th>
                  <th className="text-left px-3 py-3 font-medium">Source</th>
                  <th className="text-center px-3 py-3 font-medium">Score</th>
                  <th className="text-right px-3 py-3 font-medium">Invoiced</th>
                  <th className="text-center px-3 py-3 font-medium">Stage</th>
                  <th className="text-left px-5 py-3 font-medium">Date</th>
                </tr>
              </thead>
              <tbody>
                {scopedLeads.map((lead, i) => (
                  <tr key={lead.id || i} className="border-b border-slate-800/50 hover:bg-slate-800/30 transition-colors">
                    <td className="px-5 py-3"><span className="text-white font-medium">{lead.contact_name || lead.company_name}</span></td>
                    <td className="px-3 py-3 text-slate-300">{brandName(lead.brand_id)}</td>
                    <td className="px-3 py-3 text-slate-400">{lead.city || '—'}</td>
                    <td className="px-3 py-3 text-slate-400">{lead.lead_source || lead.source || '—'}</td>
                    <td className="px-3 py-3 text-center"><ScoreRing score={lead.lead_score || 0} size={30} /></td>
                    <td className="px-3 py-3 text-right text-white font-medium">
                      {invoicedByLead.has(lead.id) ? formatCurrency(invoicedByLead.get(lead.id)!) : <span className="text-slate-600">—</span>}
                    </td>
                    <td className="px-3 py-3 text-center">
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-medium" style={{ backgroundColor: STAGE_COLORS[lead.stage] + '20', color: STAGE_COLORS[lead.stage] }}>
                        {STAGE_LABELS[lead.stage] || lead.stage}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-slate-500">{String(lead.created_at).slice(0, 10)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {!loading && activeTab === 'brands' && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {brandData.length === 0 && <p className="text-[11px] text-slate-500">No active brands found in the database.</p>}
          {brandData.map(b => (
            <div key={b.id} className="bg-slate-900 rounded-xl border border-slate-800 p-5">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ backgroundColor: b.color + '20' }}>
                  <BarChart3 className="w-5 h-5" style={{ color: b.color }} />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-white">{b.name}</h3>
                  <p className="text-[10px] text-slate-500">{b.sector || '—'}</p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3 mb-4">
                <div className="bg-slate-800/50 rounded-lg p-3 text-center">
                  <p className="text-lg font-bold text-white">{b.leads}</p>
                  <p className="text-[10px] text-slate-500">Total Leads</p>
                </div>
                <div className="bg-slate-800/50 rounded-lg p-3 text-center">
                  <p className="text-lg font-bold text-white">{b.activeLeads}</p>
                  <p className="text-[10px] text-slate-500">Active</p>
                </div>
                <div className="bg-slate-800/50 rounded-lg p-3 text-center">
                  <p className="text-lg font-bold text-emerald-400">{formatCurrency(b.wonRevenue)}</p>
                  <p className="text-[10px] text-slate-500">Revenue Won</p>
                </div>
                <div className="bg-slate-800/50 rounded-lg p-3 text-center">
                  <p className="text-lg font-bold text-blue-400">{b.wonLeads}</p>
                  <p className="text-[10px] text-slate-500">Deals Closed</p>
                </div>
              </div>
              <div className="border-t border-slate-800 pt-3 flex justify-between text-[11px]">
                <span className="text-slate-500">Investment: <span className="text-white">{b.investment_range || '—'}</span></span>
                <span className="text-slate-500">Royalty: <span className="text-white">{b.royalty || '—'}</span></span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function KPICard({ icon: Icon, label, value, change, positive, sparkline, color }: {
  icon: any; label: string; value: string; change: string; positive: boolean;
  sparkline: number[]; color: string;
}) {
  return (
    <div className="bg-slate-900 rounded-xl border border-slate-800 p-4 flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: color + '15' }}>
            <Icon className="w-4 h-4" style={{ color }} />
          </div>
          <span className="text-[11px] text-slate-400">{label}</span>
        </div>
        <Sparkline data={sparkline} color={color} />
      </div>
      <div className="flex items-end justify-between">
        <p className="text-xl font-bold text-white">{value}</p>
        <span className={`flex items-center gap-0.5 text-[10px] font-medium ${positive ? 'text-emerald-400' : 'text-red-400'}`}>
          {positive ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
          {change}
        </span>
      </div>
    </div>
  );
}
