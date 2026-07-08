// pr-engine v2 — Phase 8 of the Founder Vision Audit roadmap, plus added
// shared HEARTBEAT_SECRET auth path (additive).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

async function llmFetch(apiKey: string, payload: Record<string, unknown>): Promise<Response> {
  const res = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }, body: JSON.stringify(payload) });
  if (res.ok) return res;
  const errMsg = `Anthropic ${res.status}: ${(await res.text()).slice(0, 200)}`;
  const gKey = Deno.env.get('GEMINI_API_KEY');
  if (gKey) {
    const sys = typeof payload.system === 'string' ? payload.system : '';
    const msgs = Array.isArray(payload.messages) ? payload.messages : [];
    const contents = msgs.map((m: any) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: typeof m.content === 'string' ? m.content : JSON.stringify(m.content) }] }));
    const gRes = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent', { method: 'POST', headers: { 'x-goog-api-key': gKey, 'content-type': 'application/json' }, body: JSON.stringify({ ...(sys ? { systemInstruction: { parts: [{ text: sys }] } } : {}), contents, generationConfig: { maxOutputTokens: Number(payload.max_tokens ?? 1024) + 256, thinkingConfig: { thinkingBudget: 0 } } }) });
    if (gRes.ok) {
      const g = await gRes.json() as any;
      const text = (g.candidates?.[0]?.content?.parts ?? []).map((p: any) => p.text ?? '').join('');
      return new Response(JSON.stringify({ model: 'gemini-2.5-flash', content: [{ type: 'text', text }] }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
  }
  return new Response(JSON.stringify({ error: errMsg }), { status: 502, headers: { 'content-type': 'application/json' } });
}

async function getFounderPrinciplesBlock(db: any, agentName: string): Promise<string> {
  try {
    const { data, error } = await db.from('founder_principles').select('principle, weight, applies_to').eq('active', true).order('weight', { ascending: false });
    if (error || !data) return '';
    const relevant = data.filter((p: any) => Array.isArray(p.applies_to) && (p.applies_to.includes('*') || p.applies_to.includes(agentName)));
    if (relevant.length === 0) return '';
    return `\n\n=== FOUNDER OPERATING PRINCIPLES (non-negotiable — apply these to every response below) ===\n${relevant.map((p: any) => `- ${p.principle}`).join('\n')}\n=== END FOUNDER OPERATING PRINCIPLES ===`;
  } catch { return ''; }
}

const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Correlation-ID, x-heartbeat-secret' };
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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  const id = cid();
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const authHeader = req.headers.get('Authorization');

  const heartbeatSecret = Deno.env.get('HEARTBEAT_SECRET');
  const providedSecret = req.headers.get('x-heartbeat-secret') ?? new URL(req.url).searchParams.get('secret');
  const secretOk = !!heartbeatSecret && providedSecret === heartbeatSecret;

  const db = createClient(supabaseUrl, secretOk && supabaseServiceKey ? supabaseServiceKey : supabaseAnonKey, { global: { headers: authHeader && !secretOk ? { Authorization: authHeader } : {} } });

  try {
    const user = secretOk ? { userId: 'heartbeat_secret' } : await verifyJWT(authHeader, supabaseUrl);
    if (!user) return errRes('Unauthorized', 401, id);
    if (req.method !== 'POST') return errRes('Method not allowed', 405, id);

    const body = await req.json() as { action?: string; name?: string; channel?: string; occasion?: string; brand_context?: string; campaign_id?: string };

    if (body.action === 'generate_campaign') {
      const { name, channel, occasion, brand_context } = body;
      if (!name || !channel) return errRes('name and channel are required', 400, id);

      const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
      if (!apiKey) return errRes('ANTHROPIC_API_KEY not configured', 500, id);
      const principlesBlock = await getFounderPrinciplesBlock(db, 'PR_CREATOR');
      const system = `You are the PR / Creator Team at Franchise Kart, writing real promotional content — an occasional wish, product/service launch announcement, or brand campaign — for distribution to clients and prospects. Write copy suited to ${channel}. Ground it in the brand context given; if none given, keep it generically on-brand for a franchise consulting company rather than inventing specific claims.${principlesBlock}`;
      const userMsg = `Campaign name: ${name}\nChannel: ${channel}\nOccasion/purpose: ${occasion || 'general brand awareness'}\n${brand_context ? `Brand context: ${brand_context}` : 'No specific brand context given.'}`;
      const res = await llmFetch(apiKey, { model: 'claude-sonnet-4-6', max_tokens: 800, system, messages: [{ role: 'user', content: userMsg }] });
      if (!res.ok) return errRes(`LLM error: ${(await res.text()).slice(0, 300)}`, 502, id);
      const data = await res.json() as any;
      const content = (data.content ?? []).filter((b: any) => b.type === 'text').map((b: any) => b.text || '').join('\n').trim();

      const { data: campaign, error: campErr } = await db.from('marketing_campaigns').insert({ name, channel, target_audience: occasion ?? null, content, status: 'draft' }).select('id').single();
      if (campErr) throw campErr;

      log('info', 'Campaign generated', { campaignId: campaign.id, channel }, id);
      return okRes({ campaign_id: campaign.id, content, status: 'draft' }, id);
    }

    if (body.action === 'mark_sent') {
      const { campaign_id } = body;
      if (!campaign_id) return errRes('campaign_id is required', 400, id);
      const { error } = await db.from('marketing_campaigns').update({ status: 'sent', sent_at: new Date().toISOString() }).eq('id', campaign_id);
      if (error) throw error;
      return okRes({ campaign_id, status: 'sent' }, id);
    }

    return errRes(`Unknown action: ${body.action}`, 400, id);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Internal server error';
    log('error', 'pr-engine error', { error: msg }, id);
    return errRes(msg, 500, id);
  }
});
