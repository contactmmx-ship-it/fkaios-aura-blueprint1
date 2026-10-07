/**
 * WhatsApp Outbound Edge Function
 * ─────────────────────────────────────────────────────────────
 * Sends outbound WhatsApp messages via Meta WhatsApp Cloud API.
 *
 * Required Environment Secrets:
 *   SUPABASE_URL               — Supabase project URL
 *   SUPABASE_SERVICE_ROLE_KEY  — Supabase service role key
 *   WHATSAPP_ACCESS_TOKEN      — Meta WhatsApp Cloud API access token
 *   WHATSAPP_PHONE_NUMBER_ID   — WhatsApp Business phone number ID from Meta dashboard
 *
 * Rate Limiting:
 *   Max 10 messages per phone number per hour, tracked via the
 *   `agent_memory` table in Supabase.
 *
 * API Reference:
 *   https://developers.facebook.com/docs/whatsapp/cloud-api/reference/messages
 * ─────────────────────────────────────────────────────────────
 */

import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import {
  correlationId as generateCorrelationId,
  structuredLog,
  errorResponse,
  successResponse,
  verifyEnvSecrets,
  verifyJWT,
} from "../_shared/utils.ts";

// ──────────────────────────────────────────────
// CORS headers
// ──────────────────────────────────────────────
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Correlation-ID",
};

// ──────────────────────────────────────────────
// Environment & Client Setup
// ──────────────────────────────────────────────
const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const whatsappAccessToken = Deno.env.get("WHATSAPP_ACCESS_TOKEN") ?? "";
const whatsappPhoneNumberId = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID") ?? "";

const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// ──────────────────────────────────────────────
// Constants
// ──────────────────────────────────────────────
const META_API_BASE = "https://graph.facebook.com/v18.0";
const RATE_LIMIT_MAX = 10;        // max messages per phone per hour
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour in ms

// ──────────────────────────────────────────────
// Validate phone number format
// Must include country code (e.g., +91 for India)
// ──────────────────────────────────────────────
function validatePhone(phone: string, cid: string): { valid: boolean; error?: string } {
  if (!phone || typeof phone !== "string") {
    return { valid: false, error: "Phone number is required and must be a string" };
  }

  // Remove any spaces, dashes, parentheses
  const cleaned = phone.replace(/[\s\-\(\)]/g, "");

  // Must start with + followed by digits, or be a raw international number
  const phoneRegex = /^\+?\d{10,15}$/;
  if (!phoneRegex.test(cleaned)) {
    return {
      valid: false,
      error: `Invalid phone format: '${phone}'. Must include country code (e.g., +919876543210)`,
    };
  }

  if (!cleaned.startsWith("+")) {
    structuredLog("WARN", "Phone number missing '+' prefix — auto-correcting", { phone, corrected: `+${cleaned}` }, cid);
  }

  return { valid: true };
}

// ──────────────────────────────────────────────
// Rate limiting: check and record via agent_memory
// Max RATE_LIMIT_MAX messages per phone per hour
// ──────────────────────────────────────────────
async function checkRateLimit(phone: string, cid: string): Promise<{ allowed: boolean; count: number }> {
  const rateLimitKey = `whatsapp_rate_${phone}`;
  const windowStart = new Date(Date.now() - RATE_LIMIT_WINDOW_MS).toISOString();

  // Count messages sent to this phone in the last hour
  const { count, error } = await supabase
    .from("agent_memory")
    .select("id", { count: "exact", head: true })
    .eq("key", rateLimitKey)
    .gte("created_at", windowStart);

  if (error) {
    structuredLog("ERROR", "Rate limit check failed", { error: error.message, phone }, cid);
    // Fail open — allow the message if we can't check rate limit
    return { allowed: true, count: 0 };
  }

  const messageCount = count ?? 0;

  if (messageCount >= RATE_LIMIT_MAX) {
    structuredLog("WARN", "Rate limit exceeded for phone", { phone, count: messageCount, limit: RATE_LIMIT_MAX }, cid);
    return { allowed: false, count: messageCount };
  }

  return { allowed: true, count: messageCount };
}

async function recordRateLimitEntry(phone: string, cid: string): Promise<void> {
  const rateLimitKey = `whatsapp_rate_${phone}`;

  const { error } = await supabase.from("agent_memory").insert({
    key: rateLimitKey,
    value: { sent_at: new Date().toISOString() },
    metadata: { phone, cid },
  });

  if (error) {
    structuredLog("ERROR", "Failed to record rate limit entry", { error: error.message, phone }, cid);
  }
}

// ──────────────────────────────────────────────
// Send WhatsApp template message
// POST /v18.0/{phone_number_id}/messages
// Template messages can be sent at any time
// ──────────────────────────────────────────────
async function sendWhatsAppMessage(
  phone: string,
  templateName: string,
  templateParams: Record<string, string>[],
  cid: string,
) {
  structuredLog("INFO", "Sending WhatsApp template message", { phone, templateName, paramCount: templateParams.length }, cid);

  const url = `${META_API_BASE}/${whatsappPhoneNumberId}/messages`;

  const body: Record<string, unknown> = {
    messaging_product: "whatsapp",
    to: phone.replace(/[\s\-\(\)]/g, ""),
    type: "template",
    template: {
      name: templateName,
      language: { code: "en" },
    },
  };

  // Add template parameters if provided
  if (templateParams && templateParams.length > 0) {
    (body.template as Record<string, unknown>).components = templateParams.map((paramSet) => ({
      type: "body",
      parameters: Object.entries(paramSet).map(([_key, value]) => ({
        type: "text",
        text: value,
      })),
    }));
  }

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${whatsappAccessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    structuredLog("ERROR", "WhatsApp template message failed", {
      status: response.status,
      body: errorBody,
      phone,
      templateName,
    }, cid);

    // Parse Meta API error for actionable messages
    let metaError: Record<string, unknown> = {};
    try {
      metaError = JSON.parse(errorBody);
    } catch {
      // non-JSON error body
    }

    const errorMsg = (metaError?.error as Record<string, unknown>)?.message
      ? String((metaError.error as Record<string, unknown>).message)
      : `Meta API returned ${response.status}`;

    throw new Error(errorMsg);
  }

  const result = await response.json();
  structuredLog("INFO", "WhatsApp template message sent", {
    messageId: result.messages?.[0]?.id,
    phone,
    templateName,
  }, cid);

  return result;
}

// ──────────────────────────────────────────────
// Send WhatsApp freeform text message
// Only works within 24-hour window after user messages you
// POST /v18.0/{phone_number_id}/messages
// ──────────────────────────────────────────────
async function sendWhatsAppText(
  phone: string,
  text: string,
  cid: string,
) {
  structuredLog("INFO", "Sending WhatsApp text message", { phone, textLength: text.length }, cid);

  if (!text || typeof text !== "string" || text.trim().length === 0) {
    throw new Error("Message text is required and must be non-empty");
  }

  // WhatsApp has a 4096 character limit for text messages
  if (text.length > 4096) {
    structuredLog("WARN", "Message text exceeds 4096 character limit, truncating", { originalLength: text.length }, cid);
  }

  const url = `${META_API_BASE}/${whatsappPhoneNumberId}/messages`;

  const body = {
    messaging_product: "whatsapp",
    to: phone.replace(/[\s\-\(\)]/g, ""),
    type: "text",
    text: {
      preview_url: false,
      body: text.slice(0, 4096),
    },
  };

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${whatsappAccessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    structuredLog("ERROR", "WhatsApp text message failed", {
      status: response.status,
      body: errorBody,
      phone,
    }, cid);

    let metaError: Record<string, unknown> = {};
    try {
      metaError = JSON.parse(errorBody);
    } catch {
      // non-JSON error body
    }

    const errorMsg = (metaError?.error as Record<string, unknown>)?.message
      ? String((metaError.error as Record<string, unknown>).message)
      : `Meta API returned ${response.status}`;

    // Add helpful context for common 24h window errors
    if (response.status === 400 && errorMsg.includes("24 hours")) {
      throw new Error(
        `Cannot send freeform text: 24-hour session window expired. Use a template message instead. Meta error: ${errorMsg}`,
      );
    }

    throw new Error(errorMsg);
  }

  const result = await response.json();
  structuredLog("INFO", "WhatsApp text message sent", {
    messageId: result.messages?.[0]?.id,
    phone,
  }, cid);

  return result;
}

// ──────────────────────────────────────────────
// Action handler: send_template
// ──────────────────────────────────────────────
async function handleSendTemplate(req: Request, cid: string) {
  // Verify WhatsApp config
  if (!whatsappAccessToken || !whatsappPhoneNumberId) {
    structuredLog("ERROR", "WhatsApp not configured", {}, cid);
    return errorResponse(
      "WhatsApp not configured",
      503,
      "Set WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID in Edge Function secrets",
      cid,
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return errorResponse("Invalid request body: expected JSON object", 400, undefined, cid);
    }
  } catch {
    return errorResponse("Invalid JSON in request body", 400, undefined, cid);
  }

  const { phone, template_name, template_params } = body;

  if (!phone || typeof phone !== "string") {
    return errorResponse("Missing or invalid 'phone' (string required, include country code e.g. +919876543210)", 400, undefined, cid);
  }
  if (!template_name || typeof template_name !== "string") {
    return errorResponse("Missing or invalid 'template_name' (string required)", 400, undefined, cid);
  }

  // Validate phone number
  const phoneValidation = validatePhone(phone, cid);
  if (!phoneValidation.valid) {
    return errorResponse(phoneValidation.error!, 400, undefined, cid);
  }

  const normalizedPhone = phone.replace(/[\s\-\(\)]/g, "");
  const params = Array.isArray(template_params)
    ? template_params as Record<string, string>[]
    : [];

  // Rate limiting
  const rateCheck = await checkRateLimit(normalizedPhone, cid);
  if (!rateCheck.allowed) {
    return errorResponse(
      "Rate limit exceeded",
      429,
      `Max ${RATE_LIMIT_MAX} messages per phone per hour. Current count: ${rateCheck.count}. Try again later.`,
      cid,
    );
  }

  try {
    const result = await sendWhatsAppMessage(normalizedPhone, template_name, params, cid);

    // Record rate limit entry
    await recordRateLimitEntry(normalizedPhone, cid);

    return successResponse({
      success: true,
      message_id: result.messages?.[0]?.id,
      phone: normalizedPhone,
      template_name,
      correlation_id: cid,
    }, 200, cid);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to send WhatsApp template message";
    structuredLog("ERROR", "Template send failed", { error: message, phone: normalizedPhone, template_name }, cid);
    return errorResponse(message, 502, undefined, cid);
  }
}

// ──────────────────────────────────────────────
// Action handler: send_text
// ──────────────────────────────────────────────
async function handleSendText(req: Request, cid: string) {
  // Verify WhatsApp config
  if (!whatsappAccessToken || !whatsappPhoneNumberId) {
    structuredLog("ERROR", "WhatsApp not configured", {}, cid);
    return errorResponse(
      "WhatsApp not configured",
      503,
      "Set WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID in Edge Function secrets",
      cid,
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return errorResponse("Invalid request body: expected JSON object", 400, undefined, cid);
    }
  } catch {
    return errorResponse("Invalid JSON in request body", 400, undefined, cid);
  }

  const { phone, text } = body;

  if (!phone || typeof phone !== "string") {
    return errorResponse("Missing or invalid 'phone' (string required, include country code e.g. +919876543210)", 400, undefined, cid);
  }
  if (!text || typeof text !== "string") {
    return errorResponse("Missing or invalid 'text' (string required)", 400, undefined, cid);
  }

  // Validate phone number
  const phoneValidation = validatePhone(phone, cid);
  if (!phoneValidation.valid) {
    return errorResponse(phoneValidation.error!, 400, undefined, cid);
  }

  const normalizedPhone = phone.replace(/[\s\-\(\)]/g, "");

  // Rate limiting
  const rateCheck = await checkRateLimit(normalizedPhone, cid);
  if (!rateCheck.allowed) {
    return errorResponse(
      "Rate limit exceeded",
      429,
      `Max ${RATE_LIMIT_MAX} messages per phone per hour. Current count: ${rateCheck.count}. Try again later.`,
      cid,
    );
  }

  try {
    const result = await sendWhatsAppText(normalizedPhone, text, cid);

    // Record rate limit entry
    await recordRateLimitEntry(normalizedPhone, cid);

    return successResponse({
      success: true,
      message_id: result.messages?.[0]?.id,
      phone: normalizedPhone,
      text_preview: text.length > 50 ? text.slice(0, 50) + "..." : text,
      correlation_id: cid,
    }, 200, cid);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to send WhatsApp text message";
    structuredLog("ERROR", "Text send failed", { error: message, phone: normalizedPhone }, cid);
    return errorResponse(message, 502, undefined, cid);
  }
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
    // Verify required env secrets at startup
    const envError = verifyEnvSecrets({
      SUPABASE_URL: supabaseUrl,
      SUPABASE_SERVICE_ROLE_KEY: supabaseServiceRoleKey,
    });
    if (envError) {
      return errorResponse(envError, 500, "Configuration error", cid);
    }

    if (req.method !== "POST") {
      return errorResponse("Method not allowed", 405, undefined, cid);
    }

    // JWT required for all outbound actions
    const authHeader = req.headers.get("Authorization") || "";
    const user = await verifyJWT(authHeader, supabaseUrl, supabaseAnonKey);
    if (!user) {
      return errorResponse("Unauthorized: valid JWT required", 401, undefined, cid);
    }

    let body: Record<string, unknown>;
    try {
      body = await req.json();
      if (!body || typeof body !== "object" || Array.isArray(body)) {
        return errorResponse("Invalid request body: expected JSON object", 400, undefined, cid);
      }
    } catch {
      return errorResponse("Invalid JSON in request body", 400, undefined, cid);
    }

    const { action } = body;

    if (!action || typeof action !== "string") {
      return errorResponse("Missing 'action' field", 400, undefined, cid);
    }

    switch (action) {
      case "send_template":
        return await handleSendTemplate(req, cid);
      case "send_text":
        return await handleSendText(req, cid);
      default:
        return errorResponse(`Unknown action: ${action}. Valid actions: send_template, send_text`, 400, undefined, cid);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    return errorResponse(message, 500, undefined, cid);
  }
});
