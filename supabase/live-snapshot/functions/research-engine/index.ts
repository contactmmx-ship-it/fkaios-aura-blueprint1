// RESEARCH-ENGINE v1 — real Apify-backed research (Prompt 15 ResearchOS subset).
// Wires the existing (tested, live) Apify token to real actor calls — previously
// connected and verified but never actually invoked to do research.
//
// IMPORTANT COST NOTE: running an Apify actor spends real Apify account credits.
// This function's 'status' action is free (checks token validity only).
// The 'run' action spends real money and should only be triggered by an
// explicit human or orchestrator-approved request — never automatically.
//
// Actions: status | run { query, actor?, city? }
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, content-type, x-heartbeat-secret', 'Content-Type': 'application/json' };
const ok = (d: unknown) => new Response(JSON.stringify(d), { status: 200, headers: CORS });
const err = (m: string, s = 500) => new Response(JSON.stringify({ error: m }), { status: s, headers: CORS });

const APIFY_BASE = 'https://api.apify.com/v2';
// Google Search Results Scraper — cheap, general-purpose, good default for
// franchise-lead / market research queries ("furniture showroom Chandigarh", etc).
const DEFAULT_ACTOR = 'apify~google-search-scraper';

function xor(input: Uint8Array, secret: string): Uint8Array {
  const s = new TextEncoder().encode(secret);
  const out = new Uint8Array(input.length);
  for (let i = 0; i < input.length; i++) out[i] = input[i] ^ s[i % s.length];
  return out;
}
function decryptToken(encrypted: string, secret: string): string {
  return new TextDecoder().decode(xor(Uint8Array.from(atob(encrypted), c => c.charCodeAt(0)), secret));
}

async function getActiveToken(db: any): Promise<string | null> {
  const secret = Deno.env.get('ENCRYPTION_SECRET') || 'fkaios-default-key';
  const { data } = await db.from('apify_connections').select('token_encrypted').eq('is_active', true)
    .order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (!data) return null;
  return decryptToken(data.token_encrypted, secret);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  const t0 = Date.now();
  try {
    const secret = Deno.env.get('HEARTBEAT_SECRET');
    const provided = req.headers.get('x-heartbeat-secret') ?? new URL(req.url).searchParams.get('secret');
    const authHeader = req.headers.get('Authorization');
    if (secret && provided !== secret && !authHeader) return err('Unauthorized', 401);

    const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_ANON_KEY')!);
    const body = await req.json().catch(() => ({}));
    const action = body.action ?? 'status';

    async function logExec(actionName: string, status: string, inputSummary: string, outputSummary: string, error?: string) {
      try {
        await db.from('execution_log').insert({ function_name: 'research-engine', department_code: 'RND', action: actionName, status, input_summary: inputSummary.slice(0, 500), output_summary: outputSummary.slice(0, 500), error: error?.slice(0, 500) ?? null, latency_ms: Date.now() - t0 });
      } catch (_) {}
    }

    if (action === 'status') {
      const token = await getActiveToken(db);
      if (!token) return ok({ connected: false, message: 'No active Apify connection. Save a token via apify-settings first.' });
      const r = await fetch(`${APIFY_BASE}/users/me?token=${encodeURIComponent(token)}`);
      const connected = r.ok;
      const body2 = connected ? await r.json() : null;
      await logExec('status_check', connected ? 'success' : 'failure', 'token liveness check', connected ? `connected as ${body2?.data?.username}` : 'token rejected');
      return ok({ connected, username: body2?.data?.username ?? null, note: 'Free check — no Apify credits spent.' });
    }

    if (action === 'run') {
      const query: string = body.query ?? '';
      if (!query.trim()) return err('query is required', 400);
      const actor = body.actor ?? DEFAULT_ACTOR;

      const token = await getActiveToken(db);
      if (!token) return err('No active Apify connection configured', 400);

      const { data: runRow } = await db.from('research_runs').insert({ query, actor_used: actor, requested_by: body.requested_by ?? 'founder', status: 'running' }).select('id').single();
      const runId = runRow?.id;

      try {
        const startRes = await fetch(`${APIFY_BASE}/acts/${actor}/run-sync-get-dataset-items?token=${encodeURIComponent(token)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ queries: query, maxPagesPerQuery: 1, resultsPerPage: 10 }),
        });

        if (!startRes.ok) {
          const errText = await startRes.text();
          await db.from('research_runs').update({ status: 'failed', error: errText.slice(0, 1000) }).eq('id', runId);
          await logExec('run', 'failure', query, '', errText.slice(0, 300));
          return err(`Apify actor run failed: ${errText.slice(0, 300)}`, 502);
        }

        const items = await startRes.json();
        const results = Array.isArray(items) ? items.slice(0, 20) : [];

        await db.from('research_runs').update({
          status: 'completed', result_count: results.length, results, completed_at: new Date().toISOString(),
        }).eq('id', runId);

        await logExec('run', 'success', query, `${results.length} results via ${actor}`);
        return ok({ run_id: runId, query, actor, result_count: results.length, results });
      } catch (runErr) {
        const msg = runErr instanceof Error ? runErr.message : String(runErr);
        await db.from('research_runs').update({ status: 'failed', error: msg }).eq('id', runId);
        await logExec('run', 'failure', query, '', msg);
        return err(`Research run failed: ${msg}`, 502);
      }
    }

    return err(`Unknown action: ${action}`, 400);
  } catch (e) {
    return err(e instanceof Error ? e.message : String(e));
  }
});
