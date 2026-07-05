// ============================================================
// business-engine v24 — FIX: forward caller's JWT so RLS (TO authenticated on
// brain_business_ideas) passes. Was using anon-only client -> every insert 500'd.
// ============================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey, X-Correlation-ID',
};
function cid(): string { return crypto.randomUUID().slice(0, 8); }
function log(level: string, message: string, data?: Record<string, unknown>, id?: string) {
  console.log(JSON.stringify({ timestamp: new Date().toISOString(), level, correlationId: id || '', message, ...(data ? { data } : {}) }));
}
function errRes(message: string, status: number, id?: string): Response {
  log('ERROR', message, undefined, id);
  return new Response(JSON.stringify({ error: message, correlationId: id }), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}
function okRes(data: unknown, id?: string): Response {
  return new Response(JSON.stringify({ ...(data as Record<string, unknown>), correlationId: id }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}
async function verifyJWT(authHeader: string | null, supabaseUrl: string): Promise<{ userId: string } | null> {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7).trim();
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0))));
    if (payload.iss !== `${supabaseUrl}/auth/v1`) return null;
    if (payload.exp && payload.exp < Date.now() / 1000) return null;
    return { userId: payload.sub as string };
  } catch { return null; }
}
async function callClaudeJSON<T>(system: string, userMessage: string, maxTokens = 1500): Promise<T> {
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not configured as a Supabase secret');
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: maxTokens, system, messages: [{ role: 'user', content: userMessage }] }),
  });
  if (!res.ok) { const t = await res.text(); throw new Error(`Anthropic API error ${res.status}: ${t.slice(0, 500)}`); }
  const data = await res.json() as { content: { type: string; text?: string }[] };
  const text = data.content.filter((b) => b.type === 'text').map((b) => b.text || '').join('\n');
  const cleaned = text.trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '');
  try { return JSON.parse(cleaned) as T; } catch { throw new Error(`Claude returned non-JSON output: ${cleaned.slice(0, 300)}`); }
}

const SYSTEM_PROMPT = `You are the Business Creator engine inside Franchise Kart's FK AIOS, evaluating new business/brand ideas for a franchise consulting and multi-brand holding company (existing brands: Mr. Chick'n, GoMax, Gio Paints, Arofur, Chaat Masters, Chawla Lab, Turning Point).

Given an idea title and description, evaluate it like a franchise investment committee would: market size in India, franchisability, capital intensity, competitive landscape, fit with the existing brand portfolio.

Respond with ONLY valid JSON, no markdown fences, no preamble, in this exact shape:
{"industry":string,"score":number (0-100),"status":"idea"|"validated"|"rejected","analysis":string (3-5 sentences covering market size, franchisability, key risk, and a verdict)}`;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  const id = cid();
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const authHeader = req.headers.get('Authorization');
  // FIX: forward the caller's real JWT so PostgREST evaluates RLS as `authenticated`, not `anon`.
  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: authHeader ? { Authorization: authHeader } : {} },
  });

  try {
    const user = await verifyJWT(authHeader, supabaseUrl);
    if (!user) return errRes('Unauthorized', 401, id);
    if (req.method !== 'POST') return errRes('Method not allowed', 405, id);

    const { title, description } = await req.json() as { title?: string; description?: string };
    if (!title || typeof title !== 'string' || title.trim().length === 0) return errRes('title is required', 400, id);

    log('info', 'Evaluating business idea', { title }, id);

    const result = await callClaudeJSON<{ industry: string; score: number; status: string; analysis: string }>(
      SYSTEM_PROMPT,
      `Idea title: ${title}\n\nDescription: ${description || '(no further detail provided)'}`
    );

    const { data: idea, error: ideaErr } = await supabase
      .from('brain_business_ideas')
      .insert({ user_id: user.userId, title, description: result.analysis, industry: result.industry, score: result.score, status: result.status })
      .select('*')
      .single();
    if (ideaErr) throw ideaErr;

    log('info', 'Idea scored', { ideaId: idea.id, score: result.score }, id);
    return okRes({ idea }, id);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Internal server error';
    log('error', 'business-engine error', { error: msg }, id);
    return errRes(msg, 500, id);
  }
});
