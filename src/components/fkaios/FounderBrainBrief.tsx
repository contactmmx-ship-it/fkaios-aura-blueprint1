'use client';
import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { Brain, TrendingUp, AlertTriangle, Sparkles, RefreshCw, Radio, Cpu, ChevronDown, ChevronRight } from 'lucide-react';
import WorkforcePanel, { WorkforceMember } from './WorkforcePanel';
import DecisionCenter, { useDecisionItems } from './DecisionCenter';

// FOUNDER BRAIN BRIEF — Refinement Sprint (approved scope: this screen +
// Decision Center only. No new tables, agents, nav, or Phase 2 screens).
//
// Reuses, does not duplicate:
//  - governance-dashboard (edge function) for company/workforce/intelligence.
//  - fleet_memory (fixed in the prior pass) for goals/insight/imagination/
//    world_learning/intuition entries.
//  - founder-brain-state (edge function) — THIS pass now actually uses its
//    full payload (intelligenceIndex, recentImagination, recentBeliefs),
//    not just executiveAttention as before.
//  - DecisionCenter for "Only You Can Decide".

const FOUNDER_BRAIN_DEPARTMENT = 'EXECUTIVE';

interface MemoryEntry { kind: string; created_at: string; [key: string]: unknown }
interface GovSummary { approval_queue: number; violations: number; exec_cycles_total: number; last_exec_cycle: string | null }
interface ExecutiveCycle {
  cycle_number: number; situation_assessment: string;
  opportunities: { title: string; rationale: string; owner_department?: string }[];
  risks: { risk: string; severity: string; mitigation?: string }[];
  founder_briefing: string; created_at: string;
}
interface ExecutivePrediction { metric: string; expected_value: string; measure_by: string; basis?: string }
interface MarketSignal { headline: string; signal_type: string; confidence: number; relevance_to_founder_vision: string | null }
interface AttentionItem { type: string; description: string; urgency: string; reason: string }
interface IntelligenceIndex {
  learning: { score: number | null; basis: string };
  confidence: { score: number | null; basis: string };
  executionReliability: { score: number | null; basis: string };
  missionAlignment: { score: number | null; basis: string };
}
interface ImaginationEntry { prompt: string; text: string; created_at: string }
interface BeliefEntry { previousBelief: string; newEvidence: string; currentBelief: string; resolved: boolean; created_at: string }

function attentionTier(a: AttentionItem): 'critical' | 'important' | 'monitor' {
  if (a.urgency === 'urgent' && a.type === 'approval') return 'critical';
  if (a.urgency === 'urgent') return 'important';
  return 'monitor';
}
const tierMeta: Record<string, { dot: string; label: string; action: string; owner?: string }> = {
  critical: { dot: '🔴', label: 'Critical', action: 'Review in Decision Center', owner: 'Founder' },
  important: { dot: '🟠', label: 'Important', action: 'Review in Governance — Executive Intelligence' },
  monitor: { dot: '🟢', label: 'Monitor', action: 'No action required — informational' },
};

function Collapsible({ title, defaultOpen = false, children, badge }: { title: string; defaultOpen?: boolean; children: React.ReactNode; badge?: string }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div>
      <button onClick={() => setOpen(o => !o)} className="w-full flex items-center justify-between text-left mb-2 group">
        <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider group-hover:text-slate-300 flex items-center gap-1.5">
          {open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
          {title}{badge && <span className="normal-case text-slate-600">({badge})</span>}
        </span>
      </button>
      {open && children}
    </div>
  );
}

export default function FounderBrainBrief() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [summary, setSummary] = useState<GovSummary | null>(null);
  const [kpiLatest, setKpiLatest] = useState<Record<string, { value: number }>>({});
  const [cycles, setCycles] = useState<ExecutiveCycle[]>([]);
  const [predictions, setPredictions] = useState<ExecutivePrediction[]>([]);
  const [workforce, setWorkforce] = useState<WorkforceMember[]>([]);
  const [marketSignals, setMarketSignals] = useState<MarketSignal[]>([]);
  const [memory, setMemory] = useState<MemoryEntry[]>([]);
  const [executiveAttention, setExecutiveAttention] = useState<AttentionItem[]>([]);
  const [intelligenceIndex, setIntelligenceIndex] = useState<IntelligenceIndex | null>(null);
  const [recentImagination, setRecentImagination] = useState<ImaginationEntry[]>([]);
  const [recentBeliefs, setRecentBeliefs] = useState<BeliefEntry[]>([]);

  const [revenueActual, setRevenueActual] = useState(0);
  const [revenueTarget, setRevenueTarget] = useState(0);
  const [leadCount, setLeadCount] = useState<number | null>(null);
  const [agentTotal, setAgentTotal] = useState<number | null>(null);
  const [agentActive, setAgentActive] = useState<number | null>(null);

  const { items: decisionItems } = useDecisionItems();

  const load = useCallback(async () => {
    setError(null);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      const res = await fetch('https://nrlsqshkjuuwiovthrnb.supabase.co/functions/v1/governance-dashboard', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({}),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'governance-dashboard failed');
      setSummary(d.summary);
      setKpiLatest(d.kpi_latest || {});
      setCycles(d.executive_cycles || []);
      setPredictions(d.executive_predictions || []);
      setWorkforce(d.workforce || []);
      setMarketSignals(d.market_intelligence || []);

      const [memRes, brainStateRes, revActRes, revTgtRes, leadRes, agentRes] = await Promise.all([
        supabase.from('fleet_memory').select('memory_type, structured_content, created_at').eq('source_department', FOUNDER_BRAIN_DEPARTMENT).order('created_at', { ascending: false }).limit(50),
        supabase.functions.invoke('founder-brain-state'),
        supabase.from('company_revenue_actuals').select('revenue_inr'),
        supabase.from('company_annual_targets').select('revenue_target_inr').eq('year', 2030),
        supabase.from('leads').select('id', { count: 'exact', head: true }).eq('is_active', true),
        supabase.from('ai_agents').select('id, status, is_active'),
      ]);
      const mem: MemoryEntry[] = (memRes.data || []).map((r: any) => ({ kind: r.memory_type, ...(r.structured_content || {}), created_at: r.created_at }));
      setMemory(mem);
      setExecutiveAttention(brainStateRes?.data?.executiveAttention || []);
      setIntelligenceIndex(brainStateRes?.data?.intelligenceIndex || null);
      setRecentImagination(brainStateRes?.data?.recentImagination || []);
      setRecentBeliefs(brainStateRes?.data?.recentBeliefs || []);
      setRevenueActual(((revActRes.data || []) as { revenue_inr: number }[]).reduce((s, r) => s + Number(r.revenue_inr || 0), 0));
      setRevenueTarget(((revTgtRes.data || []) as { revenue_target_inr: number }[]).reduce((s, r) => s + Number(r.revenue_target_inr || 0), 0));
      setLeadCount(leadRes.count ?? null);
      const agents = (agentRes.data || []) as { status: string | null; is_active: boolean | null }[];
      setAgentTotal(agents.length);
      setAgentActive(agents.filter(a => a.is_active || a.status === 'active').length);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load Founder Brain Brief');
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); const t = setInterval(load, 60000); return () => clearInterval(t); }, [load]);

  if (loading) return <div className="p-6 text-sm text-slate-400">Loading your Brain Brief…</div>;
  if (error) return <div className="m-6 bg-red-950/40 border border-red-900 rounded-xl px-4 py-3 text-xs text-red-300">Founder Brain Brief error: {error}</div>;

  const kpi = (k: string) => (kpiLatest[k] ? Number(kpiLatest[k].value) : null);
  const companyHealthParts = [kpi('autonomous_success_rate'), kpi('execution_accuracy'), kpi('founder_alignment_score')].filter((v): v is number => v !== null);
  const companyHealth = companyHealthParts.length ? Math.round(companyHealthParts.reduce((a, b) => a + b, 0) / companyHealthParts.length) : null;

  // FIX (Refinement Sprint #2): AI Confidence was previously just
  // founder_alignment_score mislabeled as an "intelligence index average."
  // This now genuinely averages getBrainState()'s real intelligenceIndex
  // components — and says so honestly when there isn't enough evidence yet.
  const iiScores = intelligenceIndex
    ? [intelligenceIndex.learning.score, intelligenceIndex.confidence.score, intelligenceIndex.executionReliability.score, intelligenceIndex.missionAlignment.score].filter((v): v is number => v !== null && v !== undefined)
    : [];
  const aiConfidence = iiScores.length >= 2 ? Math.round(iiScores.reduce((a, b) => a + b, 0) / iiScores.length) : null;

  const latestCycle = cycles[0] || null;
  const previousCycle = cycles[1] || null;
  const missionPct = revenueTarget > 0 ? Math.min(100, (revenueActual / revenueTarget) * 100) : null;

  const highRiskDecisions = decisionItems.filter(i => i.risk_level === 'high' || i.risk_level === 'critical');
  const topGoal = memory.find(m => m.kind === 'goal') as { description?: string } | undefined;

  const currentMission = highRiskDecisions.length > 0
    ? `Decide: ${highRiskDecisions[0].source === 'approvals' ? (highRiskDecisions[0] as any).action_type : (highRiskDecisions[0] as any).task_description || (highRiskDecisions[0] as any).raw_request}`
    : executiveAttention[0]?.description || topGoal?.description || 'No urgent decisions pending — review Company Radar for emerging opportunities.';

  const dueSoonPreds = predictions.filter(p => new Date(p.measure_by).getTime() - Date.now() < 3 * 86400000);
  const worldLearning = memory.filter(m => m.kind === 'world_learning').slice(0, 3) as { source?: string; topic?: string; text?: string; created_at: string }[];
  const intuitionEntry = memory.find(m => m.kind === 'intuition') as { patterns?: { taskType: string; confidence: number; sampleSize: number }[] } | undefined;
  const greeting = (() => { const h = new Date().getHours(); return h < 12 ? 'Good Morning' : h < 17 ? 'Good Afternoon' : 'Good Evening'; })();

  const attentionSorted = [...executiveAttention].sort((a, b) => {
    const order = { critical: 0, important: 1, monitor: 2 };
    return order[attentionTier(a)] - order[attentionTier(b)];
  });

  return (
    <div className="p-6 space-y-6">
      {/* HEADER — Founder Identity Layer */}
      <div className="bg-gradient-to-br from-slate-900 to-slate-950 border border-blue-900/40 rounded-xl p-5">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-cyan-500 flex items-center justify-center shrink-0"><Brain className="w-5 h-5 text-white" /></div>
            <div>
              <h1 className="text-base font-bold text-white">{greeting}, Rajeev</h1>
              <p className="text-[11px] text-slate-500">Founder · Chairman &amp; MD · Bhavishya Associates Artificial Enterprise</p>
            </div>
          </div>
          <button onClick={load} className="flex items-center gap-1.5 text-xs text-cyan-400 hover:text-cyan-300"><RefreshCw className="w-3.5 h-3.5" /> Refresh</button>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4">
          <HeaderStat label="Company Intelligence Status" value={companyHealth !== null ? `${companyHealth}%` : 'Awaiting data'} tone={companyHealth !== null && companyHealth >= 60 ? 'text-emerald-400' : 'text-amber-400'} />
          <HeaderStat label="AI Confidence" value={aiConfidence !== null ? `${aiConfidence}%` : 'Confidence building — insufficient evidence'} tone={aiConfidence !== null ? 'text-cyan-400' : 'text-slate-500'} small={aiConfidence === null} />
          <HeaderStat label="Brain Cycle Last Updated" value={summary?.last_exec_cycle ? new Date(summary.last_exec_cycle).toLocaleString() : 'Never run yet'} tone="text-slate-300" small />
          <HeaderStat label="Constitution Violations" value={String(summary?.violations ?? 0)} tone={(summary?.violations ?? 0) > 0 ? 'text-red-400' : 'text-emerald-400'} />
        </div>
        <div className="mt-4 pt-3 border-t border-slate-800/70">
          <p className="text-[10px] text-blue-400 uppercase tracking-wider font-semibold mb-1">Current mission</p>
          <p className="text-sm text-slate-200">{currentMission}</p>
        </div>
      </div>

      {/* FIRST-VIEWPORT LAYER: attention + top decisions — the "60-second brief" */}

      {/* Your Attention Today */}
      <div>
        <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-2">Your Attention Today</p>
        {attentionSorted.length === 0 ? (
          <div className="bg-slate-900 border border-slate-800 rounded-xl px-4 py-3 text-xs text-slate-500">Nothing needs your attention right now.</div>
        ) : (
          <div className="space-y-2">
            {attentionSorted.map((a, i) => {
              const tier = attentionTier(a);
              const meta = tierMeta[tier];
              return (
                <div key={i} className="bg-slate-900 border border-slate-800 rounded-xl px-4 py-3">
                  <div className="flex items-start gap-2">
                    <span className="text-sm shrink-0">{meta.dot}</span>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs text-slate-500 uppercase tracking-wider font-semibold">{meta.label}</p>
                      <p className="text-sm text-slate-200 mt-0.5">{a.description}</p>
                      <p className="text-xs text-slate-500 mt-1">Why it matters: {a.reason}</p>
                      <p className="text-xs text-cyan-400/80 mt-1">→ {meta.action}{meta.owner ? ` · Owner: ${meta.owner}` : ''}</p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Only You Can Decide */}
      <div>
        <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-2">Only You Can Decide</p>
        <DecisionCenter compact limit={5} />
      </div>

      {/* Your Company in 60 Seconds (compact strip, always visible) */}
      <div>
        <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-2">Your Company in 60 Seconds</p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Metric label="Revenue toward 2030 target" value={missionPct !== null ? `${missionPct.toFixed(1)}%` : 'Awaiting revenue data'} icon={<TrendingUp className="w-4 h-4 text-emerald-400" />} />
          <Metric label="Active Pipeline" value={leadCount !== null ? `${leadCount} leads` : '—'} icon={<Sparkles className="w-4 h-4 text-cyan-400" />} />
          <Metric label="Cash Position" value="Not yet built — no cashflow ledger exists in this codebase" small />
          <Metric label="AI Workforce" value={agentTotal !== null ? `${agentActive}/${agentTotal} active` : '—'} icon={<Cpu className="w-4 h-4 text-blue-400" />} />
        </div>
      </div>

      {/* EVERYTHING BELOW THIS LINE IS COLLAPSIBLE — deep-dive layers */}

      <Collapsible title="AI CEO Briefing">
        {!latestCycle ? (
          <div className="bg-slate-900 border border-slate-800 rounded-xl px-4 py-3 text-xs text-slate-500">No executive cycle has run yet — this section activates after the first daily cycle.</div>
        ) : (
          <div className="bg-slate-900 border border-slate-800 rounded-xl px-4 py-3 space-y-3">
            <div>
              <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">Yesterday</p>
              {!previousCycle ? <p className="text-xs text-slate-500">No prior cycle recorded yet — this is the first.</p> : (
                <>
                  <p className="text-xs text-slate-300 leading-relaxed">What changed: {previousCycle.situation_assessment}</p>
                  {previousCycle.opportunities.length > 0 && <p className="text-xs text-emerald-300/90 mt-1">What succeeded: {previousCycle.opportunities[0].title}</p>}
                  {previousCycle.risks.length > 0 && <p className="text-xs text-red-300/80 mt-1">What needed attention: {previousCycle.risks[0].risk}</p>}
                </>
              )}
            </div>
            <div>
              <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">Today</p>
              <p className="text-xs text-slate-300 leading-relaxed mb-1">Main focus: {latestCycle.situation_assessment}</p>
              <p className="text-xs text-amber-300/90">Decisions required: {decisionItems.length}</p>
              {latestCycle.risks.map((r, i) => (
                <p key={i} className="text-xs py-0.5"><span className={r.severity === 'high' ? 'text-red-400' : r.severity === 'medium' ? 'text-amber-400' : 'text-slate-400'}>⚠ [{r.severity}]</span> <span className="text-slate-300">{r.risk}</span></p>
              ))}
            </div>
            <div>
              <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">Tomorrow</p>
              {dueSoonPreds.length === 0 ? <p className="text-xs text-slate-500">No predictions due within 3 days.</p> : dueSoonPreds.map((p, i) => (
                <p key={i} className="text-xs text-slate-300 py-0.5">Prediction: {p.metric} → <span className="text-cyan-300">{p.expected_value}</span> <span className="text-slate-500">by {p.measure_by}</span></p>
              ))}
              {latestCycle.opportunities.length > 0 && <p className="text-xs text-emerald-300/90 mt-1">Opportunity to prepare for: {latestCycle.opportunities[0].title}</p>}
            </div>
          </div>
        )}
      </Collapsible>

      <Collapsible title="What I Learned Today">
        <div className="grid md:grid-cols-3 gap-3">
          <div className="bg-slate-900 border border-slate-800 rounded-xl px-4 py-3">
            <p className="text-[10px] text-emerald-400 uppercase tracking-wider mb-1.5">New discoveries</p>
            {worldLearning.length === 0 ? <p className="text-xs text-slate-500">Nothing discovered yet.</p> : worldLearning.map((l, i) => (
              <div key={i} className="mb-2"><span className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-950/50 text-emerald-400 border border-emerald-900 mr-1">Learning</span><span className="text-xs text-slate-300">{(l.text || '').slice(0, 140)}</span></div>
            ))}
          </div>
          <div className="bg-slate-900 border border-slate-800 rounded-xl px-4 py-3">
            <p className="text-[10px] text-teal-400 uppercase tracking-wider mb-1.5">Changed beliefs</p>
            {recentBeliefs.length === 0 ? <p className="text-xs text-slate-500">No belief revisions yet.</p> : recentBeliefs.map((b, i) => (
              <div key={i} className="mb-2">
                <span className={`text-[9px] px-1.5 py-0.5 rounded border mr-1 ${b.resolved ? 'bg-emerald-950/50 text-emerald-400 border-emerald-900' : 'bg-amber-950/50 text-amber-400 border-amber-900'}`}>{b.resolved ? 'Learning' : 'Hypothesis'}</span>
                <span className="text-xs text-slate-300">{b.currentBelief}</span>
              </div>
            ))}
          </div>
          <div className="bg-slate-900 border border-slate-800 rounded-xl px-4 py-3">
            <p className="text-[10px] text-purple-400 uppercase tracking-wider mb-1.5">Patterns noticed</p>
            {intuitionEntry?.patterns?.length ? intuitionEntry.patterns.slice(0, 3).map((p, i) => (
              <div key={i} className="mb-2"><span className="text-[9px] px-1.5 py-0.5 rounded bg-cyan-950/50 text-cyan-400 border border-cyan-900 mr-1">Fact</span><span className="text-xs text-slate-300">{p.taskType}: {p.confidence}% ({p.sampleSize} observations)</span></div>
            )) : recentImagination.length > 0 ? recentImagination.slice(0, 2).map((im, i) => (
              <div key={i} className="mb-2"><span className="text-[9px] px-1.5 py-0.5 rounded bg-indigo-950/50 text-indigo-400 border border-indigo-900 mr-1">Hypothesis</span><span className="text-xs text-slate-300">{(im.text || '').slice(0, 120)}</span></div>
            )) : <p className="text-xs text-slate-500">Not enough recorded outcomes yet to form a pattern.</p>}
          </div>
        </div>
      </Collapsible>

      <Collapsible title="Your AI Company" badge={`${workforce.length} agents`}>
        <WorkforcePanel workforce={workforce.slice(0, 9)} />
        {workforce.length > 9 && <p className="text-[10px] text-slate-600 mt-2">{workforce.length - 9} more agents — see Agent Factory for the full roster.</p>}
      </Collapsible>

      <Collapsible title="Company Radar">
        <div className="grid md:grid-cols-2 gap-3">
          <div className="bg-slate-900 border border-slate-800 rounded-xl px-4 py-3">
            <p className="text-[10px] text-emerald-400 uppercase tracking-wider mb-1.5">Opportunities</p>
            {!latestCycle || latestCycle.opportunities.length === 0 ? <p className="text-xs text-slate-500">None identified this cycle.</p> : latestCycle.opportunities.map((o, i) => (
              <p key={i} className="text-xs text-slate-300 py-0.5">▲ <span className="text-emerald-300">{o.title}</span> — {o.rationale}</p>
            ))}
          </div>
          <div className="bg-slate-900 border border-slate-800 rounded-xl px-4 py-3">
            <p className="text-[10px] text-cyan-400 uppercase tracking-wider mb-1.5 flex items-center gap-1"><Radio className="w-3 h-3" />Market Signals</p>
            {marketSignals.length === 0 ? <p className="text-xs text-slate-500">No market signals captured yet.</p> : marketSignals.slice(0, 4).map((m, i) => (
              <p key={i} className="text-xs text-slate-300 py-0.5">{m.headline} <span className="text-slate-600">[{m.signal_type}, conf {m.confidence}]</span></p>
            ))}
          </div>
        </div>
      </Collapsible>
    </div>
  );
}

function HeaderStat({ label, value, tone, small }: { label: string; value: string; tone: string; small?: boolean }) {
  return (
    <div className="bg-slate-900/60 border border-slate-800 rounded-lg px-3 py-2.5">
      <p className={`${small ? 'text-xs' : 'text-lg'} font-bold ${tone}`}>{value}</p>
      <p className="text-[9px] text-slate-500 uppercase tracking-wider mt-0.5">{label}</p>
    </div>
  );
}
function Metric({ label, value, icon, small }: { label: string; value: string; icon?: React.ReactNode; small?: boolean }) {
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl px-4 py-3">
      <div className="flex items-center gap-2 mb-1">{icon}{!small && <p className="text-lg font-bold text-white">{value}</p>}</div>
      {small && <p className="text-xs text-slate-500 leading-snug">{value}</p>}
      <p className="text-[9px] text-slate-500 uppercase tracking-wider mt-0.5">{label}</p>
    </div>
  );
}
