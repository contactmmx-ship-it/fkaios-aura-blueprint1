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
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey, X-Api-Key, X-Correlation-ID",
};

// ──────────────────────────────────────────────
// Environment & Client Setup
// ──────────────────────────────────────────────
const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const CRM_WEBHOOK_SECRET = Deno.env.get("CRM_WEBHOOK_SECRET") ?? "";

const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

// ──────────────────────────────────────────────
// Verify CRM webhook via API key (kept as-is)
// ──────────────────────────────────────────────
function verifyCRMWebhook(req: Request): boolean {
  if (!CRM_WEBHOOK_SECRET) {
    return true; // Dev mode
  }

  const apiKeyHeader = req.headers.get("X-API-Key");
  if (apiKeyHeader && apiKeyHeader === CRM_WEBHOOK_SECRET) {
    return true;
  }

  const authHeader = req.headers.get("Authorization");
  if (authHeader) {
    const token = authHeader.startsWith("Bearer ")
      ? authHeader.slice(7).trim()
      : authHeader.trim();
    if (token === CRM_WEBHOOK_SECRET) {
      return true;
    }
  }

  const url = new URL(req.url);
  const queryKey = url.searchParams.get("api_key");
  if (queryKey && queryKey === CRM_WEBHOOK_SECRET) {
    return true;
  }

  return false;
}

// ──────────────────────────────────────────────
// Expected payload interface
// ──────────────────────────────────────────────
interface CRMPayload {
  name?: string;
  email?: string;
  phone?: string;
  city?: string;
  state?: string;
  source?: string;
  brand_id?: string;
  investment_capacity?: string;
  notes?: string;
}

// ──────────────────────────────────────────────
// Process CRM Lead (business logic unchanged)
// ──────────────────────────────────────────────
async function processCRMLead(payload: CRMPayload, cid: string): Promise<Record<string, unknown>> {
  const { name, email, phone, city, state, source, brand_id, investment_capacity, notes } = payload;

  if (!name && !phone) {
    structuredLog("WARN", "CRM lead rejected: missing name and phone", { source }, cid);
    return {
      status: "error",
      error: "Validation failed: at least 'name' or 'phone' is required",
    };
  }

  structuredLog("INFO", "Processing CRM lead", { name, phone, email, source, brand_id }, cid);

  let normalizedPhone: string | null = null;
  if (phone) {
    normalizedPhone = phone.replace(/[\s\-\+\(\)]/g, "").replace(/^91/, "");
  }

  let existingLead = null;

  if (normalizedPhone) {
    const { data: byPhone } = await supabase
      .from("leads")
      .select("id, name, stage, mobile, email")
      .eq("mobile", normalizedPhone)
      .eq("is_active", true)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    existingLead = byPhone;
  }

  if (!existingLead && email) {
    const { data: byEmail } = await supabase
      .from("leads")
      .select("id, name, stage, mobile, email")
      .eq("email", email)
      .eq("is_active", true)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    existingLead = byEmail;
  }

  if (existingLead) {
    await supabase.from("lead_activities").insert({
      lead_id: existingLead.id,
      type: "crm_webhook",
      note: `CRM webhook duplicate: ${source ?? "CRM"} submission for existing lead`,
    });

    structuredLog("INFO", "CRM lead matched existing lead", { leadId: existingLead.id, phone: normalizedPhone, email }, cid);

    return {
      status: "existing_lead",
      lead_id: existingLead.id,
      lead_name: existingLead.name,
      stage: existingLead.stage,
    };
  }

  const { data: consultant } = await supabase
    .from("consultants")
    .select("id")
    .eq("is_active", true)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  let resolvedBrandId: string | null = null;
  if (brand_id) {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (uuidRegex.test(brand_id)) {
      resolvedBrandId = brand_id;
    } else {
      const { data: brand } = await supabase
        .from("brands")
        .select("id")
        .eq("slug", brand_id.toLowerCase().replace(/\s+/g, "-"))
        .limit(1)
        .maybeSingle();
      if (brand) resolvedBrandId = brand.id;
    }
  }

  const notesParts: string[] = [];
  if (notes) notesParts.push(notes);
  notesParts.push(`Source: ${source ?? "CRM Webhook"}`);

  const leadData: Record<string, unknown> = {
    name: (name || "CRM Lead").trim(),
    mobile: normalizedPhone,
    email: email || null,
    city: city || null,
    state: state || null,
    source: source || "CRM Webhook",
    stage: "Inquiry",
    investment_capacity: investment_capacity || null,
    brand_id: resolvedBrandId,
    assigned_to: consultant?.id ?? null,
    notes: notesParts.join("\n"),
    is_active: true,
  };

  const { data: newLead, error: leadError } = await supabase
    .from("leads")
    .insert(leadData)
    .select("id, name, stage")
    .single();

  if (leadError || !newLead) {
    structuredLog("ERROR", "Failed to create lead from CRM webhook", { error: leadError?.message }, cid);
    return {
      status: "error",
      error: leadError?.message ?? "Failed to create lead",
    };
  }

  await supabase.from("lead_activities").insert({
    lead_id: newLead.id,
    type: "crm_webhook",
    note: `Created from CRM Webhook (source: ${source ?? "CRM Webhook"})`,
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
      email: email || "",
      phone: normalizedPhone || "",
      city: city || "",
      state: state || "",
      investment_capacity: investment_capacity || "",
      source: source || "CRM Webhook",
      brand_id: resolvedBrandId ?? "",
    },
    status: "pending",
  });

  if (qualifierAgent) {
    await supabase.from("agent_activity_log").insert({
      agent_id: qualifierAgent.id,
      activity_type: "task",
      title: `Qualify new CRM lead: ${newLead.name}`,
      description: `Source: ${source ?? "CRM Webhook"}`,
      lead_id: newLead.id,
      metadata: { source: source ?? "CRM Webhook", webhook: true },
    });
  }

  structuredLog("INFO", "New lead created from CRM webhook", { leadId: newLead.id, name: newLead.name }, cid);

  return {
    status: "new_lead_created",
    lead_id: newLead.id,
    lead_name: newLead.name,
    assigned_to: consultant?.id ?? null,
  };
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

    // Verify API key (kept as-is)
    if (!verifyCRMWebhook(req)) {
      structuredLog("WARN", "CRM webhook unauthorized: invalid or missing API key", {}, cid);
      return errorResponse("Unauthorized — invalid or missing API key", 401, undefined, cid);
    }

    if (req.method !== "POST") {
      return errorResponse("Method not allowed", 405, undefined, cid);
    }

    // Parse and validate body
    let body: CRMPayload;
    try {
      body = await req.json();
      if (!body || typeof body !== "object" || Array.isArray(body)) {
        return errorResponse("Invalid payload: expected JSON object", 400, undefined, cid);
      }
    } catch {
      return errorResponse("Invalid JSON in request body", 400, undefined, cid);
    }

    // Validate string fields
    if (body.name && typeof body.name !== "string") {
      return errorResponse("Field 'name' must be a string", 400, undefined, cid);
    }
    if (body.email && typeof body.email !== "string") {
      return errorResponse("Field 'email' must be a string", 400, undefined, cid);
    }
    if (body.phone && typeof body.phone !== "string") {
      return errorResponse("Field 'phone' must be a string", 400, undefined, cid);
    }

    const result = await processCRMLead(body, cid);
    const statusCode = result.status === "error" ? 400 : 200;
    return successResponse({ success: result.status !== "error", ...result }, statusCode, cid);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    return errorResponse(message, 500, undefined, cid);
  }
});
