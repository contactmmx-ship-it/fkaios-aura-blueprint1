// ============================================================
// agent-engine v24 — FIX: forward caller's JWT to the Supabase client so RLS
// (restricted TO authenticated on brain_agent_executions) actually passes.
// Previously created the client with only the anon key, never attaching the
// user's session — every insert silently failed RLS and returned 500.
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
async function callClaude(system: string, userMessage: string, maxTokens = 1500): Promise<{ text: string; usage: { input_tokens: number; output_tokens: number } }> {
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not configured as a Supabase secret');
  const res = await llmFetch(apiKey, { model: 'claude-sonnet-4-6', max_tokens: maxTokens, system, messages: [{ role: 'user', content: userMessage }] });
  if (!res.ok) { const t = await res.text(); throw new Error(`Anthropic API error ${res.status}: ${t.slice(0, 500)}`); }
  const data = await res.json() as { content: { type: string; text?: string }[]; usage: { input_tokens: number; output_tokens: number } };
  const text = data.content.filter((b) => b.type === 'text').map((b) => b.text || '').join('\n');
  return { text, usage: data.usage };
}

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

    const body = await req.json() as { action?: string; agentId?: string; input?: string };
    if (body.action !== 'execute') return errRes(`Unsupported action: ${body.action}`, 400, id);
    if (!body.agentId || !body.input) return errRes('agentId and input are required', 400, id);

    const { data: agent, error: agentErr } = await supabase.from('brain_agents').select('*').eq('id', body.agentId).single();
    if (agentErr || !agent) return errRes('Agent not found', 404, id);

    log('info', 'Executing agent', { agentId: agent.id, name: agent.name }, id);
    const startedAt = Date.now();

    const system = `You are "${agent.name}", an AI employee at Franchise Kart, a franchise consulting and multi-brand holding company in India.\nRole/category: ${agent.category || 'general'}\nDescription: ${agent.description || 'General purpose business assistant.'}\nCapabilities: ${(agent.capabilities || []).join(', ') || 'general business reasoning'}\n\nRespond directly and usefully to the task given, in your role's voice. Be concrete and specific — give real numbers, real steps, real drafts where applicable. Do not pad with disclaimers.`;

    let output = '';
    let status = 'completed';
    try {
      const { text } = await callClaude(system, body.input);
      output = text;
    } catch (claudeErr) {
      status = 'failed';
      output = claudeErr instanceof Error ? claudeErr.message : 'Agent execution failed';
    }

    const durationMs = Date.now() - startedAt;

    const { data: execution, error: execErr } = await supabase
      .from('brain_agent_executions')
      .insert({ agent_id: agent.id, input: body.input, output, status, duration_ms: durationMs, user_id: user.userId, metadata: { agentName: agent.name } })
      .select('*')
      .single();
    if (execErr) throw execErr;

    log('info', 'Agent execution complete', { agentId: agent.id, status, durationMs }, id);
    if (status === 'failed') return errRes(output, 502, id);
    return okRes({ execution }, id);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Internal server error';
    log('error', 'agent-engine error', { error: msg }, id);
    return errRes(msg, 500, id);
  }
});
