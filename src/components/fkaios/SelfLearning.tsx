'use client';
import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';

const typeCfg: Record<string, { label: string; color: string }> = {
  win: { label: 'Win', color: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20' },
  loss: { label: 'Loss', color: 'text-red-400 bg-red-500/10 border-red-500/20' },
  campaign: { label: 'Campaign', color: 'text-blue-400 bg-blue-500/10 border-blue-500/20' },
};
const impactCfg: Record<string, { label: string; color: string }> = {
  high: { label: 'High Impact', color: 'text-emerald-400' }, medium: { label: 'Medium', color: 'text-amber-400' }, low: { label: 'Low', color: 'text-slate-400' },
};

export default function SelfLearning() {
  const [insights, setInsights] = useState<any[]>([]);
  const [filter, setFilter] = useState('all');
  const [newTitle, setNewTitle] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newType, setNewType] = useState('win');
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [companies, setCompanies] = useState<any[]>([]);
  const [forCompanyId, setForCompanyId] = useState<string>('');

  const refresh = () => {
    const q = filter === 'all' ? supabase.from('brain_learning_insights').select('*').order('created_at', { ascending: false }).limit(50) : supabase.from('brain_learning_insights').select('*').eq('type', filter).order('created_at', { ascending: false }).limit(50);
    q.then(({ data }) => setInsights(data || []));
  };

  useEffect(() => { refresh(); }, [filter]);
  useEffect(() => {
    supabase.from('companies').select('id, name').then(({ data }) => { setCompanies(data || []); if (data && data[0]) setForCompanyId(data[0].id); });
  }, []);

  const logInsight = async () => {
    if (!newTitle.trim()) return;
    await supabase.from('brain_learning_insights').insert({ type: newType, title: newTitle, description: newDesc, company_id: forCompanyId || null });
    setNewTitle(''); setNewDesc('');
    refresh();
  };

  const analyzeWithAI = async () => {
    setAnalyzing(true);
    setError(null);
    try {
      const { data, error: fnError } = await supabase.functions.invoke('learning-engine', { body: { action: 'analyze' } });
      if (fnError) throw fnError;
      if (data?.error) throw new Error(data.error);
      refresh();
    } catch (e: any) {
      setError(e?.message || 'Failed to analyze');
    } finally {
      setAnalyzing(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-bold text-white">Self-Learning System</h1>
            <span className="text-[10px] px-2 py-0.5 bg-lime-500/10 text-lime-400 rounded-full">Phase 5</span>
          </div>
          <p className="text-[11px] text-slate-500 mt-1">A running log of what's actually working or not — wins, losses, campaign results — so future decisions and agent behavior can learn from real outcomes instead of repeating mistakes.</p>
        </div>
        <div className="flex gap-2 items-end flex-wrap">
          <button onClick={analyzeWithAI} disabled={analyzing} className="px-3 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-lg text-xs font-medium cursor-pointer">
            {analyzing ? 'Analyzing...' : 'AI Analyze Last 14 Days'}
          </button>
          <select value={newType} onChange={e => setNewType(e.target.value)} className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white">
            <option value="win">Win</option><option value="loss">Loss</option><option value="campaign">Campaign</option>
          </select>
          <select value={forCompanyId} onChange={e => setForCompanyId(e.target.value)} className="bg-slate-800 border border-slate-700 rounded-lg px-2 py-2 text-xs text-white">
            {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <input value={newTitle} onChange={e => setNewTitle(e.target.value)} placeholder="Insight title" className="w-48 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500" />
          <button onClick={logInsight} disabled={!newTitle.trim()} className="px-3 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg text-xs font-medium cursor-pointer">Log</button>
        </div>
      </div>
      {error && <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{error}</div>}

      <div className="grid grid-cols-4 gap-3">
        {[
          { label: 'Wins', count: insights.filter(i => i.type === 'win').length, color: 'text-emerald-400', bg: 'bg-emerald-500/5' },
          { label: 'Losses', count: insights.filter(i => i.type === 'loss').length, color: 'text-red-400', bg: 'bg-red-500/5' },
          { label: 'Campaigns', count: insights.filter(i => i.type === 'campaign').length, color: 'text-blue-400', bg: 'bg-blue-500/5' },
          { label: 'High Impact', count: insights.filter(i => i.impact === 'high').length, color: 'text-amber-400', bg: 'bg-amber-500/5' },
        ].map(s => (
          <div key={s.label} className={`${s.bg} border border-slate-800 rounded-xl p-3 text-center`}>
            <p className={`text-2xl font-bold ${s.color}`}>{s.count}</p><p className="text-[10px] text-slate-500">{s.label}</p>
          </div>
        ))}
      </div>

      <div className="flex gap-2 flex-wrap">
        {['all', 'win', 'loss', 'campaign'].map(t => (
          <button key={t} onClick={() => setFilter(t)} className={`px-3 py-1.5 rounded-full text-[11px] transition-colors cursor-pointer ${filter === t ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-400 hover:text-white'}`}>
            {t === 'all' ? 'All Types' : typeCfg[t]?.label}
          </button>
        ))}
      </div>

      <div className="space-y-3">
        {insights.map((insight: any) => {
          const tc = typeCfg[insight.type] || typeCfg.win;
          const ic = impactCfg[insight.impact] || impactCfg.medium;
          return (
            <div key={insight.id} className="bg-slate-900 border border-slate-800 rounded-xl p-4 hover:border-slate-700 transition-colors">
              <div className="flex items-start gap-3">
                <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 border ${tc.color}`}><span className="text-xs font-bold">{tc.label.charAt(0)}</span></div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="text-sm font-medium text-white">{insight.title}</h3>
                    <span className={`text-[10px] ${ic.color} shrink-0`}>{ic.label}</span>
                  </div>
                  <p className="text-xs text-slate-400 mt-1.5 leading-relaxed">{insight.description}</p>
                  <div className="flex items-center gap-2 mt-2">
                    <p className="text-[9px] text-slate-600">{new Date(insight.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</p>
                    {companies.find(c => c.id === insight.company_id) && <p className="text-[9px] text-slate-500">· {companies.find(c => c.id === insight.company_id)?.name}</p>}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
        {insights.length === 0 && <div className="text-center py-12 text-slate-500"><p className="text-sm">No insights recorded yet</p></div>}
      </div>
    </div>
  );
}