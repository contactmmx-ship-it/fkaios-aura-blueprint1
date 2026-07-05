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
const META_WEBHOOK_VERIFY_TOKEN = Deno.env.get("META_WEBHOOK_VERIFY_TOKEN") ?? "";

const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

// ──────────────────────────────────────────────
// GET: Meta webhook verification (kept as-is)
// ──────────────────────────────────────────────
function handleVerify(req: Request, cid: string): Response {
  const url = new URL(req.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");

  if (mode === "subscribe" && token === META_WEBHOOK_VERIFY_TOKEN && challenge) {
    structuredLog("INFO", "Meta webhook verification succeeded", { mode, token: token ? "***" : undefined }, cid);
    return new Response(challenge, {
      status: 200,
      headers: { "Content-Type": "text/plain" },
    });
  }

  structuredLog("WARN", "Meta webhook verification failed", { mode, hasToken: !!token, hasChallenge: !!challenge }, cid);

  return errorResponse("Verification failed", 403, undefined, cid);
}

// ──────────────────────────────────────────────
// Interfaces
// ──────────────────────────────────────────────
interface MetaFieldData {
  name: string;
  values: string[];
}

interface MetaChange {
  field: string;
  value: {
    leadgen_id: string;
    ad_id?: string;
    form_id?: string;
    created_time: number;
    field_data: MetaFieldData[];
  };
}

interface MetaEntry {
  id: string;
  time: number;
  changes: MetaChange[];
}

function extractFieldValue(fieldData: MetaFieldData[], fieldName: string): string {
  const field = fieldData.find(
    (f) => f.name.toLowerCase() === fieldName.toLowerCase() ||
           f.name.toLowerCase().replace(/_/g, " ") === fieldName.toLowerCase().replace(/_/g, " ") ||
           f.name.toLowerCase().replace(/\s/g, "_") === fieldName.toLowerCase().replace(/\s/g, "_")
  );
  return field?.values?.[0] ?? "";
}

// ──────────────────────────────────────────────
// Process Meta Lead Ads webhook
// ──────────────────────────────────────────────
async function processLeadGen(body: { entry: MetaEntry[] }, cid: string): Promise<Record<string, unknown>> {
  const results: Array<Record<string, unknown>> = [];

  structuredLog("INFO", "Processing Meta lead gen webhook", { entryCount: body.entry?.length ?? 0 }, cid);

  for (const entry of body.entry) {
    for (const change of entry.changes) {
      if (change.field !== "leadgen_id") {
        continue;
      }

      const value = change.value;
      const fieldData = value.field_data ?? [];

      const rawName = extractFieldValue(fieldData, "full_name") ||
                      extractFieldValue(fieldData, "name") ||
                      extractFieldValue(fieldData, "first_name");
      const email = extractFieldValue(fieldData, "email") ||
                    extractFieldValue(fieldData, "email_address");
      const phone = extractFieldValue(fieldData, "phone_number") ||
                    extractFieldValue(fieldData, "phone") ||
                    extractFieldValue(fieldData, "mobile");
      const city = extractFieldValue(fieldData, "city") ||
                   extractFieldValue(fieldData, "user_city");
      const state = extractFieldValue(fieldData, "state");
      const investmentCapacity = extractFieldValue(fieldData, "investment_capacity") ||
                                  extractFieldValue(fieldData, "budget");
      const brandInterest = extractFieldValue(fieldData, "brand_interest") ||
                            extractFieldValue(fieldData, "brand") ||
                            extractFieldValue(fieldData, "interested_in");

      const normalizedPhone = phone.replace(/[\s\-\+\(\)]/g, "").replace(/^91/, "");

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
          type: "meta_lead_ad",
          note: `Duplicate Meta Lead Ad submission (leadgen_id: ${value.leadgen_id})`,
        });

        results.push({
          leadgen_id: value.leadgen_id,
          status: "existing_lead",
          lead_id: existingLead.id,
          lead_name: existingLead.name,
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

      let brandId: string | null = null;
      if (brandInterest) {
        const { data: brand } = await supabase
          .from("brands")
          .select("id")
          .or(`name.ilike.%${brandInterest}%,slug.ilike.%${brandInterest.toLowerCase().replace(/\s+/g, "-")}%`)
          .limit(1)
          .maybeSingle();
        if (brand) brandId = brand.id;
      }

      const lastName = extractFieldValue(fieldData, "last_name");
      const fullName = lastName ? `${rawName} ${lastName}`.trim() : rawName.trim();

      const leadData: Record<string, unknown> = {
        name: fullName || "Meta Lead",
        mobile: normalizedPhone || null,
        email: email || null,
        city: city || null,
        state: state || null,
        source: "Meta Lead Ads",
        stage: "Inquiry",
        investment_capacity: investmentCapacity || null,
        brand_id: brandId,
        assigned_to: consultant?.id ?? null,
        notes: `Meta Lead Ad — leadgen_id: ${value.leadgen_id}, ad_id: ${value.ad_id ?? "N/A"}, form_id: ${value.form_id ?? "N/A"}`,
        is_active: true,
      };

      const { data: newLead, error: leadError } = await supabase
        .from("leads")
        .insert(leadData)
        .select("id, name, stage")
        .single();

      if (leadError || !newLead) {
        structuredLog("ERROR", "Failed to create lead from Meta webhook", { error: leadError?.message, leadgen_id: value.leadgen_id }, cid);
        results.push({
          leadgen_id: value.leadgen_id,
          status: "error",
          error: leadError?.message ?? "Failed to create lead",
        });
        continue;
      }

      await supabase.from("lead_activities").insert({
        lead_id: newLead.id,
        type: "meta_lead_ad",
        note: `Created from Meta Lead Ad (leadgen_id: ${value.leadgen_id})`,
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
          source: "Meta Lead Ads",
          leadgen_id: value.leadgen_id,
          ad_id: value.ad_id ?? "",
        },
        status: "pending",
      });

      if (qualifierAgent) {
        await supabase.from("agent_activity_log").insert({
          agent_id: qualifierAgent.id,
          activity_type: "task",
          title: `Qualify new Meta lead: ${newLead.name}`,
          description: `leadgen_id: ${value.leadgen_id}`,
          lead_id: newLead.id,
          metadata: { source: "Meta Lead Ads", webhook: true },
        });
      }

      results.push({
        leadgen_id: value.leadgen_id,
        status: "new_lead_created",
        lead_id: newLead.id,
        lead_name: newLead.name,
        assigned_to: consultant?.id ?? null,
      });
    }
  }

  structuredLog("INFO", "Meta lead gen processing complete", { processed: results.length }, cid);

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

    // POST = lead notification
    if (req.method === "POST") {
      let body: { entry?: MetaEntry[] };
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

      const result = await processLeadGen(body, cid);
      return successResponse({ success: true, ...result }, 200, cid);
    }

    return errorResponse("Method not allowed", 405, undefined, cid);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    return errorResponse(message, 500, undefined, cid);
  }
});
