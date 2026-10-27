import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": Deno.env.get("BRAND_DISCOVERY_ALLOWED_ORIGIN") ?? "null",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
};
const reply = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers: cors });
async function hashToken(token: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, "0")).join("");
}
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return reply(405, { error: "method_not_allowed" });
  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const allowlist = (Deno.env.get("FK_BRAND_DISCOVERY_ADMIN_EMAILS") ?? "")
    .split(",").map(x => x.trim().toLowerCase()).filter(Boolean);
  if (!url || !serviceKey || allowlist.length === 0) return reply(500, { error: "admin_not_configured" });
  const auth = req.headers.get("Authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return reply(401, { error: "authentication_required" });
  const db = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: userData, error: userError } = await db.auth.getUser(auth.slice(7));
  const email = userData?.user?.email?.toLowerCase();
  if (userError || !email || !allowlist.includes(email)) return reply(403, { error: "not_authorized" });

  let body: any;
  try { body = await req.json(); } catch { return reply(400, { error: "invalid_json" }); }
  if (typeof body?.questionnaire_version_id !== "string" ||
      typeof body?.brand_name !== "string" || !body.brand_name.trim() ||
      typeof body?.respondent_email !== "string" || !body.respondent_email.includes("@"))
    return reply(400, { error: "questionnaire_version_id_brand_name_and_respondent_email_required" });

  const { data: version, error: versionError } = await db.from("brand_discovery_questionnaire_versions")
    .select("id,slug,version,brand_category,title,locale,status").eq("id", body.questionnaire_version_id).maybeSingle();
  if (versionError || !version || version.status !== "active")
    return reply(400, { error: "active_questionnaire_version_required" });
  const tokenBytes = crypto.getRandomValues(new Uint8Array(32));
  const token = Array.from(tokenBytes, b => b.toString(16).padStart(2, "0")).join("");
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  const { data: session, error: insertError } = await db.from("brand_discovery_sessions").insert({
    questionnaire_version_id: version.id, brand_name: body.brand_name.trim(),
    brand_category: version.brand_category, respondent_name: typeof body.respondent_name === "string" ? body.respondent_name.trim() : null,
    respondent_email: body.respondent_email.trim(), locale: version.locale ?? "hi-en",
    status: "invited", resume_token_hash: await hashToken(token), resume_token_expires_at: expiresAt,
  }).select("id,brand_name,respondent_name,respondent_email,status,resume_token_expires_at").single();
  if (insertError || !session) return reply(500, { error: "invite_creation_failed" });

  // The token is returned once to the authenticated FK operator. Email delivery is intentionally
  // not attempted until a reviewed mail provider and sending policy are configured.
  return reply(201, { session, resume_token: token,
    email_delivery: "not_configured",
    warning: "Store/share this link securely. The raw token cannot be retrieved again." });
});
