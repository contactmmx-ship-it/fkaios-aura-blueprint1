// ============================================================
// brain-engine — FK AIOS Brain Chat: list/create conversations,
// send messages with real Claude + lightweight RAG over real tables.
//
// KNOWN GAP (found during repo-sync read-through, not yet fixed): unlike
// agent-engine v24 and business-engine v24 (which forward the caller's JWT
// to the Supabase client so RLS evaluates as `authenticated`), this function
// is still on v23 and creates its client with the anon key only. If
// brain_conversations / brain_messages have a `TO authenticated` RLS policy
// like the tables those other two functions fixed, inserts here may be
// silently failing the same way agent-engine's did before its v24 fix.
// Not re-verified live — flagging as inferred from the pattern, not confirmed.
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
async function callClaude(system: string, messages: { role: string; content: string }[], maxTokens = 1500): Promise<string> {
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not configured as a Supabase secret');
  const res = await llmFetch(apiKey, { model: 'claude-sonnet-4-6', max_tokens: maxTokens, system, messages });
  if (!res.ok) { const t = await res.text(); throw new Error(`Anthropic API error ${res.status}: ${t.slice(0, 500)}`); }
  const data = await res.json() as { content: { type: string; text?: string }[] };
  return data.content.filter((b) => b.type === 'text').map((b) => b.text || '').join('\n');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  const id = cid();
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseAnonKey);

  try {
    const user = await verifyJWT(req.headers.get('Authorization'), supabaseUrl);
    if (!user) return errRes('Unauthorized', 401, id);
    if (req.method !== 'POST') return errRes('Method not allowed', 405, id);

    const body = await req.json() as { action?: string; conversationId?: string; message?: string };

    if (body.action === 'list') {
      const { data, error } = await supabase.from('brain_conversations').select('*').eq('user_id', user.userId).order('updated_at', { ascending: false }).limit(50);
      if (error) throw error;
      return okRes({ conversations: data }, id);
    }

    if (body.action === 'create') {
      const { data, error } = await supabase.from('brain_conversations').insert({ user_id: user.userId, title: 'New Session' }).select('*').single();
      if (error) throw error;
      log('info', 'Conversation created', { conversationId: data.id }, id);
      return okRes({ conversation: data }, id);
    }

    if (body.action === 'message') {
      if (!body.conversationId || !body.message) return errRes('conversationId and message are required', 400, id);

      const { data: conv, error: convErr } = await supabase.from('brain_conversations').select('id, user_id').eq('id', body.conversationId).single();
      if (convErr || !conv) return errRes('Conversation not found', 404, id);
      if (conv.user_id !== user.userId) return errRes('Forbidden', 403, id);

      const { error: userMsgErr } = await supabase.from('brain_messages').insert({ conversation_id: body.conversationId, role: 'user', content: body.message });
      if (userMsgErr) throw userMsgErr;

      const { data: history } = await supabase.from('brain_messages').select('role, content').eq('conversation_id', body.conversationId).order('created_at', { ascending: true }).limit(20);

      // Lightweight RAG: pull real company context relevant to the query
      const [brandsRes, docsRes, decisionsRes, ideasRes] = await Promise.all([
        supabase.from('brain_brands').select('name, sector, investment_min, investment_max'),
        supabase.from('brain_knowledge_documents').select('title, content, category').eq('status', 'active').ilike('content', `%${body.message.slice(0, 50)}%`).limit(3),
        supabase.from('brain_decisions').select('title, overall_score, created_at').order('created_at', { ascending: false }).limit(3),
        supabase.from('brain_business_ideas').select('title, score, status').order('created_at', { ascending: false }).limit(3),
      ]);

      const brandsCtx = (brandsRes.data || []).map((b) => `${b.name} (${b.sector || 'general'}, ₹${b.investment_min || '?'}-${b.investment_max || '?'})`).join('; ');
      const docsCtx = (docsRes.data || []).map((d) => `[${d.category}] ${d.title}: ${(d.content || '').slice(0, 200)}`).join('\n');
      const decisionsCtx = (decisionsRes.data || []).map((d) => `${d.title} (score: ${d.overall_score})`).join('; ');
      const ideasCtx = (ideasRes.data || []).map((i) => `${i.title} (score: ${i.score}, ${i.status})`).join('; ');

      const system = `You are the FK AI Brain — the central AI advisor inside Franchise Kart's FK AIOS, a franchise consulting and multi-brand holding company in India (target: ₹1,100 Crore ecosystem revenue by 2030).\n\nCompany brands: ${brandsCtx || 'none seeded yet'}\nRecent decisions scored: ${decisionsCtx || 'none yet'}\nRecent business ideas: ${ideasCtx || 'none yet'}\n${docsCtx ? `\nRelevant knowledge base documents:\n${docsCtx}` : ''}\n\nAnswer as a sharp, concise business advisor. Use real numbers and specifics from the context above when relevant. If you don't have real data on something, say so plainly rather than inventing figures.`;

      const messages = (history || []).map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content }));

      const reply = await callClaude(system, messages);

      const { data: assistantMsg, error: asstErr } = await supabase.from('brain_messages').insert({ conversation_id: body.conversationId, role: 'assistant', content: reply }).select('*').single();
      if (asstErr) throw asstErr;

      await supabase.from('brain_conversations').update({ updated_at: new Date().toISOString() }).eq('id', body.conversationId);

      log('info', 'Brain chat reply generated', { conversationId: body.conversationId }, id);
      return okRes({ message: assistantMsg }, id);
    }

    return errRes(`Unknown action: ${body.action}`, 400, id);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Internal server error';
    log('error', 'brain-engine error', { error: msg }, id);
    return errRes(msg, 500, id);
  }
});
