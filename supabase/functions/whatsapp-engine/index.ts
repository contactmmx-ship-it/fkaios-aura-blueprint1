// whatsapp-engine v1 — real Meta WhatsApp Cloud API integration, using the
// WHATSAPP_ACCESS_TOKEN secret that's actually configured. Needs
// WHATSAPP_PHONE_NUMBER_ID (from Meta) to send, and WHATSAPP_VERIFY_TOKEN
// to complete the webhook handshake — both checked at runtime with an
// honest 'not configured' error if missing.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Correlation-ID' };
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

async function sendWhatsAppMessage(to: string, text: string): Promise<{ ok: boolean; error?: string; messageId?: string }> {
  const token = Deno.env.get('WHATSAPP_ACCESS_TOKEN');
  const phoneNumberId = Deno.env.get('WHATSAPP_PHONE_NUMBER_ID');
  if (!token) return { ok: false, error: 'WHATSAPP_ACCESS_TOKEN is not configured' };
  if (!phoneNumberId) return { ok: false, error: 'WHATSAPP_PHONE_NUMBER_ID is not configured as a Supabase secret — get this from Meta Business Manager > WhatsApp > API Setup, it is required to send (the access token alone is not enough).' };
  try {
    const res = await fetch(`https://graph.facebook.com/v20.0/${phoneNumberId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'text', text: { body: text } }),
    });
    if (!res.ok) {
      const errText = await res.text();
      return { ok: false, error: `Meta API error ${res.status}: ${errText.slice(0, 300)}` };
    }
    const data = await res.json() as any;
    return { ok: true, messageId: data.messages?.[0]?.id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  const id = cid();
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;

  if (req.method === 'GET') {
    const url = new URL(req.url);
    const mode = url.searchParams.get('hub.mode');
    const token = url.searchParams.get('hub.verify_token');
    const challenge = url.searchParams.get('hub.challenge');
    const verifyToken = Deno.env.get('WHATSAPP_VERIFY_TOKEN');
    if (!verifyToken) return errRes('WHATSAPP_VERIFY_TOKEN is not configured as a Supabase secret — set one yourself (any random string) and enter the same value in Meta\'s webhook setup.', 500, id);
    if (mode === 'subscribe' && token === verifyToken) {
      return new Response(challenge ?? '', { status: 200, headers: { 'Content-Type': 'text/plain' } });
    }
    return errRes('Webhook verification failed — token mismatch', 403, id);
  }

  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const authHeader = req.headers.get('Authorization');

  try {
    const body = await req.json().catch(() => ({} as any));

    if (body.object === 'whatsapp_business_account') {
      const db = serviceKey ? createClient(supabaseUrl, serviceKey) : createClient(supabaseUrl, anonKey);
      let stored = 0;
      for (const entry of body.entry ?? []) {
        for (const change of entry.changes ?? []) {
          for (const msg of change.value?.messages ?? []) {
            const from = msg.from as string;
            const text = msg.text?.body ?? '';
            const { data: lead } = await db.from('leads').select('id').eq('contact_phone', from).maybeSingle();
            await db.from('whatsapp_inbound_messages').insert({ lead_id: lead?.id ?? null, phone: from, message_text: text, whatsapp_id: msg.id, replied: false });
            stored++;
          }
        }
      }
      log('info', 'WhatsApp inbound messages stored', { count: stored }, id);
      return okRes({ received: stored }, id);
    }

    const user = await verifyJWT(authHeader, supabaseUrl);
    if (!user) return errRes('Unauthorized', 401, id);
    const db = createClient(supabaseUrl, anonKey, { global: { headers: authHeader ? { Authorization: authHeader! } : {} } });

    if (body.action === 'send_message') {
      const { to, text, lead_id } = body as { to?: string; text?: string; lead_id?: string };
      if (!to || !text) return errRes('to and text are required', 400, id);
      const result = await sendWhatsAppMessage(to, text);
      if (!result.ok) return errRes(result.error ?? 'Send failed', 502, id);
      if (lead_id) await db.from('lead_activities').insert({ lead_id, type: 'note', note: `WhatsApp sent: "${text.slice(0, 200)}"` });
      log('info', 'WhatsApp message sent', { to, messageId: result.messageId }, id);
      return okRes({ status: 'sent', message_id: result.messageId }, id);
    }

    if (body.action === 'mark_replied') {
      const { message_id, reply_text } = body as { message_id?: string; reply_text?: string };
      if (!message_id) return errRes('message_id is required', 400, id);
      const { error } = await db.from('whatsapp_inbound_messages').update({ replied: true, replied_at: new Date().toISOString(), reply_text: reply_text ?? null }).eq('id', message_id);
      if (error) throw error;
      return okRes({ status: 'marked_replied' }, id);
    }

    return errRes(`Unknown action: ${body.action}`, 400, id);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Internal server error';
    log('error', 'whatsapp-engine error', { error: msg }, id);
    return errRes(msg, 500, id);
  }
});
