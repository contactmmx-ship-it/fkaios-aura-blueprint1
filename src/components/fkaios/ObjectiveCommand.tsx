'use client';
import { useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Target, Loader2, Send, RefreshCw, CheckCircle2, AlertTriangle, XCircle } from 'lucide-react';

// Objective Command — the Founder's front door into the EXISTING objective
// pipeline. Submits to the `founder-objective` edge function, which runs
// the Founder Brain's own assessRisk -> routeToDepartment -> createTask
// steps and writes a real orchestrator_requests row. The founder-brain-tick
// cron's objective loop then plans, allocates, executes and verifies it.
// This page only submits and reads back that one row's real status — it
// does not plan, execute or fake progress itself.

interface SubmitResult {
  objectiveId: string;
  status: string;
  riskLevel: string;
  departmentCode: string;
}

interface ObjectiveRow {
  id: string;
  status: string;
  risk_level: string | null;
  department_code: string | null;
  result_summary: string | null;
  created_at: string;
}

function statusTone(status: string): string {
  if (status === 'completed') return 'text-emerald-300 border-emerald-800 bg-emerald-950/40';
  if (status === 'awaiting_approval') return 'text-amber-300 border-amber-800 bg-amber-950/40';
  if (status === 'failed') return 'text-rose-300 border-rose-800 bg-rose-950/40';
  return 'text-cyan-300 border-cyan-800 bg-cyan-950/40';
}

function statusLabel(status: string): string {
  if (status === 'processing') return 'Accepted — in the objective pipeline';
  if (status === 'awaiting_approval') return 'Awaiting your approval';
  if (status === 'completed') return 'Completed (verified by the objective loop)';
  if (status === 'failed') return 'Failed';
  return status;
}

async function readFunctionError(err: unknown): Promise<string> {
  // supabase-js FunctionsHttpError carries the Response in `context`.
  const ctx = (err as { context?: unknown })?.context;
  if (ctx instanceof Response) {
    try {
      const body = await ctx.json();
      if (body?.error) return String(body.error);
    } catch { /* fall through */ }
    return `Request failed (HTTP ${ctx.status})`;
  }
  return err instanceof Error ? err.message : 'Request failed';
}

export default function ObjectiveCommand() {
  const [objective, setObjective] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SubmitResult | null>(null);
  const [row, setRow] = useState<ObjectiveRow | null>(null);
  const [checking, setChecking] = useState(false);

  const submit = async () => {
    const text = objective.trim();
    if (text.length < 10) { setError('Describe the objective in at least 10 characters.'); return; }
    setSubmitting(true);
    setError(null);
    setResult(null);
    setRow(null);
    try {
      const { data, error: fnError } = await supabase.functions.invoke('founder-objective', { body: { objective: text } });
      if (fnError) { setError(await readFunctionError(fnError)); return; }
      if (!data?.ok || !data.objectiveId) { setError(data?.error || 'FKAIOS did not confirm the objective was recorded.'); return; }
      setResult({ objectiveId: data.objectiveId, status: data.status, riskLevel: data.riskLevel, departmentCode: data.departmentCode });
      setObjective('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Request failed');
    } finally {
      setSubmitting(false);
    }
  };

  const checkStatus = async () => {
    if (!result) return;
    setChecking(true);
    setError(null);
    const { data, error: readError } = await supabase
      .from('orchestrator_requests')
      .select('id, status, risk_level, department_code, result_summary, created_at')
      .eq('id', result.objectiveId)
      .maybeSingle();
    if (readError) setError(readError.message);
    else if (!data) setError('Could not read this objective back from the database.');
    else setRow(data as ObjectiveRow);
    setChecking(false);
  };

  const currentStatus = row?.status ?? result?.status ?? '';

  return (
    <div className="max-w-3xl space-y-4">
      <div className="flex items-center gap-3">
        <Target className="w-5 h-5 text-cyan-400" />
        <div>
          <h2 className="text-lg font-semibold">Give FKAIOS an Objective</h2>
          <p className="text-xs text-slate-500 mt-0.5">Say what you want in plain language. FKAIOS assesses the risk, routes it to a department, plans it, runs the work and checks the evidence. High-risk objectives wait for your approval.</p>
        </div>
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3">
        <textarea
          value={objective}
          onChange={(e) => setObjective(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit(); }}
          rows={4}
          maxLength={2000}
          placeholder="e.g. Research the Indian paint market and identify 20 potential distributors for Bharat Paints."
          className="w-full bg-slate-950 border border-slate-800 rounded-lg p-3 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:border-cyan-700"
          disabled={submitting}
        />
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-slate-600">{objective.trim().length}/2000 · Ctrl+Enter to submit</span>
          <button
            onClick={submit}
            disabled={submitting || objective.trim().length < 10}
            className="flex items-center gap-2 text-sm bg-cyan-600 hover:bg-cyan-500 text-white px-4 py-2 rounded-lg disabled:opacity-50"
          >
            {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            {submitting ? 'Submitting…' : 'Submit objective'}
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-2 bg-red-950/50 border border-red-900 rounded-xl p-3 text-xs text-red-300">
          <XCircle className="w-4 h-4 shrink-0" /> <span>Not submitted: {error}</span>
        </div>
      )}

      {result && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-2">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-sm text-white">
              {currentStatus === 'awaiting_approval' ? <AlertTriangle className="w-4 h-4 text-amber-400" /> : <CheckCircle2 className="w-4 h-4 text-emerald-400" />}
              Objective recorded in FKAIOS
            </div>
            <span className={`text-[10px] uppercase font-semibold px-2 py-0.5 rounded-full border ${statusTone(currentStatus)}`}>{statusLabel(currentStatus)}</span>
          </div>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
            <dt className="text-slate-500">Objective ID</dt><dd className="text-slate-300 font-mono break-all">{result.objectiveId}</dd>
            <dt className="text-slate-500">Risk (assessed by Founder Brain)</dt><dd className="text-slate-300">{row?.risk_level ?? result.riskLevel}</dd>
            <dt className="text-slate-500">Department</dt><dd className="text-slate-300">{row?.department_code ?? result.departmentCode}</dd>
            {row?.result_summary && (<><dt className="text-slate-500">Latest result</dt><dd className="text-slate-300">{row.result_summary}</dd></>)}
          </dl>
          {currentStatus === 'awaiting_approval' && (
            <p className="text-[11px] text-amber-400/80">Filed in Decision Center for your approval before any work starts.</p>
          )}
          {currentStatus === 'processing' && (
            <p className="text-[11px] text-slate-500">The objective loop runs every 15 minutes: it plans the work, creates tasks and jobs, and verifies the result against evidence.</p>
          )}
          <button onClick={checkStatus} disabled={checking} className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-200 disabled:opacity-50">
            {checking ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />} Check current status
          </button>
        </div>
      )}
    </div>
  );
}
