// KNOWN BUG (found during repo-sync read-through, NOT fixed here — flagging
// rather than silently patching): extractLeadDataFromMeta() and
// extractLeadDataFromLinkedIn() below both build the `notes` field with a
// broken template literal. The intended `.slice(0, 300)` truncation sits
// OUTSIDE the ${...} interpolation, so it is never executed as code — it
// gets appended as literal text (the string ".slice(0, 300)}") onto the end
// of every notes value instead of truncating it. Not a crash, but silently
// corrupts data on every lead created through this specific webhook. Real
// fix: move the whole `Object.entries(...).map(...).join(" | ")` expression
// inside a single ${...} and call .slice(0, 300) on the resulting string
// before the closing `}`, not after.
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const metaVerifyToken = Deno.env.get("META_WEBHOOK_VERIFY_TOKEN") ?? "";
const metaAccessToken = Deno.env.get("META_ACCESS_TOKEN") ?? "";

const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function errorResponse(message: string, status = 500) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Webhook verification (GET request from Meta during setup)
async function handleVerify(req: Request) {
  const url = new URL(req.url);
  const mode = url.searchParams.get("hub.mode");
  const challenge = url.searchParams.get("hub.challenge");
  const token = url.searchParams.get("hub.verify_token");

  if (mode === "subscribe" && token === metaVerifyToken) {
    return new Response(challenge, { status: 200 });
  }
  return errorResponse("Verification failed", 403);
}

// Extract lead data from Meta Lead Ads form submission
function extractLeadDataFromMeta(leadData: Record<string, string>) {
  return {
    company_name: leadData.company_name || `Meta Lead ${Date.now()}`,
    contact_name: leadData.first_name || leadData.name || "Unknown",
    contact_email: leadData.email || null,
    contact_phone: leadData.phone_number || null,
    lead_source: "Meta Lead Ads",
    stage: "new",
    investment_capacity: leadData.investment_capacity || "Not specified",
    notes: `Meta form submission: ${Object.entries(leadData)
      .map(([k, v]) => `${k}: ${v}`)
      .join(" | ")}
      .slice(0, 300)}`,
  };
}

// Extract lead data from LinkedIn Lead Gen form submission
function extractLeadDataFromLinkedIn(leadData: Record<string, string>) {
  return {
    company_name: leadData.company || `LinkedIn Lead ${Date.now()}`,
    contact_name: leadData.firstName || leadData.name || "Unknown",
    contact_email: leadData.email || null,
    contact_phone: leadData.phoneNumber || null,
    lead_source: "LinkedIn Lead Gen",
    stage: "new",
    investment_capacity: leadData.investmentCapacity || "Not specified",
    notes: `LinkedIn form submission: ${Object.entries(leadData)
      .map(([k, v]) => `${k}: ${v}`)
      .join(" | ")}
      .slice(0, 300)}`,
  };
}

// Main webhook handler (POST from Meta/LinkedIn with lead data)
async function handleWebhook(req: Request) {
  const body = await req.json();

  // Detect source from request headers or body metadata
  const userAgent = req.headers.get("user-agent") || "";
  const isLinkedIn = userAgent.includes("LinkedIn") || body.source === "linkedin";
  const isMeta = body.source === "meta" || userAgent.includes("Facebook");

  if (!isLinkedIn && !isMeta) {
    // Default to Meta if no clear indicator
    return await handleMetaLead(body);
  }

  if (isLinkedIn) {
    return await handleLinkedInLead(body);
  }

  return await handleMetaLead(body);
}

async function handleMetaLead(body: Record<string, unknown>) {
  // Meta Lead Ads sends form field values in a specific format
  const leadFields = body.entry?.[0]?.changes?.[0]?.value?.lead_data?.field_data || [];
  const leadData: Record<string, string> = {};

  // Convert Meta's field format to flat key-value
  if (Array.isArray(leadFields)) {
    for (const field of leadFields) {
      const f = field as Record<string, unknown>;
      leadData[String(f.name || "")] = String(f.value || "");
    }
  }

  if (Object.keys(leadData).length === 0) {
    return jsonResponse({ success: true }); // Silent ignore if no data
  }

  const extracted = extractLeadDataFromMeta(leadData);

  // Get Turning Point brand
  const { data: brand } = await supabase
    .from("brands")
    .select("id")
    .eq("name", "Turning Point")
    .single();

  if (!brand) {
    return errorResponse("Brand not found", 500);
  }

  // Create lead
  const { data: lead, error: leadError } = await supabase
    .from("leads")
    .insert({ brand_id: brand.id, ...extracted })
    .select()
    .single();

  if (leadError || !lead) {
    console.error("Lead creation failed:", leadError);
    return errorResponse(`Failed to create lead: ${leadError?.message}`, 500);
  }

  // Queue Lead Qualifier job
  const { data: qualifierAgent } = await supabase
    .from("ai_agents")
    .select("id")
    .eq("name", "Lead Qualifier")
    .single();

  if (qualifierAgent) {
    await supabase.from("ai_jobs").insert({
      agent_id: qualifierAgent.id,
      type: "QUALIFY_LEAD",
      payload: {
        lead_id: lead.id,
        lead_data: lead,
        source: "Meta Lead Ads",
      },
    });
  }

  // Log activity
  await supabase.from("lead_activities").insert({
    lead_id: lead.id,
    activity_type: "note",
    description: `Lead captured via Meta Lead Ads form submission`,
  });

  return jsonResponse({
    success: true,
    lead_id: lead.id,
  });
}

async function handleLinkedInLead(body: Record<string, unknown>) {
  // LinkedIn Lead Gen sends form data differently
  const formData = body.formSubmission?.leadFormSubmission || body.leadFormSubmission || {};
  const leadData: Record<string, string> = {};

  // Extract from LinkedIn's format
  if (formData.answers) {
    const answers = formData.answers as Array<Record<string, unknown>>;
    for (const ans of answers) {
      const key = String(ans.question || "").toLowerCase().replace(/ /g, "_");
      const val = ans.value || ans.text;
      if (key && val) {
        leadData[key] = String(val);
      }
    }
  }

  // LinkedIn also provides direct fields
  if (formData.firstName) leadData.firstName = String(formData.firstName);
  if (formData.lastName) leadData.lastName = String(formData.lastName);
  if (formData.email) leadData.email = String(formData.email);
  if (formData.phoneNumber) leadData.phoneNumber = String(formData.phoneNumber);
  if (formData.company) leadData.company = String(formData.company);

  if (Object.keys(leadData).length === 0) {
    return jsonResponse({ success: true }); // Silent ignore
  }

  const extracted = extractLeadDataFromLinkedIn(leadData);

  // Get Turning Point brand
  const { data: brand } = await supabase
    .from("brands")
    .select("id")
    .eq("name", "Turning Point")
    .single();

  if (!brand) {
    return errorResponse("Brand not found", 500);
  }

  // Create lead
  const { data: lead, error: leadError } = await supabase
    .from("leads")
    .insert({ brand_id: brand.id, ...extracted })
    .select()
    .single();

  if (leadError || !lead) {
    console.error("Lead creation failed:", leadError);
    return errorResponse(`Failed to create lead: ${leadError?.message}`, 500);
  }

  // Queue Lead Qualifier job
  const { data: qualifierAgent } = await supabase
    .from("ai_agents")
    .select("id")
    .eq("name", "Lead Qualifier")
    .single();

  if (qualifierAgent) {
    await supabase.from("ai_jobs").insert({
      agent_id: qualifierAgent.id,
      type: "QUALIFY_LEAD",
      payload: {
        lead_id: lead.id,
        lead_data: lead,
        source: "LinkedIn Lead Gen",
      },
    });
  }

  // Log activity
  await supabase.from("lead_activities").insert({
    lead_id: lead.id,
    activity_type: "note",
    description: `Lead captured via LinkedIn Lead Gen form submission`,
  });

  return jsonResponse({
    success: true,
    lead_id: lead.id,
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    if (req.method === "GET") {
      return await handleVerify(req);
    }

    if (req.method === "POST") {
      return await handleWebhook(req);
    }

    return errorResponse("Method not allowed", 405);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal error";
    console.error("Webhook error:", message);
    return errorResponse(message, 500);
  }
});
