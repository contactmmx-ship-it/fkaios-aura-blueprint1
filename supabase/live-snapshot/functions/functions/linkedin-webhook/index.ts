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
const LINKEDIN_WEBHOOK_VERIFY_TOKEN = Deno.env.get("LINKEDIN_WEBHOOK_VERIFY_TOKEN") ?? "";

const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

// ──────────────────────────────────────────────
// Verify LinkedIn webhook via Authorization header (kept as-is)
// ──────────────────────────────────────────────
function verifyLinkedInAuth(req: Request): boolean {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return false;

  const token = authHeader.startsWith("Bearer ")
    ? authHeader.slice(7).trim()
    : authHeader.trim();

  return token === LINKEDIN_WEBHOOK_VERIFY_TOKEN;
}

// ──────────────────────────────────────────────
// Interfaces
// ──────────────────────────────────────────────
interface LinkedInFieldData {
  fieldDefinitionId: string;
  values: string[];
}

interface LinkedInData {
  fieldData?: LinkedInFieldData[];
}

interface LinkedInPayload {
  event?: string;
  owner?: string;
  leadFormId?: string;
  leadGenFormResponseId?: string;
  submittedAt?: number;
  schemaVersion?: string;
  data?: LinkedInData;
  test?: boolean;
}

function extractField(fieldData: LinkedInFieldData[], fieldId: string): string {
  const field = fieldData.find(
    (f) => f.fieldDefinitionId.toLowerCase() === fieldId.toLowerCase()
  );
  return field?.values?.[0] ?? "";
}

// ──────────────────────────────────────────────
// Process LinkedIn lead (business logic unchanged)
// ──────────────────────────────────────────────
async function processLinkedInLead(payload: LinkedInPayload, cid: string): Promise<Record<string, unknown>> {
  if (payload.test) {
    structuredLog("INFO", "LinkedIn test event acknowledged", {}, cid);
    return { status: "test_received", message: "LinkedIn webhook test event acknowledged" };
  }

  const fieldData = payload.data?.fieldData ?? [];

  const firstName = extractField(fieldData, "firstName");
  const lastName = extractField(fieldData, "lastName");
  const email = extractField(fieldData, "email");
  const phone = extractField(fieldData, "phone") ||
                extractField(fieldData, "phoneNumber") ||
                extractField(fieldData, "mobilePhone");
  const city = extractField(fieldData, "city") ||
               extractField(fieldData, "userCity");
  const state = extractField(fieldData, "state");
  const company = extractField(fieldData, "company") ||
                  extractField(fieldData, "companyName");
  const jobTitle = extractField(fieldData, "jobTitle") ||
                   extractField(fieldData, "title");
  const investmentCapacity = extractField(fieldData, "investmentCapacity") ||
                              extractField(fieldData, "budget") ||
                              extractField(fieldData, "investmentRange");
  const notes = extractField(fieldData, "notes") ||
                extractField(fieldData, "message") ||
                extractField(fieldData, "comments");

  const normalizedPhone = phone.replace(/[\s\-\+\(\)]/g, "").replace(/^91/, "");
  const fullName = [firstName, lastName].filter(Boolean).join(" ").trim();

  structuredLog("INFO", "Processing LinkedIn lead", { name: fullName, email, phone: normalizedPhone, responseId: payload.leadGenFormResponseId }, cid);

  let existingLead = null;

  if (normalizedPhone) {
    const { data: byPhone } = await supabase
      .from("leads")
      .select("id, name, stage")
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
      .select("id, name, stage")
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
      type: "linkedin_lead_gen",
      note: `Duplicate LinkedIn Lead Gen submission (response_id: ${payload.leadGenFormResponseId ?? "N/A"})`,
    });

    structuredLog("INFO", "LinkedIn lead matched existing", { leadId: existingLead.id }, cid);

    return {
      status: "existing_lead",
      lead_id: existingLead.id,
      lead_name: existingLead.name,
      stage: existingLead.stage,
      linkedin_response_id: payload.leadGenFormResponseId ?? null,
    };
  }

  const { data: consultant } = await supabase
    .from("consultants")
    .select("id")
    .eq("is_active", true)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  const notesParts: string[] = [];
  if (company) notesParts.push(`Company: ${company}`);
  if (jobTitle) notesParts.push(`Title: ${jobTitle}`);
  if (notes) notesParts.push(notes);
  notesParts.push(
    `LinkedIn Lead Gen — form_id: ${payload.leadFormId ?? "N/A"}, response_id: ${payload.leadGenFormResponseId ?? "N/A"}`
  );

  const leadData: Record<string, unknown> = {
    name: fullName || "LinkedIn Lead",
    mobile: normalizedPhone || null,
    email: email || null,
    city: city || null,
    state: state || null,
    source: "LinkedIn Lead Gen",
    stage: "Inquiry",
    investment_capacity: investmentCapacity || null,
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
    structuredLog("ERROR", "Failed to create lead from LinkedIn webhook", { error: leadError?.message, responseId: payload.leadGenFormResponseId }, cid);
    return {
      status: "error",
      error: leadError?.message ?? "Failed to create lead",
      linkedin_response_id: payload.leadGenFormResponseId ?? null,
    };
  }

  await supabase.from("lead_activities").insert({
    lead_id: newLead.id,
    type: "linkedin_lead_gen",
    note: `Created from LinkedIn Lead Gen (response_id: ${payload.leadGenFormResponseId ?? "N/A"})`,
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
      investment_capacity: investmentCapacity || "",
      source: "LinkedIn Lead Gen",
      company: company || "",
      job_title: jobTitle || "",
      linkedin_response_id: payload.leadGenFormResponseId ?? "",
    },
    status: "pending",
  });

  if (qualifierAgent) {
    await supabase.from("agent_activity_log").insert({
      agent_id: qualifierAgent.id,
      activity_type: "task",
      title: `Qualify new LinkedIn lead: ${newLead.name}`,
      description: `response_id: ${payload.leadGenFormResponseId ?? "N/A"}`,
      lead_id: newLead.id,
      metadata: { source: "LinkedIn Lead Gen", webhook: true },
    });
  }

  structuredLog("INFO", "New lead created from LinkedIn webhook", { leadId: newLead.id, name: newLead.name }, cid);

  return {
    status: "new_lead_created",
    lead_id: newLead.id,
    lead_name: newLead.name,
    assigned_to: consultant?.id ?? null,
    linkedin_response_id: payload.leadGenFormResponseId ?? null,
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

    // Verify authentication (kept as-is: Bearer token auth)
    if (!verifyLinkedInAuth(req)) {
      structuredLog("WARN", "LinkedIn webhook unauthorized: invalid or missing token", {}, cid);
      return errorResponse("Unauthorized — invalid or missing token", 401, undefined, cid);
    }

    if (req.method !== "POST") {
      return errorResponse("Method not allowed", 405, undefined, cid);
    }

    let body: LinkedInPayload;
    try {
      body = await req.json();
    } catch {
      // Empty body is allowed for test events
      return successResponse({ success: true, message: "Empty payload acknowledged" }, 200, cid);
    }

    if (!body) {
      return successResponse({ success: true, message: "Empty payload acknowledged" }, 200, cid);
    }

    const result = await processLinkedInLead(body, cid);
    return successResponse({ success: true, ...result }, 200, cid);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    return errorResponse(message, 500, undefined, cid);
  }
});