import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  correlationId,
  structuredLog,
  errorResponse,
  successResponse,
  verifyEnvSecrets,
} from "../_shared/utils.ts";

function parseInvestment(val: unknown): number {
  if (typeof val === "number") return val;
  if (!val) return 0;
  const s = String(val);
  const nums = s.match(/[\d.]+/g);
  if (nums && nums.length > 0) {
    if (s.toLowerCase().includes("cr") || s.toLowerCase().includes("crore")) return parseFloat(nums[0]) * 10000000;
    if (s.toLowerCase().includes("l") || s.toLowerCase().includes("lac") || s.toLowerCase().includes("lakh")) return parseFloat(nums[0]) * 100000;
    return parseFloat(nums[0]);
  }
  return 0;
}

async function verifyJWTSignature(token: string): Promise<Record<string, unknown> | null> {
  const jwtSecret = Deno.env.get("JWT_SECRET");
  if (!jwtSecret) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [headerB64, payloadB64, signatureB64] = parts;
  try {
    const headerStr = atob(headerB64.replace(/-/g, "+").replace(/_/g, "/"));
    const header = JSON.parse(headerStr);
    if (header.alg !== "HS256") return null;
    const keyData = new TextEncoder().encode(jwtSecret);
    const cryptoKey = await crypto.subtle.importKey("raw", keyData, { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
    const signingInput = new TextEncoder().encode(headerB64 + "." + payloadB64);
    const sigBytes = Uint8Array.from(atob(signatureB64.replace(/-/g, "+").replace(/_/g, "/")), function (c) { return c.charCodeAt(0); });
    const valid = await crypto.subtle.verify("HMAC", cryptoKey, sigBytes, signingInput);
    if (!valid) return null;
    const payloadStr = atob(payloadB64.replace(/-/g, "+").replace(/_/g, "/"));
    const payload = JSON.parse(payloadStr);
    if (payload.exp && payload.exp < Date.now() / 1000) return null;
    return payload;
  } catch (_e) { return null; }
}

const corsHeaders = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-heartbeat-secret" };
const TIER1_CITIES = ["Mumbai","Delhi","Bangalore","Hyderabad","Chennai","Pune","Kolkata","Ahmedabad"];

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const cid = correlationId();
  try {
    const heartbeatSecret = Deno.env.get("HEARTBEAT_SECRET");
    const providedSecret = req.headers.get("x-heartbeat-secret") ?? new URL(req.url).searchParams.get("secret");
    const secretOk = !!heartbeatSecret && providedSecret === heartbeatSecret;

    if (!secretOk) {
      const authHeader = req.headers.get("Authorization");
      if (!authHeader || !authHeader.startsWith("Bearer ")) return errorResponse("Missing Authorization header (or ?secret=)", 401, undefined, cid);
      const token = authHeader.slice(7);
      const payload = await verifyJWTSignature(token);
      if (!payload) return errorResponse("JWT verification failed", 401, undefined, cid);
      const role = payload.role || payload.user_role;
      if (role !== "service_role") return errorResponse("Forbidden: service_role required", 403, String(role || "none"), cid);
    }

    const envErr = verifyEnvSecrets({ SUPABASE_URL: Deno.env.get("SUPABASE_URL"), SUPABASE_SERVICE_ROLE_KEY: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") });
    if (envErr) return errorResponse("Environment error: " + envErr, 500, undefined, cid);
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    structuredLog("INFO", "Auto-pilot V4 started", undefined, cid);
    const results = { qualified: 0, nurtured: 0, proposed: 0, marketed: 0 };

    const { data: newLeads, error: newErr } = await supabase.from("leads").select("*").eq("stage", "new").eq("is_active", true);
    if (!newErr && newLeads && newLeads.length > 0) {
      for (let i = 0; i < newLeads.length; i++) {
        const lead = newLeads[i];
        let score = 0;
        const inv = parseInvestment(lead.investment_capacity);
        if (inv >= 500000) score += 30;
        else if (inv >= 200000) score += 20;
        else if (inv > 0) score += 10;
        if (lead.city && TIER1_CITIES.indexOf(lead.city) !== -1) score += 20;
        else if (lead.city) score += 10;
        if (lead.source === "website" || lead.source === "referral") score += 15;
        else if (lead.source === "whatsapp" || lead.source === "form") score += 10;
        else if (lead.source) score += 5;
        if (lead.contact_email) score += 10;
        if (lead.contact_phone) score += 10;
        if (lead.company_name) score += 5;
        const { error: scoreErr } = await supabase.from("leads").update({ lead_score: score, updated_at: new Date().toISOString() }).eq("id", lead.id);
        if (scoreErr) { structuredLog("ERROR", "Score failed lead " + lead.id, undefined, cid); continue; }
        if (score >= 40) {
          const { error: pErr } = await supabase.from("leads").update({ stage: "contacted" }).eq("id", lead.id);
          if (!pErr) { results.qualified++; structuredLog("INFO", "Lead " + lead.id + " scored " + score + " -> contacted", undefined, cid); }
        }
      }
    }

    const { data: nurtureLeads, error: nurtureErr } = await supabase.from("leads").select("*").in("stage", ["contacted", "qualified"]).eq("is_active", true);
    if (!nurtureErr && nurtureLeads && nurtureLeads.length > 0) {
      for (let i = 0; i < nurtureLeads.length; i++) {
        const lead = nurtureLeads[i];
        if (lead.stage === "contacted" && lead.lead_score >= 55) {
          await supabase.from("leads").update({ stage: "qualified", updated_at: new Date().toISOString() }).eq("id", lead.id);
        }
        const { data: existingJobs } = await supabase.from("ai_jobs").select("id").eq("lead_id", lead.id).eq("type", "follow_up").eq("status", "pending").limit(1);
        if (existingJobs && existingJobs.length > 0) continue;
        const { error: jErr } = await supabase.from("ai_jobs").insert({ lead_id: lead.id, type: "follow_up", status: "pending", payload: { action: "send_follow_up", contact_name: lead.contact_name || "", contact_phone: lead.contact_phone || "", contact_email: lead.contact_email || "", company_name: lead.company_name || "", stage: lead.stage } });
        if (!jErr) { results.nurtured++; structuredLog("INFO", "Follow-up queued for " + (lead.contact_name || "unnamed"), undefined, cid); }
      }
    }

    const { data: hsLeads, error: hsErr } = await supabase.from("leads").select("*").eq("stage", "qualified").eq("is_active", true).gte("lead_score", 60);
    if (!hsErr && hsLeads && hsLeads.length > 0) {
      for (let i = 0; i < hsLeads.length; i++) {
        const lead = hsLeads[i];
        const { data: existing } = await supabase.from("ai_jobs").select("id").eq("lead_id", lead.id).eq("type", "approval_required").eq("status", "pending").limit(1);
        if (existing && existing.length > 0) continue;
        const { error: sErr } = await supabase.from("leads").update({ stage: "proposal_sent", updated_at: new Date().toISOString() }).eq("id", lead.id);
        if (sErr) continue;
        const { error: aErr } = await supabase.from("ai_jobs").insert({
          lead_id: lead.id, type: "approval_required", status: "pending",
          payload: { action: "human_approval_required", contact_name: lead.contact_name || "", company_name: lead.company_name || "", contact_email: lead.contact_email || "", contact_phone: lead.contact_phone || "", lead_score: lead.lead_score || 0, investment_capacity: lead.investment_capacity || "N/A", city: lead.city || "", source: lead.source || "", message: "Lead " + (lead.contact_name || "unnamed") + " from " + (lead.company_name || "unknown") + " scored " + (lead.lead_score || 0) + ". HUMAN REVIEW REQUIRED." }
        });
        if (!aErr) { results.proposed++; structuredLog("INFO", "Approval task for " + (lead.contact_name || "unnamed") + " -> proposal_sent", undefined, cid); }
      }
    }

    const { data: closedLeads, error: cErr } = await supabase.from("leads").select("*").eq("stage", "closed").eq("is_active", true);
    if (!cErr && closedLeads && closedLeads.length > 0) {
      for (let i = 0; i < closedLeads.length; i++) {
        const lead = closedLeads[i];
        const { data: exM } = await supabase.from("ai_jobs").select("id").eq("lead_id", lead.id).eq("type", "marketing_content").eq("status", "pending").limit(1);
        if (exM && exM.length > 0) continue;
        const { error: mErr } = await supabase.from("ai_jobs").insert({ lead_id: lead.id, type: "marketing_content", status: "pending", payload: { action: "generate_welcome_kit", company_name: lead.company_name || "", contact_name: lead.contact_name || "", city: lead.city || "" } });
        if (!mErr) { results.marketed++; structuredLog("INFO", "Marketing job for " + (lead.company_name || "unnamed"), undefined, cid); }
      }
    }

    structuredLog("INFO", "Auto-pilot V4 complete", { qualified: results.qualified, nurtured: results.nurtured, proposed: results.proposed, marketed: results.marketed }, cid);
    return successResponse({ status: "ok", processed: results, timestamp: new Date().toISOString() }, 200, cid);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    structuredLog("ERROR", "Auto-pilot error: " + msg, undefined, cid);
    return errorResponse("Internal error: " + msg, 500, undefined, cid);
  }
});
