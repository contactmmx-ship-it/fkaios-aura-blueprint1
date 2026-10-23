'use client';
// Brands & Projects — the founder's single view of every brand and project.
// Reads public.project_hub (rows tagged 'register-23oct', loaded from the
// Master Project Register on 23 Oct 2026). Read-only: no writes, no AI calls.
import { useEffect, useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { supabase } from '@/lib/supabase';

type HubRow = {
  id: string;
  brand: string;
  type: string;
  title: string;
  description: string | null;
  content: string | null;
  tags: string[] | null;
  updated_at: string | null;
};

const GUIDES = 'Guides & plans';

// Order brands by money relevance first, then the rest alphabetically.
const BRAND_ORDER = [
  'GoMax', 'Bharat Paints', 'Chaat Masters', 'Arofur', 'Knead & Bake', 'My Health Freek',
  'SYROS / Gajraj Hospital', 'PerfumeWala', 'Kids DPS', 'ScaleNest', "Mr. Chick'n", 'Turning Point',
  'AVG Print n Pack', 'Chawla Lab', 'Dr. Teeth', 'Steel Era', 'Gio Paints', 'FKAIOS', 'Rajeev AI',
  'Aura Tech', 'Franchise Kart', 'Bhavishya Associates',
];

function pNumber(row: HubRow): number {
  const tag = (row.tags || []).find(t => /^P\d\d$/.test(t));
  return tag ? parseInt(tag.slice(1), 10) : 999;
}

function statusTone(text: string | null): string {
  const s = (text || '').toLowerCase();
  if (/down|blocked|dispute|retire/.test(s)) return 'bg-rose-500/10 text-rose-300 border-rose-500/20';
  if (/parked|dormant|reference|merged|replaced|superseded|name only/.test(s)) return 'bg-slate-700/40 text-slate-400 border-slate-600/40';
  if (/delivered|live|done|client/.test(s)) return 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20';
  return 'bg-amber-500/10 text-amber-300 border-amber-500/20';
}

// react-markdown (CommonMark) does not render pipe tables, so tables are
// split out and drawn here; everything else goes through ReactMarkdown.
function MarkdownBlock({ text }: { text: string }) {
  const lines = text.split('\n');
  const parts: { kind: 'md' | 'table'; lines: string[] }[] = [];
  for (const line of lines) {
    const isRow = line.trim().startsWith('|') && line.trim().endsWith('|');
    const last = parts[parts.length - 1];
    const kind = isRow ? 'table' : 'md';
    if (last && last.kind === kind) last.lines.push(line);
    else parts.push({ kind, lines: [line] });
  }
  return (
    <div className="space-y-3">
      {parts.map((p, i) => {
        if (p.kind === 'md') {
          return (
            <div key={i} className="fk-md text-sm text-slate-300 leading-relaxed">
              <ReactMarkdown
                components={{
                  a: ({ href, children }) => (
                    <a href={href} target="_blank" rel="noopener noreferrer" className="text-cyan-400 hover:underline break-words">{children}</a>
                  ),
                  h2: ({ children }) => <h2 className="text-base font-bold text-white mt-4 mb-2">{children}</h2>,
                  h3: ({ children }) => <h3 className="text-sm font-semibold text-white mt-4 mb-2">{children}</h3>,
                  ul: ({ children }) => <ul className="list-disc pl-5 space-y-1">{children}</ul>,
                  ol: ({ children }) => <ol className="list-decimal pl-5 space-y-1">{children}</ol>,
                  strong: ({ children }) => <strong className="text-white font-semibold">{children}</strong>,
                  code: ({ children }) => <code className="text-amber-200 bg-slate-800/80 rounded px-1">{children}</code>,
                  pre: ({ children }) => (
                    <pre className="bg-slate-950 border border-slate-800 rounded-lg p-3 overflow-x-auto text-xs whitespace-pre-wrap">{children}</pre>
                  ),
                  p: ({ children }) => <p className="my-2">{children}</p>,
                }}
              >
                {p.lines.join('\n')}
              </ReactMarkdown>
            </div>
          );
        }
        const rows = p.lines
          .map(l => l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim()))
          .filter(cells => !cells.every(c => /^:?-{2,}:?$/.test(c)));
        const [head, ...body] = rows;
        return (
          <div key={i} className="overflow-x-auto border border-slate-800 rounded-lg">
            <table className="w-full text-xs">
              <thead className="bg-slate-800/60">
                <tr>{head.map((c, j) => <th key={j} className="text-left px-3 py-2 text-slate-200 font-semibold"><InlineMd text={c} /></th>)}</tr>
              </thead>
              <tbody>
                {body.map((r, k) => (
                  <tr key={k} className="border-t border-slate-800 align-top">
                    {r.map((c, j) => <td key={j} className="px-3 py-2 text-slate-300"><InlineMd text={c} /></td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}
    </div>
  );
}

function InlineMd({ text }: { text: string }) {
  return (
    <ReactMarkdown
      components={{
        p: ({ children }) => <>{children}</>,
        a: ({ href, children }) => <a href={href} target="_blank" rel="noopener noreferrer" className="text-cyan-400 hover:underline">{children}</a>,
        strong: ({ children }) => <strong className="text-white font-semibold">{children}</strong>,
      }}
    >
      {text}
    </ReactMarkdown>
  );
}

export default function BrandsProjects() {
  const [rows, setRows] = useState<HubRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [brand, setBrand] = useState<string>('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  useEffect(() => {
    supabase
      .from('project_hub')
      .select('id, brand, type, title, description, content, tags, updated_at')
      .contains('tags', ['register-23oct'])
      .then(({ data, error: err }) => {
        if (err) setError(err.message);
        setRows((data as HubRow[]) || []);
        setLoading(false);
      });
  }, []);

  const brands = useMemo(() => {
    const counts = new Map<string, number>();
    rows.filter(r => r.type === 'project').forEach(r => counts.set(r.brand, (counts.get(r.brand) || 0) + 1));
    const names = Array.from(counts.keys()).sort((a, b) => {
      const ia = BRAND_ORDER.indexOf(a), ib = BRAND_ORDER.indexOf(b);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
    });
    const guideCount = rows.filter(r => r.type !== 'project').length;
    return [{ name: GUIDES, count: guideCount }, ...names.map(n => ({ name: n, count: counts.get(n) || 0 }))];
  }, [rows]);

  // Default to the first real brand until the founder picks one.
  const activeBrand = brand || (brands.length > 1 ? brands[1].name : GUIDES);

  const list = useMemo(() => {
    const q = search.trim().toLowerCase();
    let items = q
      ? rows.filter(r => (r.title + ' ' + (r.content || '') + ' ' + r.brand).toLowerCase().includes(q))
      : rows.filter(r => (activeBrand === GUIDES ? r.type !== 'project' : r.type === 'project' && r.brand === activeBrand));
    items = [...items].sort((a, b) => pNumber(a) - pNumber(b) || a.title.localeCompare(b.title));
    return items;
  }, [rows, activeBrand, search]);

  const selected = list.find(r => r.id === selectedId) || list[0] || null;

  if (loading) return <div className="text-slate-500 text-sm p-6">Loading brands and projects…</div>;
  if (error) return <div className="text-rose-400 text-sm p-6">Could not load projects: {error}</div>;
  if (!rows.length) return <div className="text-slate-500 text-sm p-6">No projects found in project_hub.</div>;

  return (
    <div className="space-y-4">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div>
          <p className="text-xs text-slate-500">
            {rows.filter(r => r.type === 'project').length} projects · {brands.length - 1} brands · every chat, file and next step in one place
          </p>
        </div>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search all projects (name, client, file, chat)…"
          className="w-full md:w-80 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500"
        />
      </div>

      <div className="flex flex-col lg:flex-row gap-4">
        {/* Brands */}
        <div className="lg:w-56 shrink-0">
          <div className="flex lg:flex-col gap-1 overflow-x-auto lg:overflow-visible pb-1">
            {brands.map(b => (
              <button
                key={b.name}
                onClick={() => { setBrand(b.name); setSearch(''); }}
                className={`shrink-0 text-left px-3 py-2 rounded-lg text-xs flex justify-between gap-2 transition-colors ${
                  !search && activeBrand === b.name ? 'bg-cyan-600/20 text-cyan-300' : 'text-slate-400 hover:bg-slate-800/60'
                }`}
              >
                <span className="truncate">{b.name}</span>
                <span className="opacity-60">{b.count}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Projects of the brand */}
        <div className="lg:w-80 shrink-0 space-y-2">
          <h3 className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">
            {search ? `${list.length} results` : `${activeBrand} · ${list.length}`}
          </h3>
          <div className="space-y-2 lg:max-h-[calc(100vh-12rem)] lg:overflow-y-auto pr-1">
            {list.map(r => (
              <button
                key={r.id}
                onClick={() => setSelectedId(r.id)}
                className={`w-full text-left rounded-xl border p-3 transition-colors ${
                  r.id === selected?.id ? 'border-cyan-500/50 bg-slate-900' : 'border-slate-800 bg-slate-900/60 hover:border-slate-700'
                }`}
              >
                <p className="text-sm font-medium text-white">{r.title}</p>
                {search && <p className="text-[10px] text-slate-500 mt-0.5">{r.brand}</p>}
                {r.description && (
                  <p className={`mt-2 inline-block text-[10px] px-2 py-0.5 rounded border ${statusTone(r.description)}`}>
                    {r.description.length > 110 ? r.description.slice(0, 110) + '…' : r.description}
                  </p>
                )}
              </button>
            ))}
            {!list.length && <p className="text-xs text-slate-500 py-6 text-center">Nothing matches.</p>}
          </div>
        </div>

        {/* Full detail */}
        <div className="flex-1 min-w-0">
          {selected ? (
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 lg:max-h-[calc(100vh-9rem)] lg:overflow-y-auto">
              <p className="text-[10px] text-slate-500 uppercase tracking-wider">{selected.brand}</p>
              <h2 className="text-lg font-bold text-white mt-1">{selected.title}</h2>
              {selected.description && (
                <p className={`mt-2 inline-block text-xs px-2 py-1 rounded border ${statusTone(selected.description)}`}>{selected.description}</p>
              )}
              <div className="mt-4">
                <MarkdownBlock text={selected.content || ''} />
              </div>
            </div>
          ) : (
            <p className="text-sm text-slate-500">Select a project.</p>
          )}
        </div>
      </div>
    </div>
  );
}
