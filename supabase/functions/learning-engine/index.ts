// ============================================================
// learning-engine — FK AIOS Brain: analyzes real activity, writes real learning insights
//
// v26: RLS bug FIXED — client now forwards the caller's JWT (was anon-only,
// silently RLS-blocking every insert). Also carries the llmFetch
// Claude→Gemini fallback.
// ============================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// ── __LLM_FALLBACK__ v1 (injected) ─────────────────────────────────────────
// Drop-in replacement for the raw Anthropic fetch: primary claude-sonnet-4-6,
// fallback gemini-2.5-flash via GEMINI_API_KEY on ANY Anthropic failure
// (credit exhaustion 400, 401, 429, 529, network). On fallback it returns an
// ANTHROPIC-SHAPED response body ({content:[{text}], usage:{...}, model}) so
// every existing parse site downstream works unchanged. model field carries
// the model that actually served.
async function llmFetch(apiKey: string, payload: Record<string, unknown>): Promise<Response> {
  let errMsg = '';
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (res.ok) return res;
    errMsg = `Anthropic ${res.status}: ${(await res.text()).slice(0, 200)}`;
  } catch (e) {
    errMsg = e instanceof Error ? e.message : String(e);
  }
  const gKey = Deno.env.get('GEMINI_API_KEY');
  if (!gKey) return new Response(JSON.stringify({ error: errMsg }), { status: 502, headers: { 'content-type': 'application/json' } });
  console.log('LLM FALLBACK to gemini-2.5-flash \u2014', errMsg.slice(0, 150));
  const sys = typeof payload.system === 'string' ? payload.system : '';
  const msgs = Array.isArray(payload.messages) ? payload.messages : [];
  const contents = msgs.map((m: any) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: typeof m.content === 'string' ? m.content : JSON.stringify(m.content) }] }));
  const gRes = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent', {
    method: 'POST',
    headers: { 'x-goog-api-key': gKey, 'content-type': 'application/json' },
    body: JSON.stringify({
      ...(sys ? { systemInstruction: { parts: [{ text: sys }] } } : {}),
      contents,
      generationConfig: { maxOutputTokens: Number(payload.max_tokens ?? 1024) + 256, thinkingConfig: { thinkingBudget: 0 } },
    }),
  });
  if (!gRes.ok) return new Response(JSON.stringify({ error: `${errMsg} | Gemini ${gRes.status}: ${(await gRes.text()).slice(0, 200)}` }), { status: 502, headers: { 'content-type': 'application/json' } });
  const g = await gRes.json() as any;
  const text = (g.candidates?.[0]?.content?.parts ?? []).map((p: any) => p.text ?? '').join('');
  const shaped = { model: 'gemini-2.5-flash', content: [{ type: 'text', text }], usage: { input_tokens: g.usageMetadata?.promptTokenCount ?? 0, output_tokens: g.usageMetadata?.candidatesTokenCount ?? 0 } };
  return new Response(JSON.stringify(shaped), { status: 200, headers: { 'content-type': 'application/json' } });
}
// ── end __LLM_FALLBACK__ ───────────────────────────────────────────────────

const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey, X-Correlation-ID' };
function cid(): string { return crypto.randomUUID().slice(0, 8); }
function log(level: string, message: string, data?: Record<string, unknown>, id?: string) { console.log(JSON.stringify({ timestamp: new Date().toISOString(), level, correlationId: id || '', message, ...(data ? { data } : {}) })); }
function errRes(message: string, status: number, id?: string): Response { log('ERROR', message, undefined, id); return new Response(JSON.stringify({ error: message, correlationId: id }), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }); }
function okRes(data: unknown, id?: string): Response { return new Response(JSON.stringify({ ...(data as Record<string, unknown>), correlationId: id }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }); }
async function verifyJWT(authHeader: string | null, supabaseUrl: string): Promise<{ userId: string } | null> {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7).trim();
  try {
    const parts = token.split('.'); if (parts.length !== 3) return null;
    const payload = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0))));
    if (payload.iss !== `${supabaseUrl}/auth/v1`) return null;
    if (payload.exp && payload.exp < Date.now() / 1000) return null;
    return { userId: payload.sub as string };
  } catch { return null; }
}
async function callClaudeJSON<T>(system: string, userMessage: string, maxTokens = 1500): Promise<T> {
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not configured as a Supabase secret');
  const res = await llmFetch(apiKey, { model: 'claude-sonnet-4-6', max_tokens: maxTokens, system, messages: [{ role: 'user', content: userMessage }] });
  if (!res.ok) { const t = await res.text(); throw new Error(`Anthropic API error ${res.status}: ${t.slice(0, 500)}`); }
  const data = await res.json() as { content: { type: string; text?: string }[] };
  const text = data.content.filter((b) => b.type === 'text').map((b) => b.text || '').join('\n');
  const cleaned = text.trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '');
  try { return JSON.parse(cleaned) as T; } catch { throw new Error(`Claude returned non-JSON output: ${cleaned.slice(0, 300)}`); }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  const id = cid();
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  // RLS FIX: forward the caller's JWT so inserts run as the authenticated user.
  // Without this the client acted as anon and every insert was silently blocked
  // by RLS (authenticated-only policies) -> 500 -> tab looked dead.
  const supabase = createClient(supabaseUrl, supabaseAnonKey, { global: { headers: { Authorization: (typeof req !== 'undefined' && req.headers.get('Authorization')) || '' } } });
  try {
    const user = await verifyJWT(req.headers.get('Authorization'), supabaseUrl);
    if (!user) return errRes('Unauthorized', 401, id);
    if (req.method !== 'POST') return errRes('Method not allowed', 405, id);

    const body = await req.json() as { action?: string };
    if (body.action !== 'analyze') return errRes(`Unsupported action: ${body.action}`, 400, id);

    const sinceIso = new Date(Date.now() - 14 * 86400000).toISOString();
    const [{ data: decisions }, { data: ideas }, { data: dispatches }, { data: leads }] = await Promise.all([
      supabase.from('brain_decisions').select('title, overall_score').gte('created_at', sinceIso).limit(20),
      supabase.from('brain_business_ideas').select('title, score, status').gte('created_at', sinceIso).limit(20),
      supabase.from('agent_dispatch_log').select('action, status').gte('created_at', sinceIso).limit(200),
      supabase.from('leads').select('stage, lead_score').gte('created_at', sinceIso).limit(100),
    ]);

    const hasSignal = (decisions && decisions.length) || (ideas && ideas.length) || (dispatches && dispatches.length) || (leads && leads.length);
    if (!hasSignal) {
      return okRes({ insights: [], message: 'Not enough real activity in the last 14 days to generate grounded insights yet.' }, id);
    }

    const failRate = dispatches && dispatches.length ? Math.round((dispatches.filter((d) => d.status === 'failed').length / dispatches.length) * 100) : null;
    const closedLeads = (leads || []).filter((l) => l.stage === 'closed').length;
    const lostLeads = (leads || []).filter((l) => l.stage === 'lost').length;

    const result = await callClaudeJSON<{ insights: { type: 'win' | 'loss' | 'campaign'; title: string; description: string; impact: 'high' | 'medium' | 'low' }[] }>(
      `You are the Self-Learning system for Franchise Kart's FK AIOS, turning the last 14 days of real operational data into 2-4 concrete learning insights (wins, losses, or campaign observations). Ground every insight in the numbers given — do not invent figures or generic platitudes. If the data is too thin for a real insight, return fewer items rather than padding.\n\nRespond with ONLY valid JSON: {"insights": [{"type":"win"|"loss"|"campaign","title":string,"description":string,"impact":"high"|"medium"|"low"}]}`,
      `Decisions scored (14d): ${(decisions || []).map((d) => `${d.title}=${d.overall_score}`).join('; ') || 'none'}\nBusiness ideas (14d): ${(ideas || []).map((i) => `${i.title}=${i.score}/${i.status}`).join('; ') || 'none'}\nAgent automation: ${dispatches?.length || 0} runs, ${failRate !== null ? failRate + '% failure rate' : 'no runs'}\nLeads (14d): ${leads?.length || 0} total, ${closedLeads} closed, ${lostLeads} lost`
    );

    const rows = result.insights.map((ins) => ({ user_id: user.userId, type: ins.type, title: ins.title, description: ins.description, impact: ins.impact }));
    const { data: inserted, error: insErr } = rows.length > 0 ? await supabase.from('brain_learning_insights').insert(rows).select('*') : { data: [], error: null };
    if (insErr) throw insErr;

    log('info', 'Learning insights generated', { count: inserted?.length || 0 }, id);
    return okRes({ insights: inserted }, id);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Internal server error';
    log('error', 'learning-engine error', { error: msg }, id);
    return errRes(msg, 500, id);
  }
});
