/// <reference lib="deno.ns" />

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const allowedOrigin = Deno.env.get("BRAND_DISCOVERY_ALLOWED_ORIGIN") ?? "";
const cors = {
  "Access-Control-Allow-Origin": allowedOrigin || "null",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
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
  const origin = req.headers.get("Origin");
  if (origin && (!allowedOrigin || origin !== allowedOrigin)) return reply(403, { error: "origin_not_allowed" });
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

  // Invitation delivery is opt-in by environment configuration. Without all required
  // settings, no email is sent and the authenticated operator receives the one-time token.
  let emailDelivery = "not_configured";
  const mailKey = Deno.env.get("RESEND_API_KEY");
  const mailFrom = Deno.env.get("BRAND_DISCOVERY_EMAIL_FROM");
  const publicOrigin = Deno.env.get("BRAND_DISCOVERY_PUBLIC_ORIGIN") ?? allowedOrigin;
  if (mailKey && mailFrom && publicOrigin && session.respondent_email) {
    try {
      const link = `${publicOrigin.replace(/\/$/, "")}/brand-discovery/${token}`;
      const brand = session.brand_name.replace(/[<>]/g, "");
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${mailKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: mailFrom,
          to: [session.respondent_email],
          subject: `Your ${brand} business discovery questionnaire`,
          html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;line-height:1.6"><h2>Your guided business discovery is ready</h2><p>Hello ${String(session.respondent_name ?? "").replace(/[<>]/g, "")},</p><p>Franchise Kart invites you to complete the discovery questionnaire for <strong>${brand}</strong>.</p><p>It is designed to be completed independently, one question at a time. Your progress is saved, so you can return using the same secure link.</p><p><a href="${link}" style="display:inline-block;padding:12px 18px;background:#0e7490;color:white;text-decoration:none;border-radius:8px">Start questionnaire</a></p><p>Keep this link private. It provides access to your questionnaire.</p><p>Regards,<br>Franchise Kart</p></div>`,
        }),
      });
      emailDelivery = response.ok ? "sent" : "failed";
    } catch {
      emailDelivery = "failed";
    }
  }
  return reply(201, {
    session,
    resume_token: token,
    resume_url: publicOrigin ? `${publicOrigin.replace(/\/$/, "")}/brand-discovery/${token}` : null,
    email_delivery: emailDelivery,
    warning: emailDelivery === "sent"
      ? "Invitation email was accepted by the configured provider. The raw token is returned once; handle it securely."
      : "No invitation email was confirmed. Configure the approved mail provider or share the one-time secure link manually.",
  });
});
