// ============================================================
// knowledge-engine — FK AIOS Brain: AI search/summarize over brain_knowledge_documents
// ============================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
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
async function callClaude(system: string, userMessage: string, maxTokens = 1200): Promise<string> {
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not configured as a Supabase secret');
  const res = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }, body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: maxTokens, system, messages: [{ role: 'user', content: userMessage }] }) });
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

    const body = await req.json() as { action?: string; query?: string; brandId?: string; documentId?: string };

    if (body.action === 'search') {
      if (!body.query) return errRes('query is required', 400, id);
      let q = supabase.from('brain_knowledge_documents').select('id, title, content, category, brand_id').eq('status', 'active');
      if (body.brandId) q = q.eq('brand_id', body.brandId);
      q = q.or(`title.ilike.%${body.query}%,content.ilike.%${body.query}%`).limit(8);
      const { data: docs, error } = await q;
      if (error) throw error;

      if (!docs || docs.length === 0) {
        return okRes({ answer: 'No matching documents found in the knowledge base for that query.', sources: [] }, id);
      }

      const context = docs.map((d, i) => `[Doc ${i + 1}] ${d.title} (${d.category}):\n${(d.content || '').slice(0, 1000)}`).join('\n\n');
      const answer = await callClaude(
        `You are the Knowledge Vault search assistant for Franchise Kart's FK AIOS. Answer the user's question using ONLY the document excerpts provided. Cite which document number(s) you used. If the documents don't answer the question, say so plainly.`,
        `Question: ${body.query}\n\nDocuments:\n${context}`
      );
      log('info', 'Knowledge search answered', { query: body.query, docCount: docs.length }, id);
      return okRes({ answer, sources: docs.map((d) => ({ id: d.id, title: d.title, category: d.category })) }, id);
    }

    if (body.action === 'summarize') {
      if (!body.documentId) return errRes('documentId is required', 400, id);
      const { data: doc, error } = await supabase.from('brain_knowledge_documents').select('*').eq('id', body.documentId).single();
      if (error || !doc) return errRes('Document not found', 404, id);
      const summary = await callClaude('Summarize this internal business document in 3-4 sentences, focused on actionable takeaways.', doc.content || doc.title);
      log('info', 'Document summarized', { documentId: doc.id }, id);
      return okRes({ summary }, id);
    }

    return errRes(`Unknown action: ${body.action}`, 400, id);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Internal server error';
    log('error', 'knowledge-engine error', { error: msg }, id);
    return errRes(msg, 500, id);
  }
});
