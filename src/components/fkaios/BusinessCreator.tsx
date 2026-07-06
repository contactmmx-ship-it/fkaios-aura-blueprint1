'use client';
import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';

export default function BusinessCreator() {
  const [ideas, setIdeas] = useState<any[]>([]);
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');

  useEffect(() => {
    supabase.from('brain_business_ideas').select('*, brand:brain_brands(name, color)').order('created_at', { ascending: false }).then(({ data }) => {
      setIdeas(data || []);
      if (data && data.length > 0) setSelectedIdea(data[0]);
    });
  }, []);

  const [evaluating, setEvaluating] = useState(false);
  const [evalError, setEvalError] = useState<string | null>(null);
  const [lastAnalysis, setLastAnalysis] = useState<string | null>(null);
  const [selectedIdea, setSelectedIdea] = useState<any>(null);
  const [genDoc, setGenDoc] = useState<{ type: string; loading: boolean; content: string | null; error: string | null } | null>(null);

  const generateDocument = async (documentType: string) => {
    if (!selectedIdea) return;
    setGenDoc({ type: documentType, loading: true, content: selectedIdea.generated_docs?.[documentType] ?? null, error: null });
    // If already generated for this idea, show cached version instead of re-billing Claude.
    if (selectedIdea.generated_docs?.[documentType]) {
      setGenDoc({ type: documentType, loading: false, content: selectedIdea.generated_docs[documentType], error: null });
      return;
    }
    try {
      const { data, error: fnError } = await supabase.functions.invoke('business-engine', {
        body: { action: 'generate_document', idea_id: selectedIdea.id, document_type: documentType },
      });
      if (fnError || data?.error) throw new Error(data?.error || fnError?.message || 'Document generation failed');
      setGenDoc({ type: documentType, loading: false, content: data.content, error: null });
      setSelectedIdea((prev: any) => prev ? { ...prev, generated_docs: { ...(prev.generated_docs ?? {}), [documentType]: data.content } } : prev);
      setIdeas((prev) => prev.map((i) => i.id === selectedIdea.id ? { ...i, generated_docs: { ...(i.generated_docs ?? {}), [documentType]: data.content } } : i));
    } catch (e) {
      setGenDoc({ type: documentType, loading: false, content: null, error: e instanceof Error ? e.message : 'Failed to generate document' });
    }
  };

  const createIdea = async () => {
    if (!title.trim() || evaluating) return; // guard fixes the double-insert seen in DB (two identical ideas 2s apart)
    setEvaluating(true); setEvalError(null); setLastAnalysis(null);
    try {
      const { data, error: fnError } = await supabase.functions.invoke('business-engine', { body: { title, description: desc } });
      if (fnError || data?.error) throw new Error(data?.error || fnError?.message || 'Evaluation failed');
      const analysisText = data?.idea?.description || data?.description || data?.analysis || null;
      if (analysisText) setLastAnalysis(analysisText);
      const { data: fresh } = await supabase.from('brain_business_ideas').select('*, brand:brain_brands(name, color)').order('created_at', { ascending: false });
      if (fresh) { setIdeas(fresh); setSelectedIdea(fresh[0] ?? null); }
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
              <button key={idea.id} onClick={() => setSelectedIdea(idea)} className={`w-full text-left p-3 bg-slate-900 border rounded-xl transition-colors ${selectedIdea?.id === idea.id ? 'border-blue-500/50' : 'border-slate-800 hover:border-slate-700'}`}>
                <div className="flex items-start justify-between">
                  <p className="text-xs font-medium text-white truncate flex-1">{idea.title}</p>
                  <span className={`text-[9px] px-1.5 py-0.5 rounded shrink-0 ml-2 ${sc.color}`}>{sc.label}</span>
                </div>
                <p className="text-[10px] text-slate-500 mt-1 truncate">{idea.description}</p>
                <div className="flex items-center justify-between mt-1"><span className="text-[9px] text-slate-500">{idea.industry || 'General'}</span><span className="text-xs font-bold text-amber-400">{idea.score?.toFixed(1)}</span></div>
              </button>
            );
          })}
        </div>

        <div className="flex-1">
          {selectedIdea ? (
            <div>
              <p className="text-[10px] text-slate-500 mb-2">Generate real, AI-written documents for <span className="text-slate-300">{selectedIdea.title}</span> — grounded in its investment-committee analysis above, not templates.</p>
              <div className="grid grid-cols-2 gap-3">
                {autoComponents.map(item => {
                  const cached = selectedIdea.generated_docs?.[item.title];
                  return (
                    <button key={item.title} onClick={() => generateDocument(item.title)}
                      className="text-left bg-slate-900 border border-slate-800 rounded-xl p-4 hover:border-blue-500/40 transition-colors cursor-pointer">
                      <div className="flex items-start gap-3">
                        <div className="w-8 h-8 rounded-lg bg-blue-500/10 flex items-center justify-center text-blue-400 shrink-0 text-xs font-bold">{item.title.charAt(0)}</div>
                        <div>
                          <h3 className="text-xs font-semibold text-white">{item.title}</h3>
                          <p className="text-[11px] text-slate-400 mt-0.5">{item.desc}</p>
                          <p className="text-[10px] mt-1.5 font-medium">{cached ? <span className="text-emerald-400">✓ Generated — click to view</span> : <span className="text-blue-400">Click to generate with AI</span>}</p>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-center h-48 text-slate-500"><p className="text-sm">Submit or select a business idea to generate real documents for it</p></div>
          )}
        </div>
      </div>

      {genDoc && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={() => setGenDoc(null)}>
          <div className="bg-slate-900 border border-slate-700 rounded-xl w-full max-w-2xl max-h-[80vh] overflow-y-auto p-5" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-base font-bold text-white">{genDoc.type}</h2>
              <button onClick={() => setGenDoc(null)} className="text-slate-400 hover:text-white text-lg">✕</button>
            </div>
            {genDoc.loading && <p className="text-sm text-slate-400">Generating with Claude — grounded in this idea's real analysis…</p>}
            {genDoc.error && <p className="text-sm text-rose-400">⚠ {genDoc.error}</p>}
            {genDoc.content && <p className="text-sm text-slate-300 whitespace-pre-wrap leading-relaxed">{genDoc.content}</p>}
          </div>
        </div>
      )}
    </div>
  );
}