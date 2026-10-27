import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const allowedOrigin = Deno.env.get("BRAND_DISCOVERY_ALLOWED_ORIGIN") ?? "";
const cors = {
  "Access-Control-Allow-Origin": allowedOrigin || "null",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
  "Pragma": "no-cache",
};
const reply = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers: cors });
async function hashToken(token: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, "0")).join("");
}
function hasMeaningfulAnswer(value: unknown): boolean {
  if (typeof value === "string") return value.trim().length > 0;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "boolean") return true;
  if (Array.isArray(value)) return value.some(hasMeaningfulAnswer);
  if (value && typeof value === "object") return Object.values(value as Record<string, unknown>).some(hasMeaningfulAnswer);
  return false;
}
function validQuestionnaire(q: any) {
  return q && Array.isArray(q.sections) && q.sections.every((s: any) =>
    typeof s.id === "string" && Array.isArray(s.questions) &&
    s.questions.every((item: any) => typeof item.id === "string"));
}
Deno.serve(async (req: Request) => {
  const origin = req.headers.get("Origin");
  if (origin && (!allowedOrigin || origin !== allowedOrigin)) return reply(403, { error: "origin_not_allowed" });
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return reply(405, { error: "method_not_allowed" });
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return reply(500, { error: "server_not_configured" });
  let body: any;
  try { body = await req.json(); } catch { return reply(400, { error: "invalid_json" }); }
  if (typeof body?.token !== "string" || body.token.length < 32 || body.token.length > 256)
    return reply(401, { error: "invalid_resume_link" });

  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const tokenHash = await hashToken(body.token);
  const { data: session, error: sessionError } = await db.from("brand_discovery_sessions")
    .select("id,questionnaire_version_id,brand_name,brand_category,respondent_name,locale,status,current_section,current_question,resume_token_expires_at,submitted_at")
    .eq("resume_token_hash", tokenHash).maybeSingle();
  if (sessionError || !session) return reply(401, { error: "invalid_resume_link" });
  if (!session.resume_token_expires_at || new Date(session.resume_token_expires_at).getTime() < Date.now())
    return reply(410, { error: "resume_link_expired" });
  if (session.status === "withdrawn" || session.status === "expired")
    return reply(410, { error: "session_unavailable" });

  const { data: version, error: versionError } = await db.from("brand_discovery_questionnaire_versions")
    .select("title,locale,questionnaire,status").eq("id", session.questionnaire_version_id).maybeSingle();
  if (versionError || !version || !validQuestionnaire(version.questionnaire))
    return reply(503, { error: "questionnaire_not_ready" });

  if (body.action === "get") {
    const { data: answers, error } = await db.from("brand_discovery_answers")
      .select("question_id,section_id,answer,updated_at").eq("session_id", session.id);
    if (error) return reply(500, { error: "could_not_load_answers" });
    return reply(200, { session: { brand_name: session.brand_name, brand_category: session.brand_category,
      respondent_name: session.respondent_name, locale: session.locale, status: session.status,
      current_section: session.current_section, current_question: session.current_question,
      submitted_at: session.submitted_at }, questionnaire: version.questionnaire, answers: answers ?? [] });
  }

  if (session.status === "submitted") return reply(409, { error: "already_submitted" });
  if (body.action === "save") {
    const { question_id, section_id, answer, current_section, current_question } = body;
    if (typeof question_id !== "string" || typeof section_id !== "string" ||
        answer === undefined || answer === null ||
        !Number.isInteger(current_section) || current_section < 0 ||
        !Number.isInteger(current_question) || current_question < 0 ||
        current_section >= version.questionnaire.sections.length ||
        current_question >= (version.questionnaire.sections[current_section]?.questions?.length ?? 0))
      return reply(400, { error: "invalid_answer_payload" });
    const section = version.questionnaire.sections.find((s: any) => s.id === section_id);
    const question = section?.questions?.find((q: any) => q.id === question_id);
    if (!question) return reply(400, { error: "question_not_in_active_version" });
    const { error: saveError } = await db.from("brand_discovery_answers").upsert({
      session_id: session.id, question_id, section_id, answer,
      updated_at: new Date().toISOString(),
    }, { onConflict: "session_id,question_id" });
    if (saveError) return reply(500, { error: "answer_not_saved" });
    const { error: updateError } = await db.from("brand_discovery_sessions").update({
      status: "in_progress", current_section, current_question,
      started_at: session.status === "invited" ? new Date().toISOString() : undefined,
      last_saved_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    }).eq("id", session.id);
    if (updateError) return reply(500, { error: "answer_saved_but_progress_not_updated" });
    return reply(200, { saved: true, current_section, current_question });
  }

  if (body.action === "submit") {
    const required: Array<{ id: string; section_id: string }> = [];
    for (const section of version.questionnaire.sections) {
      for (const q of section.questions) if (q.required !== false) required.push({ id: q.id, section_id: section.id });
    }
    const { data: answers, error } = await db.from("brand_discovery_answers")
      .select("question_id,answer").eq("session_id", session.id);
    if (error) return reply(500, { error: "could_not_verify_completion" });
    const saved = new Map((answers ?? []).map((a: any) => [a.question_id, a.answer]));
    const missing = required.filter(q => !saved.has(q.id) || !hasMeaningfulAnswer(saved.get(q.id)));
    if (missing.length) return reply(422, { error: "required_answers_missing", missing_count: missing.length });
    const now = new Date().toISOString();
    const { error: submitError } = await db.from("brand_discovery_sessions").update({
      status: "submitted", submitted_at: now, updated_at: now,
    }).eq("id", session.id);
    if (submitError) return reply(500, { error: "submit_failed" });
    return reply(200, { submitted: true, message: "Thank you. Your responses have been received." });
  }
  return reply(400, { error: "unknown_action" });
});
