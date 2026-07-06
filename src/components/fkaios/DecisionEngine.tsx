'use client';
import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';

function ScoreBar({ score, label, weight, assessment, recommendation }: { score: number; label: string; weight: number; assessment: string; recommendation: string }) {
  // Backend scores dimensions 0-100 (see decision-engine SYSTEM_PROMPT). This
  // component used to assume a 0-10 scale (>=8 threshold, score*10 width),
  // which made every real 0-100 score render as an overflowing bar stuck at
  // "always green" — the literal cause of "Decision Engine doesn't work".
  const color = score >= 80 ? 'bg-emerald-500' : score >= 60 ? 'bg-amber-500' : 'bg-red-500';
  const textColor = score >= 80 ? 'text-emerald-400' : score >= 60 ? 'text-amber-400' : 'text-red-400';
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-slate-300">{label} <span className="text-slate-500">({(weight * 100).toFixed(0)}%)</span></span>
        <span className={`text-sm font-bold ${textColor}`}>{score.toFixed(1)}</span>
      </div>
      <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden"><div className={`h-full ${color} rounded-full transition-all`} style={{ width: `${Math.min(100, score)}%` }} /></div>
      <p className="text-[11px] text-slate-400">{assessment}</p>
      {recommendation && <p className="text-[11px] text-blue-400 pl-3 border-l-2 border-blue-500/20">{recommendation}</p>}
    </div>
  );
}

export default function DecisionEngine() {
  const [decisions, setDecisions] = useState<any[]>([]);
  const [selected, setSelected] = useState<any>(null);
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');
  const [companies, setCompanies] = useState<any[]>([]);
  const [forCompanyId, setForCompanyId] = useState<string>('');

  useEffect(() => {
    supabase.from('brain_decisions').select('*, dimensions:brain_decision_dimensions(*)').order('created_at', { ascending: false }).then(({ data }) => setDecisions(data || []));
    supabase.from('companies').select('id, name').then(({ data }) => { setCompanies(data || []); if (data && data[0]) setForCompanyId(data[0].id); });
  }, []);

  const [scoring, setScoring] = useState(false);
  const [scoreError, setScoreError] = useState<string | null>(null);
  const createDecision = async () => {
    if (!title.trim() || scoring) return;
    setScoring(true); setScoreError(null);
    try {
      const { data, error: fnError } = await supabase.functions.invoke('decision-engine', { body: { title, description: desc } });
      if (fnError || data?.error) throw new Error(data?.error || fnError?.message || 'Scoring failed');
      // decision-engine doesn't accept a company param, so tag it client-side
      // right after creation — this is a real write, so it does nothing if
      // no company is selected.
      const newId = data?.decision?.id;
      if (newId && forCompanyId) await supabase.from('brain_decisions').update({ company_id: forCompanyId }).eq('id', newId);
      // Re-fetch with the dimensions join so the detail panel has real data
      const { data: fresh } = await supabase.from('brain_decisions').select('*, dimensions:brain_decision_dimensions(*)').order('created_at', { ascending: false }).limit(50);
      if (fresh) { setDecisions(fresh); setSelected(fresh[0] ?? null); }
      setTitle(''); setDesc('');
    } catch (e) {
      setScoreError(e instanceof Error ? e.message : 'Failed to score decision');
    } finally { setScoring(false); }
  };

  // Same 0-100 scale fix as ScoreBar above.
  const verdict = (s: number) => s >= 80 ? { label: 'Strongly Recommended', color: 'text-emerald-400 bg-emerald-500/10' } : s >= 60 ? { label: 'Recommended with Conditions', color: 'text-amber-400 bg-amber-500/10' } : { label: 'Not Recommended', color: 'text-red-400 bg-red-500/10' };
  const scoreColor = (s: number) => s >= 80 ? 'text-emerald-400' : s >= 60 ? 'text-amber-400' : 'text-red-400';

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-bold text-white">Decision Support Engine</h1>
            <span className="text-[10px] px-2 py-0.5 bg-cyan-500/10 text-cyan-400 rounded-full">6-Dimension Framework</span>
          </div>
          <p className="text-[11px] text-slate-500 mt-1">Score any business decision (a new brand, a big spend, entering a market) across Financial Impact, Strategic Fit, Execution Risk, Time to Value, Market Timing, and Resource Availability — real Claude analysis, not a template.</p>
        </div>
        <button onClick={createDecision} disabled={!title.trim() || scoring} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg text-xs font-medium cursor-pointer">{scoring ? 'Scoring with AI…' : '+ New Analysis'}</button>
        {scoreError && <p className="text-xs text-rose-400 mt-1">{scoreError}</p>}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-5 gap-3 mb-4">
        <input value={title} onChange={e => setTitle(e.target.value)} placeholder="What decision are you evaluating?" className="col-span-2 bg-slate-800 border border-slate-700 rounded-lg px-4 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500" />
        <input value={desc} onChange={e => setDesc(e.target.value)} placeholder="Context..." className="col-span-2 bg-slate-800 border border-slate-700 rounded-lg px-4 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500" />
        <select value={forCompanyId} onChange={e => setForCompanyId(e.target.value)} className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white">
          {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>

      <div className="flex gap-4">
        <div className="w-64 shrink-0 space-y-2">
          <h3 className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Analyses ({decisions.length})</h3>
          {decisions.map((d: any) => {
            const v = verdict(d.overall_score);
            const co = companies.find(c => c.id === d.company_id);
            return (
              <button key={d.id} onClick={() => setSelected(d)} className={`w-full text-left p-3 rounded-xl bg-slate-900 border transition-colors cursor-pointer ${selected?.id === d.id ? 'border-blue-500/50' : 'border-slate-800 hover:border-slate-700'}`}>
                <p className="text-xs font-medium text-white truncate">{d.title}</p>
                {co && <p className="text-[9px] text-slate-500 mt-0.5">{co.name}</p>}
                <div className="flex items-center justify-between mt-1.5">
                  <span className={`text-lg font-bold ${scoreColor(d.overall_score)}`}>{d.overall_score?.toFixed(1) || '0.0'}</span>
                  <span className={`text-[9px] px-1.5 py-0.5 rounded ${v.color}`}>{v.label.split(' ').slice(0, 2).join(' ')}</span>
                </div>
              </button>
            );
          })}
        </div>

        <div className="flex-1">
          {selected ? (
            <div className="space-y-4">
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-base font-bold text-white">{selected.title}</h2>
                  <div className="text-center"><p className={`text-3xl font-bold ${scoreColor(selected.overall_score)}`}>{selected.overall_score?.toFixed(1) || '0'}</p><p className="text-[10px] text-slate-500">/100</p></div>
                </div>
                {(() => { const v = verdict(selected.overall_score); return <div className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg ${v.color} text-sm font-medium`}>{v.label}</div>; })()}
              </div>
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
                <h3 className="text-sm font-semibold text-white">Evaluation Dimensions</h3>
                {(selected.dimensions || []).map((dim: any) => <ScoreBar key={dim.id} score={dim.score} label={dim.name} weight={dim.weight} assessment={dim.assessment} recommendation={dim.recommendation} />)}
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-center h-64 text-slate-500"><div className="text-center"><p className="text-sm">Select or create a decision analysis</p></div></div>
          )}
        </div>
      </div>
    </div>
  );
}