'use client';
import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';

export default function ChiefOfStaff() {
  const [reports, setReports] = useState<any[]>([]);
  const [selected, setSelected] = useState<any>(null);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [companies, setCompanies] = useState<any[]>([]);
  const [forCompanyId, setForCompanyId] = useState<string>('');

  const refresh = () => {
    supabase.from('brain_staff_reports').select('*, brand:brain_brands(name, color, icon)').order('created_at', { ascending: false }).limit(50).then(({ data }) => {
      setReports(data || []);
      if (data && data.length > 0) setSelected(data[0]);
    });
  };

  useEffect(() => {
    refresh();
    supabase.from('companies').select('id, name').then(({ data }) => { setCompanies(data || []); if (data && data[0]) setForCompanyId(data[0].id); });
  }, []);

  const generateReport = async (type: 'daily' | 'weekly') => {
    setGenerating(true);
    setError(null);
    try {
      const { data, error: fnError } = await supabase.functions.invoke('staff-engine', { body: { action: 'generate_report', type } });
      if (fnError) throw fnError;
      if (data?.error) throw new Error(data.error);
      // staff-engine doesn't accept a company param yet, so tag the new
      // report client-side right after creation.
      const newId = data?.report?.id;
      if (newId && forCompanyId) await supabase.from('brain_staff_reports').update({ company_id: forCompanyId }).eq('id', newId);
      refresh();
    } catch (e: any) {
      setError(e?.message || 'Failed to generate report');
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-bold text-white">Chief of Staff</h1>
            <span className="text-[10px] px-2 py-0.5 bg-teal-500/10 text-teal-400 rounded-full">Phase 4 - Autonomous Reviews</span>
          </div>
          <p className="text-[11px] text-slate-500 mt-1">Real Claude-written founder briefings grounded in your actual leads, decisions, ideas, and agent activity from the last 1 or 7 days — not a template.</p>
        </div>
        <div className="flex gap-2 items-center">
          <select value={forCompanyId} onChange={e => setForCompanyId(e.target.value)} className="bg-slate-800 border border-slate-700 rounded-lg px-2 py-2 text-xs text-white">
            {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <button onClick={() => generateReport('daily')} disabled={generating} className="px-3 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg text-xs font-medium cursor-pointer">
            {generating ? 'Generating...' : 'Generate Daily Briefing'}
          </button>
          <button onClick={() => generateReport('weekly')} disabled={generating} className="px-3 py-2 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-white rounded-lg text-xs font-medium cursor-pointer">
            Weekly
          </button>
        </div>
      </div>
      {error && <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{error}</div>}

      <div className="flex gap-4">
        <div className="w-64 shrink-0 space-y-2">
          <h3 className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Reports ({reports.length})</h3>
          <div className="max-h-[calc(100vh-14rem)] overflow-y-auto space-y-1.5">
            {reports.map((r: any) => (
              <button key={r.id} onClick={() => setSelected(r)} className={`w-full text-left p-3 rounded-xl bg-slate-900 border transition-colors cursor-pointer ${selected?.id === r.id ? 'border-blue-500/50' : 'border-slate-800 hover:border-slate-700'}`}>
                <div className="flex items-center gap-2">
                  {r.brand && <div className="w-5 h-5 rounded text-[8px] font-bold text-white flex items-center justify-center" style={{ backgroundColor: r.brand.color }}>{r.brand.name.charAt(0)}</div>}
                  <div className="min-w-0"><p className="text-xs font-medium text-white">{r.brand?.name || 'System-Wide'}</p>
                    <div className="flex items-center gap-1.5 mt-0.5"><span className="text-[8px] px-1 py-0 bg-slate-800 text-slate-400 rounded">{r.type}</span><span className="text-[9px] text-slate-500">{new Date(r.created_at).toLocaleDateString()}</span></div>
                    {companies.find(c => c.id === r.company_id) && <p className="text-[9px] text-slate-600 mt-0.5">{companies.find(c => c.id === r.company_id)?.name}</p>}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1">
          {selected ? (
            <div className="space-y-4">
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
                <div className="flex items-center gap-3 mb-2">
                  {selected.brand && <div className="w-10 h-10 rounded-lg text-white font-bold flex items-center justify-center" style={{ backgroundColor: selected.brand.color }}>{selected.brand.name.charAt(0)}</div>}
                  <div><h2 className="text-base font-bold text-white">{selected.brand?.name || 'System-Wide'} Report</h2>
                    <div className="flex items-center gap-2 mt-0.5"><span className="text-[9px] px-1.5 py-0.5 bg-slate-800 text-slate-400 rounded">{selected.type} briefing</span>
                      <span className="text-[10px] text-slate-500">{new Date(selected.created_at).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</span></div>
                  </div>
                </div>
              </div>
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
                <h3 className="text-sm font-semibold text-white mb-2">Briefing</h3>
                <p className="text-sm text-slate-300 leading-relaxed">{selected.content}</p>
              </div>
              {selected.priorities && Array.isArray(selected.priorities) && selected.priorities.length > 0 && (
                <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
                  <h3 className="text-sm font-semibold text-white mb-2">Priorities</h3>
                  <div className="space-y-2">{selected.priorities.map((p: string, i: number) => (
                    <div key={i} className="flex items-start gap-2 px-3 py-2 rounded-lg bg-slate-800/50"><span className="w-5 h-5 rounded-full bg-blue-500/20 text-blue-400 flex items-center justify-center text-[10px] font-bold shrink-0">{i + 1}</span><span className="text-xs text-slate-300">{p}</span></div>
                  ))}</div>
                </div>
              )}
            </div>
          ) : <div className="flex items-center justify-center h-48 text-slate-500"><p className="text-sm">Select a report to view</p></div>}
        </div>
      </div>
    </div>
  );
}