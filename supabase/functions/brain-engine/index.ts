// ============================================================
// brain-engine — FK AIOS Brain Chat: list/create conversations,
// send messages with real Claude + lightweight RAG over real tables.
//
// v24: RLS bug FIXED — client now forwards the caller's JWT (was anon-only,
// same pattern already fixed in agent-engine/business-engine v24). Also
// carries the llmFetch Claude→Gemini fallback.
// ============================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
// SPRINT 4 (M1-S4): Brain Chat now routes its actual LLM call through the
// canonical Founder Brain instead of its own local llmFetch/callClaude.
// RAG/context-building here (brand/doc/decision/idea lookups a few lines
// down) stays as-is — this sprint removes duplicate REASONING, not the
// conversation-specific retrieval this screen already does well.
import { reason as founderBrainReason } from '../_shared/founder-brain.ts';

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
  // SPRINT 4: delegates to the canonical Founder Brain reason() instead of
  // this function's own llmFetch call. reason() is single-turn (system +
  // one userContent), so multi-turn history is flattened into a transcript
  // — same information, no native multi-turn API shape, which is the only
  // behavioral difference from the old inline implementation.
  const transcript = messages.map((m) => `${m.role.toUpperCase()}: ${m.content}`).join('\n\n');
  const result = await founderBrainReason(system, transcript, maxTokens);
  return result.text;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  const id = cid();
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  // RLS FIX: forward the caller's JWT so conversation/message inserts run as
  // the authenticated user instead of anon (which was silently RLS-blocked).
  const supabase = createClient(supabaseUrl, supabaseAnonKey, { global: { headers: { Authorization: req.headers.get('Authorization') || '' } } });

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
