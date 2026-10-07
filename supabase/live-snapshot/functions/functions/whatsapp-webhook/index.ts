import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import {
  correlationId as generateCorrelationId,
  structuredLog,
  errorResponse,
  successResponse,
  verifyEnvSecrets,
} from "../_shared/utils.ts";

// ──────────────────────────────────────────────
// CORS headers
// ──────────────────────────────────────────────
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey, X-Correlation-ID",
};

// ──────────────────────────────────────────────
// Environment & Client Setup
// ──────────────────────────────────────────────
const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const WHATSAPP_WEBHOOK_VERIFY_TOKEN = Deno.env.get("WHATSAPP_WEBHOOK_VERIFY_TOKEN") ?? "";

const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

// ──────────────────────────────────────────────
// GET: WhatsApp webhook verification (kept as-is)
// ──────────────────────────────────────────────
function handleVerify(req: Request, cid: string): Response {
  const url = new URL(req.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");

  if (mode === "subscribe" && token === WHATSAPP_WEBHOOK_VERIFY_TOKEN && challenge) {
    structuredLog("INFO", "WhatsApp webhook verification succeeded", { mode, token: token ? "***" : undefined }, cid);
    return new Response(challenge, {
      status: 200,
      headers: { "Content-Type": "text/plain" },
    });
  }

  structuredLog("WARN", "WhatsApp webhook verification failed", { mode, hasToken: !!token, hasChallenge: !!challenge }, cid);

  return errorResponse("Verification failed", 403, undefined, cid);
}

// ──────────────────────────────────────────────
// Interfaces
// ──────────────────────────────────────────────
interface WhatsAppEntry {
  id: string;
  changes: Array<{
    value: {
      messages?: Array<{
        from: string;
        id: string;
        text?: { body: string };
        type: string;
        timestamp: string;
      }>;
      contacts?: Array<{
        wa_id: string;
        profile?: { name?: string };
      }>;
      statuses?: Array<unknown>;
    };
    field: string;
  }>;
}

// ──────────────────────────────────────────────
// Process incoming WhatsApp message
// ──────────────────────────────────────────────
async function processMessage(body: WhatsAppEntry, cid: string): Promise<Record<string, unknown>> {
  const results: Array<Record<string, unknown>> = [];

  structuredLog("INFO", "Processing WhatsApp messages", { entryCount: body.entry?.length ?? 0 }, cid);

  for (const entry of body.entry) {
    for (const change of entry.changes) {
      const messages = change.value.messages;
      const contacts = change.value.contacts;

      if (!messages || messages.length === 0) {
        continue;
      }

      for (const msg of messages) {
        if (msg.type !== "text" || !msg.text) {
          results.push({ whatsapp_id: msg.id, status: "skipped", reason: "Not a text message" });
          continue;
        }

        const phone = msg.from;
        const messageText = msg.text.body;
        const normalizedPhone = phone.replace(/^91/, "");

        structuredLog("INFO", "Processing WhatsApp text message", { whatsappId: msg.id, phone: normalizedPhone, textLength: messageText.length }, cid);

        const { data: existingLead } = await supabase
          .from("leads")
          .select("id, name, stage")
          .eq("mobile", normalizedPhone)
          .or(`mobile.eq.${phone}`)
          .eq("is_active", true)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (existingLead) {
          await supabase.from("lead_activities").insert({
            lead_id: existingLead.id,
            type: "whatsapp_message",
            note: `WhatsApp: ${messageText.slice(0, 200)}`,
          });

          structuredLog("INFO", "WhatsApp message logged for existing lead", { leadId: existingLead.id }, cid);

          results.push({
            whatsapp_id: msg.id,
            status: "existing_lead",
            lead_id: existingLead.id,
            lead_name: existingLead.name,
            stage: existingLead.stage,
          });
          continue;
        }

        const { data: consultant } = await supabase
          .from("consultants")
          .select("id")
          .eq("is_active", true)
          .order("created_at", { ascending: true })
          .limit(1)
          .maybeSingle();

        let contactName = "";
        if (contacts && contacts.length > 0 && contacts[0].profile?.name) {
          contactName = contacts[0].profile.name;
        }

        const leadData: Record<string, unknown> = {
          name: contactName || phone,
          mobile: normalizedPhone,
          source: "WhatsApp",
          stage: "Inquiry",
          notes: `First WhatsApp message: ${messageText.slice(0, 500)}`,
          is_active: true,
        };

        if (consultant) {
          leadData.assigned_to = consultant.id;
        }

        const { data: newLead, error: leadError } = await supabase
          .from("leads")
          .insert(leadData)
          .select("id, name, stage")
          .single();

        if (leadError || !newLead) {
          structuredLog("ERROR", "Failed to create lead from WhatsApp webhook", { error: leadError?.message, whatsappId: msg.id }, cid);
          results.push({
            whatsapp_id: msg.id,
            status: "error",
            error: leadError?.message ?? "Failed to create lead",
          });
          continue;
        }

        await supabase.from("lead_activities").insert({
          lead_id: newLead.id,
          type: "whatsapp_message",
          note: `WhatsApp (new lead): ${messageText.slice(0, 200)}`,
        });

        const { data: qualifierAgent } = await supabase
          .from("ai_agents")
          .select("id")
          .eq("task", "QUALIFY_LEAD")
          .eq("is_active", true)
          .limit(1)
          .maybeSingle();

        await supabase.from("ai_jobs").insert({
          agent_id: qualifierAgent?.id ?? null,
          type: "QUALIFY_LEAD",
          payload: {
            lead_id: newLead.id,
            name: newLead.name,
            phone: normalizedPhone,
            source: "WhatsApp",
            message: messageText.slice(0, 500),
          },
          status: "pending",
        });

        if (qualifierAgent) {
          await supabase.from("agent_activity_log").insert({
            agent_id: qualifierAgent.id,
            activity_type: "task",
            title: `Qualify new WhatsApp lead: ${newLead.name}`,
            description: `Phone: ${normalizedPhone}`,
            lead_id: newLead.id,
            metadata: { source: "WhatsApp", webhook: true },
          });
        }

        structuredLog("INFO", "New lead created from WhatsApp webhook", { leadId: newLead.id, name: newLead.name }, cid);

        results.push({
          whatsapp_id: msg.id,
          status: "new_lead_created",
          lead_id: newLead.id,
          lead_name: newLead.name,
          assigned_to: consultant?.id ?? null,
        });
      }
    }
  }

  return { processed: results.length, results };
}

// ──────────────────────────────────────────────
// Handler
// ──────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  // Correlation ID
  const cid = req.headers.get("X-Correlation-ID") || generateCorrelationId();
  structuredLog("INFO", `Request received: ${req.method} ${req.url}`, {}, cid);

  try {
    // Verify required env secrets
    const envError = verifyEnvSecrets({ SUPABASE_URL: supabaseUrl, SUPABASE_SERVICE_ROLE_KEY: supabaseServiceRoleKey });
    if (envError) {
      return errorResponse(envError, 500, "Configuration error", cid);
    }

    // GET = webhook verification (kept as-is: hub verify token)
    if (req.method === "GET") {
      return handleVerify(req, cid);
    }

    // POST = incoming message
    if (req.method === "POST") {
      let body: WhatsAppEntry;
      try {
        body = await req.json();
        if (!body || typeof body !== "object" || Array.isArray(body)) {
          return errorResponse("Invalid payload format: expected JSON object with 'entry' array", 400, undefined, cid);
        }
      } catch {
        return errorResponse("Invalid JSON in request body", 400, undefined, cid);
      }

      if (!body.entry || !Array.isArray(body.entry)) {
        return errorResponse("Invalid payload format: missing 'entry' array", 400, undefined, cid);
      }

      const result = await processMessage(body, cid);
      return successResponse({ success: true, ...result }, 200, cid);
    }

    return errorResponse("Method not allowed", 405, undefined, cid);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    return errorResponse(message, 500, undefined, cid);
  }
});