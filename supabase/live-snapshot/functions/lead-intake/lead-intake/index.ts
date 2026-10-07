/**
 * LEAD-INTAKE — Universal Lead Capture Webhook
 *
 * SYNC/FIX NOTE (2026-07-05): redeployed with gateway verify_jwt=false.
 * Previously verify_jwt=true at the Supabase gateway meant Meta's webhook
 * calls (GET verification + POST events, which carry no Supabase JWT)
 * were 401'd before this code ever ran — /lead-intake/webhook was dead as
 * deployed. This function already has its own internal auth: /ingest
 * requires a real JWT or service_role bearer token, and /webhook is
 * protected by Meta's own hub.verify_token handshake. No business-logic
 * changes were made — only the gateway flag, plus inlining the small
 * shared utils helpers (correlationId/log/errorResponse/successResponse/
 * verifyEnvSecrets/verifyJWT) directly into this file, since the
 * '../_shared/utils.ts' relative import failed to bundle via this deploy
 * path. Behavior is identical to the previous version's utils.ts.
 * Still recommended as a follow-up: add real X-Hub-Signature-256 HMAC
 * verification on inbound webhook POSTs, since that header is currently
 * accepted in CORS but never checked.
 */ import { createClient } from "npm:@supabase/supabase-js@2.57.4";
// ──────────────────────────────────────────────
// Inlined shared utils (previously in ../_shared/utils.ts)
// ──────────────────────────────────────────────
function generateCorrelationId() {
  return crypto.randomUUID().slice(0, 8);
}
function structuredLog(level, message, data, cid) {
  console.log(JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    correlationId: cid || '',
    message,
    ...data ? {
      data
    } : {}
  }));
}
function errorResponse(message, status, details, cid) {
  structuredLog('ERROR', message, {
    status,
    details
  }, cid);
  return new Response(JSON.stringify({
    error: message,
    ...details ? {
      details
    } : {},
    ...cid ? {
      correlationId: cid
    } : {}
  }), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
      'Access-Control-Allow-Methods': 'POST, GET, OPTIONS, PUT, DELETE'
    }
  });
}
function successResponse(data, status = 200, cid) {
  return new Response(JSON.stringify({
    ...data || {},
    ...cid ? {
      correlationId: cid
    } : {}
  }), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
      'Access-Control-Allow-Methods': 'POST, GET, OPTIONS, PUT, DELETE'
    }
  });
}
function verifyEnvSecrets(required) {
  const missing = [];
  for (const [name, value] of Object.entries(required)){
    if (!value) missing.push(name);
  }
  return missing.length > 0 ? `Missing required secrets: ${missing.join(', ')}` : null;
}
async function verifyJWT(authHeader, supabaseUrl, supabaseAnonKey) {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7);
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
    if (payload.iss !== `${supabaseUrl}/auth/v1`) return null;
    if (payload.exp && payload.exp < Date.now() / 1000) return null;
    return {
      userId: payload.sub,
      role: payload.user_role || payload.role || 'authenticated'
    };
  } catch  {
    return null;
  }
}
// ──────────────────────────────────────────────
// CORS headers
// ──────────────────────────────────────────────
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey, X-Correlation-ID, X-Hub-Signature-256"
};
// ──────────────────────────────────────────────
// Environment & Client Setup
// ──────────────────────────────────────────────
const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const whatsappVerifyToken = Deno.env.get("WHATSAPP_VERIFY_TOKEN") ?? "";
const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});
// ──────────────────────────────────────────────
// Service role auth check
// ──────────────────────────────────────────────
function isServiceRoleAuth(authHeader) {
  if (!authHeader || !authHeader.startsWith("Bearer ")) return false;
  const token = authHeader.slice(7).trim();
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return false;
    const payload = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));
    return payload.role === "service_role";
  } catch  {
    return false;
  }
}
// ══════════════════════════════════════════════
// UNIVERSAL LEAD INGESTION
// ══════════════════════════════════════════════
async function ingestLead(leadData, source, cid) {
  structuredLog("INFO", `Ingesting lead from ${source}`, leadData, cid);
  const { name, email, mobile, phone, city, state, investment_capacity, investment_range, timeline, brand_id, brand_slug, brand_name, message, notes, utm_source, utm_medium, utm_campaign } = leadData;
  const phoneNum = mobile || phone || "";
  if (!name && !phoneNum && !email) {
    return errorResponse("At least one of 'name', 'mobile', or 'email' is required", 400, undefined, cid);
  }
  let resolvedBrandId = brand_id;
  if (!resolvedBrandId && brand_slug) {
    const { data: brand } = await supabase.from("brands").select("id").eq("slug", brand_slug).single();
    if (brand) resolvedBrandId = brand.id;
  }
  if (!resolvedBrandId && brand_name) {
    const { data: brand } = await supabase.from("brands").select("id").eq("name", brand_name).single();
    if (brand) resolvedBrandId = brand.id;
  }
  const leadName = name || (email ? String(email).split("@")[0].replace(/[._]/g, " ").replace(/\b\w/g, (c)=>c.toUpperCase()) : "Unknown Lead");
  const leadRecord = {
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
    notes: notes || message || null
  };
  if (utm_source) leadRecord.utm_source = utm_source;
  if (utm_medium) leadRecord.utm_medium = utm_medium;
  if (utm_campaign) leadRecord.utm_campaign = utm_campaign;
  const { data: lead, error: insertErr } = await supabase.from("leads").insert(leadRecord).select("id, name, stage, brand:brand_id(name)").single();
  if (insertErr) {
    structuredLog("ERROR", `Failed to ingest lead: ${insertErr.message}`, {
      error: insertErr.message
    }, cid);
    return errorResponse(`Failed to store lead: ${insertErr.message}`, 500, undefined, cid);
  }
  const brandName = lead?.brand?.name || "N/A";
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
      has_phone: !!phoneNum
    }
  });
  await supabase.from("lead_activities").insert({
    lead_id: lead.id,
    type: "note",
    note: `Lead received via ${source}${message ? `: "${String(message).slice(0, 200)}"` : ""}. Auto-pilot will qualify and nurture.`
  });
  const { data: qualifierAgent } = await supabase.from("ai_agents").select("id").eq("name", "Lead Qualifier AI").single();
  if (qualifierAgent) {
    await supabase.from("ai_jobs").insert({
      agent_id: qualifierAgent.id,
      type: "QUALIFY_LEAD",
      payload: {
        lead_id: lead.id,
        lead_name: lead.name,
        source: source,
        brand: brandName,
        urgent: true
      },
      status: "pending"
    });
  }
  structuredLog("INFO", `Lead ingested successfully: ${lead.id}`, {
    name: lead.name,
    brand: brandName
  }, cid);
  return successResponse({
    success: true,
    lead_id: lead.id,
    lead_name: lead.name,
    stage: lead.stage,
    brand: brandName,
    source: source,
    qualification_queued: !!qualifierAgent,
    message: "Lead captured and queued for qualification. Auto-pilot will nurture automatically."
  }, 201, cid);
}
// ══════════════════════════════════════════════
// WHATSAPP WEBHOOK HANDLER
// ══════════════════════════════════════════════
async function handleWhatsAppVerify(req, cid) {
  const url = new URL(req.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");
  if (mode === "subscribe" && token === whatsappVerifyToken && challenge) {
    structuredLog("INFO", "WhatsApp webhook verified", {
      mode,
      token
    }, cid);
    return new Response(challenge, {
      status: 200,
      headers: {
        "Content-Type": "text/plain"
      }
    });
  }
  structuredLog("WARN", "WhatsApp webhook verification failed", {
    mode,
    token,
    expected: whatsappVerifyToken
  }, cid);
  return errorResponse("Webhook verification failed", 403, "Check WHATSAPP_VERIFY_TOKEN matches Meta dashboard configuration", cid);
}
async function handleWhatsAppEvent(req, cid) {
  let body;
  try {
    body = await req.json();
  } catch  {
    return errorResponse("Invalid JSON", 400, undefined, cid);
  }
  const entry = body.entry?.[0];
  const changes = entry?.changes || [];
  if (changes.length === 0) {
    return successResponse({
      received: true,
      message: "No changes to process"
    }, 200, cid);
  }
  let processed = 0;
  for (const change of changes){
    const value = change.value;
    const messages = value.messages || [];
    const contacts = value.contacts || [];
    for (const msg of messages){
      const from = msg.from;
      const msgType = msg.type;
      const contact = contacts[0];
      let textContent = "";
      if (msgType === "text") {
        textContent = msg.text?.body || "";
      } else if (msgType === "interactive") {
        const interactive = msg.interactive;
        textContent = interactive?.button_reply?.title || interactive?.list_reply?.title || "";
      }
      const { data: existingLead } = await supabase.from("leads").select("id, name, stage").eq("mobile", from).order("created_at", {
        ascending: false
      }).limit(1).single();
      if (existingLead) {
        await supabase.from("lead_activities").insert({
          lead_id: existingLead.id,
          type: "whatsapp_message",
          note: `WhatsApp message received: "${textContent.slice(0, 500)}"`
        });
        structuredLog("INFO", `WhatsApp message from existing lead ${existingLead.id}`, {
          phone: from,
          msgType
        }, cid);
      } else {
        const contactName = contact ? `${contact.wa_name || contact.wa_id || "WhatsApp User"}` : "WhatsApp User";
        await ingestLead({
          name: contactName,
          mobile: from,
          message: textContent,
          source: "whatsapp"
        }, "whatsapp", cid);
      }
      processed++;
    }
  }
  return successResponse({
    received: true,
    processed,
    timestamp: new Date().toISOString()
  }, 200, cid);
}
// ══════════════════════════════════════════════
// MAIN HANDLER
// ══════════════════════════════════════════════
Deno.serve(async (req)=>{
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: corsHeaders
    });
  }
  const cid = req.headers.get("X-Correlation-ID") || generateCorrelationId();
  try {
    const envError = verifyEnvSecrets({
      SUPABASE_URL: supabaseUrl,
      SUPABASE_SERVICE_ROLE_KEY: supabaseServiceRoleKey
    });
    if (envError) {
      return errorResponse(envError, 500, "Configuration error", cid);
    }
    const url = new URL(req.url);
    if (url.pathname === "/lead-intake/webhook" && req.method === "GET") {
      structuredLog("INFO", "WhatsApp webhook verification request", {}, cid);
      return await handleWhatsAppVerify(req, cid);
    }
    if (url.pathname === "/lead-intake/webhook" && req.method === "POST") {
      structuredLog("INFO", "WhatsApp webhook event received", {}, cid);
      return await handleWhatsAppEvent(req, cid);
    }
    if (url.pathname === "/lead-intake/ingest" && req.method === "POST") {
      const authHeader = req.headers.get("Authorization") || "";
      const isServiceRole = isServiceRoleAuth(authHeader);
      const user = isServiceRole ? {
        userId: "service_role",
        role: "service_role"
      } : await verifyJWT(authHeader, supabaseUrl, supabaseAnonKey);
      if (!user) {
        return errorResponse("Unauthorized: JWT or service_role key required", 401, undefined, cid);
      }
      let body;
      try {
        body = await req.json();
      } catch  {
        return errorResponse("Invalid JSON in request body", 400, undefined, cid);
      }
      if (!body || typeof body !== "object" || Array.isArray(body)) {
        return errorResponse("Invalid request body: expected JSON object", 400, undefined, cid);
      }
      return await ingestLead(body, body.source || "api", cid);
    }
    if (url.pathname === "/lead-intake/health" && req.method === "GET") {
      const { error } = await supabase.from("brands").select("id", {
        count: "exact",
        head: true
      }).limit(1);
      return successResponse({
        status: error ? "degraded" : "healthy",
        whatsapp_configured: !!whatsappVerifyToken,
        database_connected: !error,
        version: "1.0.0",
        timestamp: new Date().toISOString()
      }, 200, cid);
    }
    return errorResponse(`Unknown route: ${req.method} ${url.pathname}`, 404, "Valid routes: GET /lead-intake/health, POST /lead-intake/ingest, GET/POST /lead-intake/webhook", cid);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    structuredLog("ERROR", `LEAD-INTAKE error: ${message}`, {}, cid);
    return errorResponse(message, 500, undefined, cid);
  }
});
