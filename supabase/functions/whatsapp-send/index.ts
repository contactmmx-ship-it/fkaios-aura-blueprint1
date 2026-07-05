// Supabase Edge Function: WhatsApp Cloud API Outbound Message Sender
// Deno runtime with npm: imports

import { createClient } from "npm:@supabase/supabase-js@2";
import { createHmac, timingSafeEqual } from "node:crypto";

// ─── Types ───────────────────────────────────────────────────────────────────

interface JwtPayload {
  sub: string;
  role: string;
  aud: string;
  exp: number;
  iat: number;
  [key: string]: unknown;
}

interface SendMessageRequest {
  phone_number: string;
  message_type: "template" | "text" | "interactive";
  template_name?: string;
  template_params?: string[];
  body_text?: string;
  lead_id?: string;
  brand_id?: string;
}

interface MetaMessageResponse {
  messaging_product: string;
  contacts?: Array<{ input: string; wa_id: string }>;
  messages?: Array<{ id: string }>;
  error?: {
    message: string;
    type: string;
    code: number;
    error_data?: {
      messaging_product: string;
      details: string;
      title: string;
    };
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function generateCorrelationId(): string {
  return `wa-send-${crypto.randomUUID().slice(0, 8)}`;
}

function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

function structuredLog(
  correlationId: string,
  level: string,
  message: string,
  data?: Record<string, unknown>
): void {
  const timestamp = new Date().toISOString();
  const entry = {
    timestamp,
    correlationId,
    level,
    message,
    ...(data && { data }),
  };
  console.log(JSON.stringify(entry));
}

/**
 * Decode and verify a Supabase JWT using the JWT secret.
 * Returns the payload if valid, throws otherwise.
 */
function verifyJwt(token: string, jwtSecret: string): JwtPayload {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) {
      throw new Error("Invalid JWT format: expected 3 parts");
    }

    const headerB64 = parts[0].replace(/-/g, "+").replace(/_/g, "/");
    const payloadB64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const signatureB64 = parts[2].replace(/-/g, "+").replace(/_/g, "/");

    const header = JSON.parse(atob(headerB64));
    if (header.alg !== "HS256") {
      throw new Error(`Unsupported JWT algorithm: ${header.alg}`);
    }

    // Verify signature
    const signingInput = `${parts[0]}.${parts[1]}`;
    const expectedSignature = createHmac("sha256", jwtSecret)
      .update(signingInput)
      .digest("base64")
      .replace(/=/g, "")
      .replace(/\+/g, "-")
      .replace(/\//g, "_");

    const actualSignature = signatureB64; // already url-safe base64
    const sigBuffer = Buffer.from(actualSignature, "base64");
    const expectedBuffer = Buffer.from(expectedSignature, "base64");

    if (
      sigBuffer.length !== expectedBuffer.length ||
      !timingSafeEqual(sigBuffer, expectedBuffer)
    ) {
      throw new Error("JWT signature verification failed");
    }

    const payload = JSON.parse(atob(payloadB64));

    // Check expiration
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp && payload.exp < now) {
      throw new Error("JWT has expired");
    }

    // Check audience — Supabase JWTs have aud = "authenticated"
    if (payload.aud !== "authenticated") {
      throw new Error(
        `Invalid JWT audience: expected "authenticated", got "${payload.aud}"`
      );
    }

    return payload as JwtPayload;
  } catch (err) {
    if (err instanceof Error) throw err;
    throw new Error("JWT verification failed: unknown error");
  }
}

/**
 * Validate an Indian phone number. Must start with 91 and be 12-13 digits total.
 */
function validateIndianPhoneNumber(phone: string): string {
  const cleaned = phone.replace(/[\s\-()]/g, "");

  if (!/^\d+$/.test(cleaned)) {
    throw new Error(
      `Invalid phone number "${phone}": contains non-digit characters`
    );
  }

  if (cleaned.startsWith("91") && cleaned.length === 12) {
    return cleaned;
  }

  if (cleaned.startsWith("+91")) {
    const withoutPlus = cleaned.slice(1);
    if (withoutPlus.length === 12) return withoutPlus;
  }

  if (cleaned.length === 10 && /^\d{10}$/.test(cleaned)) {
    return `91${cleaned}`;
  }

  throw new Error(
    `Invalid phone number "${phone}": must be a valid Indian number starting with 91 (10 digits, or 12 digits with country code)`
  );
}

/**
 * Build the WhatsApp Cloud API message payload based on message type.
 */
function buildMessagePayload(
  recipientPhone: string,
  request: SendMessageRequest
): Record<string, unknown> {
  const base = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: recipientPhone,
  };

  switch (request.message_type) {
    case "template": {
      if (!request.template_name) {
        throw new Error(
          "template_name is required for template message_type"
        );
      }
      const components: Record<string, unknown>[] = [];
      if (request.template_params && request.template_params.length > 0) {
        components.push({
          type: "body",
          parameters: request.template_params.map((p) => ({
            type: "text",
            text: p,
          })),
        });
      }
      return {
        ...base,
        type: "template",
        template: {
          name: request.template_name,
          language: { code: "en" },
          ...(components.length > 0 && { components }),
        },
      };
    }

    case "text": {
      if (!request.body_text) {
        throw new Error("body_text is required for text message_type");
      }
      return {
        ...base,
        type: "text",
        text: {
          preview_url: false,
          body: request.body_text,
        },
      };
    }

    case "interactive": {
      if (!request.body_text) {
        throw new Error(
          "body_text is required for interactive message_type (used as body text)"
        );
      }
      return {
        ...base,
        type: "interactive",
        interactive: {
          type: "button",
          body: {
            text: request.body_text,
          },
          action: {
            buttons: [
              {
                id: "confirm_yes",
                title: "Yes, Confirm",
                type: "reply",
              },
              {
                id: "confirm_no",
                title: "No, Reschedule",
                type: "reply",
              },
            ],
          },
        },
      };
    }

    default:
      throw new Error(
        `Unsupported message_type: ${(request as Record<string, unknown>).message_type}`
      );
  }
}

// ─── Main Handler ────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  const correlationId = generateCorrelationId();

  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: corsHeaders() });
  }

  if (req.method !== "POST") {
    structuredLog(correlationId, "WARN", "Method not allowed", {
      method: req.method,
    });
    return new Response(
      JSON.stringify({ error: "Method not allowed. Use POST." }),
      { status: 405, headers: { ...corsHeaders(), "Content-Type": "application/json" } }
    );
  }

  try {
    // ── 1. Verify JWT auth + admin role ───────────────────────────────────
    const authHeader = req.headers.get("authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      structuredLog(correlationId, "WARN", "Missing or invalid authorization header");
      return new Response(
        JSON.stringify({ error: "Missing or invalid authorization header" }),
        { status: 401, headers: { ...corsHeaders(), "Content-Type": "application/json" } }
      );
    }

    const token = authHeader.slice(7);
    const jwtSecret = Deno.env.get("SUPABASE_JWT_SECRET") ?? Deno.env.get("JWT_SECRET");

    if (!jwtSecret) {
      structuredLog(correlationId, "ERROR", "JWT secret not configured in environment");
      return new Response(
        JSON.stringify({ error: "Server misconfigured: JWT secret not available" }),
        { status: 500, headers: { ...corsHeaders(), "Content-Type": "application/json" } }
      );
    }

    let payload: JwtPayload;
    try {
      payload = verifyJwt(token, jwtSecret);
    } catch (jwtErr) {
      structuredLog(correlationId, "WARN", "JWT verification failed", {
        error: jwtErr instanceof Error ? jwtErr.message : String(jwtErr),
      });
      return new Response(
        JSON.stringify({ error: "Invalid or expired token" }),
        { status: 401, headers: { ...corsHeaders(), "Content-Type": "application/json" } }
      );
    }

    const userRole = payload.role ?? payload["app_metadata"]?.role;
    if (userRole !== "admin" && userRole !== "super_admin") {
      structuredLog(correlationId, "WARN", "Insufficient permissions", {
        userId: payload.sub,
        role: userRole,
      });
      return new Response(
        JSON.stringify({ error: "Forbidden: admin role required" }),
        { status: 403, headers: { ...corsHeaders(), "Content-Type": "application/json" } }
      );
    }

    structuredLog(correlationId, "INFO", "JWT verified", {
      userId: payload.sub,
      role: userRole,
    });

    // ── 2. Parse and validate request body ────────────────────────────────
    let body: SendMessageRequest;
    try {
      body = await req.json();
    } catch {
      structuredLog(correlationId, "WARN", "Invalid JSON body");
      return new Response(
        JSON.stringify({ error: "Invalid JSON in request body" }),
        { status: 400, headers: { ...corsHeaders(), "Content-Type": "application/json" } }
      );
    }

    if (!body.phone_number || !body.message_type) {
      structuredLog(correlationId, "WARN", "Missing required fields", {
        hasPhone: !!body.phone_number,
        hasType: !!body.message_type,
      });
      return new Response(
        JSON.stringify({
          error: "Missing required fields: phone_number, message_type",
        }),
        { status: 400, headers: { ...corsHeaders(), "Content-Type": "application/json" } }
      );
    }

    if (!["template", "text", "interactive"].includes(body.message_type)) {
      return new Response(
        JSON.stringify({
          error:
            'Invalid message_type. Must be one of: "template", "text", "interactive"',
        }),
        { status: 400, headers: { ...corsHeaders(), "Content-Type": "application/json" } }
      );
    }

    // ── 3. Validate phone number ──────────────────────────────────────────
    let validatedPhone: string;
    try {
      validatedPhone = validateIndianPhoneNumber(body.phone_number);
    } catch (phoneErr) {
      structuredLog(correlationId, "WARN", "Phone validation failed", {
        error: phoneErr instanceof Error ? phoneErr.message : String(phoneErr),
        phone: body.phone_number,
      });
      return new Response(
        JSON.stringify({
          error: phoneErr instanceof Error ? phoneErr.message : "Invalid phone number",
        }),
        { status: 400, headers: { ...corsHeaders(), "Content-Type": "application/json" } }
      );
    }

    // ── 4. Verify WhatsApp credentials — HONESTY PROTOCOL ─────────────────
    const WHATSAPP_ACCESS_TOKEN = Deno.env.get("WHATSAPP_ACCESS_TOKEN");
    const WHATSAPP_PHONE_NUMBER_ID = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID");
    const WHATSAPP_BUSINESS_ACCOUNT_ID = Deno.env.get(
      "WHATSAPP_BUSINESS_ACCOUNT_ID"
    );

    if (!WHATSAPP_ACCESS_TOKEN) {
      const errorMsg =
        "WhatsApp send failed: WHATSAPP_ACCESS_TOKEN not configured. Meta Business verification and WhatsApp Business API access required. Founder action: Complete Meta Business Suite verification → WhatsApp Manager → API setup.";
      structuredLog(correlationId, "ERROR", "WhatsApp credentials missing", {
        missingVar: "WHATSAPP_ACCESS_TOKEN",
        hasPhoneNumberId: !!WHATSAPP_PHONE_NUMBER_ID,
        hasBusinessAccountId: !!WHATSAPP_BUSINESS_ACCOUNT_ID,
      });
      return new Response(JSON.stringify({ error: errorMsg }), {
        status: 503,
        headers: { ...corsHeaders(), "Content-Type": "application/json" },
      });
    }

    if (!WHATSAPP_PHONE_NUMBER_ID) {
      const errorMsg =
        "WhatsApp send failed: WHATSAPP_PHONE_NUMBER_ID not configured. Founder action: Meta Business Suite → WhatsApp Manager → Phone Numbers → Copy Phone Number ID.";
      structuredLog(correlationId, "ERROR", "WhatsApp credentials missing", {
        missingVar: "WHATSAPP_PHONE_NUMBER_ID",
      });
      return new Response(JSON.stringify({ error: errorMsg }), {
        status: 503,
        headers: { ...corsHeaders(), "Content-Type": "application/json" },
      });
    }

    structuredLog(correlationId, "INFO", "WhatsApp credentials verified", {
      phoneNumberId: WHATSAPP_PHONE_NUMBER_ID,
      businessAccountId: WHATSAPP_BUSINESS_ACCOUNT_ID ?? "not_set",
    });

    // ── 5. Build message payload ──────────────────────────────────────────
    let messagePayload: Record<string, unknown>;
    try {
      messagePayload = buildMessagePayload(validatedPhone, body);
    } catch (buildErr) {
      structuredLog(correlationId, "WARN", "Failed to build message payload", {
        error: buildErr instanceof Error ? buildErr.message : String(buildErr),
      });
      return new Response(
        JSON.stringify({
          error:
            buildErr instanceof Error ? buildErr.message : "Failed to build message",
        }),
        { status: 400, headers: { ...corsHeaders(), "Content-Type": "application/json" } }
      );
    }

    structuredLog(correlationId, "INFO", "Sending WhatsApp message", {
      to: validatedPhone,
      type: body.message_type,
      templateName: body.template_name ?? null,
      leadId: body.lead_id ?? null,
    });

    // ── 6. Call Meta Graph API ────────────────────────────────────────────
    const metaApiUrl = `https://graph.facebook.com/v18.0/${WHATSAPP_PHONE_NUMBER_ID}/messages`;

    let metaResponse: Response;
    try {
      metaResponse = await fetch(metaApiUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${WHATSAPP_ACCESS_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(messagePayload),
      });
    } catch (fetchErr) {
      structuredLog(correlationId, "ERROR", "Meta API fetch failed", {
        error:
          fetchErr instanceof Error ? fetchErr.message : String(fetchErr),
      });
      return new Response(
        JSON.stringify({
          error: `Failed to reach Meta Graph API: ${fetchErr instanceof Error ? fetchErr.message : "Network error"}`,
        }),
        { status: 502, headers: { ...corsHeaders(), "Content-Type": "application/json" } }
      );
    }

    const metaResponseBody: MetaMessageResponse = await metaResponse.json();

    if (!metaResponse.ok) {
      const metaError = metaResponseBody.error;
      const errMessage =
        metaError?.message ?? `Meta API returned status ${metaResponse.status}`;

      structuredLog(correlationId, "ERROR", "Meta API returned error", {
        status: metaResponse.status,
        metaCode: metaError?.code,
        metaType: metaError?.type,
        metaMessage: metaError?.message,
        phone: validatedPhone,
        messageType: body.message_type,
      });

      return new Response(
        JSON.stringify({
          error: `WhatsApp API error: ${errMessage}`,
          meta_code: metaError?.code,
          meta_type: metaError?.type,
        }),
        { status: metaResponse.status >= 500 ? 502 : 400,
          headers: { ...corsHeaders(), "Content-Type": "application/json" } }
      );
    }

    // ── 7. Parse WhatsApp message ID ──────────────────────────────────────
    const whatsappMessageId =
      metaResponseBody.messages?.[0]?.id;
    const contactWaId = metaResponseBody.contacts?.[0]?.wa_id;

    if (!whatsappMessageId) {
      structuredLog(correlationId, "ERROR", "No message ID in Meta response", {
        responseBody: metaResponseBody,
      });
      return new Response(
        JSON.stringify({
          error:
            "WhatsApp API did not return a message ID. Unexpected response format.",
          meta_response: metaResponseBody,
        }),
        { status: 502, headers: { ...corsHeaders(), "Content-Type": "application/json" } }
      );
    }

    structuredLog(correlationId, "INFO", "WhatsApp message sent successfully", {
      whatsappMessageId,
      contactWaId,
    });

    // ── 8. Log the outbound message ───────────────────────────────────────
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (supabaseUrl && supabaseServiceKey) {
      const supabase = createClient(supabaseUrl, supabaseServiceKey, {
        auth: { persistSession: false },
      });

      // Try whatsapp_outbound_log table first
      const logRecord = {
        phone_number: validatedPhone,
        message_type: body.message_type,
        template_name: body.template_name ?? null,
        body_text: body.body_text ?? null,
        whatsapp_message_id: whatsappMessageId,
        whatsapp_contact_id: contactWaId ?? null,
        lead_id: body.lead_id ?? null,
        brand_id: body.brand_id ?? null,
        sent_by: payload.sub,
        status: "sent",
        correlation_id: correlationId,
        created_at: new Date().toISOString(),
      };

      const { error: logError } = await supabase
        .from("whatsapp_outbound_log")
        .insert(logRecord);

      if (logError) {
        // Table might not exist — fall back to agent_dispatch_log
        structuredLog(
          correlationId,
          "WARN",
          "whatsapp_outbound_log insert failed, trying agent_dispatch_log",
          { logError: logError.message }
        );

        const { error: dispatchLogError } = await supabase
          .from("agent_dispatch_log")
          .insert({
            lead_id: body.lead_id ?? null,
            channel: "whatsapp",
            direction: "outbound",
            message_content:
              body.message_type === "template"
                ? `Template: ${body.template_name}`
                : body.body_text ?? "",
            external_message_id: whatsappMessageId,
            status: "sent",
            metadata: {
              phone_number: validatedPhone,
              message_type: body.message_type,
              template_name: body.template_name,
              template_params: body.template_params,
              correlation_id: correlationId,
            },
            created_at: new Date().toISOString(),
          });

        if (dispatchLogError) {
          structuredLog(
            correlationId,
            "WARN",
            "agent_dispatch_log insert also failed",
            { logError: dispatchLogError.message }
          );
          // Non-fatal — the message was still sent
        } else {
          structuredLog(
            correlationId,
            "INFO",
            "Logged to agent_dispatch_log"
          );
        }
      } else {
        structuredLog(
          correlationId,
          "INFO",
          "Logged to whatsapp_outbound_log"
        );
      }
    } else {
      structuredLog(
        correlationId,
        "WARN",
        "Supabase credentials not set, skipping outbound log"
      );
    }

    // ── 9. Return success ─────────────────────────────────────────────────
    return new Response(
      JSON.stringify({
        success: true,
        message_id: whatsappMessageId,
        whatsapp_id: contactWaId ?? validatedPhone,
        correlation_id: correlationId,
      }),
      {
        status: 200,
        headers: { ...corsHeaders(), "Content-Type": "application/json" },
      }
    );
  } catch (err) {
    structuredLog(correlationId, "ERROR", "Unhandled exception", {
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    return new Response(
      JSON.stringify({
        error: "Internal server error",
        correlation_id: correlationId,
      }),
      {
        status: 500,
        headers: { ...corsHeaders(), "Content-Type": "application/json" },
      }
    );
  }
});
