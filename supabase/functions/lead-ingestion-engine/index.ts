// lead-ingestion-engine v1 — Phase 7. Generic multi-platform lead webhook
// receiver. Each platform posts here (or this gets polled by a per-platform
// cron once real API keys exist); this function normalizes whatever payload
// shape it gets into a real leads row and logs it in lead_ingestion_log.
//
// HONEST STATE: this endpoint is real and functional today for 'manual'
// and any platform that can already POST a webhook. It does NOT itself hold
// Instagram/Facebook/Google/YouTube/Twitter/LinkedIn API credentials —
// those require external app registration and business-account verification
// with each platform. Once those secrets exist (INSTAGRAM_ACCESS_TOKEN
// etc.), this function is the landing point they post to — no further
// architecture work needed then.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Correlation-ID, x-webhook-secret' };
function cid(): string { return crypto.randomUUID().slice(0, 8); }
function log(level: string, message: string, data?: Record<string, unknown>, id?: string) { console.log(JSON.stringify({ timestamp: new Date().toISOString(), level, correlationId: id || '', message, ...(data ? { data } : {}) })); }
function errRes(message: string, status: number, id?: string): Response { log('ERROR', message, undefined, id); return new Response(JSON.stringify({ error: message, correlationId: id }), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }); }
function okRes(data: unknown, id?: string): Response { return new Response(JSON.stringify({ ...(data as Record<string, unknown>), correlationId: id }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }); }

interface NormalizedLead { company_name: string; contact_name?: string; contact_email?: string; contact_phone?: string; source: string; notes?: string; }

function normalize(platform: string, payload: Record<string, unknown>): NormalizedLead | null {
  switch (platform) {
    case 'manual':
      if (!payload.company_name && !payload.name) return null;
      return { company_name: String(payload.company_name ?? payload.name), contact_name: payload.contact_name as string | undefined, contact_email: payload.email as string | undefined, contact_phone: payload.phone as string | undefined, source: 'manual', notes: payload.notes as string | undefined };
    case 'instagram':
    case 'facebook':
      if (Array.isArray(payload.field_data)) {
        const fields: Record<string, string> = {};
        for (const f of payload.field_data as any[]) fields[f.name] = f.values?.[0] ?? '';
        if (!fields.full_name && !fields.company_name) return null;
        return { company_name: fields.company_name || fields.full_name, contact_name: fields.full_name, contact_email: fields.email, contact_phone: fields.phone_number, source: platform, notes: 'Meta Lead Ads' };
      }
      return null;
    case 'whatsapp':
      if (!payload.phone && !payload.from) return null;
      return { company_name: (payload.name as string) || 'WhatsApp inquiry', contact_phone: (payload.phone as string) || (payload.from as string), source: 'whatsapp', notes: (payload.message as string) || undefined };
    case 'google':
    case 'youtube':
    case 'twitter':
    case 'linkedin':
      if (payload.company_name || payload.name) {
        return { company_name: String(payload.company_name ?? payload.name), contact_email: payload.email as string | undefined, contact_phone: payload.phone as string | undefined, source: platform, notes: `Ingested via ${platform}` };
      }
      return null;
    default:
      return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  const id = cid();
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const webhookSecret = Deno.env.get('LEAD_WEBHOOK_SECRET');

  try {
    if (req.method !== 'POST') return errRes('Method not allowed', 405, id);

    const providedSecret = req.headers.get('x-webhook-secret');
    const authHeader = req.headers.get('Authorization');
    const isWebhook = webhookSecret && providedSecret === webhookSecret;
    if (!isWebhook && !authHeader) return errRes('Unauthorized: provide a valid JWT or the correct x-webhook-secret header', 401, id);

    const db = isWebhook && serviceKey ? createClient(supabaseUrl, serviceKey) : createClient(supabaseUrl, anonKey, { global: { headers: authHeader ? { Authorization: authHeader } : {} } });

    const body = await req.json() as { platform?: string; payload?: Record<string, unknown> };
    const platform = body.platform ?? 'manual';
    const rawPayload = body.payload ?? {};

    const { data: logRow, error: logErr } = await db.from('lead_ingestion_log').insert({ platform, raw_payload: rawPayload, status: 'received' }).select('id').single();
    if (logErr) throw logErr;

    const normalized = normalize(platform, rawPayload);
    if (!normalized) {
      await db.from('lead_ingestion_log').update({ status: 'failed', error: 'Payload could not be normalized — missing required identifying fields' }).eq('id', logRow.id);
      return errRes(`Could not extract a lead from this ${platform} payload — missing company_name/name`, 422, id);
    }

    let existing = null;
    if (normalized.contact_phone) {
      const { data } = await db.from('leads').select('id').eq('contact_phone', normalized.contact_phone).gte('created_at', new Date(Date.now() - 86400000).toISOString()).maybeSingle();
      existing = data;
    }
    if (existing) {
      await db.from('lead_ingestion_log').update({ status: 'duplicate', lead_id: existing.id }).eq('id', logRow.id);
      return okRes({ status: 'duplicate', lead_id: existing.id }, id);
    }

    const { data: lead, error: leadErr } = await db.from('leads').insert({
      company_name: normalized.company_name, contact_name: normalized.contact_name ?? null,
      contact_email: normalized.contact_email ?? null, contact_phone: normalized.contact_phone ?? null,
      source: normalized.source, notes: normalized.notes ?? null, stage: 'new', is_active: true,
    }).select('id').single();
    if (leadErr) throw leadErr;

    await db.from('lead_ingestion_log').update({ status: 'normalized', lead_id: lead.id }).eq('id', logRow.id);

    log('info', 'Lead ingested', { platform, leadId: lead.id }, id);
    return okRes({ status: 'created', lead_id: lead.id, source: platform }, id);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Internal server error';
    log('error', 'lead-ingestion-engine error', { error: msg }, id);
    return errRes(msg, 500, id);
  }
});
