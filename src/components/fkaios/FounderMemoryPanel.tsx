'use client';
// ONE BRAIN step 2 (28 Oct 2026): shows the one memory the brain now uses
// (fkaios_knowledge_*: 622 ChatGPT work chats + future documents) and lets the founder search it
// with the same recall Brain Chat / Decision Engine / Self-Learning use (edge function memory-search).
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

type Hit = { title: string; page: number | null; excerpt: string };
type Stats = { sources: number; pages: number; byProject: { project: string; chats: number; pages: number }[] };

export default function FounderMemoryPanel() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    supabase.functions.invoke('memory-search', { body: { action: 'stats' } }).then(({ data, error }) => {
      if (error || data?.error) setErr(data?.error || error?.message || 'Could not load memory'); else setStats(data);
    });
  }, []);

  async function run() {
    if (!query.trim()) return;
    setBusy(true); setErr(null);
    const { data, error } = await supabase.functions.invoke('memory-search', { body: { action: 'search', query } });
    setBusy(false);
    if (error || data?.error) { setErr(data?.error || error?.message || 'Search failed'); return; }
    setHits(data.results || []);
  }

  return (
    <div className="bg-slate-900 border border-purple-500/30 rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <p className="text-sm font-semibold text-white">Founder Memory — the one memory the brain uses</p>
          <p className="text-[11px] text-slate-400">Brain Chat, Decision Engine and Self-Learning recall from here before they answer.</p>
        </div>
        {stats && <span className="text-[10px] px-2 py-0.5 bg-purple-500/10 text-purple-300 rounded-full">{stats.sources} sources · {stats.pages.toLocaleString('en-IN')} pages</span>}
      </div>
      {stats && stats.byProject.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {stats.byProject.slice(0, 16).map((p) => (
            <button key={p.project} onClick={() => { setQuery(p.project); }}
              className="text-[10px] px-2 py-0.5 bg-slate-800 text-slate-300 rounded hover:bg-slate-700">{p.project} · {p.chats}</button>
          ))}
        </div>
      )}
      <div className="flex gap-2">
        <input value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && run()}
          placeholder="Search past work — e.g. Gio contractor scheme, Chaat Masters franchise model"
          className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-purple-500" />
        <button onClick={run} disabled={busy || !query.trim()}
          className="px-4 py-2 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white text-xs font-semibold rounded-lg">{busy ? 'Searching…' : 'Search'}</button>
      </div>
      {err && <p className="text-xs text-rose-400">{err}</p>}
      {hits && (
        <div className="space-y-2 max-h-96 overflow-y-auto">
          {hits.length === 0 && <p className="text-xs text-slate-500">Nothing found in memory for that.</p>}
          {hits.map((h, i) => (
            <div key={i} className="bg-slate-800/60 rounded-lg p-3">
              <p className="text-xs font-medium text-white">{h.title}{h.page ? <span className="text-slate-500"> · p.{h.page}</span> : null}</p>
              <p className="text-[11px] text-slate-400 mt-1 whitespace-pre-wrap">{h.excerpt}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
