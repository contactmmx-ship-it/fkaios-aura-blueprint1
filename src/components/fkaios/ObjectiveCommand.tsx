'use client';
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Target, Loader2, Send, RefreshCw, CheckCircle2, AlertTriangle, XCircle, Ban, Users, GitBranch } from 'lucide-react';
import { deriveObjectiveView, shouldPoll, STAGES, type ObjectiveState, type ObjectiveStatusRow } from '@/lib/objective-view';

// Objective Command — the Founder's front door into the EXISTING objective
// pipeline. Submits to the `founder-objective` edge function, which runs
// the Founder Brain's own assessRisk -> routeToDepartment -> createTask
// steps and writes a real orchestrator_requests row. The founder-brain-tick
// cron's objective loop then plans, allocates, executes and verifies it.
// This page submits, then reads back real status through the same
// function's `status` action (objective row + progress derived from its
// tasks and jobs). It does not plan, execute or fake progress itself, and
// it never shows task output, so a rejected answer cannot appear here.

const STATE_TONE: Record<ObjectiveState, string> = {
  PROCESSING: 'text-cyan-300 border-cyan-800 bg-cyan-950/40',
  BLOCKED: 'text-amber-300 border-amber-800 bg-amber-950/40',
  AWAITING_APPROVAL: 'text-amber-300 border-amber-800 bg-amber-950/40',
  COMPLETED: 'text-emerald-300 border-emerald-800 bg-emerald-950/40',
  FAILED: 'text-rose-300 border-rose-800 bg-rose-950/40',
};

// Same cadence as GovernanceDashboard's load/setInterval pattern. Polling
// only runs while an objective is still processing.
const STATUS_POLL_MS = 30000;

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

function StateIcon({ state }: { state: ObjectiveState }) {
  if (state === 'COMPLETED') return <CheckCircle2 className="w-4 h-4 text-emerald-400" />;
  if (state === 'FAILED') return <XCircle className="w-4 h-4 text-rose-400" />;
  if (state === 'BLOCKED') return <Ban className="w-4 h-4 text-amber-400" />;
  if (state === 'AWAITING_APPROVAL') return <AlertTriangle className="w-4 h-4 text-amber-400" />;
  return <Loader2 className="w-4 h-4 text-cyan-400 animate-spin" />;
}

function Stepper({ stage, terminal }: { stage: string; terminal: boolean }) {
  const steps: string[] = [...STAGES, terminal ? stage : 'Result'];
  const current = terminal ? steps.length - 1 : steps.indexOf(stage);
  return (
    <ol className="flex flex-wrap items-center gap-1 text-[10px]" aria-label="Objective progress">
      {steps.map((step, i) => (
        <li key={step} className={`px-2 py-0.5 rounded-full border ${i === current ? 'border-cyan-600 text-cyan-200' : i < current ? 'border-slate-700 text-slate-400' : 'border-slate-800 text-slate-600'}`} aria-current={i === current ? 'step' : undefined}>
          {step}
        </li>
      ))}
    </ol>
  );
}

function formatTime(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleString();
}

export function ObjectiveCard({ row, checkedAt, onOpenDecisionCenter }: { row: ObjectiveStatusRow; checkedAt?: string | null; onOpenDecisionCenter?: () => void }) {
  const view = deriveObjectiveView(row);
  const label = view.state.replace('_', ' ');
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3" data-objective-id={row.id} data-state={view.state}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm text-white"><StateIcon state={view.state} /> Status: {label}</div>
        <span className={`text-[10px] uppercase font-semibold px-2 py-0.5 rounded-full border ${STATE_TONE[view.state]}`}>{label}</span>
      </div>
      <Stepper stage={view.stage} terminal={view.terminal} />
      <dl className="space-y-1.5 text-xs">
        <div><dt className="text-slate-500">Objective</dt><dd className="text-slate-200">{view.objective}</dd></div>
        {view.result && <div><dt className="text-slate-500">Result</dt><dd className="text-slate-200">{view.result}</dd></div>}
        {view.reason && <div><dt className="text-slate-500">Reason</dt><dd className="text-slate-300">{view.reason}</dd></div>}
        {view.completed.length > 0 && (
          <div><dt className="text-slate-500">Completed with evidence</dt>
            <dd><ul className="list-disc list-inside text-emerald-300/90">{view.completed.map((line) => <li key={line}>{line}</li>)}</ul></dd></div>
        )}
        {view.terminal && view.notCompleted.length > 0 && (
          <div><dt className="text-slate-500">Not completed</dt>
            <dd><ul className="list-disc list-inside text-amber-300/90">{view.notCompleted.map((line) => <li key={line}>{line}</li>)}</ul></dd></div>
        )}
        {view.nextAction && <div><dt className="text-slate-500">Next action</dt><dd className="text-slate-300">{view.nextAction}</dd></div>}
        {view.retry && <div><dt className="text-slate-500">Retry</dt><dd className="text-slate-300">{view.retry}</dd></div>}
        {view.progress.length > 0 && (
          <div><dt className="text-slate-500">{view.terminal ? 'Work recorded' : 'Progress'}</dt>
            <dd><ul className="list-disc list-inside text-slate-400">{view.progress.map((line) => <li key={line}>{line}</li>)}</ul></dd></div>
        )}
      </dl>
      {view.opensDecisionCenter && onOpenDecisionCenter && (
        <button onClick={onOpenDecisionCenter} className="text-xs text-amber-300 hover:text-amber-200 underline underline-offset-2">Open Decision Center</button>
      )}
      <p className="text-[10px] text-slate-600">
        {formatTime(view.submittedAt) && <>Submitted {formatTime(view.submittedAt)} · </>}
        {checkedAt && <>Status as of {formatTime(checkedAt)} · </>}
        <span className="font-mono break-all">{row.id}</span>
      </p>
    </div>
  );
}

interface WorkerHandoffRow {
  id: string; objective_id: string | null; project: string | null;
  from_worker: string | null; to_worker: string | null; status: string;
  current_task: string | null; current_state: string | null; next_action: string | null;
  capacity_state: unknown; retry_count: number; created_at: string;
}
interface WorkerRunRow {
  id: string; objective_id: string | null; worker: string; provider: string | null; model: string | null;
  status: string; steps: number; max_steps: number | null; last_step: string | null;
  started_at: string; ended_at: string | null;
}

// Real worker activity (acceptance matrix #29/#30/#32/#33): the actual
// worker_runs/worker_handoffs rows, not a decorative summary. Reads
// through founder-objective's worker_activity action (service-role backed
// - these tables are RLS-locked to service-role only, so the browser
// cannot query them directly).
function WorkerActivityPanel() {
  const [handoffs, setHandoffs] = useState<WorkerHandoffRow[] | null>(null);
  const [runs, setRuns] = useState<WorkerRunRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error: fnError } = await supabase.functions.invoke('founder-objective', { body: { action: 'worker_activity' } });
    if (fnError) setErr(await readFunctionError(fnError));
    else if (!data?.ok) setErr(data?.error || 'Could not read worker activity.');
    else { setErr(null); setHandoffs(data.handoffs as WorkerHandoffRow[]); setRuns(data.runs as WorkerRunRow[]); }
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Users className="w-4 h-4 text-slate-400" />
          <h3 className="text-sm font-semibold text-slate-300">Worker activity</h3>
        </div>
        <button onClick={load} disabled={loading} className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-200 disabled:opacity-50">
          {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />} Refresh
        </button>
      </div>
      {err && <div className="bg-red-950/40 border border-red-900 rounded-xl px-4 py-3 text-xs text-red-300">Could not read worker activity: {err}</div>}
      {runs && runs.length > 0 && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-3 space-y-2">
          <p className="text-[11px] text-slate-500 uppercase tracking-wider">Worker runs</p>
          {runs.map((r) => (
            <div key={r.id} className="text-xs text-slate-300 flex items-center justify-between gap-2 border-b border-slate-800/60 last:border-0 pb-1.5 last:pb-0">
              <span className="font-mono text-slate-400">{r.worker}</span>
              <span className="text-slate-500">{r.status}{r.max_steps ? ` · step ${r.steps}/${r.max_steps}` : ''}</span>
            </div>
          ))}
        </div>
      )}
      {handoffs && handoffs.length > 0 && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-3 space-y-2">
          <p className="text-[11px] text-slate-500 uppercase tracking-wider flex items-center gap-1.5"><GitBranch className="w-3 h-3" /> Handoffs</p>
          {handoffs.map((h) => (
            <div key={h.id} className="text-xs space-y-0.5 border-b border-slate-800/60 last:border-0 pb-1.5 last:pb-0">
              <div className="flex items-center justify-between gap-2">
                <span className="text-slate-300">{h.from_worker ?? '?'} → {h.to_worker ?? '(unassigned)'}</span>
                <span className="text-slate-500">{h.status}</span>
              </div>
              {h.current_task && <p className="text-slate-500 truncate">{h.current_task}</p>}
            </div>
          ))}
        </div>
      )}
      {handoffs && handoffs.length === 0 && runs && runs.length === 0 && (
        <p className="text-xs text-slate-500">No worker activity recorded yet.</p>
      )}
    </div>
  );
}

export default function ObjectiveCommand({ onNavigate }: { onNavigate?: (page: string) => void } = {}) {
  const [objective, setObjective] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [objectives, setObjectives] = useState<ObjectiveStatusRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [checkedAt, setCheckedAt] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error: fnError } = await supabase.functions.invoke('founder-objective', { body: { action: 'status' } });
    if (fnError) setStatusError(await readFunctionError(fnError));
    else if (!data?.ok) setStatusError(data?.error || 'Could not read objective status.');
    else { setStatusError(null); setObjectives(data.objectives as ObjectiveStatusRow[]); setCheckedAt(new Date().toISOString()); }
    setLoading(false);
  }, []);

  const anyProcessing = shouldPoll(objectives);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!anyProcessing) return;
    const t = setInterval(load, STATUS_POLL_MS);
    return () => clearInterval(t);
  }, [anyProcessing, load]);

  const submit = async () => {
    const text = objective.trim();
    if (text.length < 10) { setError('Describe the objective in at least 10 characters.'); return; }
    setSubmitting(true);
    setError(null);
    try {
      const { data, error: fnError } = await supabase.functions.invoke('founder-objective', { body: { objective: text } });
      if (fnError) { setError(await readFunctionError(fnError)); return; }
      if (!data?.ok || !data.objectiveId) { setError(data?.error || 'FKAIOS did not confirm the objective was recorded.'); return; }
      setObjective('');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Request failed');
    } finally {
      setSubmitting(false);
    }
  };

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

      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-300">Your recent objectives</h3>
        <button onClick={load} disabled={loading} className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-200 disabled:opacity-50">
          {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />} Refresh
        </button>
      </div>
      {statusError && <div className="bg-red-950/40 border border-red-900 rounded-xl px-4 py-3 text-xs text-red-300">Could not read objective status: {statusError}</div>}
      {objectives && objectives.length === 0 && <p className="text-xs text-slate-500">No objectives yet.</p>}
      {(objectives ?? []).map((row) => <ObjectiveCard key={row.id} row={row} checkedAt={checkedAt} onOpenDecisionCenter={onNavigate ? () => onNavigate('decision-center') : undefined} />)}
      {anyProcessing && <p className="text-[11px] text-slate-500">Updates automatically. The objective loop runs every 15 minutes: it plans the work, creates tasks and jobs, and verifies the result against evidence.</p>}

      <div className="pt-2 border-t border-slate-800">
        <WorkerActivityPanel />
      </div>
    </div>
  );
}
