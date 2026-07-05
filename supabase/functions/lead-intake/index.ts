// ═══════════════════════════════════════════════════════════════
// SYNC NOTE (repo sync, live v25 pulled 2026-07-05):
// FLAGS — NOT FIXED:
// 1. GATEWAY AUTH vs WEBHOOK: this function is deployed with
//    verify_jwt=true at the Supabase gateway, but /lead-intake/webhook
//    must be publicly reachable for Meta's WhatsApp webhook verification
//    (GET hub.challenge) and event delivery (POST). Meta sends no
//    Supabase JWT, so the gateway returns 401 before this code runs.
//    The webhook route is DEAD as deployed. Fix = redeploy with
//    verify_jwt=false (the function already has its own service_role /
//    JWT gating on /ingest, and token-based verification on /webhook).
// 2. Comments below contain mojibake (â€”, â•â• etc.) from a previous
//    encoding mangle in the deployed source. Copied faithfully as-is.
// 3. No X-Hub-Signature-256 verification on inbound webhook events —
//    header is CORS-allowed but the signature is never checked.
// ═══════════════════════════════════════════════════════════════
/**
 * LEAD-INTAKE â€” Universal Lead Capture Webhook
 * â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
 * Receives incoming leads from ANY channel:
 *   - WhatsApp (via Meta webhook)
 *   - Website forms
 *   - LinkedIn messages
 *   - Manual API submission
 *   - Google Ads landing pages
 *
 * All leads are stored, scored, and auto-assigned to
 * the appropriate AI agent for immediate nurturing.
 *
 * Endpoints:
 *   POST /lead-intake/webhook  â€” Meta/WhatsApp webhook
 *   POST /lead-intake/ingest   â€” Universal lead ingestion
 *   GET  /lead-intake/health   â€” Health check
 * â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
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

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// CORS headers
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Client-Info, Apikey, X-Correlation-ID, X-Hub-Signature-256",
};

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Environment & Client Setup
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const supabaseServiceRoleKey =
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const whatsappVerifyToken = Deno.env.get("WHATSAPP_VERIFY_TOKEN") ?? "";

const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Service role auth check
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function isServiceRoleAuth(authHeader: string): boolean {
  if (!authHeader || !authHeader.startsWith("Bearer ")) return false;
  const token = authHeader.slice(7).trim();
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return false;
    const payload = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));
    return payload.role === "service_role";
  } catch {
    return false;
  }
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// UNIVERSAL LEAD INGESTION
// Accepts lead data from any channel and stores
// it in the leads table with proper formatting.
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
async function ingestLead(
  leadData: Record<string, unknown>,
  source: string,
  cid: string,
) {
  structuredLog("INFO", `Ingesting lead from ${source}`, leadData, cid);

  const {
    name,
    email,
    mobile,
    phone,
    city,
    state,
    investment_capacity,
    investment_range,
    timeline,
    brand_id,
    brand_slug,
    brand_name,
    message,
    notes,
    utm_source,
    utm_medium,
    utm_campaign,
    extra,
  } = leadData;

  // Normalize phone field
  const phoneNum = (mobile || phone || "") as string;

  // Validate minimum required fields
  if (!name && !phoneNum && !email) {
    return errorResponse(
      "At least one of 'name', 'mobile', or 'email' is required",
      400,
      undefined,
      cid,
    );
  }

  // Resolve brand_id from slug or name if brand_id not provided
  let resolvedBrandId = brand_id as string | null;
  if (!resolvedBrandId && brand_slug) {
    const { data: brand } = await supabase
      .from("brands")
      .select("id")
      .eq("slug", brand_slug)
      .single();
    if (brand) resolvedBrandId = brand.id;
  }
  if (!resolvedBrandId && brand_name) {
    const { data: brand } = await supabase
      .from("brands")
      .select("id")
      .eq("name", brand_name)
      .single();
    if (brand) resolvedBrandId = brand.id;
  }

  // Generate a name from email if not provided
  const leadName = (name as string) || (
    email
      ? String(email).split("@")[0].replace(/[._]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
      : "Unknown Lead"
  );

  // Build the lead record
  const leadRecord: Record<string, unknown> = {
    name: leadName,
    email: email || null,
    mobile: phoneNum || null,
    city: city || null,
    state: state || city || null,
    investment_capacity: investment_capacity || investment_range || null,
    timeline: timeline || null,
    brand_id: resolvedBrandId,
    source: source,
    source_detail: message || notes || `Ingested via lead-intake from ${source}`,
    stage: "New",
    status: "active",
    lead_score: 0,
    notes: notes || message || null,
  };

  // Add UTM data if present
  if (utm_source) leadRecord.utm_source = utm_source;
  if (utm_medium) leadRecord.utm_medium = utm_medium;
  if (utm_campaign) leadRecord.utm_campaign = utm_campaign;

  // Insert the lead
  const { data: lead, error: insertErr } = await supabase
    .from("leads")
    .insert(leadRecord)
    .select("id, name, stage, brand:brand_id(name)")
    .single();

  if (insertErr) {
    structuredLog("ERROR", `Failed to ingest lead: ${insertErr.message}`, { error: insertErr.message }, cid);
    return errorResponse(
      `Failed to store lead: ${insertErr.message}`,
      500,
      undefined,
      cid,
    );
  }

  const brandName = (lead?.brand as Record<string, unknown> | null)?.name || "N/A";

  // Log activity
  await supabase.from("agent_activity_log").insert({
    agent_id: null,
    activity_type: "lead_intake",
    title: `Lead Ingested: ${leadName}`,
    description: `New lead received from ${source}. Brand: ${brandName}. Phone: ${phoneNum ? phoneNum.slice(0, -4) + "****" : "N/A"}.`,
    metadata: {
      lead_id: lead.id,
      source,
      brand: brandName,
      has_email: !!email,
      has_phone: !!phoneNum,
    },
  });

  // Log in lead_activities
  await supabase.from("lead_activities").insert({
    lead_id: lead.id,
    type: "note",
    note: `Lead received via ${source}${message ? `: "${String(message).slice(0, 200)}"` : ""}. Auto-pilot will qualify and nurture.`,
  });

  // Immediately trigger qualification job
  const { data: qualifierAgent } = await supabase
    .from("ai_agents")
    .select("id")
    .eq("name", "Lead Qualifier AI")
    .single();

  if (qualifierAgent) {
    await supabase.from("ai_jobs").insert({
      agent_id: qualifierAgent.id,
      type: "QUALIFY_LEAD",
      payload: {
        lead_id: lead.id,
        lead_name: lead.name,
        source: source,
        brand: brandName,
        urgent: true,
      },
      status: "pending",
    });
  }

  structuredLog("INFO", `Lead ingested successfully: ${lead.id}`, { name: lead.name, brand: brandName }, cid);

  return successResponse({
    success: true,
    lead_id: lead.id,
    lead_name: lead.name,
    stage: lead.stage,
    brand: brandName,
    source: source,
    qualification_queued: !!qualifierAgent,
    message: "Lead captured and queued for qualification. Auto-pilot will nurture automatically.",
  }, 201, cid);
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// WHATSAPP WEBHOOK HANDLER
// Handles Meta/WhatsApp webhook verification and
// inbound message events.
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

// GET: WhatsApp webhook verification
async function handleWhatsAppVerify(req: Request, cid: string) {
  const url = new URL(req.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");

  if (mode === "subscribe" && token === whatsappVerifyToken && challenge) {
    structuredLog("INFO", "WhatsApp webhook verified", { mode, token }, cid);
    return new Response(challenge, {
      status: 200,
      headers: { "Content-Type": "text/plain" },
    });
  }

  structuredLog("WARN", "WhatsApp webhook verification failed", { mode, token, expected: whatsappVerifyToken }, cid);
  return errorResponse(
    "Webhook verification failed",
    403,
    "Check WHATSAPP_VERIFY_TOKEN matches Meta dashboard configuration",
    cid,
  );
}

// POST: WhatsApp webhook event
async function handleWhatsAppEvent(req: Request, cid: string) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return errorResponse("Invalid JSON", 400, undefined, cid);
  }

  // Meta webhooks send an array of entries
  const entry = (body.entry as Array<Record<string, unknown>>)?.[0];
  const changes = (entry?.changes as Array<Record<string, unknown>>) || [];

  if (changes.length === 0) {
    return successResponse({ received: true, message: "No changes to process" }, 200, cid);
  }

  let processed = 0;

  for (const change of changes) {
    const value = change.value as Record<string, unknown>;
    const messages = (value.messages as Array<Record<string, unknown>>) || [];
    const contacts = (value.contacts as Array<Record<string, unknown>>) || [];

    for (const msg of messages) {
      // Extract message data
      const from = msg.from as string; // WhatsApp phone number
      const msgType = msg.type as string;
      const timestamp = msg.timestamp as string;
      const contact = contacts[0];

      let textContent = "";
      if (msgType === "text") {
        textContent = ((msg.text as Record<string, unknown>)?.body as string) || "";
      } else if (msgType === "interactive") {
        const interactive = msg.interactive as Record<string, unknown>;
        textContent = ((interactive?.button_reply as Record<string, unknown>)?.title as string) ||
          ((interactive?.list_reply as Record<string, unknown>)?.title as string) ||
          "";
      }

      // Check if this phone number is already a lead
      const { data: existingLead } = await supabase
        .from("leads")
        .select("id, name, stage")
        .eq("mobile", from)
        .order("created_at", { ascending: false })
        .limit(1)
        .single();

      if (existingLead) {
        // Add as activity to existing lead
        await supabase.from("lead_activities").insert({
          lead_id: existingLead.id,
          type: "whatsapp_message",
          note: `WhatsApp message received: "${textContent.slice(0, 500)}"`,
        });

        structuredLog("INFO", `WhatsApp message from existing lead ${existingLead.id}`, { phone: from, msgType }, cid);
      } else {
        // New lead from WhatsApp
        const contactName = contact
          ? `${(contact.wa_name as string) || (contact.wa_id as string) || "WhatsApp User"}`
          : "WhatsApp User";

        await ingestLead(
          {
            name: contactName,
            mobile: from,
            message: textContent,
            source: "whatsapp",
          },
          "whatsapp",
          cid,
        );
      }

      processed++;
    }
  }

  return successResponse({
    received: true,
    processed,
    timestamp: new Date().toISOString(),
  }, 200, cid);
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// MAIN HANDLER
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
Deno.serve(async (req: Request) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  // Correlation ID
  const cid =
    req.headers.get("X-Correlation-ID") || generateCorrelationId();

  try {
    // Verify required env secrets
    const envError = verifyEnvSecrets({
      SUPABASE_URL: supabaseUrl,
      SUPABASE_SERVICE_ROLE_KEY: supabaseServiceRoleKey,
    });
    if (envError) {
      return errorResponse(envError, 500, "Configuration error", cid);
    }

    const url = new URL(req.url);

    // â”€â”€ GET /lead-intake/webhook â€” WhatsApp verification â”€â”€
    if (url.pathname === "/lead-intake/webhook" && req.method === "GET") {
      structuredLog("INFO", "WhatsApp webhook verification request", {}, cid);
      return await handleWhatsAppVerify(req, cid);
    }

    // â”€â”€ POST /lead-intake/webhook â€” WhatsApp event â”€â”€
    if (url.pathname === "/lead-intake/webhook" && req.method === "POST") {
      structuredLog("INFO", "WhatsApp webhook event received", {}, cid);
      return await handleWhatsAppEvent(req, cid);
    }

    // â”€â”€ POST /lead-intake/ingest â€” Universal ingestion â”€â”€
    if (url.pathname === "/lead-intake/ingest" && req.method === "POST") {
      // Accept with service_role or JWT
      const authHeader = req.headers.get("Authorization") || "";
      const isServiceRole = isServiceRoleAuth(authHeader);
      const user = isServiceRole
        ? { userId: "service_role", role: "service_role" }
        : await verifyJWT(authHeader, supabaseUrl, supabaseAnonKey);

      if (!user) {
        return errorResponse("Unauthorized: JWT or service_role key required", 401, undefined, cid);
      }

      let body: Record<string, unknown>;
      try {
        body = await req.json();
      } catch {
        return errorResponse("Invalid JSON in request body", 400, undefined, cid);
      }

      if (!body || typeof body !== "object" || Array.isArray(body)) {
        return errorResponse("Invalid request body: expected JSON object", 400, undefined, cid);
      }

      return await ingestLead(body, (body.source as string) || "api", cid);
    }

    // â”€â”€ GET /lead-intake/health â”€â”€
    if (url.pathname === "/lead-intake/health" && req.method === "GET") {
      // Check database connectivity
      const { error } = await supabase
        .from("brands")
        .select("id", { count: "exact", head: true })
        .limit(1);

      return successResponse({
        status: error ? "degraded" : "healthy",
        whatsapp_configured: !!whatsappVerifyToken,
        database_connected: !error,
        version: "1.0.0",
        timestamp: new Date().toISOString(),
      }, 200, cid);
    }

    return errorResponse(
      `Unknown route: ${req.method} ${url.pathname}`,
      404,
      "Valid routes: GET /lead-intake/health, POST /lead-intake/ingest, GET/POST /lead-intake/webhook",
      cid,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    structuredLog("ERROR", `LEAD-INTAKE error: ${message}`, {}, cid);
    return errorResponse(message, 500, undefined, cid);
  }
});
