'use client';
import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { Plug, CheckCircle, XCircle, Loader2, Clock, RefreshCw } from 'lucide-react';

// ─── Real error extraction ───────────────────────────────────────────────────
// supabase-js's functions.invoke() returns a generic "Edge Function returned
// a non-2xx status code" in error.message for ANY failure, regardless of what
// the function actually responded with. The real error body is on
// error.context (a Response object) and must be read separately. Without
// this, every backend error looks identical in the UI no matter what
// actually went wrong server-side.
async function extractFunctionError(error: any, data: any): Promise<string> {
  if (data?.error) return data.error;
  if (error?.context && typeof error.context.json === 'function') {
    try {
      const body = await error.context.clone().json();
      if (body?.error) return body.error;
    } catch {
      try {
        const text = await error.context.clone().text();
        if (text) return text.slice(0, 300);
      } catch { /* fall through */ }
    }
  }
  return error?.message || 'Unknown error';
}

export default function SettingsPage() {
  const [apifyToken, setApifyToken] = useState('');
  const [apifyStatus, setApifyStatus] = useState<{ connected: boolean; lastTestedAt?: string } | null>(null);
  const [apifyBusy, setApifyBusy] = useState(false);
  const [apifyMessage, setApifyMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [tasks, setTasks] = useState<any[]>([]);

  useEffect(() => { loadApifyStatus(); loadTasks(); }, []);

  async function loadApifyStatus() {
    try {
      const { data } = await supabase.functions.invoke('apify-settings', { body: { action: 'status' } });
      setApifyStatus(data);
    } catch { setApifyStatus(null); }
  }

  async function loadTasks() {
    const { data } = await supabase.from('scheduled_tasks').select('*').order('task_key');
    setTasks(data || []);
  }

  async function saveApifyToken() {
    if (!apifyToken.trim()) { setApifyMessage({ type: 'error', text: 'Enter a token first' }); return; }
    setApifyBusy(true); setApifyMessage(null);
    try {
      const { data, error } = await supabase.functions.invoke('apify-settings', { body: { action: 'save', token: apifyToken.trim() } });
      if (error || data?.error) {
        const realError = await extractFunctionError(error, data);
        throw new Error(realError);
      }
      setApifyMessage({ type: 'success', text: `Connected — verified as "${data.username ?? data.actorCount ?? 'ok'}"` });
      setApifyToken(''); await loadApifyStatus();
    } catch (e) { setApifyMessage({ type: 'error', text: e instanceof Error ? e.message : 'Failed' }); }
    finally { setApifyBusy(false); }
  }

  async function testApify() {
    setApifyBusy(true); setApifyMessage(null);
    try {
      const { data, error } = await supabase.functions.invoke('apify-settings', { body: { action: 'test' } });
      if (error || data?.error) {
        const realError = await extractFunctionError(error, data);
        throw new Error(realError);
      }
      setApifyMessage({ type: data.valid ? 'success' : 'error', text: data.valid ? `Still valid — ${data.username ?? 'ok'}` : data.message });
      await loadApifyStatus();
    } catch (e) { setApifyMessage({ type: 'error', text: e instanceof Error ? e.message : 'Failed' }); }
    finally { setApifyBusy(false); }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Settings</h2>
        <p className="text-xs text-slate-500">Integrations and automation — real, wired connections only.</p>
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4">
        <div className="flex items-center gap-3">
          <Plug className="w-5 h-5 text-amber-400" />
          <h3 className="text-sm font-semibold">Integrations — Apify</h3>
        </div>
        <p className="text-xs text-slate-500">Saving here calls Apify's live API to validate the token before storing anything.</p>

        <div className="flex items-center justify-between p-4 bg-slate-800/50 rounded-xl">
          <div>
            <p className="text-sm font-medium">Apify</p>
            <p className="text-xs text-slate-500">Web scraping & competitor research automation</p>
          </div>
          {apifyStatus === null ? (
            <span className="px-3 py-1 bg-slate-700 text-slate-300 text-xs font-semibold rounded-full">Unknown</span>
          ) : apifyStatus.connected ? (
            <div className="flex items-center gap-2 px-3 py-1 bg-emerald-500/20 text-emerald-400 text-xs font-semibold rounded-full border border-emerald-500/30">
              <CheckCircle className="w-3 h-3" /> Connected
            </div>
          ) : (
            <div className="flex items-center gap-2 px-3 py-1 bg-rose-500/20 text-rose-400 text-xs font-semibold rounded-full border border-rose-500/30">
              <XCircle className="w-3 h-3" /> Not connected
            </div>
          )}
        </div>

        <div className="flex gap-2">
          <input type="password" placeholder="Paste Apify API token (apify_api_...)" value={apifyToken}
            onChange={(e) => setApifyToken(e.target.value)}
            className="flex-1 bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-sm text-white" />
          <button onClick={saveApifyToken} disabled={apifyBusy}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold rounded-xl disabled:opacity-50 flex items-center gap-2">
            {apifyBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : null} Save & Validate
          </button>
          {apifyStatus?.connected && (
            <button onClick={testApify} disabled={apifyBusy} className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white text-sm font-semibold rounded-xl disabled:opacity-50">
              Re-test
            </button>
          )}
        </div>

        {apifyMessage && (
          <div className={`flex items-start gap-2 rounded-xl px-4 py-2 text-sm ${apifyMessage.type === 'success' ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-400' : 'bg-rose-500/10 border border-rose-500/30 text-rose-400'}`}>
            {apifyMessage.type === 'success' ? <CheckCircle className="w-4 h-4 shrink-0 mt-0.5" /> : <XCircle className="w-4 h-4 shrink-0 mt-0.5" />}
            <span className="break-words">{apifyMessage.text}</span>
          </div>
        )}
        <p className="text-xs text-slate-600">Get a token at console.apify.com → Settings → Integrations → API tokens.</p>
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <RefreshCw className="w-5 h-5 text-cyan-400" />
            <h3 className="text-sm font-semibold">Automation Center — recurring jobs</h3>
          </div>
          <button onClick={loadTasks} className="text-xs text-slate-500 hover:text-slate-300">Refresh</button>
        </div>
        <p className="text-xs text-slate-500">
          These run automatically via <code className="text-cyan-400">heartbeat-engine</code> on a schedule — no button click needed once the cron trigger is wired.
        </p>
        {tasks.length === 0 && <p className="text-xs text-slate-600">No scheduled tasks found — run the AEOS migration first.</p>}
        <div className="space-y-2">
          {tasks.map(t => (
            <div key={t.id} className="flex items-center justify-between p-3 bg-slate-800/50 rounded-xl border border-slate-700/50">
              <div>
                <p className="text-sm font-medium">{t.label}</p>
                <p className="text-xs text-slate-500">Every {t.interval_minutes} min · {t.last_status ? t.last_status.slice(0, 60) : 'Never run yet'}</p>
              </div>
              <div className="flex items-center gap-2 text-xs text-slate-500">
                <Clock className="w-3 h-3" />
                {t.last_run_at ? new Date(t.last_run_at).toLocaleString() : 'Pending first run'}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
