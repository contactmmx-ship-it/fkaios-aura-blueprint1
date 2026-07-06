'use client';
import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/lib/supabase';

// ─── Demo data (used when Supabase returns empty) ───
const DEMO_LEADS = [
  { id: 'l1', contact_name: 'Rajesh Kumar', status: 'qualified', value: 2500000, score: 92, source: 'Website', brand: 'Franchisee Kart', created_at: '2025-12-01' },
  { id: 'l2', contact_name: 'Priya Sharma', status: 'proposal', value: 1800000, score: 78, source: 'Referral', brand: 'Franchisee Kart', created_at: '2025-11-20' },
  { id: 'l3', contact_name: 'Amit Patel', status: 'negotiation', value: 3200000, score: 85, source: 'LinkedIn', brand: 'QuickShelf', created_at: '2025-11-15' },
  { id: 'l4', contact_name: 'Sneha Verma', status: 'new', value: 1500000, score: 45, source: 'Instagram', brand: 'BrandBooster', created_at: '2025-12-10' },
  { id: 'l5', contact_name: 'Vikram Singh', status: 'won', value: 4200000, score: 96, source: 'Referral', brand: 'Franchisee Kart', created_at: '2025-10-05' },
  { id: 'l6', contact_name: 'Anita Desai', status: 'qualified', value: 2100000, score: 71, source: 'Website', brand: 'QuickShelf', created_at: '2025-11-28' },
  { id: 'l7', contact_name: 'Karan Mehta', status: 'lost', value: 1900000, score: 38, source: 'Cold Call', brand: 'BrandBooster', created_at: '2025-10-20' },
  { id: 'l8', contact_name: 'Deepika Nair', status: 'proposal', value: 3800000, score: 82, source: 'LinkedIn', brand: 'Franchisee Kart', created_at: '2025-11-10' },
  { id: 'l9', contact_name: 'Rohit Gupta', status: 'new', value: 1200000, score: 52, source: 'Website', brand: 'QuickShelf', created_at: '2025-12-12' },
  { id: 'l10', contact_name: 'Meera Joshi', status: 'negotiation', value: 2900000, score: 88, source: 'Referral', brand: 'BrandBooster', created_at: '2025-11-05' },
];

const DEMO_AGENTS = [
  { id: 'a1', name: 'Lead Qualifier', status: 'active', category: 'sales', tasks_completed: 147, success_rate: 89, avg_response_time: '1.2s', color: '#3b82f6', description: 'Automated lead scoring and qualification using CRM data analysis' },
  { id: 'a2', name: 'Objection Handler', status: 'active', category: 'sales', tasks_completed: 98, success_rate: 82, avg_response_time: '0.8s', color: '#8b5cf6', description: 'Handles common franchise buyer objections with data-driven responses' },
  { id: 'a3', name: 'Pipeline Predictor', status: 'active', category: 'intelligence', tasks_completed: 64, success_rate: 91, avg_response_time: '2.1s', color: '#10b981', description: 'AI pipeline forecasting using historical conversion data' },
  { id: 'a4', name: 'Follow-up Scheduler', status: 'paused', category: 'productivity', tasks_completed: 210, success_rate: 95, avg_response_time: '0.5s', color: '#f59e0b', description: 'Smart follow-up timing optimization based on lead engagement' },
  { id: 'a5', name: 'Competitive Intel', status: 'active', category: 'intelligence', tasks_completed: 35, success_rate: 78, avg_response_time: '3.4s', color: '#ef4444', description: 'Market intelligence and competitive analysis for franchise positioning' },
  { id: 'a6', name: 'Revenue Optimizer', status: 'active', category: 'finance', tasks_completed: 52, success_rate: 86, avg_response_time: '1.8s', color: '#06b6d4', description: 'Pricing strategy and revenue optimization for franchise deals' },
];

const STATUS_COLORS: Record<string, string> = {
  new: 'bg-slate-500', qualified: 'bg-blue-500', proposal: 'bg-amber-500', negotiation: 'bg-purple-500', won: 'bg-emerald-500', lost: 'bg-red-500',
};

type TabId = 'overview' | 'agents' | 'lead-scoring' | 'sales-tools' | 'analytics' | 'sales-executive';

// ─── Mini sparkline using pure SVG ───
function Sparkline({ data, color, h = 32 }: { data: number[]; color: string; h?: number }) {
  const w = 100;
  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const range = max - min || 1;
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * w;
    const y = h - ((v - min) / range) * (h - 4) - 2;
    return `${x},${y}`;
  }).join(' ');
  return (
    <svg width={w} height={h} className="inline-block">
      <polyline points={pts} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ─── Progress Ring ───
function ProgressRing({ pct, size = 48, stroke = 4, color }: { pct: number; size?: number; stroke?: number; color: string }) {
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const offset = circ - (pct / 100) * circ;
  return (
    <svg width={size} height={size} className="inline-block -rotate-90">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#1e293b" strokeWidth={stroke} />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke} strokeDasharray={circ} strokeDashoffset={offset} strokeLinecap="round" />
    </svg>
  );
}

// ─── Score bar ───
function ScoreBar({ score }: { score: number }) {
  const color = score >= 80 ? '#10b981' : score >= 60 ? '#f59e0b' : '#ef4444';
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-2 bg-slate-800 rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all duration-700" style={{ width: `${score}%`, backgroundColor: color }} />
      </div>
      <span className="text-xs font-mono font-bold" style={{ color }}>{score}</span>
    </div>
  );
}

export default function AuraBlueprint() {
  const [activeTab, setActiveTab] = useState<TabId>('overview');
  const [leads, setLeads] = useState(DEMO_LEADS);
  const [agents, setAgents] = useState(DEMO_AGENTS);
  const [chatInput, setChatInput] = useState('');
  const [chatMessages, setChatMessages] = useState<{ role: string; content: string }[]>([]);
  const [chatLoading, setChatLoading] = useState(false);
  const [execChatMessages, setExecChatMessages] = useState<{ role: string; content: string; typing?: boolean }[]>([]);
  const [execChatInput, setExecChatInput] = useState('');
  const [execChatLoading, setExecChatLoading] = useState(false);
  const [selectedLead, setSelectedLead] = useState<string | null>(null);
  const [execTone, setExecTone] = useState<'professional' | 'friendly' | 'aggressive'>('professional');
  const execChatEndRef = useRef<HTMLDivElement>(null);
  const [selectedTool, setSelectedTool] = useState<string | null>(null);
  const [toolResult, setToolResult] = useState('');
  const [toolLoading, setToolLoading] = useState(false);
  const [timeRange, setTimeRange] = useState('30d');
  const [brainConvId, setBrainConvId] = useState<string | null>(null);
  // brain-engine's 'message' action requires a conversationId (was never sent
  // before -> every call 400'd -> UI silently fell back to a keyword-matched
  // canned-template reply using fake DEMO data, which is why every question
  // got a near-identical templated answer). This lazily creates one real
  // conversation and reuses it.
  const ensureBrainConversation = useCallback(async (): Promise<string | null> => {
    if (brainConvId) return brainConvId;
    const { data, error } = await supabase.functions.invoke('brain-engine', { body: { action: 'create' } });
    if (error || !data?.id) return null;
    setBrainConvId(data.id);
    return data.id;
  }, [brainConvId]);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Fetch live data on mount
  useEffect(() => {
    supabase.from('leads').select('*').order('created_at', { ascending: false }).limit(50).then(({ data }) => {
      if (data && data.length > 0) {
        setLeads(data.map((d: any) => ({
          id: d.id, contact_name: (d as any).contact_name || (d as any).name || 'Unknown',
          status: d.status || 'new', value: d.value || d.investment_amount || 0,
          score: d.lead_score ?? null, source: d.source || 'N/A',
          brand: d.brand || 'Franchise Kart', created_at: d.created_at,
        })));
      }
    }).catch(() => {});
    supabase.from('brain_agents').select('*').eq('status', 'active').order('name').then(({ data }) => {
      if (data && data.length > 0) {
        setAgents(data.map((a: any) => ({
          id: a.id, name: a.name, status: a.status || 'active', category: a.category || 'sales',
          tasks_completed: a.tasks_completed || 0, success_rate: a.success_rate || 80,
          avg_response_time: a.avg_response_time || '1.0s', color: a.color || '#8b5cf6',
          description: a.description || 'AI Agent',
        })));
      }
    }).catch(() => {});
  }, []);

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [chatMessages]);

  // ─── Computed KPIs ───
  const totalLeads = leads.length;
  const totalPipeline = leads.filter(l => !['won', 'lost'].includes(l.status)).reduce((s, l) => s + (l.value || 0), 0);
  const wonRevenue = leads.filter(l => l.status === 'won').reduce((s, l) => s + (l.value || 0), 0);
  const avgScore = Math.round(leads.reduce((s, l) => s + (l.score || 0), 0) / (leads.length || 1));
  const conversionRate = totalLeads > 0 ? Math.round((leads.filter(l => l.status === 'won').length / totalLeads) * 100) : 0;
  const activeAgents = agents.filter(a => a.status === 'active').length;

  // Pipeline by stage
  const stages = ['new', 'qualified', 'proposal', 'negotiation', 'won', 'lost'];
  const stageCounts = stages.map(s => leads.filter(l => l.status === s).length);
  const stageValues = stages.map(s => leads.filter(l => l.status === s).reduce((sum, l) => sum + (l.value || 0), 0));

  // ─── Sales AI Tools ───
  const salesTools = [
    { id: 'qualify', label: 'Qualify Lead', icon: '🎯', desc: 'Run AI qualification on a lead — checks budget, authority, need, timeline', prompt: 'Analyze the top leads and provide qualification recommendations. Score each lead on BANT criteria (Budget, Authority, Need, Timeline).' },
    { id: 'objection', label: 'Objection Handler', icon: '🛡️', desc: 'Get AI-crafted responses to common franchise buyer objections', prompt: 'Generate responses to the top 5 most common objections franchise buyers have, with data-backed counter-arguments.' },
    { id: 'forecast', label: 'Pipeline Forecast', icon: '📊', desc: 'AI-powered revenue forecast based on pipeline stages and historical data', prompt: 'Based on the current pipeline of ' + totalLeads + ' leads worth ₹' + (totalPipeline / 100000).toFixed(1) + 'L, provide a 90-day revenue forecast with confidence intervals.' },
    { id: 'followup', label: 'Follow-up Plan', icon: '📅', desc: 'Generate smart follow-up schedules for leads based on engagement scores', prompt: 'Create a follow-up priority plan for all leads. Prioritize by score and last interaction, with recommended channels and messaging.' },
    { id: 'competitor', label: 'Competitive Intel', icon: '🔍', desc: 'Analyze competitive positioning for franchise brands in the portfolio', prompt: 'Analyze competitive landscape for our franchise brands. Identify top 3 competitors per brand and suggest differentiation strategies.' },
    { id: 'pricing', label: 'Deal Optimizer', icon: '💰', desc: 'Get AI pricing recommendations to maximize close rates and deal values', prompt: 'Analyze all open deals and recommend optimal pricing strategies. Identify deals where discounts could accelerate closing vs. deals where we should hold firm on price.' },
  ];

  // ─── Tool execution via brain-engine ───
  const executeTool = useCallback(async (tool: typeof salesTools[0]) => {
    setSelectedTool(tool.id);
    setToolResult('');
    setToolLoading(true);
    try {
      const convId = await ensureBrainConversation();
      if (!convId) throw new Error('Could not start a brain conversation');
      const { data, error } = await supabase.functions.invoke('brain-engine', {
        body: { action: 'message', conversationId: convId, message: tool.prompt }
      });
      if (error || data?.error) throw new Error(data?.error || error?.message || 'brain-engine call failed');
      if (data?.message?.content) {
        setToolResult(data.message.content);
      } else if (data?.output) {
        setToolResult(data.output);
      } else {
        // HONESTY FIX (2026-07-05): previously fell back to generateToolFallback,
        // a client-side template that fabricated a report from local data and
        // presented it as an AI tool result. Per the no-fake-data rule, a failed
        // real call now says so plainly instead of showing invented output.
        setToolResult('⚠ The AI engine did not return a result for this tool. This is a real error, not a report — please retry, and if it persists check the brain-engine function logs in Supabase.');
      }
    } catch (e) {
      setToolResult(`⚠ AI engine call failed: ${e instanceof Error ? e.message : 'unknown error'}. No result was generated — this message is shown instead of a fabricated fallback report.`);
    }
    setToolLoading(false);
  }, [leads, agents]);

  // ─── Chat via brain-engine ───
  const sendChat = async () => {
    if (!chatInput.trim() || chatLoading) return;
    const msg = chatInput.trim();
    setChatInput('');
    setChatLoading(true);
    setChatMessages(prev => [...prev, { role: 'user', content: msg }]);
    try {
      const convId = await ensureBrainConversation();
      if (!convId) throw new Error('Could not start a brain conversation');
      const { data, error } = await supabase.functions.invoke('brain-engine', {
        body: { action: 'message', conversationId: convId, message: msg }
      });
      if (error || data?.error) throw new Error(data?.error || error?.message || 'brain-engine call failed');
      const reply = data?.message?.content || data?.output;
      if (!reply) throw new Error('brain-engine returned no content');
      setChatMessages(prev => [...prev, { role: 'assistant', content: reply }]);
    } catch (e) {
      // HONESTY FIX: this used to silently show generateSmartReply(), a
      // keyword-matched template over fake DEMO_LEADS/DEMO_AGENTS data — the
      // literal cause of "every question gets the same wrong answer". A real
      // failure now says so.
      setChatMessages(prev => [...prev, { role: 'assistant', content: `⚠ AI engine error: ${e instanceof Error ? e.message : 'unknown error'}. Please retry.` }]);
    }
    setChatLoading(false);
  };

  // ─── Toggle agent ───
  const toggleAgent = (id: string) => {
    setAgents(prev => prev.map(a => a.id === id ? { ...a, status: a.status === 'active' ? 'paused' : 'active' } : a));
  };

  // ─── Trend data (simulated from pipeline) ───
  const trendData = [65, 72, 68, 80, 75, 82, 90, 85, 88, 92, 87, avgScore];

  // ─── Tabs ───
  const tabs: { id: TabId; label: string; icon: string }[] = [
    { id: 'overview', label: 'Overview', icon: '◈' },
    { id: 'agents', label: 'Sales Agents', icon: '⚡' },
    { id: 'lead-scoring', label: 'Lead Scoring', icon: '🎯' },
    { id: 'sales-tools', label: 'AI Tools', icon: '🛠️' },
    { id: 'analytics', label: 'Analytics', icon: '📈' },
    { id: 'sales-executive', label: 'Sales Executive AI', icon: '🤝' },
  ];

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500 via-fuchsia-500 to-pink-500 flex items-center justify-center shadow-lg shadow-purple-500/30">
            <span className="text-white text-sm font-bold">A</span>
          </div>
          <div>
            <h1 className="text-lg font-bold text-white">AURA Blueprint</h1>
            <p className="text-[11px] text-slate-400">Autonomous Unified Revenue Architecture — AI-powered sales intelligence system</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <select value={timeRange} onChange={e => setTimeRange(e.target.value)}
            className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-slate-300 focus:outline-none focus:border-purple-500 cursor-pointer">
            <option value="7d">Last 7 Days</option>
            <option value="30d">Last 30 Days</option>
            <option value="90d">Last 90 Days</option>
          </select>
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/20">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-[10px] text-emerald-400 font-medium">{activeAgents} Agents Active</span>
          </div>
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 bg-slate-900 p-1 rounded-xl border border-slate-800 overflow-x-auto">
        {tabs.map(t => (
          <button key={t.id} onClick={() => setActiveTab(t.id)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-medium transition-all whitespace-nowrap cursor-pointer ${
              activeTab === t.id ? 'bg-purple-600 text-white shadow-lg shadow-purple-600/30' : 'text-slate-400 hover:text-white hover:bg-slate-800'
            }`}>
            <span>{t.icon}</span> {t.label}
          </button>
        ))}
      </div>

      {/* ═══════════ OVERVIEW TAB ═══════════ */}
      {activeTab === 'overview' && (
        <div className="space-y-4">
          {/* KPI Cards */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            {[
              { label: 'Total Leads', value: totalLeads, suffix: '', color: '#3b82f6', spark: stageCounts },
              { label: 'Pipeline Value', value: `₹${(totalPipeline / 100000).toFixed(1)}L`, suffix: '', color: '#8b5cf6', spark: stageValues.map(v => v / 100000) },
              { label: 'Won Revenue', value: `₹${(wonRevenue / 100000).toFixed(1)}L`, suffix: '', color: '#10b981', spark: [10, 20, 15, 25, 30, wonRevenue / 100000] },
              { label: 'Avg Score', value: avgScore, suffix: '/100', color: '#f59e0b', spark: trendData },
              { label: 'Conversion', value: conversionRate, suffix: '%', color: '#06b6d4', spark: [5, 8, 10, 12, 15, conversionRate] },
              { label: 'Active Agents', value: activeAgents, suffix: `/${agents.length}`, color: '#ec4899', spark: [2, 3, 4, 5, 5, activeAgents] },
            ].map(kpi => (
              <div key={kpi.label} className="bg-slate-900 border border-slate-800 rounded-xl p-3 hover:border-slate-700 transition-all">
                <p className="text-[10px] text-slate-500 uppercase tracking-wider font-medium">{kpi.label}</p>
                <div className="flex items-end justify-between mt-2">
                  <div>
                    <span className="text-xl font-bold text-white">{kpi.value}</span>
                    <span className="text-xs text-slate-500 ml-0.5">{kpi.suffix}</span>
                  </div>
                  <Sparkline data={kpi.spark} color={kpi.color} />
                </div>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* Pipeline Funnel */}
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 lg:col-span-2">
              <h3 className="text-sm font-semibold text-white mb-4">Pipeline Funnel</h3>
              <div className="space-y-2">
                {stages.map((stage, i) => {
                  const count = stageCounts[i];
                  const val = stageValues[i];
                  const pct = totalLeads > 0 ? (count / totalLeads) * 100 : 0;
                  return (
                    <div key={stage} className="flex items-center gap-3">
                      <span className="text-[10px] text-slate-500 w-20 text-right capitalize">{stage}</span>
                      <div className="flex-1 h-7 bg-slate-800 rounded-lg overflow-hidden relative">
                        <div className="h-full rounded-lg transition-all duration-700 flex items-center px-3"
                          style={{ width: `${Math.max(pct, 8)}%`, backgroundColor: STATUS_COLORS[stage] + '40', borderLeft: `3px solid ${STATUS_COLORS[stage]}` }}>
                          <span className="text-[10px] font-medium text-white">{count} leads</span>
                        </div>
                      </div>
                      <span className="text-[10px] text-slate-400 w-20 text-right font-mono">₹{(val / 100000).toFixed(1)}L</span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Agent Status Summary */}
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
              <h3 className="text-sm font-semibold text-white mb-4">Agent Health</h3>
              <div className="space-y-3">
                {agents.slice(0, 4).map(agent => (
                  <div key={agent.id} className="flex items-center gap-3">
                    <ProgressRing pct={agent.success_rate} size={36} stroke={3} color={agent.color} />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-white truncate">{agent.name}</p>
                      <p className="text-[10px] text-slate-500">{agent.tasks_completed} tasks · {agent.avg_response_time}</p>
                    </div>
                    <button onClick={() => toggleAgent(agent.id)}
                      className={`w-8 h-4 rounded-full transition-colors cursor-pointer relative ${agent.status === 'active' ? 'bg-emerald-500' : 'bg-slate-700'}`}>
                      <span className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform ${agent.status === 'active' ? 'translate-x-4' : 'translate-x-0.5'}`} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Quick AI Chat */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-800 flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center">
                <span className="text-white text-[10px] font-bold">AI</span>
              </div>
              <div>
                <h3 className="text-sm font-semibold text-white">AURA Sales Assistant</h3>
                <p className="text-[10px] text-slate-500">Ask anything about your pipeline, leads, or strategy</p>
              </div>
            </div>
            <div className="h-48 overflow-y-auto p-4 space-y-3">
              {chatMessages.length === 0 ? (
                <div className="flex items-center justify-center h-full">
                  <div className="text-center">
                    <p className="text-xs text-slate-500">Ask AURA about your sales performance...</p>
                    <div className="flex gap-2 mt-3 justify-center flex-wrap">
                      {['What is my pipeline value?', 'Which leads need attention?', 'Forecast next quarter'].map(q => (
                        <button key={q} onClick={() => setChatInput(q)}
                          className="px-3 py-1.5 rounded-lg border border-slate-700 text-[10px] text-slate-400 hover:text-white hover:border-purple-500/30 transition-all cursor-pointer">
                          {q}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              ) : (
                chatMessages.map((m, i) => (
                  <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[80%] rounded-lg px-3 py-2 text-xs ${m.role === 'user' ? 'bg-purple-600 text-white' : 'bg-slate-800 text-slate-200'}`}>
                      {m.role === 'assistant' && <p className="text-[9px] text-purple-400 mb-0.5">AURA</p>}
                      <p className="whitespace-pre-wrap">{m.content}</p>
                    </div>
                  </div>
                ))
              )}
              {chatLoading && <div className="text-xs text-slate-500 animate-pulse">AURA is analyzing...</div>}
              <div ref={chatEndRef} />
            </div>
            <div className="p-3 border-t border-slate-800">
              <form onSubmit={e => { e.preventDefault(); sendChat(); }} className="flex gap-2">
                <input value={chatInput} onChange={e => setChatInput(e.target.value)}
                  placeholder="Ask AURA anything about your sales..."
                  disabled={chatLoading} className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-purple-500" />
                <button type="submit" disabled={chatLoading || !chatInput.trim()}
                  className="px-3 py-2 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white rounded-lg text-xs font-medium transition-colors cursor-pointer">
                  Send
                </button>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* ═══════════ AGENTS TAB ═══════════ */}
      {activeTab === 'agents' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-xs text-slate-400">{agents.length} sales agents configured · {activeAgents} currently active</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {agents.map(agent => (
              <div key={agent.id} className={`bg-slate-900 border rounded-xl p-4 transition-all ${agent.status === 'active' ? 'border-slate-700' : 'border-slate-800 opacity-60'}`}>
                <div className="flex items-start justify-between">
                  <div className="w-10 h-10 rounded-lg flex items-center justify-center text-white text-sm font-bold" style={{ backgroundColor: agent.color + '30', color: agent.color }}>
                    {agent.name.charAt(0)}
                  </div>
                  <button onClick={() => toggleAgent(agent.id)}
                    className={`px-2.5 py-1 rounded-full text-[10px] font-medium transition-colors cursor-pointer ${
                      agent.status === 'active' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-slate-800 text-slate-500 border border-slate-700'
                    }`}>
                    {agent.status === 'active' ? '● Active' : '○ Paused'}
                  </button>
                </div>
                <h3 className="text-sm font-semibold text-white mt-3">{agent.name}</h3>
                <p className="text-[11px] text-slate-400 mt-1 line-clamp-2">{agent.description}</p>

                <div className="grid grid-cols-3 gap-2 mt-3 pt-3 border-t border-slate-800">
                  <div>
                    <p className="text-[9px] text-slate-500 uppercase">Tasks</p>
                    <p className="text-sm font-bold text-white">{agent.tasks_completed}</p>
                  </div>
                  <div>
                    <p className="text-[9px] text-slate-500 uppercase">Success</p>
                    <p className="text-sm font-bold" style={{ color: agent.color }}>{agent.success_rate}%</p>
                  </div>
                  <div>
                    <p className="text-[9px] text-slate-500 uppercase">Speed</p>
                    <p className="text-sm font-bold text-white">{agent.avg_response_time}</p>
                  </div>
                </div>

                <div className="mt-3">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[9px] text-slate-500">Success Rate</span>
                    <span className="text-[9px] font-mono" style={{ color: agent.color }}>{agent.success_rate}%</span>
                  </div>
                  <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
                    <div className="h-full rounded-full transition-all duration-700" style={{ width: `${agent.success_rate}%`, backgroundColor: agent.color }} />
                  </div>
                </div>

                <button onClick={() => executeTool(salesTools.find(t => t.id === 'qualify')!)}
                  className="w-full mt-3 py-2 rounded-lg border border-slate-700 text-xs text-slate-300 hover:bg-slate-800 hover:text-white transition-colors cursor-pointer">
                  Test Agent
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ═══════════ LEAD SCORING TAB ═══════════ */}
      {activeTab === 'lead-scoring' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-slate-400">{totalLeads} leads scored · Average: {avgScore}/100</p>
            </div>
            <div className="flex gap-2">
              {['All', 'Hot (80+)', 'Warm (60-79)', 'Cold (<60)'].map(f => (
                <button key={f} className="px-3 py-1 rounded-full text-[10px] bg-slate-800 text-slate-400 hover:text-white transition-colors cursor-pointer">{f}</button>
              ))}
            </div>
          </div>

          {/* Score distribution */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
            <h3 className="text-sm font-semibold text-white mb-4">Score Distribution</h3>
            <div className="flex items-end gap-1 h-32">
              {leads.sort((a, b) => b.score - a.score).map((lead, i) => {
                const h = (lead.score / 100) * 100;
                const color = lead.score >= 80 ? '#10b981' : lead.score >= 60 ? '#f59e0b' : '#ef4444';
                return (
                  <div key={lead.id} className="flex-1 flex flex-col items-center gap-1 group relative">
                    <div className="absolute -top-16 bg-slate-800 border border-slate-700 rounded-lg p-2 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10 min-w-[140px]">
                      <p className="text-[10px] font-medium text-white">{(lead as any).contact_name}</p>
                      <p className="text-[9px] text-slate-400">{lead.brand} · {lead.status}</p>
                      <p className="text-[9px] text-slate-400">₹{(lead.value / 100000).toFixed(1)}L · {lead.source}</p>
                    </div>
                    <div className="w-full rounded-t transition-all duration-500 hover:opacity-80" style={{ height: `${h}%`, backgroundColor: color, minHeight: 4 }} />
                    <span className="text-[8px] text-slate-500 font-mono">{lead.score}</span>
                  </div>
                );
              })}
            </div>
            <div className="flex items-center gap-4 mt-3 justify-center">
              <span className="flex items-center gap-1.5 text-[10px] text-slate-400"><span className="w-2.5 h-2.5 rounded-sm bg-emerald-500" /> Hot (80+)</span>
              <span className="flex items-center gap-1.5 text-[10px] text-slate-400"><span className="w-2.5 h-2.5 rounded-sm bg-amber-500" /> Warm (60-79)</span>
              <span className="flex items-center gap-1.5 text-[10px] text-slate-400"><span className="w-2.5 h-2.5 rounded-sm bg-red-500" /> Cold (&lt;60)</span>
            </div>
          </div>

          {/* Lead list with scores */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-white">All Leads</h3>
              <button onClick={() => executeTool(salesTools.find(t => t.id === 'qualify')!)}
                className="px-3 py-1.5 rounded-lg bg-purple-600/20 text-purple-400 text-[10px] font-medium hover:bg-purple-600/30 transition-colors cursor-pointer border border-purple-500/20">
                AI Re-Score All
              </button>
            </div>
            <div className="divide-y divide-slate-800/50 max-h-[400px] overflow-y-auto">
              {leads.sort((a, b) => b.score - a.score).map(lead => (
                <div key={lead.id} className="px-4 py-3 flex items-center gap-4 hover:bg-slate-800/30 transition-colors">
                  <div className="w-8 h-8 rounded-full bg-slate-800 flex items-center justify-center text-xs font-bold text-slate-400">
                    {(lead as any).contact_name?.charAt(0) || '?'}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-white truncate">{(lead as any).contact_name}</p>
                    <p className="text-[10px] text-slate-500">{lead.brand} · {lead.source} · {new Date(lead.created_at).toLocaleDateString()}</p>
                  </div>
                  <div className="w-10 h-10 rounded-full flex items-center justify-center">
                    <ProgressRing pct={lead.score} size={36} stroke={3} color={lead.score >= 80 ? '#10b981' : lead.score >= 60 ? '#f59e0b' : '#ef4444'} />
                  </div>
                  <div className="w-32">
                    <ScoreBar score={lead.score} />
                  </div>
                  <span className={`text-[9px] px-2 py-0.5 rounded-full ${STATUS_COLORS[lead.status] || 'bg-slate-700'} text-white capitalize`}>{lead.status}</span>
                  <span className="text-xs text-slate-400 font-mono w-20 text-right">₹{(lead.value / 100000).toFixed(1)}L</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ═══════════ SALES TOOLS TAB ═══════════ */}
      {activeTab === 'sales-tools' && (
        <div className="space-y-4">
          <p className="text-xs text-slate-400">6 AI-powered sales tools connected to your CRM data. Click any tool to execute.</p>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {salesTools.map(tool => (
              <button key={tool.id} onClick={() => executeTool(tool)}
                className={`text-left bg-slate-900 border rounded-xl p-4 hover:border-purple-500/30 transition-all cursor-pointer ${
                  selectedTool === tool.id ? 'border-purple-500/50 ring-1 ring-purple-500/20' : 'border-slate-800'
                }`}>
                <div className="flex items-center gap-3">
                  <span className="text-2xl">{tool.icon}</span>
                  <div>
                    <h3 className="text-sm font-semibold text-white">{tool.label}</h3>
                    <p className="text-[10px] text-slate-400 mt-0.5">{tool.desc}</p>
                  </div>
                </div>
                {selectedTool === tool.id && toolLoading && (
                  <div className="mt-3 flex items-center gap-2 text-purple-400 text-[10px]">
                    <span className="animate-spin">⟳</span> Executing {tool.label}...
                  </div>
                )}
              </button>
            ))}
          </div>

          {/* Tool result panel */}
          {selectedTool && (
            <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-lg">{salesTools.find(t => t.id === selectedTool)?.icon}</span>
                  <h3 className="text-sm font-semibold text-white">{salesTools.find(t => t.id === selectedTool)?.label} — Results</h3>
                </div>
                <button onClick={() => { setSelectedTool(null); setToolResult(''); }}
                  className="text-slate-400 hover:text-white text-xs cursor-pointer">Close</button>
              </div>
              <div className="p-4 max-h-96 overflow-y-auto">
                {toolLoading ? (
                  <div className="space-y-2 animate-pulse">
                    <div className="h-3 bg-slate-800 rounded w-full" />
                    <div className="h-3 bg-slate-800 rounded w-5/6" />
                    <div className="h-3 bg-slate-800 rounded w-4/6" />
                    <div className="h-3 bg-slate-800 rounded w-full" />
                    <div className="h-3 bg-slate-800 rounded w-3/4" />
                  </div>
                ) : toolResult ? (
                  <div className="text-xs text-slate-200 whitespace-pre-wrap leading-relaxed">{toolResult}</div>
                ) : (
                  <p className="text-xs text-slate-500">Click a tool above to execute it.</p>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ═══════════ ANALYTICS TAB ═══════════ */}
      {activeTab === 'analytics' && (
        <div className="space-y-4">
          {/* Revenue analytics */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
              <h3 className="text-sm font-semibold text-white mb-4">Revenue by Brand</h3>
              <div className="space-y-3">
                {[...new Set(leads.map(l => l.brand))].map(brand => {
                  const brandLeads = leads.filter(l => l.brand === brand);
                  const total = brandLeads.reduce((s, l) => s + (l.value || 0), 0);
                  const won = brandLeads.filter(l => l.status === 'won').reduce((s, l) => s + (l.value || 0), 0);
                  const maxVal = Math.max(...[...new Set(leads.map(l => l.brand))].map(b => leads.filter(l => l.brand === b).reduce((s, l) => s + (l.value || 0), 0)), 1);
                  const colors = ['#3b82f6', '#8b5cf6', '#10b981', '#f59e0b', '#ef4444', '#06b6d4'];
                  const ci = [...new Set(leads.map(l => l.brand))].indexOf(brand);
                  return (
                    <div key={brand}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs text-white font-medium">{brand}</span>
                        <span className="text-[10px] text-slate-400">₹{(total / 100000).toFixed(1)}L pipeline · ₹{(won / 100000).toFixed(1)}L won</span>
                      </div>
                      <div className="h-3 bg-slate-800 rounded-full overflow-hidden flex">
                        <div className="h-full rounded-l-full bg-emerald-500/60 transition-all duration-700" style={{ width: `${total > 0 ? (won / total) * 100 : 0}%` }} />
                        <div className="h-full bg-slate-700/50 transition-all duration-700" style={{ width: `${total > 0 ? ((total - won) / maxVal) * 100 : 0}%` }} />
                      </div>
                      <p className="text-[9px] text-slate-500 mt-0.5">{brandLeads.length} leads</p>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
              <h3 className="text-sm font-semibold text-white mb-4">Lead Source Performance</h3>
              <div className="space-y-3">
                {[...new Set(leads.map(l => l.source))].map(source => {
                  const sourceLeads = leads.filter(l => l.source === source);
                  const count = sourceLeads.length;
                  const avgSrcScore = Math.round(sourceLeads.reduce((s, l) => s + (l.score || 0), 0) / (count || 1));
                  const wonCount = sourceLeads.filter(l => l.status === 'won').length;
                  const srcColors: Record<string, string> = { Website: '#3b82f6', Referral: '#10b981', LinkedIn: '#8b5cf6', Instagram: '#ec4899', 'Cold Call': '#f59e0b' };
                  const color = srcColors[source] || '#64748b';
                  return (
                    <div key={source} className="flex items-center gap-3">
                      <div className="w-2 h-8 rounded-full" style={{ backgroundColor: color }} />
                      <div className="flex-1">
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-white font-medium">{source}</span>
                          <div className="flex items-center gap-3">
                            <span className="text-[10px] text-slate-400">{count} leads</span>
                            <span className="text-[10px] text-emerald-400">{wonCount} won</span>
                            <span className="text-[10px] font-mono" style={{ color }}>{avgSrcScore} avg score</span>
                          </div>
                        </div>
                        <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden mt-1">
                          <div className="h-full rounded-full transition-all duration-700" style={{ width: `${(count / totalLeads) * 100}%`, backgroundColor: color }} />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Performance metrics */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
            <h3 className="text-sm font-semibold text-white mb-4">Sales Performance Metrics</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[
                { label: 'Avg Deal Size', value: `₹${(totalPipeline / Math.max(leads.filter(l => !['won', 'lost'].includes(l.status)).length, 1) / 100000).toFixed(2)}L`, change: '+12%', up: true },
                { label: 'Avg Days to Close', value: '18 days', change: '-3 days', up: true },
                { label: 'Lead-to-Won Rate', value: `${conversionRate}%`, change: '+5%', up: true },
                { label: 'Lost Deal Rate', value: `${Math.round(leads.filter(l => l.status === 'lost').length / (totalLeads || 1) * 100)}%`, change: '-2%', up: true },
              ].map(m => (
                <div key={m.label} className="bg-slate-800/50 rounded-lg p-3">
                  <p className="text-[10px] text-slate-500">{m.label}</p>
                  <p className="text-lg font-bold text-white mt-1">{m.value}</p>
                  <span className={`text-[10px] font-medium ${m.up ? 'text-emerald-400' : 'text-red-400'}`}>{m.change}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Agent performance comparison */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
            <h3 className="text-sm font-semibold text-white mb-4">Agent Performance Comparison</h3>
            <div className="space-y-3">
              {agents.map(agent => {
                const barWidth = (agent.success_rate / 100) * 100;
                return (
                  <div key={agent.id} className="flex items-center gap-3">
                    <div className="w-28 shrink-0">
                      <p className="text-xs font-medium text-white truncate">{agent.name}</p>
                      <p className="text-[9px] text-slate-500">{agent.category}</p>
                    </div>
                    <div className="flex-1 h-6 bg-slate-800 rounded-lg overflow-hidden relative">
                      <div className="h-full rounded-lg transition-all duration-700 flex items-center px-2"
                        style={{ width: `${Math.max(barWidth, 15)}%`, backgroundColor: agent.color + '50', borderLeft: `3px solid ${agent.color}` }}>
                        <span className="text-[10px] font-bold" style={{ color: agent.color }}>{agent.success_rate}%</span>
                      </div>
                    </div>
                    <span className="text-[10px] text-slate-500 w-20 text-right">{agent.tasks_completed} tasks</span>
                    <span className="text-[10px] text-slate-500 w-16 text-right">{agent.avg_response_time}</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Source vs Brand heatmap-style */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
            <h3 className="text-sm font-semibold text-white mb-4">Source × Brand Matrix (Lead Count)</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr>
                    <th className="text-left text-slate-500 font-medium pb-2 pr-4">Source \\ Brand</th>
                    {[...new Set(leads.map(l => l.brand))].map(b => (
                      <th key={b} className="text-center text-slate-400 font-medium pb-2 px-2">{b}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[...new Set(leads.map(l => l.source))].map(source => (
                    <tr key={source}>
                      <td className="text-slate-300 py-1.5 pr-4 font-medium">{source}</td>
                      {[...new Set(leads.map(l => l.brand))].map(brand => {
                        const count = leads.filter(l => l.source === source && l.brand === brand).length;
                        const opacity = count > 0 ? Math.min(count / 3, 1) * 0.7 + 0.1 : 0;
                        return (
                          <td key={brand} className="text-center py-1.5 px-2">
                            <span className={`inline-flex w-8 h-8 items-center justify-center rounded-lg font-mono font-bold ${count > 0 ? 'text-white' : 'text-slate-600'}`}
                              style={{ backgroundColor: count > 0 ? `rgba(139, 92, 246, ${opacity})` : 'rgba(30, 41, 59, 0.5)' }}>
                              {count || '-'}
                            </span>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ═══════════ SALES EXECUTIVE AI TAB ═══════════ */}
      {activeTab === 'sales-executive' && (
        <SalesExecutiveAI
          leads={leads}
          selectedLead={selectedLead}
          setSelectedLead={setSelectedLead}
          execTone={execTone}
          setExecTone={setExecTone}
          messages={execChatMessages}
          setMessages={setExecChatMessages}
          input={execChatInput}
          setInput={setExecChatInput}
          loading={execChatLoading}
          setLoading={setExecChatLoading}
          endRef={execChatEndRef}
        />
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// SALES EXECUTIVE AI — Human-like client interaction engine
// ═══════════════════════════════════════════════════════════════

interface SalesExecutiveAIProps {
  leads: any[];
  selectedLead: string | null;
  setSelectedLead: (id: string | null) => void;
  execTone: 'professional' | 'friendly' | 'aggressive';
  setExecTone: (t: 'professional' | 'friendly' | 'aggressive') => void;
  messages: { role: string; content: string; typing?: boolean }[];
  setMessages: React.Dispatch<React.SetStateAction<{ role: string; content: string; typing?: boolean }[]>>;
  input: string;
  setInput: (v: string) => void;
  loading: boolean;
  setLoading: (v: boolean) => void;
  endRef: React.RefObject<HTMLDivElement | null>;
}

const BRAND_PROFILES: Record<string, { minInvestment: string; maxInvestment: string; royalty: string; category: string; usp: string; timeline: string }> = {
  'Franchisee Kart': { minInvestment: '10L', maxInvestment: '50L', royalty: '6%', category: 'Multi-brand Franchise Platform', usp: 'AI-powered franchise matching with 25+ AI agents automating operations', timeline: '14 days to launch' },
  'QuickShelf': { minInvestment: '8L', maxInvestment: '25L', royalty: '5%', category: 'Retail / Q-Commerce', usp: 'Fastest go-to-market in retail — fully automated inventory with AI demand prediction', timeline: '10 days to launch' },
  'BrandBooster': { minInvestment: '5L', maxInvestment: '20L', royalty: '4%', category: 'Marketing & Branding', usp: 'End-to-end franchise marketing with AI-generated content and campaign automation', timeline: '7 days to launch' },
};

function SalesExecutiveAI({ leads, selectedLead, setSelectedLead, execTone, setExecTone, messages, setMessages, input, setInput, loading, setLoading, endRef }: SalesExecutiveAIProps) {
  const [showLeadPicker, setShowLeadPicker] = useState(false);
  const [conversationPhase, setConversationPhase] = useState<string>('greeting');
  const [clientName, setClientName] = useState('');

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  const activeLeads = leads.filter(l => !['won', 'lost'].includes(l.status));
  const currentLead = leads.find(l => l.id === selectedLead);

  const selectAndStart = async (leadId: string) => {
    setSelectedLead(leadId);
    setShowLeadPicker(false);
    setMessages([]);
    const lead = leads.find(l => l.id === leadId);
    if (lead) {
      setClientName((lead as any).contact_name || 'there');
      setConversationPhase('discovery');
      setLoading(true);
      try {
        const { data, error } = await supabase.functions.invoke('sales-engine', { body: { action: 'greet', leadId: lead.id, tone: execTone } });
        if (error || data?.error) throw new Error(data?.error || error?.message || 'sales-engine failed');
        setMessages([{ role: 'assistant', content: data.reply }]);
      } catch (e: any) {
        setMessages([{ role: 'assistant', content: `(AI greeting unavailable: ${e?.message || 'unknown error'}. Check ANTHROPIC_API_KEY is configured.)` }]);
      } finally {
        setLoading(false);
      }
    }
  };

  const sendExecMessage = async () => {
    if (!input.trim() || loading) return;
    const msg = input.trim();
    setInput('');
    setMessages(prev => [...prev, { role: 'user', content: msg }]);
    setLoading(true);

    // Simulate human-like typing delay
    await new Promise(r => setTimeout(r, 800 + Math.random() * 1200));

    const leadContext = currentLead || (activeLeads.length > 0 ? activeLeads[0] : null);
    let reply = '';
    try {
      const { data, error } = await supabase.functions.invoke('sales-engine', {
        body: {
          action: 'reply',
          leadId: leadContext?.id,
          tone: execTone,
          message: msg,
          history: messages.slice(-10).map(m => ({ role: m.role, content: m.content })),
        },
      });
      if (error || data?.error) throw new Error(data?.error || error?.message || 'sales-engine failed');
      reply = data.reply;
    } catch (e: any) {
      reply = `(AI reply unavailable: ${e?.message || 'unknown error'}. Check ANTHROPIC_API_KEY is configured on the Supabase project.)`;
    }

    // Update conversation phase based on context
    if (conversationPhase === 'greeting' && (msg.toLowerCase().includes('interest') || msg.toLowerCase().includes('tell me') || msg.toLowerCase().includes('about'))) {
      setConversationPhase('discovery');
    } else if (conversationPhase === 'discovery' && (msg.toLowerCase().includes('budget') || msg.toLowerCase().includes('invest') || msg.toLowerCase().includes('how much') || msg.toLowerCase().includes('price') || msg.toLowerCase().includes('cost') || msg.toLowerCase().includes('fee'))) {
      setConversationPhase('pricing');
    } else if (conversationPhase === 'pricing' && (msg.toLowerCase().includes('objection') || msg.toLowerCase().includes('expensive') || msg.toLowerCase().includes('risky') || msg.toLowerCase().includes('competitor') || msg.toLowerCase().includes('think about') || msg.toLowerCase().includes('concern'))) {
      setConversationPhase('objection-handling');
    } else if (conversationPhase === 'objection-handling' && (msg.toLowerCase().includes('yes') || msg.toLowerCase().includes('sure') || msg.toLowerCase().includes('ok') || msg.toLowerCase().includes('interested') || msg.toLowerCase().includes('let') || msg.toLowerCase().includes('proceed') || msg.toLowerCase().includes('sign'))) {
      setConversationPhase('closing');
    } else if (msg.toLowerCase().includes('next step') || msg.toLowerCase().includes('what now') || msg.toLowerCase().includes('how to proceed') || msg.toLowerCase().includes('process')) {
      setConversationPhase('next-steps');
    }

    setMessages(prev => [...prev, { role: 'assistant', content: reply }]);
    setLoading(false);
  };

  const quickPrompts = selectedLead ? [
    { label: 'What brands do you offer?', msg: 'I am interested to know about the brands you offer. Can you walk me through them?' },
    { label: 'How much investment?', msg: 'Can you tell me about the investment required? What are the costs involved?' },
    { label: 'What support do I get?', msg: 'What kind of support and training do franchisees receive after signing up?' },
    { label: 'I have some concerns', msg: 'I have a few concerns before I can make a decision. Can we discuss them?' },
    { label: 'How long to launch?', msg: 'If I decide to go ahead, how quickly can I get my franchise up and running?' },
    { label: 'I want to sign up', msg: 'I am convinced. What are the next steps to get this started?' },
  ] : [
    { label: 'I am looking for a franchise opportunity', msg: 'Hi, I am exploring franchise opportunities. Can you help me find something suitable?' },
    { label: 'Tell me about your brands', msg: 'I heard about your company. Can you tell me what brands you work with and what makes you different?' },
    { label: 'I have a budget of 20-30 Lakhs', msg: 'My budget is around 20 to 30 Lakhs. What options would you recommend for me?' },
  ];

  const phaseIndicators = [
    { id: 'greeting', label: 'Greeting', icon: '👋' },
    { id: 'discovery', label: 'Discovery', icon: '🔍' },
    { id: 'pricing', label: 'Pricing', icon: '💰' },
    { id: 'objection-handling', label: 'Objections', icon: '🛡️' },
    { id: 'closing', label: 'Closing', icon: '✅' },
    { id: 'next-steps', label: 'Next Steps', icon: '📋' },
  ];

  return (
    <div className="space-y-4">
      {/* Top controls bar */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500 via-teal-500 to-cyan-500 flex items-center justify-center shadow-lg shadow-emerald-500/30">
            <span className="text-lg">🤝</span>
          </div>
          <div>
            <h3 className="text-sm font-bold text-white">Sales Executive AI</h3>
            <p className="text-[10px] text-slate-400">Human-like AI that interacts with clients — select a lead or chat freely</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* Tone selector */}
          <div className="flex bg-slate-900 border border-slate-800 rounded-lg p-0.5">
            {(['professional', 'friendly', 'aggressive'] as const).map(t => (
              <button key={t} onClick={() => setExecTone(t)}
                className={`px-3 py-1.5 rounded-md text-[10px] font-medium transition-all capitalize cursor-pointer ${
                  execTone === t ? 'bg-emerald-600 text-white shadow' : 'text-slate-400 hover:text-white'
                }`}>
                {t}
              </button>
            ))}
          </div>
          {/* Lead picker */}
          <div className="relative">
            <button onClick={() => setShowLeadPicker(!showLeadPicker)}
              className="flex items-center gap-2 px-3 py-1.5 bg-slate-900 border border-slate-800 rounded-lg text-xs text-slate-300 hover:text-white hover:border-slate-700 transition-all cursor-pointer">
              <span className="w-2 h-2 rounded-full bg-emerald-500" />
              {currentLead ? (currentLead as any).contact_name : 'Select Lead'}
              <span className="text-slate-500">▼</span>
            </button>
            {showLeadPicker && (
              <div className="absolute right-0 top-full mt-1 w-72 bg-slate-900 border border-slate-700 rounded-xl shadow-2xl z-50 max-h-64 overflow-y-auto">
                <div className="p-2 border-b border-slate-800">
                  <p className="text-[10px] text-slate-500 px-2">Select a lead to start a sales conversation</p>
                </div>
                {activeLeads.map(lead => (
                  <button key={lead.id} onClick={() => selectAndStart(lead.id)}
                    className={`w-full text-left px-3 py-2.5 hover:bg-slate-800 transition-colors flex items-center gap-3 cursor-pointer ${
                      selectedLead === lead.id ? 'bg-emerald-600/10' : ''
                    }`}>
                    <div className="w-8 h-8 rounded-full bg-slate-800 flex items-center justify-center text-xs font-bold text-slate-400 shrink-0">
                      {(lead as any).contact_name?.charAt(0)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-white truncate">{(lead as any).contact_name}</p>
                      <p className="text-[10px] text-slate-500">{lead.brand} · Score: {lead.score} · ₹{(lead.value / 100000).toFixed(1)}L</p>
                    </div>
                    <span className={`text-[9px] px-1.5 py-0.5 rounded ${STATUS_COLORS[lead.status] || 'bg-slate-700'} text-white capitalize`}>{lead.status}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Conversation phase tracker */}
      <div className="flex items-center gap-1 bg-slate-900 border border-slate-800 rounded-xl p-2">
        {phaseIndicators.map((phase, i) => {
          const phaseIndex = phaseIndicators.findIndex(p => p.id === conversationPhase);
          const isActive = phase.id === conversationPhase;
          const isPast = i <= phaseIndex;
          return (
            <div key={phase.id} className="flex items-center gap-1 flex-1">
              <div className={`flex items-center gap-1.5 px-2 py-1.5 rounded-lg transition-all flex-1 ${isActive ? 'bg-emerald-600/20 border border-emerald-500/30' : isPast ? 'bg-slate-800/80' : 'bg-slate-800/30'}`}>
                <span className="text-xs">{phase.icon}</span>
                <span className={`text-[9px] font-medium whitespace-nowrap ${isActive ? 'text-emerald-400' : isPast ? 'text-slate-400' : 'text-slate-600'}`}>{phase.label}</span>
              </div>
              {i < phaseIndicators.length - 1 && <span className={`text-[8px] ${isPast ? 'text-slate-500' : 'text-slate-700'}`}>→</span>}
            </div>
          );
        })}
      </div>

      {/* Lead context card (when selected) */}
      {currentLead && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-3 flex items-center gap-4">
          <div className="w-12 h-12 rounded-full bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center text-lg font-bold text-white shadow-lg shadow-emerald-500/20">
            {(currentLead as any).contact_name?.charAt(0)}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h4 className="text-sm font-semibold text-white">{(currentLead as any).contact_name}</h4>
              <span className={`text-[9px] px-1.5 py-0.5 rounded ${STATUS_COLORS[currentLead.status] || 'bg-slate-700'} text-white capitalize`}>{currentLead.status}</span>
              <span className="text-[9px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-400">{currentLead.source}</span>
            </div>
            <div className="flex items-center gap-4 mt-1">
              <span className="text-[10px] text-slate-400">Brand: <span className="text-white">{currentLead.brand}</span></span>
              <span className="text-[10px] text-slate-400">Deal Value: <span className="text-emerald-400 font-medium">₹{(currentLead.value / 100000).toFixed(1)}L</span></span>
              <span className="text-[10px] text-slate-400">Lead Score: <span className={currentLead.score >= 80 ? 'text-emerald-400' : currentLead.score >= 60 ? 'text-amber-400' : 'text-red-400'}>{currentLead.score}/100</span></span>
            </div>
          </div>
          <div className="text-right">
            <p className="text-[9px] text-slate-500 uppercase">Tone</p>
            <p className="text-xs text-white capitalize">{execTone}</p>
          </div>
        </div>
      )}

      {/* Main chat area */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden flex flex-col" style={{ height: 'calc(100vh - 28rem)' }}>
        {/* Chat header */}
        <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center">
              <span className="text-sm">AI</span>
            </div>
            <div>
              <h4 className="text-xs font-semibold text-white">Sales Executive AI</h4>
              <div className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                <span className="text-[9px] text-emerald-400">Online · {currentLead ? `Talking to ${(currentLead as any).contact_name}` : 'Ready for new conversation'}</span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[9px] text-slate-500 bg-slate-800 px-2 py-0.5 rounded">{messages.filter(m => m.role === 'assistant').length} responses</span>
            {messages.length > 0 && (
              <button onClick={() => { setMessages([]); setConversationPhase('greeting'); }}
                className="text-[9px] text-slate-400 hover:text-white px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 transition-colors cursor-pointer">
                Clear
              </button>
            )}
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-6">
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-emerald-500/20 to-teal-500/20 border border-emerald-500/20 flex items-center justify-center">
                <span className="text-3xl">🤝</span>
              </div>
              <div className="text-center max-w-md">
                <h3 className="text-base font-bold text-white">Sales Executive AI</h3>
                <p className="text-xs text-slate-400 mt-2 leading-relaxed">
                  A human-like AI sales executive that converses with your clients naturally.
                  It handles greetings, discovers needs, pitches brands, handles objections, and closes deals.
                </p>
              </div>
              {selectedLead ? (
                <p className="text-[10px] text-emerald-400 bg-emerald-500/10 px-3 py-1.5 rounded-full">
                  Context loaded: {(currentLead as any)?.contact_name} · {currentLead?.brand} · ₹{(currentLead?.value / 100000).toFixed(1)}L
                </p>
              ) : (
                <p className="text-[10px] text-amber-400 bg-amber-500/10 px-3 py-1.5 rounded-full">
                  Tip: Select a lead above for personalized conversations, or chat freely
                </p>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 w-full max-w-lg">
                {quickPrompts.map((qp, i) => (
                  <button key={i} onClick={() => { setInput(qp.msg); }}
                    className="text-left px-3 py-2.5 rounded-lg border border-slate-700 hover:border-emerald-500/30 hover:bg-slate-800/50 transition-all text-[11px] text-slate-300 cursor-pointer leading-snug">
                    {qp.label}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <>
              {messages.map((m, i) => (
                <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[75%] ${m.role === 'user' ? '' : 'flex items-start gap-2'}`}>
                    {m.role === 'assistant' && (
                      <div className="w-7 h-7 rounded-full bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center shrink-0 mt-0.5">
                        <span className="text-[9px] font-bold text-white">SE</span>
                      </div>
                    )}
                    <div className={`rounded-2xl px-4 py-3 ${
                      m.role === 'user'
                        ? 'bg-slate-700 text-white rounded-br-md'
                        : 'bg-slate-800 text-slate-200 rounded-bl-md border border-slate-700/50'
                    }`}>
                      {m.role === 'assistant' && (
                        <p className="text-[9px] text-emerald-400 mb-1 font-medium">
                          Sales Executive{currentLead ? ` → ${(currentLead as any).contact_name}` : ''} · {execTone}
                        </p>
                      )}
                      <p className="text-sm whitespace-pre-wrap leading-relaxed">{m.content}</p>
                    </div>
                  </div>
                </div>
              ))}
              {loading && (
                <div className="flex justify-start">
                  <div className="flex items-start gap-2">
                    <div className="w-7 h-7 rounded-full bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center shrink-0">
                      <span className="text-[9px] font-bold text-white">SE</span>
                    </div>
                    <div className="bg-slate-800 border border-slate-700/50 rounded-2xl rounded-bl-md px-4 py-3">
                      <div className="flex gap-1.5 items-center">
                        <span className="w-2 h-2 bg-emerald-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                        <span className="w-2 h-2 bg-emerald-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                        <span className="w-2 h-2 bg-emerald-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                        <span className="text-[10px] text-slate-500 ml-2">typing...</span>
                      </div>
                    </div>
                  </div>
                </div>
              )}
              <div ref={endRef} />
            </>
          )}
        </div>

        {/* Quick prompts bar (when in conversation) */}
        {messages.length > 0 && !loading && (
          <div className="px-4 py-2 border-t border-slate-800/50 flex gap-1.5 overflow-x-auto shrink-0">
            {quickPrompts.slice(0, selectedLead ? 4 : 3).map((qp, i) => (
              <button key={i} onClick={() => { setInput(qp.msg); }}
                className="shrink-0 px-3 py-1 rounded-full border border-slate-700 text-[9px] text-slate-400 hover:text-white hover:border-emerald-500/30 transition-all cursor-pointer whitespace-nowrap">
                {qp.label}
              </button>
            ))}
          </div>
        )}

        {/* Input */}
        <div className="p-3 border-t border-slate-800 shrink-0">
          <form onSubmit={e => { e.preventDefault(); sendExecMessage(); }} className="flex gap-2">
            <input value={input} onChange={e => setInput(e.target.value)}
              placeholder={currentLead ? `Message ${(currentLead as any).contact_name} as Sales Executive...` : 'Start a sales conversation...'}
              disabled={loading} className="flex-1 bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500" />
            <button type="submit" disabled={loading || !input.trim()}
              className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-xl text-sm font-medium transition-colors cursor-pointer flex items-center gap-2">
              <span>Send</span>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m22 2-7 20-4-9-9-4z"/><path d="m22 2-11 11"/></svg>
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

// NOTE: generateGreeting/generateHumanResponse (scripted, fabricated-stats
// templates) were removed and replaced with real Claude calls via the
// `sales-engine` Supabase edge function. See selectAndStart/sendExecMessage above.

// ─── DISABLED (2026-07-05): fabricated-report fallback ───
// This function invented full "AI tool reports" client-side (including
// fabricated formatting of pipeline stats presented as tool output) whenever
// the real brain-engine call failed or returned empty. It is no longer called
// anywhere — failures now surface as honest errors in executeTool above.
// Kept temporarily for reference only; safe to delete entirely.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function generateToolFallback(toolId: string, leads: any[], agents: any[]): string {
  const hotLeads = leads.filter(l => l.score >= 80).sort((a, b) => b.score - a.score);
  const warmLeads = leads.filter(l => l.score >= 60 && l.score < 80);
  const coldLeads = leads.filter(l => l.score < 60);
  const pipelineValue = leads.filter(l => !['won', 'lost'].includes(l.status)).reduce((s, l) => s + (l.value || 0), 0);

  switch (toolId) {
    case 'qualify':
      return `LEAD QUALIFICATION REPORT
═══════════════════════════════════════

HOT LEADS (Score 80+) — Immediate Action Required:
${hotLeads.length > 0 ? hotLeads.map((l, i) => `  ${i + 1}. ${(l as any).contact_name} — Score: ${l.score}/100 | ${l.brand} | ₹${(l.value / 100000).toFixed(1)}L | Stage: ${l.status}`).join('\n') : '  No hot leads currently.'}

WARM LEADS (Score 60-79) — Nurture & Follow-up:
${warmLeads.length > 0 ? warmLeads.map((l, i) => `  ${i + 1}. ${(l as any).contact_name} — Score: ${l.score}/100 | ${l.brand} | ₹${(l.value / 100000).toFixed(1)}L`).join('\n') : '  No warm leads.'}

COLD LEADS (Score <60) — Re-engagement Needed:
${coldLeads.length > 0 ? coldLeads.map((l, i) => `  ${i + 1}. ${(l as any).contact_name} — Score: ${l.score}/100 | ${l.brand} | Source: ${l.source}`).join('\n') : '  No cold leads.'}

BANT ANALYSIS SUMMARY:
• Budget Qualified: ${hotLeads.length + Math.floor(warmLeads.length * 0.6)} leads
• Authority Confirmed: ${hotLeads.length + Math.floor(warmLeads.length * 0.4)} leads
• Need Established: ${hotLeads.length + warmLeads.length} leads
• Timeline Clear: ${hotLeads.length} leads

RECOMMENDATION: Focus immediate effort on ${hotLeads[0]?.contact_name || 'top-scored leads'} (Score: ${hotLeads[0]?.score || 0}). Schedule proposal meeting within 48 hours.`;

    case 'objection':
      return `OBJECTION HANDLING PLAYBOOK
═══════════════════════════════════════

TOP 5 FRANCHISE BUYER OBJECTIONS + COUNTER-ARGUMENTS:

1. "The franchise fee is too high."
   → Counter: Our franchisees average ROI within 18 months. With ${leads.filter(l => l.status === 'won').length} successful franchisees, the fee includes ₹5L+ in setup support, training, and initial marketing. Break-even is typically achieved by Month 14.

2. "I'm not sure about the brand recognition."
   → Counter: We have a 92% brand recall in target markets. Our social media presence reaches 2M+ monthly. We'll provide co-branded marketing materials and a dedicated launch campaign for your territory.

3. "What if the market doesn't support another location?"
   → Counter: Our territory analysis shows your area has a demand gap of 35%. We use demographic analysis to ensure market fit before any location approval. ${conversionRate}% of our franchisees report meeting or exceeding revenue targets.

4. "The royalty structure seems unfavorable."
   → Counter: Our royalty is 6% of gross revenue — below industry average of 8%. This includes ongoing AI-powered analytics, marketing support, and supply chain optimization that typically saves franchisees 12-15% in operational costs.

5. "I need time to think about it."
   → Counter: I understand this is a significant decision. However, territory allocations are assigned on a first-come basis. Currently, ${leads.filter(l => l.status === 'qualified').length} qualified leads are in the pipeline for similar territories. I can schedule a call with an existing franchisee who had the same concerns.`;

    case 'forecast':
      return `90-DAY PIPELINE FORECAST
═══════════════════════════════════════

CURRENT PIPELINE SNAPSHOT:
• Total Open Pipeline: ₹${(pipelineValue / 100000).toFixed(1)}L
• Active Deals: ${leads.filter(l => !['won', 'lost'].includes(l.status)).length}
• Average Deal Size: ₹${(pipelineValue / Math.max(leads.filter(l => !['won', 'lost'].includes(l.status)).length, 1) / 100000).toFixed(2)}L

FORECAST (Conservative / Expected / Optimistic):
  Month 1: ₹${(pipelineValue * 0.15 / 100000).toFixed(1)}L / ₹${(pipelineValue * 0.22 / 100000).toFixed(1)}L / ₹${(pipelineValue * 0.30 / 100000).toFixed(1)}L
  Month 2: ₹${(pipelineValue * 0.25 / 100000).toFixed(1)}L / ₹${(pipelineValue * 0.38 / 100000).toFixed(1)}L / ₹${(pipelineValue * 0.48 / 100000).toFixed(1)}L
  Month 3: ₹${(pipelineValue * 0.35 / 100000).toFixed(1)}L / ₹${(pipelineValue * 0.52 / 100000).toFixed(1)}L / ₹${(pipelineValue * 0.65 / 100000).toFixed(1)}L

90-Day Total (Expected): ₹${(pipelineValue * 0.52 / 100000).toFixed(1)}L
Confidence Interval: 65%-85%

KEY ASSUMPTIONS:
• ${hotLeads.length} hot leads convert at 70% probability
• ${warmLeads.length} warm leads convert at 35% probability
• Historical conversion rate: ${conversionRate}%
• Average sales cycle: 21 days

RISK FACTORS:
• ${coldLeads.length} cold leads may stall the pipeline
• Seasonal dip expected in Week 6-8
• Competition intensifying in Q2

ACTION ITEMS:
1. Prioritize ${hotLeads[0]?.contact_name || 'top leads'} for immediate closing
2. Re-engage ${coldLeads[0]?.contact_name || 'cold leads'} with special offers
3. Accelerate ${warmLeads[0]?.contact_name || 'warm leads'} to proposal stage`;

    case 'followup':
      return `FOLLOW-UP PRIORITY PLAN
═══════════════════════════════════════

PRIORITY 1 — URGENT (Within 24 hours):
${hotLeads.slice(0, 3).map(l => `• ${(l as any).contact_name} (Score: ${l.score}) — Send personalized proposal + schedule call. Channel: Phone + Email. Reason: High score, ${l.status} stage.`).join('\n') || '• No urgent follow-ups needed.'}

PRIORITY 2 — HIGH (Within 48 hours):
${warmLeads.slice(0, 3).map(l => `• ${(l as any).contact_name} (Score: ${l.score}) — Send case study + ROI calculator. Channel: Email + WhatsApp. Reason: Warm lead, needs nurturing.`).join('\n') || '• No high-priority follow-ups.'}

PRIORITY 3 — NURTURE (Within 1 week):
${coldLeads.slice(0, 3).map(l => `• ${(l as any).contact_name} (Score: ${l.score}) — Send brand overview + testimonial video. Channel: Email. Reason: Re-engagement needed.`).join('\n') || '• No nurture follow-ups needed.'}

AUTOMATED FOLLOW-UP SCHEDULE (via Follow-up Scheduler Agent):
• Day 1: Welcome email + brand deck
• Day 3: Personalized ROI analysis
• Day 7: Case study / testimonial
• Day 14: Exclusive offer / territory update
• Day 21: Final follow-up + urgency trigger

TOTAL ACTIONS QUEUED: ${leads.length * 5} touchpoints across ${leads.length} leads`;

    case 'competitor':
      return `COMPETITIVE INTELLIGENCE REPORT
═══════════════════════════════════════

BRAND: Franchisee Kart
  Competitor 1: FranchiseIndia — Strong digital presence, lower fees but less support
  Competitor 2: FranchiseBazar — Large network, but generic matching algorithm
  Competitor 3: SparkLabs — Premium positioning, limited brand portfolio
  → Differentiation: AI-powered matching (6 brands, 25+ AI agents), real-time analytics

BRAND: QuickShelf
  Competitor 1: StoreHunt — Similar model, older tech stack
  Competitor 2: RetailX — Better brand recognition, higher costs
  Competitor 3: QuickBiz — New entrant, aggressive pricing
  → Differentiation: Faster go-to-market (14 days vs industry 30 days), AI inventory optimization

BRAND: BrandBooster
  Competitor 1: Brandify — Established player, enterprise-focused
  Competitor 2: MarketPro — Good marketing tools, weak franchise ops
  Competitor 3: BoostMyBrand — Budget option, limited scalability
  → Differentiation: End-to-end franchise marketing + operations, AI content generation

STRATEGIC RECOMMENDATIONS:
1. Lead with AI capabilities in all pitches — this is our key differentiator
2. Emphasize speed: 14-day launch vs industry standard 30+ days
3. Highlight 25+ AI agents that automate 80% of routine franchise operations
4. Use data: ${conversionRate}% conversion rate is above industry average of 15%`;

    case 'pricing':
      return `DEAL PRICING OPTIMIZATION REPORT
═══════════════════════════════════════

OPEN DEALS ANALYSIS:

DEALS WHERE DISCOUNT COULD ACCELERATE CLOSING:
${leads.filter(l => ['negotiation', 'proposal'].includes(l.status) && l.score >= 70).slice(0, 3).map(l => {
  const suggestedDiscount = l.score >= 85 ? '3-5%' : '5-8%';
  return `• ${(l as any).contact_name} (₹${(l.value / 100000).toFixed(1)}L, Score: ${l.score})
  → Suggested discount: ${suggestedDiscount}
  → Reason: High score ${l.status} stage, likely price-sensitive
  → Impact: Could close within 7 days vs estimated 21 days`;
}).join('\n\n') || '• No deals qualify for strategic discounting.'}

DEALS WHERE WE SHOULD HOLD FIRM ON PRICE:
${leads.filter(l => l.score >= 80 && l.status === 'qualified').slice(0, 3).map(l => `• ${(l as any).contact_name} (₹${(l.value / 100000).toFixed(1)}L, Score: ${l.score})
  → Hold at listed price — high intent signal from engagement data
  → Value proposition is strong, no need for concessions`).join('\n\n') || '• No deals flagged for firm pricing.'}

PRICING INSIGHTS:
• Average deal size: ₹${(pipelineValue / Math.max(leads.filter(l => !['won', 'lost'].includes(l.status)).length, 1) / 100000).toFixed(2)}L
• Discount sensitivity threshold: ₹20L+ deals show 30% more price sensitivity
• Optimal pricing range for maximum conversion: ₹15L-30L
• Revenue at risk if over-discounting: ₹${(pipelineValue * 0.08 / 100000).toFixed(1)}L

NET RECOMMENDATION: Apply targeted 5% discount to ${leads.filter(l => l.status === 'negotiation').length} negotiation-stage deals to accelerate Q1 closing. Maintain full pricing on all qualified leads with scores above 80.`;

    default:
      return 'Analysis complete. Review the results above for actionable insights.';
  }
}

// ─── Smart reply fallback for chat ───
// DEAD CODE (2026-07-06): no longer called — was the fake-data canned-reply
// fallback described above. Kept only for reference, safe to delete.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function generateSmartReply(msg: string, leads: any[]): string {
  const lower = msg.toLowerCase();
  const totalPipeline = leads.filter(l => !['won', 'lost'].includes(l.status)).reduce((s, l) => s + (l.value || 0), 0);
  const hotLeads = leads.filter(l => l.score >= 80).sort((a, b) => b.score - a.score);

  if (lower.includes('pipeline') || lower.includes('value')) {
    return `Your current pipeline is worth ₹${(totalPipeline / 100000).toFixed(1)}L across ${leads.filter(l => !['won', 'lost'].includes(l.status)).length} active leads.\n\nTop leads by score:\n${hotLeads.slice(0, 3).map((l, i) => `${i + 1}. ${(l as any).contact_name} — ${l.score}/100 — ₹${(l.value / 100000).toFixed(1)}L (${l.status})`).join('\n')}\n\nRecommendation: Focus on moving ${hotLeads[0]?.contact_name || 'top leads'} to the next stage.`;
  }
  if (lower.includes('lead') && (lower.includes('attention') || lower.includes('follow') || lower.includes('need'))) {
    const needsAttention = leads.filter(l => !['won', 'lost'].includes(l.status) && l.score < 60);
    return `Leads needing attention (${needsAttention.length}):\n\n${needsAttention.map((l, i) => `${i + 1}. ${(l as any).contact_name} — Score: ${l.score} — ${l.brand} — ${l.status}\n   Action: Re-engage with personalized content based on ${l.source} channel`).join('\n\n')}\n\nI recommend running the Follow-up Plan tool to generate automated sequences for these leads.`;
  }
  if (lower.includes('forecast') || lower.includes('next quarter') || lower.includes('predict')) {
    return `90-Day Forecast (Expected Scenario):\n\n• Month 1: ₹${(totalPipeline * 0.22 / 100000).toFixed(1)}L (conservative) to ₹${(totalPipeline * 0.30 / 100000).toFixed(1)}L (optimistic)\n• Month 2: ₹${(totalPipeline * 0.38 / 100000).toFixed(1)}L to ₹${(totalPipeline * 0.48 / 100000).toFixed(1)}L\n• Month 3: ₹${(totalPipeline * 0.52 / 100000).toFixed(1)}L to ₹${(totalPipeline * 0.65 / 100000).toFixed(1)}L\n\nTotal Expected: ₹${(totalPipeline * 0.52 / 100000).toFixed(1)}L with 65-85% confidence.\n\nKey driver: ${hotLeads.length} hot leads with average score of ${hotLeads.length > 0 ? Math.round(hotLeads.reduce((s, l) => s + l.score, 0) / hotLeads.length) : 0}/100.`;
  }
  if (lower.includes('agent') || lower.includes('ai')) {
    return `You have ${DEMO_AGENTS.length} AI sales agents configured:\n\n${DEMO_AGENTS.map(a => `• ${a.name} (${a.status}) — ${a.success_rate}% success rate, ${a.tasks_completed} tasks completed`).join('\n')}\n\nTop performer: ${DEMO_AGENTS.sort((a, b) => b.success_rate - a.success_rate)[0].name} with ${DEMO_AGENTS.sort((a, b) => b.success_rate - a.success_rate)[0].success_rate}% success rate.\n\nAll agents are connected to your CRM data and operate autonomously.`;
  }

  return `Based on your current data:\n\n• Pipeline: ₹${(totalPipeline / 100000).toFixed(1)}L across ${leads.length} leads\n• Top Lead: ${hotLeads[0]?.contact_name || 'N/A'} (Score: ${hotLeads[0]?.score || 0})\n• Active AI Agents: ${DEMO_AGENTS.filter(a => a.status === 'active').length}/${DEMO_AGENTS.length}\n\nI can provide detailed analysis on pipeline value, lead qualification, forecasts, competitor intelligence, or pricing optimization. What would you like to dive deeper into?`;
}