// ============================================================
// sales-engine — real Claude-powered franchise sales conversation,
// grounded in real leads/brands data. Replaces the scripted/fabricated
// "Sales Executive AI" templates that previously invented stats.
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
async function callClaude(system: string, messages: { role: string; content: string }[], maxTokens = 800): Promise<string> {
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not configured as a Supabase secret');
  const res = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }, body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: maxTokens, system, messages }) });
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

    const body = await req.json() as { action?: string; leadId?: string; tone?: string; history?: { role: string; content: string }[]; message?: string };
    const tone = body.tone || 'professional';

    let leadCtx = 'No specific lead selected — speak in general terms about Franchise Kart\'s brand portfolio.';
    if (body.leadId) {
      const { data: lead } = await supabase.from('leads').select('*, brand:brands(name, sector, investment_range, royalty)').eq('id', body.leadId).single();
      if (lead) {
        leadCtx = `Lead: ${lead.contact_name || lead.company_name} | Brand interest: ${lead.brand?.name || 'unspecified'} (${lead.brand?.sector || ''}) | Investment range: ${lead.brand?.investment_range || lead.investment_capacity || 'not specified'} | Royalty: ${lead.brand?.royalty || 'not specified'} | Stage: ${lead.stage} | Lead score: ${lead.lead_score}`;
      }
    }

    const { data: brands } = await supabase.from('brands').select('name, sector, investment_range, royalty').eq('is_active', true);
    const brandsCtx = (brands || []).map((b) => `${b.name} (${b.sector}, ${b.investment_range || 'investment range not set'}, royalty ${b.royalty || 'not set'})`).join('; ') || 'No active brands configured yet';

    const toneInstruction: Record<string, string> = {
      professional: 'Warm, polished, consultative. No hype.',
      friendly: 'Casual, approachable, conversational.',
      aggressive: 'Direct and urgency-driven, but never dishonest — urgency must come from real facts (e.g. real territory/lead status), never invented.',
    };

    const system = `You are a franchise sales consultant AI for Franchise Kart, an Indian franchise consulting and brand holding company.\n\nReal brand portfolio: ${brandsCtx}\n${leadCtx}\n\nTone: ${toneInstruction[tone] || toneInstruction.professional}\n\nCRITICAL RULE: Never invent statistics, revenue figures, satisfaction percentages, success rates, or franchisee counts that aren't given to you above. If you don't have a real number for something the prospect asks (ROI, revenue, success rate), say plainly that you'll follow up with verified figures rather than estimating or making one up. Keep replies to 3-5 sentences, end with a relevant question to move the conversation forward.`;

    if (body.action === 'greet') {
      const reply = await callClaude(system, [{ role: 'user', content: 'Greet this prospect and open the conversation.' }]);
      return okRes({ reply }, id);
    }

    if (body.action === 'reply') {
      if (!body.message) return errRes('message is required', 400, id);
      const history = (body.history || []).map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content }));
      const reply = await callClaude(system, [...history, { role: 'user', content: body.message }]);
      return okRes({ reply }, id);
    }

    return errRes(`Unknown action: ${body.action}`, 400, id);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Internal server error';
    log('error', 'sales-engine error', { error: msg }, id);
    return errRes(msg, 500, id);
  }
});
