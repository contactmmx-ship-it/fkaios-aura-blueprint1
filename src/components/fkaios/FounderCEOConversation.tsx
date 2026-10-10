'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Brain, Send, Loader2, RefreshCw, CheckCircle2, AlertTriangle, MessageSquare, ArrowLeft, Mic, MicOff, Volume2, VolumeX } from 'lucide-react';

type Message = { role: 'founder' | 'ceo'; content: string; created_at: string };
type Milestone = { name: string; outcome: string };
type Risk = { risk: string; mitigation: string };
type Plan = {
  title: string; objective: string; rationale: string; approach: string[];
  assumptions: string[]; researchNeeded: string[]; milestones: Milestone[];
  deliverables: string[]; risks: Risk[]; budgetEstimate: string; roiModel: string;
  acceptanceCriteria: string[]; approvalsRequired: string[];
};
type Discussion = {
  id: string; title: string; status: string; messages?: Message[];
  proposed_plan?: Plan | null; submitted_objective_id?: string | null;
  created_at?: string; updated_at?: string;
};

async function blobToBase64(blob: Blob): Promise<string> {
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read microphone audio'));
    reader.onload = () => {
      const result = String(reader.result ?? '');
      const comma = result.indexOf(',');
      if (comma < 0) reject(new Error('Microphone audio encoding failed'));
      else resolve(result.slice(comma + 1));
    };
    reader.readAsDataURL(blob);
  });
}

async function functionError(error: unknown): Promise<string> {
  const ctx = (error as { context?: unknown })?.context;
  if (ctx instanceof Response) {
    try { const body = await ctx.json(); if (body?.error) return String(body.error); } catch {}
    return `Request failed (HTTP ${ctx.status})`;
  }
  return error instanceof Error ? error.message : 'Request failed';
}

export default function FounderCEOConversation() {
  const [threads, setThreads] = useState<Discussion[]>([]);
  const [active, setActive] = useState<Discussion | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [approving, setApproving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [listening, setListening] = useState(false);
  const [voiceOutput, setVoiceOutput] = useState(true);
  const [voiceStatus, setVoiceStatus] = useState('Voice uses FKAIOS speech routing for transcription and spoken replies.');
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const listThreads = useCallback(async () => {
    const { data, error: callError } = await supabase.functions.invoke('founder-objective', { body: { action: 'discussion_list' } });
    if (callError) { setError(await functionError(callError)); return; }
    if (!data?.ok) { setError(data?.error || 'Could not load CEO discussions'); return; }
    setThreads(data.discussions ?? []);
    setError(null);
  }, []);

  useEffect(() => { void listThreads(); }, [listThreads]);

  const openThread = async (id: string) => {
    setBusy(true); setError(null);
    try {
      const { data, error: callError } = await supabase.functions.invoke('founder-objective', { body: { action: 'discussion_get', discussionId: id } });
      if (callError) throw new Error(await functionError(callError));
      if (!data?.ok) throw new Error(data?.error || 'Could not load discussion');
      setActive(data.discussion);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not load discussion'); }
    finally { setBusy(false); }
  };

  const speakCEO = async (text: string) => {
    if (!voiceOutput || typeof window === 'undefined') return;
    try {
      setVoiceStatus('Preparing spoken reply through FKAIOS speech routing…');
      const { data, error: callError } = await supabase.functions.invoke('founder-objective', {
        body: { action: 'speak', text: text.slice(0, 4000), voice: 'en-IN' },
      });
      if (callError) throw new Error(await functionError(callError));
      if (!data?.ok || !data?.audioBase64) throw new Error(data?.error || 'Speech synthesis returned no audio');
      const binary = atob(data.audioBase64);
      const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: data.mimeType || 'audio/mpeg' }));
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.src = '';
      }
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.onended = () => { URL.revokeObjectURL(url); setVoiceStatus('Voice ready'); };
      audio.onerror = () => { URL.revokeObjectURL(url); setVoiceStatus('Spoken reply unavailable; the written CEO response remains available.'); };
      setVoiceStatus('AI CEO is speaking');
      await audio.play();
    } catch (e) {
      setVoiceStatus('Speech output unavailable: ' + (e instanceof Error ? e.message : 'unknown error') + '. The written response remains available.');
    }
  };

  const toggleVoiceInput = async () => {
    if (listening) { recorderRef.current?.stop(); setListening(false); return; }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setVoiceStatus('This browser does not support microphone recording. You can type your message instead.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];
      const preferredType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : undefined;
      const recorder = new MediaRecorder(stream, preferredType ? { mimeType: preferredType } : undefined);
      recorderRef.current = recorder;
      recorder.ondataavailable = (event) => { if (event.data.size > 0) chunksRef.current.push(event.data); };
      recorder.onerror = () => { setListening(false); setVoiceStatus('Microphone recording failed. You can type your message instead.'); };
      recorder.onstop = async () => {
        setListening(false);
        stream.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' });
        chunksRef.current = [];
        if (!blob.size) { setVoiceStatus('No audio was captured. Try again or type your message.'); return; }
        if (blob.size > 10 * 1024 * 1024) { setVoiceStatus('Audio exceeded the 10 MB limit. Please record a shorter message.'); return; }
        try {
          setVoiceStatus('Transcribing audio through FKAIOS speech routing…');
          const { data, error: callError } = await supabase.functions.invoke('founder-objective', {
            body: { action: 'transcribe', audioBase64: await blobToBase64(blob), mimeType: blob.type || 'audio/webm', language: 'en-IN' },
          });
          if (callError) throw new Error(await functionError(callError));
          if (!data?.ok || typeof data?.text !== 'string' || !data.text.trim()) throw new Error(data?.error || 'Transcription returned no text');
          setVoiceStatus('Heard: ' + data.text.slice(0, 180));
          setDraft(data.text);
          await send(data.text);
        } catch (e) {
          setVoiceStatus('Voice input failed: ' + (e instanceof Error ? e.message : 'unknown error') + '. You can type instead.');
        }
      };
      recorder.start();
      setListening(true);
      setVoiceStatus('Listening… speak your instruction, then press Stop listening.');
    } catch (e) {
      setListening(false);
      setVoiceStatus('Could not access microphone: ' + (e instanceof Error ? e.message : 'permission denied') + '. Check browser permission or type instead.');
    }
  };

  useEffect(() => () => {
    recorderRef.current?.stop();
    streamRef.current?.getTracks().forEach((track) => track.stop());
    audioRef.current?.pause();
  }, []);

  const send = async (spokenMessage?: string) => {
    const message = (spokenMessage ?? draft).trim();
    if (message.length < 2 || busy) return;
    setBusy(true); setError(null);
    try {
      const { data, error: callError } = await supabase.functions.invoke('founder-objective', {
        body: { action: 'discussion_turn', discussionId: active?.id, message },
      });
      if (callError) throw new Error(await functionError(callError));
      if (!data?.ok) throw new Error(data?.error || 'The CEO could not respond');
      setActive(data.discussion);
      setDraft('');
      const latestCEO = [...(data.discussion?.messages ?? [])].reverse().find((m: Message) => m.role === 'ceo');
      if (latestCEO && voiceOutput) await speakCEO(latestCEO.content);
      await listThreads();
    } catch (e) { setError(e instanceof Error ? e.message : 'The message was not completed'); }
    finally { setBusy(false); }
  };

  const approve = async () => {
    if (!active || active.status !== 'plan_ready' || approving) return;
    setApproving(true); setError(null);
    try {
      const { data, error: callError } = await supabase.functions.invoke('founder-objective', {
        body: { action: 'discussion_approve', discussionId: active.id },
      });
      if (callError) throw new Error(await functionError(callError));
      if (!data?.ok) throw new Error(data?.error || 'Could not submit the approved plan');
      setActive({ ...active, status: 'submitted', submitted_objective_id: data.objectiveId });
      await listThreads();
    } catch (e) { setError(e instanceof Error ? e.message : 'Approval failed'); }
    finally { setApproving(false); }
  };

  const plan = active?.proposed_plan ?? null;
  return (
    <div className="max-w-5xl space-y-5" data-founder-ceo-discussion="true">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="rounded-xl border border-violet-800 bg-violet-950/50 p-3"><Brain className="h-6 w-6 text-violet-300" /></div>
          <div>
            <p className="text-[10px] uppercase tracking-[0.2em] text-violet-300 font-semibold">Founder ↔ AI CEO</p>
            <h2 className="mt-1 text-xl font-semibold text-white">Think together. Approve the plan. Then execute.</h2>
            <p className="mt-1 max-w-2xl text-sm text-slate-400">Discuss an idea in natural language. The CEO challenges assumptions, identifies research gaps and builds a measurable plan. Nothing is submitted for execution until you approve it.</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={toggleVoiceInput} aria-pressed={listening} className={"flex items-center gap-2 rounded-lg border px-3 py-2 text-xs " + (listening ? "border-rose-600 bg-rose-950/40 text-rose-200" : "border-slate-700 text-slate-300 hover:border-violet-600")}>
            {listening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />} {listening ? 'Stop listening' : 'Speak to CEO'}
          </button>
          <button onClick={() => { setVoiceOutput(v => !v); if (voiceOutput && typeof window !== 'undefined') window.speechSynthesis.cancel(); }} aria-pressed={voiceOutput} className="flex items-center gap-2 rounded-lg border border-slate-700 px-3 py-2 text-xs text-slate-300 hover:border-violet-600">
            {voiceOutput ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />} Voice replies {voiceOutput ? 'on' : 'off'}
          </button>
          <button onClick={() => { setActive(null); setDraft(''); setError(null); }} className="flex items-center gap-2 rounded-lg border border-slate-700 px-3 py-2 text-xs text-slate-300 hover:border-violet-600">
            <MessageSquare className="h-4 w-4" /> New discussion
          </button>
        </div>
      </header>

      <p aria-live="polite" className="text-[10px] text-slate-500">{voiceStatus}</p>
      {error && <div role="alert" className="rounded-xl border border-rose-900 bg-rose-950/40 px-4 py-3 text-sm text-rose-200">{error}</div>}

      {!active ? (
        <div className="grid gap-4 lg:grid-cols-[1.15fr_.85fr]">
          <section className="rounded-2xl border border-violet-900/60 bg-gradient-to-br from-violet-950/50 to-slate-950 p-5">
            <p className="text-xs font-semibold uppercase tracking-wider text-violet-200">Start with the outcome</p>
            <h3 className="mt-3 text-lg font-semibold text-white">What are you thinking about?</h3>
            <p className="mt-2 text-sm leading-6 text-slate-300">Share the idea, the business problem, or the result you want. It is fine if the idea is incomplete.</p>
            <textarea value={draft} onChange={e => setDraft(e.target.value)} onKeyDown={e => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') void send(); }} maxLength={4000} rows={5} placeholder="I want to explore how we can… My target is… The constraints I have are…" className="mt-4 w-full rounded-xl border border-slate-700 bg-slate-950/80 p-3 text-sm text-white placeholder:text-slate-600 focus:border-violet-500 focus:outline-none" />
            <div className="mt-3 flex items-center justify-between gap-3">
              <span className="text-[10px] text-slate-500">{draft.length}/4000 · Ctrl+Enter to send</span>
              <button onClick={() => void send()} disabled={busy || draft.trim().length < 2} className="flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-violet-500 disabled:opacity-50">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Start with CEO
              </button>
            </div>
          </section>
          <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
            <div className="flex items-center justify-between gap-3"><h3 className="font-semibold text-white">Continue a discussion</h3><button onClick={() => void listThreads()} className="rounded-lg p-2 text-slate-400 hover:text-white" aria-label="Refresh discussions"><RefreshCw className="h-4 w-4" /></button></div>
            <div className="mt-4 space-y-2">
              {threads.length === 0 && <p className="text-sm text-slate-500">Your saved discussions will appear here.</p>}
              {threads.map(t => <button key={t.id} onClick={() => void openThread(t.id)} className="w-full rounded-xl border border-slate-800 bg-slate-950/70 p-3 text-left hover:border-violet-700">
                <div className="flex items-start justify-between gap-2"><span className="text-sm font-medium text-slate-100">{t.title}</span><span className="rounded-full border border-slate-700 px-2 py-0.5 text-[9px] uppercase text-slate-400">{t.status.replace('_',' ')}</span></div>
                <p className="mt-1 text-[10px] text-slate-500">{t.updated_at ? new Date(t.updated_at).toLocaleString() : ''}</p>
              </button>)}
            </div>
          </section>
        </div>
      ) : (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
          <section className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/60">
            <div className="flex items-center justify-between border-b border-slate-800 p-4">
              <div><button onClick={() => setActive(null)} className="mb-2 flex items-center gap-1 text-[11px] text-slate-400 hover:text-white"><ArrowLeft className="h-3 w-3" /> All discussions</button><h3 className="font-semibold text-white">{active.title}</h3></div>
              <span className="rounded-full border border-slate-700 px-2 py-1 text-[9px] uppercase text-slate-400">{active.status.replace('_',' ')}</span>
            </div>
            <div className="max-h-[520px] space-y-4 overflow-y-auto p-4">
              {(active.messages ?? []).map((m, i) => <div key={`${m.created_at}-${i}`} className={m.role === 'founder' ? 'ml-8 rounded-xl border border-cyan-900/60 bg-cyan-950/20 p-3' : 'mr-8 rounded-xl border border-violet-900/60 bg-violet-950/20 p-3'}>
                <p className="mb-1 text-[9px] font-semibold uppercase tracking-wider text-slate-400">{m.role === 'founder' ? 'You · Founder' : 'FKAIOS · CEO'}</p>
                <p className="whitespace-pre-wrap text-sm leading-6 text-slate-200">{m.content}</p>
              </div>)}
            </div>
            {active.status !== 'submitted' && active.status !== 'closed' && <div className="border-t border-slate-800 p-3">
              <textarea value={draft} onChange={e => setDraft(e.target.value)} onKeyDown={e => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') void send(); }} maxLength={4000} rows={3} placeholder="Challenge an assumption, add a constraint, or answer the CEO's question…" className="w-full rounded-xl border border-slate-700 bg-slate-950 p-3 text-sm text-white placeholder:text-slate-600 focus:border-violet-500 focus:outline-none" />
              <div className="mt-2 flex items-center justify-between"><span className="text-[10px] text-slate-500">The plan is revised as you discuss.</span><button onClick={() => void send()} disabled={busy || draft.trim().length < 2} className="flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-sm text-white disabled:opacity-50">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Send to CEO</button></div>
            </div>}
          </section>
          <aside className="space-y-3">
            {plan ? <section className="space-y-4 rounded-2xl border border-emerald-800/70 bg-slate-900 p-4">
              <div className="flex items-center gap-2"><CheckCircle2 className="h-5 w-5 text-emerald-400" /><div><p className="text-[10px] uppercase tracking-wider text-emerald-300">Decision-ready plan</p><h3 className="font-semibold text-white">{plan.title}</h3></div></div>
              <div><p className="text-[10px] uppercase text-slate-500">Target outcome</p><p className="mt-1 text-sm text-slate-200">{plan.objective}</p></div>
              <div><p className="text-[10px] uppercase text-slate-500">Why this approach</p><p className="mt-1 text-xs leading-5 text-slate-300">{plan.rationale}</p></div>
              <div><p className="text-[10px] uppercase text-slate-500">Milestones</p><ol className="mt-2 space-y-2">{plan.milestones.map((m,i) => <li key={i} className="rounded-lg border border-slate-800 p-2"><p className="text-xs font-semibold text-slate-200">{i+1}. {m.name}</p><p className="mt-1 text-[11px] text-slate-400">{m.outcome}</p></li>)}</ol></div>
              <div><p className="text-[10px] uppercase text-slate-500">Deliverables</p><ul className="mt-1 list-disc space-y-1 pl-4 text-xs text-slate-300">{plan.deliverables.map((d,i) => <li key={i}>{d}</li>)}</ul></div>
              <div><p className="text-[10px] uppercase text-slate-500">Risks & mitigations</p><ul className="mt-1 space-y-2">{plan.risks.map((r,i) => <li key={i} className="rounded-lg border border-slate-800 p-2"><p className="text-xs text-amber-200">{r.risk}</p><p className="mt-1 text-[11px] text-slate-400">{r.mitigation}</p></li>)}</ul></div>
              <div><p className="text-[10px] uppercase text-slate-500">Budget & ROI</p><p className="mt-1 text-xs text-slate-200">{plan.budgetEstimate}</p><p className="mt-1 text-[11px] text-slate-400">{plan.roiModel}</p></div>
              <div><p className="text-[10px] uppercase text-slate-500">Acceptance criteria</p><ul className="mt-1 list-disc space-y-1 pl-4 text-xs text-slate-300">{plan.acceptanceCriteria.map((a,i) => <li key={i}>{a}</li>)}</ul></div>
              {plan.researchNeeded.length > 0 && <div className="rounded-lg border border-amber-900/70 bg-amber-950/20 p-3"><p className="flex items-center gap-1 text-[10px] font-semibold uppercase text-amber-300"><AlertTriangle className="h-3 w-3" /> Evidence still needed</p><ul className="mt-1 list-disc pl-4 text-xs text-amber-100">{plan.researchNeeded.map((x,i) => <li key={i}>{x}</li>)}</ul></div>}
              {plan.assumptions.length > 0 && <div><p className="text-[10px] uppercase text-slate-500">Assumptions</p><ul className="mt-1 list-disc pl-4 text-xs text-slate-300">{plan.assumptions.map((x,i) => <li key={i}>{x}</li>)}</ul></div>}
              {plan.approvalsRequired.length > 0 && <div><p className="text-[10px] uppercase text-slate-500">Separate approvals still required</p><ul className="mt-1 list-disc pl-4 text-xs text-slate-300">{plan.approvalsRequired.map((x,i) => <li key={i}>{x}</li>)}</ul></div>}
              {active.status === 'plan_ready' && <button onClick={() => void approve()} disabled={approving} className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-3 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50">{approving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} Approve plan & submit for execution</button>}
              {active.status === 'submitted' && <div className="rounded-xl border border-emerald-800 bg-emerald-950/30 p-3 text-xs text-emerald-200">Submitted to FKAIOS execution. Objective: <span className="font-mono">{active.submitted_objective_id}</span></div>}
            </section> : <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4"><p className="text-sm font-semibold text-slate-200">The CEO is working toward a decision-ready plan</p><p className="mt-2 text-xs leading-5 text-slate-400">The plan appears when the outcome, scope, milestones and measurable acceptance criteria are sufficiently clear. You can challenge assumptions before approval.</p></section>}
          </aside>
        </div>
      )}
      <footer className="text-[10px] leading-5 text-slate-500">Governance: discussion does not execute work. Approval creates a persistent Founder objective. Spending, credentials, security changes, deletion, external communications, contracts and physical actions remain separately gated.</footer>
    </div>
  );
}
