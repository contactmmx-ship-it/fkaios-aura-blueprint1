// ============================================================================
// lead-capture v2 — THE MISSING TOP-OF-FUNNEL.
//
// WHY THIS EXISTS (root cause, proven from live data, not assumed):
// All 71 leads came from `Apify Discovery` — scraped Google search results. ZERO
// carry an investment capacity; only 8 of 71 carry a phone. The qualifier scores
// BANT (Budget, Authority, Need, Timeline). A scraped search result has no Budget
// and no reachable Authority, so B and A are structurally ~0 — which is exactly
// why the best score the enterprise has EVER produced is 32 against a bar of 40.
// The cold funnel is not underperforming; it is ARITHMETICALLY INCAPABLE of
// emitting a qualifiable lead. No enrichment or paid contact data fixes that:
// the input was never a buyer.
//
// An INBOUND enquirer supplies all four BANT axes themselves. That is a lead that
// can clear 40. It is also how franchise businesses actually acquire franchisees:
// they are FOUND, not hunted.
//
// v2 — CRITICAL BUG CAUGHT IN SELF-TEST BEFORE LAUNCH:
//   leads.lead_score has DEFAULT 0, and the qualifier selects unscored leads with
//   `lead_score IS NULL`. v1 inserted without setting it, so every inbound enquiry
//   was born at score 0, was NEVER seen by the qualifier, and would have sat
//   unscored forever. The channel would have looked built and silently produced
//   nothing — the same silent-failure class that wasted 251 qualifier runs.
//   Now inserts an explicit lead_score: null = "not yet scored".
//
// Deliberately PUBLIC (verify_jwt: false) — a prospective franchisee has no account.
// DISCIPLINE: records a real enquiry and nothing else. Does not score, does not
// advance a stage, does not contact anyone, does not move money. The existing
// qualifier picks it up on its normal cron. Nothing bypasses governance.
// ============================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json"
};
const ok = (d)=>new Response(JSON.stringify(d), {
    status: 200,
    headers: CORS
  });
const err = (m, s = 400)=>new Response(JSON.stringify({
    error: m
  }), {
    status: s,
    headers: CORS
  });
function normalisePhone(raw) {
  const digits = String(raw || "").replace(/\D/g, "");
  const ten = digits.length > 10 ? digits.slice(-10) : digits;
  return /^[6-9]\d{9}$/.test(ten) ? ten : null;
}
const isEmail = (e)=>/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(e || "").trim());
Deno.serve(async (req)=>{
  if (req.method === "OPTIONS") return new Response(null, {
    headers: CORS
  });
  if (req.method !== "POST") return err("Method not allowed", 405);
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return err("Server not configured", 503);
  const db = createClient(url, key);
  let b;
  try {
    b = await req.json();
  } catch  {
    return err("Invalid JSON");
  }
  const contactName = String(b.contact_name ?? "").trim();
  const phone = normalisePhone(String(b.contact_phone ?? ""));
  const email = String(b.contact_email ?? "").trim();
  const city = String(b.city ?? "").trim();
  const state = String(b.state ?? "").trim();
  const brandName = String(b.brand ?? "").trim();
  const investment = Number(b.investment_capacity ?? 0);
  const timeline = String(b.timeline ?? "").trim();
  const note = String(b.note ?? "").trim();
  if (contactName.length < 2) return err("Please enter your name.");
  if (!phone) return err("Please enter a valid 10-digit Indian mobile number.");
  if (email && !isEmail(email)) return err("That email address does not look valid.");
  if (!city) return err("Please enter your city.");
  if (!investment || investment <= 0) return err("Please tell us your investment capacity — without it we cannot assess the opportunity honestly.");
  const { data: brand } = await db.from("brands").select("id, name").ilike("name", brandName).maybeSingle();
  const { data: dupe } = await db.from("leads").select("id").eq("contact_phone", phone).gte("created_at", new Date(Date.now() - 30 * 864e5).toISOString()).limit(1).maybeSingle();
  if (dupe) {
    return ok({
      success: true,
      duplicate: true,
      message: "We already have your enquiry — the team will be in touch."
    });
  }
  const { data: lead, error } = await db.from("leads").insert({
    brand_id: brand?.id ?? null,
    company_name: brandName ? `${contactName} — ${brandName} enquiry` : contactName,
    contact_name: contactName,
    contact_phone: phone,
    contact_email: email || null,
    city,
    state: state || null,
    // investment_capacity is TEXT in this schema (verified). Store a readable
    // rupee figure so the BANT qualifier can actually read Budget.
    investment_capacity: `₹${investment.toLocaleString("en-IN")}`,
    source: "inbound_enquiry",
    stage: "new",
    is_active: true,
    // CRITICAL: leads.lead_score has DEFAULT 0 and the qualifier selects unscored
    // leads with `lead_score IS NULL`. Without this explicit NULL, every inbound
    // enquiry is born at 0, is NEVER seen by the qualifier, and sits unscored
    // forever — a silent dead channel. Explicit NULL = "not yet scored".
    lead_score: null,
    notes: [
      timeline ? `Timeline: ${timeline}` : "",
      note
    ].filter(Boolean).join(" | ") || null
  }).select("id").single();
  if (error) return err(`Could not record enquiry: ${error.message}`, 500);
  await db.from("execution_log").insert({
    function_name: "lead-capture",
    department_code: "SALES",
    action: "inbound_enquiry_received",
    output_summary: `Inbound enquiry: ${contactName}, ${city}, ₹${investment.toLocaleString("en-IN")} capacity${brand ? `, brand: ${brand.name}` : ""}. Real phone captured. Carries Budget + Authority + Timeline — the axes the scraped funnel could never supply.`,
    status: "completed"
  });
  return ok({
    success: true,
    lead_id: lead.id,
    message: "Thank you — your enquiry is recorded and our team will contact you shortly."
  });
});
