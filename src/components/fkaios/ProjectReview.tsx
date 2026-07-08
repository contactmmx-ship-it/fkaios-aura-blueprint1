'use client';
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Upload, Loader2, FileText, CheckCircle2, XCircle, AlertTriangle, Clock } from 'lucide-react';

interface Submission {
  id: string;
  title: string;
  description: string | null;
  submission_type: string;
  file_name: string;
  file_size_bytes: number | null;
  ai_review_status: string;
  ai_review_summary: string | null;
  ai_review_findings: Record<string, unknown> | null;
  founder_decision: string | null;
  created_at: string;
}

const TYPES = ['crm', 'app', 'website', 'document', 'other'];

function formatBytes(n: number | null) {
  if (!n) return '';
  if (n > 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / 1024).toFixed(0)} KB`;
}

export default function ProjectReview() {
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [subType, setSubType] = useState('other');
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const { data } = await supabase.from('project_submissions').select('*').order('created_at', { ascending: false });
    setSubmissions((data as Submission[]) || []);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  async function submit() {
    if (!file || !title.trim()) { setError('Title and a file are required.'); return; }
    setUploading(true);
    setError(null);
    try {
      const path = `${Date.now()}-${file.name}`;
      const { error: upErr } = await supabase.storage.from('project-submissions').upload(path, file);
      if (upErr) throw upErr;

      const { data: row, error: insErr } = await supabase.from('project_submissions').insert({
        title, description: description || null, submission_type: subType,
        file_path: path, file_name: file.name, file_size_bytes: file.size,
      }).select('id').single();
      if (insErr) throw insErr;

      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      await fetch('https://nrlsqshkjuuwiovthrnb.supabase.co/functions/v1/project-review-engine', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: 'review', submission_id: row.id }),
      });

      setTitle(''); setDescription(''); setFile(null); setShowForm(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed');
    }
    setUploading(false);
  }

  async function decide(id: string, decision: 'approved' | 'rejected' | 'needs_changes') {
    await supabase.from('project_submissions').update({ founder_decision: decision, decided_at: new Date().toISOString() }).eq('id', id);
    await load();
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Project Review</h2>
          <p className="text-xs text-slate-500 mt-0.5">Upload real work — CRMs, apps, code, docs — for an AI first-pass review, then approve or reject.</p>
        </div>
        <button onClick={() => setShowForm(!showForm)} className="text-xs bg-slate-900 text-white px-3 py-1.5 rounded-lg hover:bg-slate-800">+ Upload</button>
      </div>

      {showForm && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3">
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title (e.g. 'Mr. Chick'n CRM v2')" className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white" />
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What is this? (optional)" rows={2} className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white" />
          <select value={subType} onChange={(e) => setSubType(e.target.value)} className="bg-slate-800 border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-white capitalize">
            {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <input type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="text-xs text-slate-400" />
          <p className="text-[10px] text-slate-600">Any file type accepted. Text/code files (.js, .ts, .py, .md, .json, .html, .css, .sql etc.) get a real AI content review. Zip/archive and binary files (images, PDFs) are stored and logged, but their contents are NOT automatically inspected — say so honestly rather than fake a review.</p>
          {error && <p className="text-xs text-red-400">{error}</p>}
          <button onClick={submit} disabled={uploading} className="flex items-center gap-1.5 text-xs bg-emerald-600 hover:bg-emerald-500 text-white px-3 py-1.5 rounded-lg disabled:opacity-50">
            {uploading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Upload className="w-3 h-3" />} Upload & Review
          </button>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center h-32"><Loader2 className="w-5 h-5 text-slate-500 animate-spin" /></div>
      ) : submissions.length === 0 ? (
        <p className="text-sm text-slate-500">Nothing uploaded yet.</p>
      ) : (
        <div className="space-y-3">
          {submissions.map((s) => (
            <div key={s.id} className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
              <div className="flex items-start justify-between">
                <div className="flex items-start gap-2">
                  <FileText className="w-4 h-4 text-slate-500 mt-0.5" />
                  <div>
                    <p className="text-sm font-medium text-white">{s.title}</p>
                    <p className="text-xs text-slate-500">{s.file_name} {s.file_size_bytes ? `· ${formatBytes(s.file_size_bytes)}` : ''} · <span className="capitalize">{s.submission_type}</span></p>
                  </div>
                </div>
                <span className="text-[10px] text-slate-600">{new Date(s.created_at).toLocaleDateString()}</span>
              </div>

              <div className="mt-3 flex items-center gap-1.5 text-xs">
                {s.ai_review_status === 'pending' && <><Clock className="w-3 h-3 text-slate-500" /><span className="text-slate-500">Queued for review</span></>}
                {s.ai_review_status === 'reviewing' && <><Loader2 className="w-3 h-3 text-amber-500 animate-spin" /><span className="text-amber-500">Reviewing…</span></>}
                {s.ai_review_status === 'failed' && <><AlertTriangle className="w-3 h-3 text-red-500" /><span className="text-red-500">Review failed</span></>}
              </div>

              {s.ai_review_summary && (
                <div className="mt-2 bg-slate-800/50 rounded-lg p-3">
                  <p className="text-xs text-slate-300">{s.ai_review_summary}</p>
                  {s.ai_review_findings?.contents_inspected === false && (
                    <p className="text-[10px] text-amber-500 mt-1.5">⚠ Contents were not actually inspected by AI — see summary for why.</p>
                  )}
                  {Array.isArray((s.ai_review_findings as any)?.concerns) && (s.ai_review_findings as any).concerns.length > 0 && (
                    <div className="mt-1.5">
                      <p className="text-[10px] text-amber-500 font-semibold uppercase">Concerns</p>
                      {(s.ai_review_findings as any).concerns.map((c: string, i: number) => <p key={i} className="text-xs text-slate-400">• {c}</p>)}
                    </div>
                  )}
                </div>
              )}

              {s.ai_review_status === 'reviewed' && !s.founder_decision && (
                <div className="flex gap-2 mt-3">
                  <button onClick={() => decide(s.id, 'approved')} className="flex items-center gap-1 text-xs bg-emerald-600 hover:bg-emerald-500 text-white px-3 py-1.5 rounded-lg"><CheckCircle2 className="w-3 h-3" /> Approve</button>
                  <button onClick={() => decide(s.id, 'needs_changes')} className="flex items-center gap-1 text-xs bg-amber-600 hover:bg-amber-500 text-white px-3 py-1.5 rounded-lg">Needs Changes</button>
                  <button onClick={() => decide(s.id, 'rejected')} className="flex items-center gap-1 text-xs bg-rose-950 hover:bg-rose-900 text-rose-300 px-3 py-1.5 rounded-lg border border-rose-900"><XCircle className="w-3 h-3" /> Reject</button>
                </div>
              )}
              {s.founder_decision && (
                <p className={`text-xs mt-3 font-medium capitalize ${s.founder_decision === 'approved' ? 'text-emerald-400' : s.founder_decision === 'rejected' ? 'text-red-400' : 'text-amber-400'}`}>
                  Decision: {s.founder_decision.replace('_', ' ')}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
