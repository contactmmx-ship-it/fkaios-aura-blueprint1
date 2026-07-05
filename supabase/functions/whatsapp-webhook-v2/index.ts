import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey, X-Correlation-ID",
};

function cid(): string { return crypto.randomUUID().slice(0, 8); }
function log(level: string, message: string, data?: Record<string, unknown>, c?: string): void {
  console.log(JSON.stringify({ timestamp: new Date().toISOString(), level, correlationId: c || '', message, ...(data ? { data } : {}) }));
}
function errResp(message: string, status: number, c?: string): Response {
  log('ERROR', message, { status }, c);
  return new Response(JSON.stringify({ error: message, ...(c ? { correlationId: c } : {}) }), { status, headers: { 'Content-Type': 'application/json', ...corsHeaders } });
}
function okResp(data: unknown, status = 200, c?: string): Response {
  return new Response(JSON.stringify({ ...((data as Record<string, unknown>) || {}), ...(c ? { correlationId: c } : {}) }), { status, headers: { 'Content-Type': 'application/json', ...corsHeaders } });
}

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const WHATSAPP_WEBHOOK_VERIFY_TOKEN = Deno.env.get("WHATSAPP_WEBHOOK_VERIFY_TOKEN") ?? "";
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const WHATSAPP_ACCESS_TOKEN = Deno.env.get("WHATSAPP_ACCESS_TOKEN") ?? "";
const WHATSAPP_PHONE_NUMBER_ID = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID") ?? "";

const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

function handleVerify(req: Request, c: string): Response {
  const url = new URL(req.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");
  if (mode === "subscribe" && token === WHATSAPP_WEBHOOK_VERIFY_TOKEN && challenge) {
    log("INFO", "WhatsApp webhook verification succeeded", { mode }, c);
    return new Response(challenge, { status: 200, headers: { "Content-Type": "text/plain" } });
  }
  log("WARN", "WhatsApp webhook verification failed", { mode, hasToken: !!token, hasChallenge: !!challenge }, c);
  return errResp("Verification failed", 403, c);
}

async function claude(system: string, user: string, maxTokens = 400): Promise<string> {
  if (!ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY not configured");
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: maxTokens, system, messages: [{ role: 'user', content: user }] }),
  });
  if (!res.ok) { const t = await res.text(); throw new Error(`Anthropic ${res.status}: ${t.slice(0, 200)}`); }
  const data = await res.json() as any;
  return data.content?.[0]?.text ?? '';
}

async function sendWhatsAppReply(toPhone: string, text: string): Promise<string | null> {
  if (!WHATSAPP_ACCESS_TOKEN || !WHATSAPP_PHONE_NUMBER_ID) throw new Error('WHATSAPP_ACCESS_TOKEN or WHATSAPP_PHONE_NUMBER_ID not configured');
  const toFormatted = toPhone.startsWith('91') ? toPhone : `91${toPhone}`;
  const res = await fetch(`https://graph.facebook.com/v18.0/${WHATSAPP_PHONE_NUMBER_ID}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${WHATSAPP_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', to: toFormatted, type: 'text', text: { preview_url: false, body: text } }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`WhatsApp send failed: ${body?.error?.message ?? res.status}`);
  return body?.messages?.[0]?.id ?? null;
}

// Fires IMMEDIATELY when a message arrives — not on the next cron tick.
// The 30-min heartbeat still runs as a safety-net retry for anything that
// fails here (e.g. a transient network error), but the normal case is now
// instant, matching how a real customer would expect a reply.
async function replyImmediately(leadId: string, phone: string, c: string): Promise<void> {
  try {
    const { data: brands } = await supabase.from("brands").select("name, sector, investment_range, royalty").eq("is_active", true);
    const brandsCtx = (brands && brands.length > 0)
      ? brands.map((b: any) => `${b.name} (${b.sector}, ${b.investment_range || 'investment range not set'}, royalty ${b.royalty || 'not set'})`).join('; ')
      : 'No active brands configured yet';

    const { data: history } = await supabase.from("whatsapp_inbound_messages")
      .select("message_text, reply_text, created_at").eq("lead_id", leadId)
      .order("created_at", { ascending: true }).limit(10);
    const convo = (history ?? []).map((h: any) => `Prospect: ${h.message_text}${h.reply_text ? `\nYou replied: ${h.reply_text}` : ''}`).join('\n');

    const system = `You are a franchise sales consultant AI for Franchise Kart, an Indian franchise consulting company, continuing a real WhatsApp conversation.\n\nReal brand portfolio: ${brandsCtx}\n\nCRITICAL RULE: Never invent statistics, revenue figures, satisfaction rates, or franchisee counts not given above. If asked for a number you don't have, say you'll follow up with verified figures. Keep the reply to 2-4 sentences (this is WhatsApp), warm and professional, end with a question. Do not repeat a greeting if this is not the first message.`;

    const reply = await claude(system, `Conversation so far:\n${convo}\n\nDraft the next reply to the prospect's latest message.`, 400);
    const waMessageId = await sendWhatsAppReply(phone, reply);

    await supabase.from("whatsapp_inbound_messages").update({ replied: true, replied_at: new Date().toISOString(), reply_text: reply })
      .eq("lead_id", leadId).eq("replied", false);
    await supabase.from("system_events").insert({ event_type: "ai_reply_sent", payload: { lead_id: leadId, reply, whatsapp_message_id: waMessageId, source: "instant" }, processed: true, processed_at: new Date().toISOString() });
    log("INFO", "Instant AI reply sent", { leadId }, c);
  } catch (replyErr) {
    const msg = replyErr instanceof Error ? replyErr.message : String(replyErr);
    log("WARN", "Instant reply failed, will retry via heartbeat", { leadId, error: msg }, c);
    await supabase.from("system_events").insert({ event_type: "ai_reply_failed", payload: { lead_id: leadId, error: msg, source: "instant" }, processed: true, processed_at: new Date().toISOString() });
    // Not re-thrown — message stays replied=false so the heartbeat retries it later.
  }
}

interface WhatsAppEntry {
  id: string;
  changes: Array<{
    value: {
      messages?: Array<{ from: string; id: string; text?: { body: string }; type: string; timestamp: string }>;
      contacts?: Array<{ wa_id: string; profile?: { name?: string } }>;
      statuses?: Array<unknown>;
    };
    field: string;
  }>;
}

async function processMessage(body: { entry: WhatsAppEntry[] }, c: string): Promise<Record<string, unknown>> {
  const results: Array<Record<string, unknown>> = [];
  log("INFO", "Processing WhatsApp messages", { entryCount: body.entry?.length ?? 0 }, c);

  for (const entry of body.entry) {
    for (const change of entry.changes) {
      const messages = change.value.messages;
      const contacts = change.value.contacts;
      if (!messages || messages.length === 0) continue;

      for (const msg of messages) {
        if (msg.type !== "text" || !msg.text) {
          results.push({ whatsapp_id: msg.id, status: "skipped", reason: "Not a text message" });
          continue;
        }
        const phone = msg.from;
        const messageText = msg.text.body;
        const normalizedPhone = phone.replace(/^91/, "");

        log("INFO", "Processing WhatsApp text message", { whatsappId: msg.id, phone: normalizedPhone }, c);

        const { data: existingLead, error: findErr } = await supabase
          .from("leads").select("id, contact_name, stage")
          .or(`contact_phone.eq.${normalizedPhone},contact_phone.eq.${phone}`)
          .eq("is_active", true).order("created_at", { ascending: false }).limit(1).maybeSingle();

        if (findErr) log("WARN", "Lead lookup error (non-fatal)", { error: findErr.message }, c);

        let leadId: string;
        let leadStatus: string;

        if (existingLead) {
          leadId = existingLead.id;
          leadStatus = "existing_lead";
        } else {
          const { data: consultant } = await supabase.from("consultants").select("id").eq("is_active", true).order("created_at", { ascending: true }).limit(1).maybeSingle();
          let contactName = "";
          if (contacts && contacts.length > 0 && contacts[0].profile?.name) contactName = contacts[0].profile.name;

          const leadData: Record<string, unknown> = {
            company_name: "Not provided (WhatsApp inbound)",
            contact_name: contactName || phone,
            contact_phone: normalizedPhone,
            lead_source: "WhatsApp",
            stage: "new",
            notes: `First WhatsApp message: ${messageText.slice(0, 500)}`,
            is_active: true,
          };
          if (consultant) leadData.assigned_to = consultant.id;

          const { data: newLead, error: leadError } = await supabase.from("leads").insert(leadData).select("id").single();
          if (leadError || !newLead) {
            log("ERROR", "Failed to create lead from WhatsApp webhook", { error: leadError?.message, whatsappId: msg.id }, c);
            results.push({ whatsapp_id: msg.id, status: "error", error: leadError?.message ?? "Failed to create lead" });
            continue;
          }
          leadId = newLead.id;
          leadStatus = "new_lead_created";
        }

        await supabase.from("whatsapp_inbound_messages").insert({
          lead_id: leadId, phone: normalizedPhone, message_text: messageText, whatsapp_id: msg.id, replied: false,
        });

        // Reply now, don't wait for the heartbeat.
        await replyImmediately(leadId, normalizedPhone, c);

        results.push({ whatsapp_id: msg.id, status: leadStatus, lead_id: leadId });
      }
    }
  }
  return { processed: results.length, results };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  const c = req.headers.get("X-Correlation-ID") || cid();
  log("INFO", `Request received: ${req.method} ${req.url}`, {}, c);

  try {
    if (!supabaseUrl || !supabaseServiceRoleKey) return errResp("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY", 500, c);
    if (req.method === "GET") return handleVerify(req, c);

    if (req.method === "POST") {
      let body: { entry: WhatsAppEntry[] };
      try {
        body = await req.json();
        if (!body || typeof body !== "object" || Array.isArray(body)) {
          return errResp("Invalid payload format: expected JSON object with 'entry' array", 400, c);
        }
      } catch {
        return errResp("Invalid JSON in request body", 400, c);
      }
      if (!body.entry || !Array.isArray(body.entry)) {
        return errResp("Invalid payload format: missing 'entry' array", 400, c);
      }
      const result = await processMessage(body, c);
      return okResp({ success: true, ...result }, 200, c);
    }

    return errResp("Method not allowed", 405, c);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    return errResp(message, 500, c);
  }
});
