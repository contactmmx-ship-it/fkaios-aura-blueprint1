'use client';
import { X, Database, GitBranch } from 'lucide-react';

// P2 — LINEAGE (Palantir principle): no number on TODAY is an assertion.
// Every number opens this panel, which shows (1) the live source table(s),
// (2) the exact derivation, and (3) the ACTUAL underlying rows from the same
// live payload that produced the number — so the count on screen reconciles
// against rows the Founder can read. Zero extra queries, zero fabrication:
// if the source is empty, the panel says so, because empty IS the number.

export interface LineageRow {
  primary: string;
  secondary?: string;
  ts?: string;
  status?: string;
  meta?: string;
}

export interface LineageSpec {
  title: string;        // what was clicked, e.g. "Operations in the last 24h"
  value: string;        // the number as displayed
  source: string;       // live table(s) / RPC behind it
  derivation: string;   // plain-language formula, including any window/limit caveats
  rows: LineageRow[];
  emptyTruth?: string;  // honest statement when rows = 0
  reconciles?: boolean; // false when rows are supporting detail, not a 1:1 count
}

function hhmm(iso?: string) {
  if (!iso) return '';
  try { return new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }); } catch { return ''; }
}

const statusTone: Record<string, string> = {
  completed: 'text-emerald-400 bg-emerald-950/40 border-emerald-900',
  success: 'text-emerald-400 bg-emerald-950/40 border-emerald-900',
  failed: 'text-red-400 bg-red-950/40 border-red-900',
  error: 'text-red-400 bg-red-950/40 border-red-900',
  pending: 'text-amber-300 bg-amber-950/40 border-amber-900',
  running: 'text-cyan-300 bg-cyan-950/40 border-cyan-900',
};

export default function LineagePanel({ spec, onClose }: { spec: LineageSpec; onClose: () => void }) {
  const matches = spec.reconciles !== false && String(spec.rows.length) === spec.value.replace(/[^\d]/g, '');
  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-label={`Lineage: ${spec.title}`}>
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative w-full max-w-md h-full bg-slate-950 border-l border-slate-800 flex flex-col shadow-2xl">
        {/* header */}
        <div className="px-5 py-4 border-b border-slate-800 flex items-start gap-3">
          <GitBranch className="w-4 h-4 text-cyan-400 mt-1 shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="text-[10px] uppercase tracking-wider text-slate-500">Lineage — where this number comes from</p>
            <p className="text-sm font-semibold text-white mt-0.5">{spec.title}</p>
            <p className="text-2xl font-bold text-cyan-300 tabular-nums mt-1">{spec.value}</p>
          </div>
          <button onClick={onClose} aria-label="Close lineage" className="text-slate-500 hover:text-white"><X className="w-4 h-4" /></button>
        </div>

        {/* source + derivation */}
        <div className="px-5 py-3 border-b border-slate-800 space-y-2">
          <div className="flex items-start gap-2">
            <Database className="w-3.5 h-3.5 text-purple-400 mt-0.5 shrink-0" />
            <div>
              <p className="text-[10px] uppercase tracking-wider text-slate-500">Live source</p>
              <p className="text-xs text-slate-200 font-mono break-words">{spec.source}</p>
            </div>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wider text-slate-500">Derivation</p>
            <p className="text-[11px] text-slate-400 leading-snug">{spec.derivation}</p>
          </div>
        </div>

        {/* rows */}
        <div className="flex-1 overflow-y-auto px-5 py-3">
          {spec.rows.length === 0 ? (
            <div className="rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-3">
              <p className="text-xs text-slate-300 font-medium">0 source rows.</p>
              <p className="text-[11px] text-slate-500 mt-1 leading-snug">
                {spec.emptyTruth ?? 'The source is empty — the number on screen is honest emptiness, not a placeholder.'}
              </p>
            </div>
          ) : (
            <div className="space-y-1.5">
              {spec.rows.map((r, i) => (
                <div key={i} className="rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-semibold text-white">{r.primary}</span>
                    {r.status && (
                      <span className={`text-[9px] px-1.5 py-0.5 rounded-full border ${statusTone[r.status] ?? 'text-slate-400 bg-slate-800 border-slate-700'}`}>{r.status}</span>
                    )}
                    {r.ts && <span className="text-[10px] text-slate-500 tabular-nums ml-auto shrink-0">{hhmm(r.ts)}</span>}
                  </div>
                  {r.secondary && <p className="text-[11px] text-slate-400 leading-snug mt-0.5 break-words">{r.secondary}</p>}
                  {r.meta && <p className="text-[10px] text-slate-500 mt-0.5">{r.meta}</p>}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* reconciliation footer — evidence, not claims */}
        <div className={`px-5 py-3 border-t border-slate-800 text-[11px] ${spec.rows.length === 0 ? 'text-slate-500' : matches ? 'text-emerald-400' : 'text-slate-400'}`}>
          {spec.rows.length === 0
            ? 'Reconciliation: 0 rows = the number shown. Empty is the truth.'
            : spec.reconciles === false
              ? `${spec.rows.length} supporting row${spec.rows.length === 1 ? '' : 's'} shown (this figure is derived, not a row count — see derivation).`
              : matches
                ? `✓ Reconciled: ${spec.rows.length} source row${spec.rows.length === 1 ? '' : 's'} = the number you clicked.`
                : `${spec.rows.length} row${spec.rows.length === 1 ? '' : 's'} shown for a displayed value of ${spec.value} — see derivation for the exact window.`}
        </div>
      </div>
    </div>
  );
}
