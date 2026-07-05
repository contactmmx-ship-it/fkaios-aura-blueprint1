'use client';
import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import {
  TrendingUp, TrendingDown, Users, DollarSign, Activity,
  ArrowUpRight, ArrowDownRight, Clock, CheckCircle, XCircle,
  Target, BarChart3, PieChart, Zap
} from 'lucide-react';


const BRANDS = [
  { name: 'Franchisee Kart', color: '#3b82f6', sector: 'Multi-brand Platform', minInvestment: '₹10L', maxInvestment: '₹50L' },
  { name: 'QuickShelf', color: '#10b981', sector: 'Q-Commerce Retail', minInvestment: '₹8L', maxInvestment: '₹25L' },
  { name: 'BrandBooster', color: '#f59e0b', sector: 'Marketing Franchise', minInvestment: '₹5L', maxInvestment: '₹20L' },
];

const STAGES = ['new', 'qualified', 'proposal', 'negotiation', 'won', 'lost'];
const STAGE_LABELS: Record<string, string> = { new: 'New', qualified: 'Qualified', proposal: 'Proposal', negotiation: 'Negotiation', won: 'Won', lost: 'Lost' };
const STAGE_COLORS: Record<string, string> = { new: '#6366f1', qualified: '#3b82f6', proposal: '#f59e0b', negotiation: '#f97316', won: '#10b981', lost: '#ef4444' };

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

// Mini sparkline using pure SVG
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

export default function Dashboard() {
  const [leads, setLeads] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'overview' | 'pipeline' | 'brands'>('overview');

  useEffect(() => {
    supabase.from('leads').select('*').then(({ data }) => {
      if (data && data.length > 0) setLeads(data);
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

  const activeLeads = leads.filter(l => !['won', 'lost'].includes(l.status));
  const wonLeads = leads.filter(l => l.status === 'won');
  const lostLeads = leads.filter(l => l.status === 'lost');
  const totalPipelineValue = activeLeads.reduce((s, l) => s + (l.value || 0), 0);
  const wonRevenue = wonLeads.reduce((s, l) => s + (l.value || 0), 0);
  const avgScore = activeLeads.length > 0 ? Math.round(activeLeads.reduce((s, l) => s + (l.score || 0), 0) / activeLeads.length) : 0;
  const conversionRate = leads.length > 0 ? Math.round((wonLeads.length / leads.length) * 100) : 0;

  // Pipeline funnel data
  const funnelData = STAGES.slice(0, 5).map(stage => ({
    stage,
    label: STAGE_LABELS[stage],
    count: leads.filter(l => l.status === stage).length,
    value: leads.filter(l => l.status === stage).reduce((s, l) => s + (l.value || 0), 0),
    color: STAGE_COLORS[stage],
  }));

  // Brand breakdown
  const brandData = BRANDS.map(b => {
    const bLeads = leads.filter(l => l.brand === b.name);
    return {
      ...b,
      leads: bLeads.length,
      activeLeads: bLeads.filter(l => !['won', 'lost'].includes(l.status)).length,
      wonLeads: bLeads.filter(l => l.status === 'won').length,
      pipelineValue: bLeads.filter(l => !['won', 'lost'].includes(l.status)).reduce((s, l) => s + (l.value || 0), 0),
      wonRevenue: bLeads.filter(l => l.status === 'won').reduce((s, l) => s + (l.value || 0), 0),
    };
  });

  // Source performance
  const sources = [...new Set(leads.map(l => l.source))].map(src => {
    const sLeads = leads.filter(l => l.source === src);
    return { source: src, count: sLeads.length, won: sLeads.filter(l => l.status === 'won').length, value: sLeads.reduce((s, l) => s + (l.value || 0), 0) };
  }).sort((a, b) => b.count - a.count);

  // Recent leads (last 5)
  const recentLeads = [...leads].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()).slice(0, 5);

  // Top leads by score
  const topLeads = [...activeLeads].sort((a, b) => (b.score || 0) - (a.score || 0)).slice(0, 5);

  // Monthly won-revenue sparkline from REAL leads (empty until enough data)
  const revenueSparkline = (() => {
    const byMonth = new Map<string, number>();
    for (const l of wonLeads) {
      if (!l.created_at) continue;
      const k = String(l.created_at).slice(0, 7);
      byMonth.set(k, (byMonth.get(k) || 0) + (l.value || 0));
    }
    const keys = [...byMonth.keys()].sort();
    return keys.map(k => byMonth.get(k) as number);
  })();

  return (
    <div className="space-y-6">
      {/* Tab bar */}
      <div className="flex gap-1 bg-slate-900 rounded-xl p-1 w-fit">
        {(['overview', 'pipeline', 'brands'] as const).map(tab => (
          <button key={tab} onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 rounded-lg text-xs font-medium transition-all cursor-pointer ${activeTab === tab ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'}`}>
            {tab === 'overview' ? 'Overview' : tab === 'pipeline' ? 'Pipeline' : 'Brands'}
          </button>
        ))}
      </div>

      {/* Live AI operations — real execution_log data */}
      {ops && (
        <div className="flex flex-wrap gap-4 bg-slate-900 border border-slate-800 rounded-xl px-4 py-3 text-xs">
          <span className="text-slate-400">AI ops (24h): <span className="text-white font-semibold">{ops.calls} calls</span></span>
          <span className="text-slate-400">Cost: <span className="text-emerald-400 font-semibold">₹{ops.costInr.toFixed(2)}</span></span>
          <span className="text-slate-400">Gemini fallbacks: <span className={ops.fallbacks > 0 ? 'text-amber-400 font-semibold' : 'text-white font-semibold'}>{ops.fallbacks}</span></span>
          <span className="text-slate-500 ml-auto">Last: {ops.lastAction}</span>
        </div>
      )}

      {activeTab === 'overview' && (
        <>
          {/* KPI Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <KPICard icon={DollarSign} label="Total Revenue (Won)" value={formatCurrency(wonRevenue)}
              change={`${wonLeads.length} won deals`} positive sparkline={revenueSparkline} color="#10b981" />
            <KPICard icon={Users} label="Active Leads" value={activeLeads.length.toString()}
              change={`${leads.length} total`} positive sparkline={[]} color="#3b82f6" />
            <KPICard icon={Target} label="Avg. Lead Score" value={`${avgScore}/100`}
              change={`${activeLeads.length} scored`} positive sparkline={[]} color="#f59e0b" />
            <KPICard icon={Activity} label="Conversion Rate" value={`${conversionRate}%`}
              change={`${lostLeads.length} lost`} positive={false} sparkline={[]} color="#8b5cf6" />
          </div>

          {/* Pipeline Funnel + Top Leads */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* Pipeline Funnel */}
            <div className="lg:col-span-2 bg-slate-900 rounded-xl border border-slate-800 p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold text-white">Sales Pipeline Funnel</h3>
                <span className="text-[10px] text-slate-500">{leads.length} total leads</span>
              </div>
              <div className="space-y-2">
                {funnelData.map((f, i) => (
                  <div key={f.stage} className="flex items-center gap-3">
                    <div className="w-20 text-right">
                      <span className="text-[11px] text-slate-400">{f.label}</span>
                    </div>
                    <div className="flex-1 relative h-7">
                      <div className="absolute inset-0 bg-slate-800 rounded-md overflow-hidden">
                        <div className="h-full rounded-md transition-all duration-500 flex items-center pl-3"
                          style={{ width: `${Math.max(f.count / Math.max(...funnelData.map(d => d.count)) * 100, 15)}%`, backgroundColor: f.color + '30', borderLeft: `3px solid ${f.color}` }}>
                          <span className="text-[11px] font-semibold text-white">{f.count}</span>
                        </div>
                      </div>
                    </div>
                    <div className="w-20 text-right">
                      <span className="text-[11px] text-slate-300">{formatCurrency(f.value)}</span>
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-3 pt-3 border-t border-slate-800 flex justify-between text-[11px]">
                <span className="text-slate-400">Total Pipeline: <span className="text-white font-semibold">{formatCurrency(totalPipelineValue)}</span></span>
                <span className="text-slate-400">Won: <span className="text-emerald-400 font-semibold">{formatCurrency(wonRevenue)}</span></span>
              </div>
            </div>

            {/* Top Leads */}
            <div className="bg-slate-900 rounded-xl border border-slate-800 p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold text-white">Top Leads</h3>
                <Target className="w-4 h-4 text-slate-500" />
              </div>
              <div className="space-y-3">
                {topLeads.map((lead, i) => (
                  <div key={lead.id || i} className="flex items-center gap-3">
                    <ScoreRing score={lead.score || 0} size={34} />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-white truncate">{lead.contact_name || lead.name}</p>
                      <p className="text-[10px] text-slate-500">{lead.brand} &middot; {lead.city}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs font-semibold text-white">{formatCurrency(lead.value || 0)}</p>
                      <span className="text-[9px] px-1.5 py-0.5 rounded-full" style={{ backgroundColor: STAGE_COLORS[lead.status] + '20', color: STAGE_COLORS[lead.status] }}>
                        {STAGE_LABELS[lead.status]}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Brand Cards + Source Performance */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Brand Performance */}
            <div className="bg-slate-900 rounded-xl border border-slate-800 p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold text-white">Brand Performance</h3>
                <PieChart className="w-4 h-4 text-slate-500" />
              </div>
              <div className="space-y-3">
                {brandData.map(b => (
                  <div key={b.name} className="flex items-center gap-3 p-3 rounded-lg bg-slate-800/50 border border-slate-700/50">
                    <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ backgroundColor: b.color + '20' }}>
                      <BarChart3 className="w-4 h-4" style={{ color: b.color }} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-white">{b.name}</p>
                      <p className="text-[10px] text-slate-500">{b.sector}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs font-semibold text-white">{b.activeLeads} active</p>
                      <p className="text-[10px] text-emerald-400">{formatCurrency(b.wonRevenue)} won</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Source Performance + Recent Activity */}
            <div className="bg-slate-900 rounded-xl border border-slate-800 p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold text-white">Lead Sources</h3>
                <Zap className="w-4 h-4 text-slate-500" />
              </div>
              <div className="space-y-2 mb-5">
                {sources.map(s => (
                  <div key={s.source} className="flex items-center gap-3">
                    <div className="flex-1">
                      <div className="flex justify-between mb-1">
                        <span className="text-[11px] text-slate-300">{s.source}</span>
                        <span className="text-[11px] text-slate-400">{s.count} leads &middot; {s.won} won</span>
                      </div>
                      <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
                        <div className="h-full bg-blue-500/60 rounded-full transition-all" style={{ width: `${(s.count / leads.length) * 100}%` }} />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <div className="border-t border-slate-800 pt-4">
                <h4 className="text-xs font-semibold text-white mb-3">Recent Activity</h4>
                <div className="space-y-2">
                  {recentLeads.map((lead, i) => (
                    <div key={lead.id || i} className="flex items-center gap-2 text-[11px]">
                      <div className={`w-5 h-5 rounded-full flex items-center justify-center ${lead.status === 'won' ? 'bg-emerald-500/20' : 'bg-blue-500/20'}`}>
                        {lead.status === 'won' ? <CheckCircle className="w-3 h-3 text-emerald-400" /> : <Clock className="w-3 h-3 text-blue-400" />}
                      </div>
                      <span className="text-slate-300 flex-1 truncate"><span className="text-white font-medium">{lead.contact_name || lead.name}</span> — {lead.brand}</span>
                      <span className="text-slate-500">{lead.created_at}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </>
      )}

      {activeTab === 'pipeline' && (
        <div className="bg-slate-900 rounded-xl border border-slate-800 overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-white">All Leads ({leads.length})</h3>
            <div className="flex gap-2">
              {STAGES.map(stage => (
                <span key={stage} className="text-[10px] px-2 py-1 rounded-full" style={{ backgroundColor: STAGE_COLORS[stage] + '20', color: STAGE_COLORS[stage] }}>
                  {STAGE_LABELS[stage]}: {leads.filter(l => l.status === stage).length}
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
                  <th className="text-right px-3 py-3 font-medium">Value</th>
                  <th className="text-center px-3 py-3 font-medium">Stage</th>
                  <th className="text-left px-5 py-3 font-medium">Date</th>
                </tr>
              </thead>
              <tbody>
                {leads.map((lead, i) => (
                  <tr key={lead.id || i} className="border-b border-slate-800/50 hover:bg-slate-800/30 transition-colors">
                    <td className="px-5 py-3">
                      <span className="text-white font-medium">{lead.contact_name || lead.name}</span>
                    </td>
                    <td className="px-3 py-3 text-slate-300">{lead.brand}</td>
                    <td className="px-3 py-3 text-slate-400">{lead.city}</td>
                    <td className="px-3 py-3 text-slate-400">{lead.source}</td>
                    <td className="px-3 py-3 text-center"><ScoreRing score={lead.score || 0} size={30} /></td>
                    <td className="px-3 py-3 text-right text-white font-medium">{formatCurrency(lead.value || 0)}</td>
                    <td className="px-3 py-3 text-center">
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-medium" style={{ backgroundColor: STAGE_COLORS[lead.status] + '20', color: STAGE_COLORS[lead.status] }}>
                        {STAGE_LABELS[lead.status]}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-slate-500">{lead.created_at}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === 'brands' && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {brandData.map(b => (
            <div key={b.name} className="bg-slate-900 rounded-xl border border-slate-800 p-5">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ backgroundColor: b.color + '20' }}>
                  <BarChart3 className="w-5 h-5" style={{ color: b.color }} />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-white">{b.name}</h3>
                  <p className="text-[10px] text-slate-500">{b.sector}</p>
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
                  <p className="text-lg font-bold text-blue-400">{formatCurrency(b.pipelineValue)}</p>
                  <p className="text-[10px] text-slate-500">Pipeline</p>
                </div>
              </div>
              <div className="border-t border-slate-800 pt-3 flex justify-between text-[11px]">
                <span className="text-slate-500">Investment: <span className="text-white">{b.minInvestment} – {b.maxInvestment}</span></span>
                <span className="text-slate-500">Won: <span className="text-emerald-400">{b.wonLeads}</span></span>
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