'use client';
import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Network, Loader2, CheckCircle, XCircle, Download, ChevronDown, ChevronUp, Crown, Users, ClipboardCheck, RefreshCw, Package, AlertTriangle } from 'lucide-react';

interface Task {
  id: string; role: string; title: string; description: string;
  output: string | null; review_score: number | null; review_notes: string | null;
  status: 'pending' | 'done' | 'rework' | 'approved'; attempts: number;
}
interface Project {
  id: string; request: string;
  status: 'planning' | 'working' | 'reviewing' | 'reworking' | 'merging' | 'complete' | 'failed';
  final_output: string | null; output_type: string | null; error_message: string | null; created_at: string;
}

const STAGE_LABELS: Record<string, string> = {
  planning: 'CEO AI is decomposing your request…',
  working: 'Specialist agents are executing tasks…',
  reviewing: 'Manager AI is reviewing and scoring…',
  reworking: 'Agents are fixing rejected work…',
  merging: 'Chief Project Officer is merging everything…',
  complete: 'Complete — approved and delivered',
  failed: 'Failed',
};

export default function OrchestratorAI() {
  const [request, setRequest] = useState('');
  const [running, setRunning] = useState(false);
  const [project, setProject] = useState<Project | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [stepLog, setStepLog] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [expandedTask, setExpandedTask] = useState<string | null>(null);
  const stopRef = useRef(false);
  const [pastProjects, setPastProjects] = useState<{ id: string; request: string; status: string; created_at: string; has_final?: boolean }[]>([]);

  useEffect(() => { loadProjects(); }, []);
  async function loadProjects() {
    const { data } = await supabase.functions.invoke('orchestrator-engine', { body: { action: 'list' } });
    if (data?.projects) setPastProjects(data.projects);
  }

  async function refreshStatus(projectId: string) {
    const { data } = await supabase.functions.invoke('orchestrator-engine', { body: { action: 'status', project_id: projectId } });
    if (data?.project) { setProject(data.project); setTasks(data.tasks ?? []); }
    return data?.project as Project | undefined;
  }

  async function start() {
    if (!request.trim()) { setError('Describe what you want built.'); return; }
    setError(null); setRunning(true); setProject(null); setTasks([]); setStepLog([]); setPreviewOpen(false);
    stopRef.current = false;
    try {
      const { data, error: e } = await supabase.functions.invoke('orchestrator-engine', { body: { action: 'start', request: request.trim() } });
      if (e || data?.error) throw new Error(data?.error || e?.message || 'Start failed');
      const projectId = data.project_id as string;
      setStepLog(l => [...l, `CEO created ${data.tasks_created} specialist tasks`]);
      await refreshStatus(projectId);

      await runAdvanceLoop(projectId);
    } catch (err2) {
      setError(err2 instanceof Error ? err2.message : 'Orchestration failed');
    } finally {
      setRunning(false);
      loadProjects();
    }
  }

  // advance loop — each call = one AI step; one automatic retry per step so a
  // single transient failure no longer kills the whole pipeline
  async function runAdvanceLoop(projectId: string) {
    let safety = 25;
    while (safety-- > 0 && !stopRef.current) {
      let adv: any = null;
      for (let attempt = 0; attempt < 2; attempt++) {
        const { data, error: advErr } = await supabase.functions.invoke('orchestrator-engine', { body: { action: 'advance', project_id: projectId } });
        if (!advErr && !data?.error) { adv = data; break; }
        if (attempt === 1) throw new Error(data?.error || advErr?.message || 'Advance failed after retry');
        setStepLog(l => [...l, 'Step failed once — retrying…']);
      }
      if (adv.step) setStepLog(l => [...l, adv.step]);
      const p = await refreshStatus(projectId);
      if (adv.done || p?.status === 'complete' || p?.status === 'failed') break;
    }
  }

  // Resume a stuck project from wherever it stopped — advance is stateless
  async function resume(projectId: string) {
    setError(null); setRunning(true); setStepLog([`Resuming project…`]); setPreviewOpen(false);
    stopRef.current = false;
    try {
      await refreshStatus(projectId);
      await runAdvanceLoop(projectId);
    } catch (err2) {
      setError(err2 instanceof Error ? err2.message : 'Resume failed');
    } finally {
      setRunning(false);
      loadProjects();
    }
  }

  function downloadFinal() {
    if (!project?.final_output) return;
    const isHtml = project.output_type === 'html';
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([project.final_output], { type: isHtml ? 'text/html' : 'text/markdown' }));
    a.download = `ai-company-output.${isHtml ? 'html' : 'md'}`;
    a.click();
  }

  const statusIcon = (s: Task['status']) =>
    s === 'approved' ? <CheckCircle className="w-4 h-4 text-emerald-400" />
    : s === 'done' ? <ClipboardCheck className="w-4 h-4 text-blue-400" />
    : s === 'rework' ? <RefreshCw className="w-4 h-4 text-amber-400" />
    : <Loader2 className="w-4 h-4 text-slate-500 animate-spin" />;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Network className="w-5 h-5 text-cyan-400" />
        <div>
          <h2 className="text-lg font-semibold">AI Company — Autonomous Orchestrator</h2>
          <p className="text-xs text-slate-500 mt-0.5">CEO decomposes → specialists execute → manager reviews & scores → rework loop → CPO merges. Every step is a real <span className="text-cyan-400">claude-sonnet-4-6</span> call, fully audited below.</p>
        </div>
      </div>

      {/* Request input */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3">
        <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Your request to the company</p>
        <textarea rows={4} value={request} onChange={(e) => setRequest(e.target.value)}
          placeholder='E.g. "Build a franchise landing page for GoMax with hero, benefits, investment section and contact form. Make the copy persuasive and check it for quality."'
          className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-sm text-white resize-none" />
        {error && (
          <div className="flex items-center gap-2 text-rose-400 text-sm bg-rose-500/10 border border-rose-500/30 rounded-xl px-3 py-2">
            <XCircle className="w-4 h-4 shrink-0" />{error}
          </div>
        )}
        <button onClick={start} disabled={running || !request.trim()}
          className="w-full py-3 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white font-semibold rounded-xl transition-all shadow-lg shadow-cyan-600/30 disabled:opacity-50 flex items-center justify-center gap-2">
          {running ? <><Loader2 className="w-4 h-4 animate-spin" />Company at work — this takes 2-5 minutes…</> : <><Crown className="w-4 h-4" />Assign to AI Company</>}
        </button>
        {running && <p className="text-xs text-slate-500 text-center">Each stage below is a separate real AI call. Watch the pipeline progress live.</p>}
      </div>

      {/* Pipeline status */}
      {project && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {project.status === 'complete' ? <CheckCircle className="w-5 h-5 text-emerald-400" />
                : project.status === 'failed' ? <XCircle className="w-5 h-5 text-rose-400" />
                : <Loader2 className="w-5 h-5 text-cyan-400 animate-spin" />}
              <span className="text-sm font-semibold">{STAGE_LABELS[project.status]}</span>
            </div>
            <span className="text-xs text-slate-600 capitalize">{project.status}</span>
          </div>

          {project.error_message && (
            <p className="text-sm text-rose-400 bg-rose-500/10 rounded-xl px-3 py-2 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4" />{project.error_message}
            </p>
          )}

          {/* Tasks with scores */}
          {tasks.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-2"><Users className="w-3 h-3" />Specialist tasks & manager scores</p>
              {tasks.map(t => (
                <div key={t.id} className="bg-slate-800/50 rounded-xl border border-slate-700/50">
                  <button onClick={() => setExpandedTask(expandedTask === t.id ? null : t.id)} className="w-full flex items-center justify-between p-3 text-left">
                    <div className="flex items-center gap-3">
                      {statusIcon(t.status)}
                      <div>
                        <p className="text-sm font-medium">{t.title}</p>
                        <p className="text-xs text-slate-500 capitalize">{t.role} agent · attempt {t.attempts}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      {t.review_score !== null && (
                        <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${t.review_score >= 80 ? 'bg-emerald-500/20 text-emerald-400' : 'bg-amber-500/20 text-amber-400'}`}>
                          {t.review_score}/100
                        </span>
                      )}
                      {expandedTask === t.id ? <ChevronUp className="w-4 h-4 text-slate-500" /> : <ChevronDown className="w-4 h-4 text-slate-500" />}
                    </div>
                  </button>
                  {expandedTask === t.id && (
                    <div className="px-3 pb-3 space-y-2">
                      {t.review_notes && <p className="text-xs text-slate-400 bg-slate-900 rounded-lg p-2">Manager notes: {t.review_notes}</p>}
                      {t.output && <pre className="text-xs text-slate-300 bg-slate-900 rounded-lg p-2 max-h-48 overflow-auto whitespace-pre-wrap">{t.output.slice(0, 2000)}{t.output.length > 2000 ? '\n…(truncated)' : ''}</pre>}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Step log */}
          {stepLog.length > 0 && (
            <div className="text-xs text-slate-500 space-y-1">
              {stepLog.map((s, i) => <p key={i}>• {s}</p>)}
            </div>
          )}

          {/* Final output */}
          {project.status === 'complete' && project.final_output && (
            <div className="space-y-3 pt-2 border-t border-slate-800">
              <p className="text-xs font-semibold text-emerald-400 uppercase tracking-wider flex items-center gap-2"><Package className="w-3 h-3" />Final deliverable (CPO-merged)</p>
              <div className="flex gap-2 flex-wrap">
                <button onClick={downloadFinal} className="flex items-center gap-2 px-4 py-2 bg-emerald-600/20 border border-emerald-500/30 text-emerald-400 text-sm font-medium rounded-xl hover:bg-emerald-600/30 transition-all">
                  <Download className="w-4 h-4" />Download
                </button>
                {project.output_type === 'html' && (
                  <button onClick={() => setPreviewOpen(v => !v)} className="flex items-center gap-2 px-4 py-2 bg-slate-800 border border-slate-700 text-slate-300 text-sm font-medium rounded-xl hover:bg-slate-700 transition-all">
                    {previewOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}{previewOpen ? 'Hide preview' : 'Preview'}
                  </button>
                )}
              </div>
              {previewOpen && project.output_type === 'html' && (
                <div className="rounded-xl overflow-hidden border border-slate-700">
                  <iframe srcDoc={project.final_output} className="w-full h-96 bg-white" sandbox="allow-scripts" title="Final output preview" />
                </div>
              )}
              {project.output_type !== 'html' && (
                <pre className="bg-slate-800 rounded-xl p-4 text-xs text-slate-300 overflow-auto max-h-80 whitespace-pre-wrap">{project.final_output.slice(0, 4000)}{project.final_output.length > 4000 ? '\n…(download for full output)' : ''}</pre>
              )}
            </div>
          )}
        </div>
      )}

      {/* Past projects — resume stuck runs, reopen completed ones */}
      {pastProjects.length > 0 && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-2">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Past projects</p>
          {pastProjects.slice(0, 10).map(pp => {
            const stuck = !['complete', 'failed'].includes(pp.status);
            return (
              <div key={pp.id} className="flex items-center gap-3 bg-slate-800/50 rounded-xl px-3 py-2">
                {pp.status === 'complete' ? <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0" />
                  : pp.status === 'failed' ? <XCircle className="w-4 h-4 text-rose-400 shrink-0" />
                  : <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />}
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-white truncate">{pp.request}</p>
                  <p className="text-[10px] text-slate-500 capitalize">{pp.status} · {new Date(pp.created_at).toLocaleString()}</p>
                </div>
                {stuck && (
                  <button onClick={() => resume(pp.id)} disabled={running}
                    className="px-3 py-1.5 bg-amber-600/20 border border-amber-500/30 text-amber-400 text-[11px] font-semibold rounded-lg hover:bg-amber-600/30 disabled:opacity-50 transition-all shrink-0">
                    Resume
                  </button>
                )}
                {pp.status === 'complete' && (
                  <button onClick={() => { refreshStatus(pp.id); setStepLog([]); }} disabled={running}
                    className="px-3 py-1.5 bg-slate-700/50 border border-slate-600/50 text-slate-300 text-[11px] font-semibold rounded-lg hover:bg-slate-700 disabled:opacity-50 transition-all shrink-0">
                    View
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
