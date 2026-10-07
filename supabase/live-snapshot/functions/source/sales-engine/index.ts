// ============================================================
// sales-engine — real Claude-powered franchise sales conversation.
// v2: hardened so backend issues surface as a real, specific message
// in the chat itself (200 + diagnostic text) instead of a generic
// "non-2xx" error the frontend can't see into. Also defensively fixes
// message ordering (Anthropic requires the first message to have role
// 'user') and isolates each data fetch so one bad query can't crash
// the whole request.
// ============================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
// SPRINT 4 (M1-S4): Founder Voice now routes its LLM call through the
// canonical Founder Brain instead of its own local callClaude.
import { reason as founderBrainReason, getFounderPrinciples } from '../_shared/founder-brain.ts';

// REGRESSION FIX (caught before this migration's first deploy): the Sprint 4
// rewrite dropped two live capabilities entirely when it replaced the old
// self-contained llmFetch chain: (1) the founder-principles block below, same
// pattern already restored in staff-engine/decision-engine, and (2) the whole
// 'speak' action -- real ElevenLabs text-to-speech plus voice_call_log
// telemetry, restored verbatim below. Neither is duplicate reasoning logic;
// both are real business capability this migration must not silently delete.
async function getFounderPrinciplesBlock(agentName: string): Promise<string> {
  try {
    const principles = await getFounderPrinciples(agentName);
    if (principles.length === 0) return '';
    return `\n\n=== FOUNDER OPERATING PRINCIPLES (non-negotiable — apply these to every response below) ===\n${principles.map((p) => `- ${p.principle}`).join('\n')}\n=== END FOUNDER OPERATING PRINCIPLES ===`;
  } catch { return ''; }
}

const ELEVEN_VOICE_BY_TONE: Record<string, string> = {
  professional: 'pNInz6obpgDQGcFmaJgB',
  aggressive: 'onwK4e9ZLuTAKqWW03F9',
  friendly: 'EXAVITQu4vr4xnSDxMaL',
};
async function elevenLabsSpeak(text: string, tone: string): Promise<{ audioBase64: string; contentType: string }> {
  const key = Deno.env.get('ELEVENLABS_API_KEY');
  if (!key) throw new Error('ELEVENLABS_API_KEY is not configured as a Supabase secret — real voice is unavailable until it is added.');
  const voiceId = ELEVEN_VOICE_BY_TONE[tone] || ELEVEN_VOICE_BY_TONE.professional;
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
    method: 'POST', headers: { 'xi-api-key': key, 'content-type': 'application/json', accept: 'audio/mpeg' },
    body: JSON.stringify({ text: text.slice(0, 2000), model_id: 'eleven_multilingual_v2', voice_settings: { stability: 0.5, similarity_boost: 0.75 } }),
  });
  if (!res.ok) throw new Error(`ElevenLabs API error ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const buf = await res.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return { audioBase64: btoa(binary), contentType: 'audio/mpeg' };
}

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
  const transcript = messages.map((m) => `${m.role.toUpperCase()}: ${m.content}`).join('\n\n');
  const result = await founderBrainReason(system, transcript, maxTokens);
  return result.text;
}

// Anthropic requires messages[0].role === 'user'. Drop any leading
// assistant messages (e.g. a greeting shown before the user replied)
// so we never send an invalid sequence.
function sanitizeMessages(messages: { role: string; content: string }[]): { role: string; content: string }[] {
  let i = 0;
  while (i < messages.length && messages[i].role !== 'user') i++;
  return messages.slice(i);
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

    const body = await req.json() as { action?: string; leadId?: string; tone?: string; history?: { role: string; content: string }[]; message?: string; text?: string };
    const tone = body.tone || 'professional';

    if (body.action === 'speak') {
      if (!body.text?.trim()) return errRes('text is required', 400, id);
      try {
        const audio = await elevenLabsSpeak(body.text, tone);
        log('info', 'ElevenLabs speech generated', { chars: body.text.length }, id);
        await supabase.from('voice_call_log').insert({ lead_id: body.leadId ?? null, tone, text_length: body.text.length, status: 'success' });
        return okRes({ audioBase64: audio.audioBase64, contentType: audio.contentType }, id);
      } catch (ttsErr) {
        const msg = ttsErr instanceof Error ? ttsErr.message : String(ttsErr);
        log('warn', 'ElevenLabs TTS failed', { error: msg }, id);
        await supabase.from('voice_call_log').insert({ lead_id: body.leadId ?? null, tone, text_length: body.text?.length ?? 0, status: 'failed' });
        return errRes(msg, 502, id);
      }
    }

    let leadCtx = 'No specific lead selected — speak in general terms about Franchise Kart\'s brand portfolio.';
    if (body.leadId) {
      try {
        const { data: lead, error: leadErr } = await supabase.from('leads').select('*, brand:brands(name, sector, investment_range, royalty)').eq('id', body.leadId).maybeSingle();
        if (leadErr) log('warn', 'Lead lookup failed, continuing without lead context', { error: leadErr.message }, id);
        if (lead) {
          leadCtx = `Lead: ${lead.contact_name || lead.company_name} | Brand interest: ${lead.brand?.name || 'unspecified'} (${lead.brand?.sector || ''}) | Investment range: ${lead.brand?.investment_range || lead.investment_capacity || 'not specified'} | Royalty: ${lead.brand?.royalty || 'not specified'} | Stage: ${lead.stage} | Lead score: ${lead.lead_score}`;
        }
      } catch (leadCatchErr) {
        log('warn', 'Lead lookup threw, continuing without lead context', { error: String(leadCatchErr) }, id);
      }
    }

    let brandsCtx = 'No active brands configured yet';
    try {
      const { data: brands, error: brandsErr } = await supabase.from('brands').select('name, sector, investment_range, royalty').eq('is_active', true);
      if (brandsErr) log('warn', 'Brands lookup failed', { error: brandsErr.message }, id);
      if (brands && brands.length > 0) {
        brandsCtx = brands.map((b) => `${b.name} (${b.sector}, ${b.investment_range || 'investment range not set'}, royalty ${b.royalty || 'not set'})`).join('; ');
      }
    } catch (brandsCatchErr) {
      log('warn', 'Brands lookup threw', { error: String(brandsCatchErr) }, id);
    }

    const toneInstruction: Record<string, string> = {
      professional: 'Warm, polished, consultative. No hype.',
      friendly: 'Casual, approachable, conversational.',
      aggressive: 'Direct and urgency-driven, but never dishonest — urgency must come from real facts (e.g. real territory/lead status), never invented.',
    };

    const principlesBlock = await getFounderPrinciplesBlock('sales-engine');
    const system = `You are a franchise sales consultant AI for Franchise Kart, an Indian franchise consulting and brand holding company.\n\nReal brand portfolio: ${brandsCtx}\n${leadCtx}\n\nTone: ${toneInstruction[tone] || toneInstruction.professional}\n\nCRITICAL RULE: Never invent statistics, revenue figures, satisfaction percentages, success rates, or franchisee counts that aren't given to you above. If you don't have a real number for something the prospect asks (ROI, revenue, success rate), say plainly that you'll follow up with verified figures rather than estimating or making one up. Keep replies to 3-5 sentences, end with a relevant question to move the conversation forward.${principlesBlock}`;

    if (body.action === 'greet') {
      try {
        const reply = await callClaude(system, [{ role: 'user', content: 'Greet this prospect and open the conversation.' }]);
        return okRes({ reply }, id);
      } catch (claudeErr) {
        const msg = claudeErr instanceof Error ? claudeErr.message : String(claudeErr);
        log('error', 'Claude call failed on greet', { error: msg }, id);
        return okRes({ reply: `(Couldn't reach the AI brain: ${msg})` }, id);
      }
    }

    if (body.action === 'reply') {
      if (!body.message) return errRes('message is required', 400, id);
      const history = sanitizeMessages((body.history || []).map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content })));
      try {
        const reply = await callClaude(system, [...history, { role: 'user', content: body.message }]);
        return okRes({ reply }, id);
      } catch (claudeErr) {
        const msg = claudeErr instanceof Error ? claudeErr.message : String(claudeErr);
        log('error', 'Claude call failed on reply', { error: msg }, id);
        return okRes({ reply: `(Couldn't reach the AI brain: ${msg})` }, id);
      }
    }

    return errRes(`Unknown action: ${body.action}`, 400, id);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Internal server error';
    log('error', 'sales-engine error', { error: msg }, id);
    return errRes(msg, 500, id);
  }
});
