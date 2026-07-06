'use client';
import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';

export default function BusinessCreator() {
  const [ideas, setIdeas] = useState<any[]>([]);
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');

  useEffect(() => {
    supabase.from('brain_business_ideas').select('*, brand:brain_brands(name, color)').order('created_at', { ascending: false }).then(({ data }) => setIdeas(data || []));
  }, []);

  const [evaluating, setEvaluating] = useState(false);
  const [evalError, setEvalError] = useState<string | null>(null);
  const [lastAnalysis, setLastAnalysis] = useState<string | null>(null);
  const createIdea = async () => {
    if (!title.trim() || evaluating) return; // guard fixes the double-insert seen in DB (two identical ideas 2s apart)
    setEvaluating(true); setEvalError(null); setLastAnalysis(null);
    try {
      const { data, error: fnError } = await supabase.functions.invoke('business-engine', { body: { title, description: desc } });
      if (fnError || data?.error) throw new Error(data?.error || fnError?.message || 'Evaluation failed');
      const analysisText = data?.idea?.description || data?.description || data?.analysis || null;
      if (analysisText) setLastAnalysis(analysisText);
      const { data: fresh } = await supabase.from('brain_business_ideas').select('*, brand:brain_brands(name, color)').order('created_at', { ascending: false });
      if (fresh) setIdeas(fresh);
      setTitle(''); setDesc('');
    } catch (e) {
      setEvalError(e instanceof Error ? e.message : 'Failed to evaluate idea');
    } finally { setEvaluating(false); }
  };

  const statusCfg: Record<string, { label: string; color: string }> = { idea: { label: 'Idea', color: 'bg-slate-500/10 text-slate-400' }, validating: { label: 'Validating', color: 'bg-blue-500/10 text-blue-400' }, planning: { label: 'Planning', color: 'bg-amber-500/10 text-amber-400' }, building: { label: 'Building', color: 'bg-purple-500/10 text-purple-400' }, launched: { label: 'Launched', color: 'bg-emerald-500/10 text-emerald-400' } };

  const autoComponents = [
    { title: 'Business Model Canvas', desc: 'Revenue streams, cost structure, value proposition, and key partnerships.' },
    { title: 'Franchise Model', desc: 'Fee structure, territory rights, support packages, and investment requirements.' },
    { title: 'Standard Operating Procedures', desc: 'Step-by-step operational guides covering setup, daily operations, and quality control.' },
    { title: 'Marketing Plan', desc: 'Channel strategy, content calendar, customer acquisition funnel, and brand positioning.' },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <h1 className="text-lg font-bold text-white">Business Creation Engine</h1>
          <span className="text-[10px] px-2 py-0.5 bg-rose-500/10 text-rose-400 rounded-full">Phase 2</span>
        </div>
      </div>

      <div className="grid grid-cols-5 gap-2">
        {Object.entries(statusCfg).map(([key, cfg]) => (
          <div key={key} className="text-center px-3 py-2 rounded-lg border border-slate-800">
            <p className="text-lg font-bold text-white">{ideas.filter((i: any) => i.status === key).length}</p>
            <p className="text-[10px] text-slate-500">{cfg.label}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-3 gap-3">
        <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Business idea title" className="col-span-2 bg-slate-800 border border-slate-700 rounded-lg px-4 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500" />
        <button onClick={createIdea} disabled={!title.trim() || evaluating} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg text-xs font-medium cursor-pointer">{evaluating ? 'AI evaluating…' : 'Submit & Analyze'}</button>
      </div>
      {evalError && <p className="text-xs text-rose-400">{evalError}</p>}
      {lastAnalysis && (
        <div className="bg-slate-900 border border-emerald-500/30 rounded-xl p-4">
          <p className="text-xs font-semibold text-emerald-400 uppercase tracking-wider mb-2">Investment-committee analysis</p>
          <p className="text-sm text-slate-300 whitespace-pre-wrap">{lastAnalysis}</p>
        </div>
      )}

      <div className="flex gap-4">
        <div className="w-64 shrink-0 space-y-2">
          <h3 className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Ideas ({ideas.length})</h3>
          {ideas.map((idea: any) => {
            const sc = statusCfg[idea.status] || statusCfg.idea;
            return (
              <div key={idea.id} className="p-3 bg-slate-900 border border-slate-800 rounded-xl">
                <div className="flex items-start justify-between">
                  <p className="text-xs font-medium text-white truncate flex-1">{idea.title}</p>
                  <span className={`text-[9px] px-1.5 py-0.5 rounded shrink-0 ml-2 ${sc.color}`}>{sc.label}</span>
                </div>
                <p className="text-[10px] text-slate-500 mt-1 truncate">{idea.description}</p>
                <div className="flex items-center justify-between mt-1"><span className="text-[9px] text-slate-500">{idea.industry || 'General'}</span><span className="text-xs font-bold text-amber-400">{idea.score?.toFixed(1)}</span></div>
              </div>
            );
          })}
        </div>

        <div className="flex-1">
          {ideas.length > 0 ? (
            <div className="grid grid-cols-2 gap-3">
              {autoComponents.map(item => (
                <div key={item.title} className="bg-slate-900 border border-slate-800 rounded-xl p-4 hover:border-slate-700 transition-colors cursor-pointer">
                  <div className="flex items-start gap-3">
                    <div className="w-8 h-8 rounded-lg bg-blue-500/10 flex items-center justify-center text-blue-400 shrink-0 text-xs font-bold">{item.title.charAt(0)}</div>
                    <div><h3 className="text-xs font-semibold text-white">{item.title}</h3><p className="text-[11px] text-slate-400 mt-0.5">{item.desc}</p></div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex items-center justify-center h-48 text-slate-500"><p className="text-sm">Submit a business idea to get started</p></div>
          )}
        </div>
      </div>
    </div>
  );
}