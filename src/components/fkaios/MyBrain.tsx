'use client';
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Brain, Loader2, Plus, RefreshCw, CheckCircle2, XCircle, MessageSquareWarning, Sparkles, ChevronRight } from 'lucide-react';

interface BrainProject {
  id: string;
  title: string;
  client_name: string | null;
  deliverable_type: string;
  status: string;
  brief: string | null;
  chief_summary: string | null;
  final_output: string | null;
  current_iteration: number;
  max_iterations: number;
  founder_decision: string | null;
  created_at: string;
}
interface Iteration {
  id: string;
  iteration_number: number;
  maker_output: string;
  critic_feedback: string | null;
  critic_approved: boolean;
}

const DELIVERABLE_TYPES = ['video_brief', 'app_spec', 'image', 'document', 'website', 'other'];
const REFERENCE_TYPES = ['youtube', 'instagram', 'doc_upload', 'text_description', 'url', 'none'];

const STATUS_LABEL: Record<string, { label: string; color: string }> = {
  planning: { label: 'Planning', color: 'bg-slate-700 text-slate-300' },
  making: { label: 'Maker working', color: 'bg-blue-500/20 text-blue-400' },
  reviewing: { label: 'Critic reviewing', color: 'bg-amber-500/20 text-amber-400' },
  chief_review: { label: 'Chief summarizing', color: 'bg-violet-500/20 text-violet-400' },
  founder_review: { label: 'Awaiting your review', color: 'bg-red-500/20 text-red-400' },
  approved: { label: 'Approved', color: 'bg-emerald-500/20 text-emerald-400' },
  rejected: { label: 'Rejected', color: 'bg-rose-500/20 text-rose-400' },
  needs_founder_input: { label: 'Needs your input', color: 'bg-amber-500/20 text-amber-400' },
};

async function authedFetch(action: string, body: Record<string, unknown>) {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  const res = await fetch('https://nrlsqshkjuuwiovthrnb.supabase.co/functions/v1/my-brain-engine', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ action, ...body }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `${action} failed`);
  return data;
}

export default function MyBrain() {
  const [projects, setProjects] = useState<BrainProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [selected, setSelected] = useState<BrainProject | null>(null);
  const [iterations, setIterations] = useState<Iteration[]>([]);
  const [iterationLoading, setIterationLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [title, setTitle] = useState('');
  const [clientName, setClientName] = useState('');
  const [deliverableType, setDeliverableType] = useState('video_brief');
  const [referenceType, setReferenceType] = useState('youtube');
  const [referenceUrl, setReferenceUrl] = useState('');
  const [briefInput, setBriefInput] = useState('');
  const [creating, setCreating] = useState(false);

  async function load() {
    setLoading(true);
    const { data } = await supabase.from('brain_projects').select('*').order('created_at', { ascending: false });
    setProjects((data as BrainProject[]) || []);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  async function openProject(p: BrainProject) {
    setSelected(p);
    setError(null);
    const { data } = await supabase.from('brain_project_iterations').select('*').eq('project_id', p.id).order('iteration_number', { ascending: true });
    setIterations((data as Iteration[]) || []);
  }

  async function createProject() {
    if (!title.trim() || !briefInput.trim()) { setError('Title and your request are both required.'); return; }
    setCreating(true); setError(null);
    try {
      const result = await authedFetch('create_project', {
        title, client_name: clientName || null, deliverable_type: deliverableType,
        reference_type: referenceType, reference_url: referenceUrl || null, brief_input: briefInput,
      });
      setTitle(''); setClientName(''); setReferenceUrl(''); setBriefInput('');
      setShowForm(false);
      await load();
      const { data } = await supabase.from('brain_projects').select('*').eq('id', result.project_id).single();
      if (data) openProject(data as BrainProject);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create project');
    }
    setCreating(false);
  }

  async function runIteration() {
    if (!selected) return;
    setIterationLoading(true); setError(null);
    try {
      await authedFetch('run_iteration', { project_id: selected.id });
      const { data: p } = await supabase.from('brain_projects').select('*').eq('id', selected.id).single();
      const { data: iters } = await supabase.from('brain_project_iterations').select('*').eq('project_id', selected.id).order('iteration_number', { ascending: true });
      if (p) setSelected(p as BrainProject);
      setIterations((iters as Iteration[]) || []);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Iteration failed');
    }
    setIterationLoading(false);
  }

  async function decide(decision: 'approved' | 'rejected' | 'needs_changes') {
    if (!selected) return;
    await authedFetch('founder_decide', { project_id: selected.id, decision });
    const { data } = await supabase.from('brain_projects').select('*').eq('id', selected.id).single();
    if (data) setSelected(data as BrainProject);
    await load();
  }

  return (
    <div className="flex gap-5 h-full">
      <div className="w-72 shrink-0 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Brain className="w-4 h-4 text-violet-400" />
            <h2 className="text-sm font-semibold text-white">My Brain</h2>
          </div>
          <button onClick={() => setShowForm(!showForm)} className="text-xs bg-slate-900 text-white px-2 py-1 rounded-lg hover:bg-slate-800"><Plus className="w-3.5 h-3.5" /></button>
        </div>
        <p className="text-[11px] text-slate-500 leading-relaxed">Give a reference + a request. Maker drafts, Critic pushes back, Chief summarizes for you — same loop you run manually, automated.</p>

        {loading ? (
          <div className="flex justify-center py-6"><Loader2 className="w-4 h-4 text-slate-500 animate-spin" /></div>
        ) : (
          <div className="space-y-2">
            {projects.map((p) => (
              <button key={p.id} onClick={() => openProject(p)} className={`w-full text-left p-3 rounded-xl border ${selected?.id === p.id ? 'bg-slate-800 border-slate-600' : 'bg-slate-900 border-slate-800 hover:border-slate-700'}`}>
                <p className="text-xs font-medium text-white truncate">{p.title}</p>
                <span className={`inline-block mt-1.5 text-[9px] px-1.5 py-0.5 rounded-full ${STATUS_LABEL[p.status]?.color || 'bg-slate-700 text-slate-300'}`}>{STATUS_LABEL[p.status]?.label || p.status}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="flex-1 min-w-0">
        {showForm && (
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3 mb-4">
            <h3 className="text-sm font-semibold text-white">New Project</h3>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title (e.g. 'Dental Kart product 3D video')" className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white" />
            <input value={clientName} onChange={(e) => setClientName(e.target.value)} placeholder="Client (optional)" className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white" />
            <div className="flex gap-2">
              <select value={deliverableType} onChange={(e) => setDeliverableType(e.target.value)} className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-2 py-2 text-xs text-white capitalize">
                {DELIVERABLE_TYPES.map((t) => <option key={t} value={t}>{t.replace('_', ' ')}</option>)}
              </select>
              <select value={referenceType} onChange={(e) => setReferenceType(e.target.value)} className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-2 py-2 text-xs text-white capitalize">
                {REFERENCE_TYPES.map((t) => <option key={t} value={t}>{t.replace('_', ' ')}</option>)}
              </select>
            </div>
            {referenceType !== 'none' && referenceType !== 'text_description' && (
              <input value={referenceUrl} onChange={(e) => setReferenceUrl(e.target.value)} placeholder="Paste YouTube/Instagram/reference link" className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white" />
            )}
            <textarea value={briefInput} onChange={(e) => setBriefInput(e.target.value)} placeholder="What do you want, in your own words — as if telling me directly" rows={4} className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white" />
            <p className="text-[10px] text-amber-500">Note: video/3D deliverables come back as a detailed production brief/script — this system doesn't render actual video or 3D files.</p>
            {error && <p className="text-xs text-red-400">{error}</p>}
            <button onClick={createProject} disabled={creating} className="flex items-center gap-1.5 text-xs bg-violet-600 hover:bg-violet-500 text-white px-3 py-1.5 rounded-lg disabled:opacity-50">
              {creating ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />} Start
            </button>
          </div>
        )}

        {!selected ? (
          <div className="flex items-center justify-center h-64 text-sm text-slate-500">Select a project, or start a new one.</div>
        ) : (
          <div className="space-y-4">
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
              <div className="flex items-center justify-between">
                <h3 className="text-base font-semibold text-white">{selected.title}</h3>
                <span className={`text-[10px] px-2 py-0.5 rounded-full ${STATUS_LABEL[selected.status]?.color}`}>{STATUS_LABEL[selected.status]?.label}</span>
              </div>
              {selected.brief && <p className="text-xs text-slate-400 mt-2 whitespace-pre-wrap">{selected.brief}</p>}
              <p className="text-[10px] text-slate-600 mt-2">Iteration {selected.current_iteration} of {selected.max_iterations} max</p>
            </div>

            {error && <p className="text-xs text-red-400">{error}</p>}

            {(selected.status === 'making' || selected.status === 'reviewing') && (
              <button onClick={runIteration} disabled={iterationLoading} className="flex items-center gap-1.5 text-xs bg-blue-600 hover:bg-blue-500 text-white px-3 py-1.5 rounded-lg disabled:opacity-50">
                {iterationLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <ChevronRight className="w-3 h-3" />} Run Maker → Critic Iteration
              </button>
            )}

            <div className="space-y-3">
              {iterations.map((it) => (
                <div key={it.id} className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
                  <div className="px-4 py-2 border-b border-slate-800 flex items-center justify-between">
                    <span className="text-xs font-semibold text-white">Iteration {it.iteration_number}</span>
                    {it.critic_approved ? <span className="text-[10px] text-emerald-400 flex items-center gap-1"><CheckCircle2 className="w-3 h-3" /> Critic approved</span> : <span className="text-[10px] text-amber-400 flex items-center gap-1"><MessageSquareWarning className="w-3 h-3" /> Rectifications requested</span>}
                  </div>
                  <details className="px-4 py-3">
                    <summary className="text-xs text-slate-400 cursor-pointer">Maker output</summary>
                    <p className="text-xs text-slate-300 mt-2 whitespace-pre-wrap">{it.maker_output}</p>
                  </details>
                  {it.critic_feedback && (
                    <div className="px-4 pb-3">
                      <p className="text-[10px] text-slate-500 uppercase font-semibold">Critic Feedback</p>
                      <p className="text-xs text-slate-400 mt-1 whitespace-pre-wrap">{it.critic_feedback}</p>
                    </div>
                  )}
                </div>
              ))}
            </div>

            {selected.status === 'founder_review' && (
              <div className="bg-slate-900 border border-red-900/50 rounded-2xl p-4 space-y-3">
                <p className="text-xs font-semibold text-white flex items-center gap-1.5"><Brain className="w-3.5 h-3.5 text-violet-400" /> Chief Summary</p>
                <p className="text-xs text-slate-300 whitespace-pre-wrap">{selected.chief_summary}</p>
                <div className="flex gap-2 pt-2">
                  <button onClick={() => decide('approved')} className="flex items-center gap-1 text-xs bg-emerald-600 hover:bg-emerald-500 text-white px-3 py-1.5 rounded-lg"><CheckCircle2 className="w-3 h-3" /> Approve</button>
                  <button onClick={() => decide('needs_changes')} className="text-xs bg-amber-600 hover:bg-amber-500 text-white px-3 py-1.5 rounded-lg">Needs Changes</button>
                  <button onClick={() => decide('rejected')} className="flex items-center gap-1 text-xs bg-rose-950 hover:bg-rose-900 text-rose-300 px-3 py-1.5 rounded-lg border border-rose-900"><XCircle className="w-3 h-3" /> Reject</button>
                </div>
              </div>
            )}

            {selected.founder_decision && (
              <p className={`text-xs font-medium capitalize ${selected.founder_decision === 'approved' ? 'text-emerald-400' : selected.founder_decision === 'rejected' ? 'text-red-400' : 'text-amber-400'}`}>
                Your decision: {selected.founder_decision.replace('_', ' ')}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
