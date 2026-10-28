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
  "Pragma": "no-cache",
};
const reply = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers: cors });
async function hashToken(token: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, "0")).join("");
}
async function sendCompletionEmails(session: any): Promise<{ owner: string; fk: string }> {
  // Email is deliberately disabled unless the owner explicitly enables the server-side gate.
  if (Deno.env.get("FK_BRAND_DISCOVERY_EMAIL_SENDING_ENABLED") !== "true") {
    return { owner: "disabled_by_policy", fk: "disabled_by_policy" };
  }
  const apiKey = Deno.env.get("RESEND_API_KEY");
  const from = Deno.env.get("BRAND_DISCOVERY_EMAIL_FROM");
  const fkEmail = Deno.env.get("FK_BRAND_DISCOVERY_REPORT_EMAIL");
  if (!apiKey || !from) return { owner: "not_configured", fk: "not_configured" };
  const send = async (to: string, subject: string, html: string) => {
    try {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from, to: [to], subject, html }),
      });
      return response.ok ? "sent" : "failed";
    } catch {
      return "failed";
    }
  };
  const brand = String(session.brand_name ?? "your business").replace(/[<>]/g, "");
  const owner = session.respondent_email ? await send(
    session.respondent_email,
    `Questionnaire completed — ${brand}`,
    `<div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;line-height:1.6"><h2>Thank you for completing your discovery questionnaire.</h2><p>Your responses for <strong>${brand}</strong> have been received successfully.</p><p>The Franchise Kart team will review the information and contact you about next steps.</p><p>This email confirms receipt only; it does not represent a business diagnosis or approval.</p><p>Regards,<br>Franchise Kart</p></div>`
  ) : "not_configured";
  const fk = fkEmail ? await send(
    fkEmail,
    `Private Brand Discovery submission received — ${brand}`,
    `<div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;line-height:1.6"><h2>New completed brand discovery</h2><p><strong>Brand:</strong> ${brand}</p><p><strong>Respondent:</strong> ${String(session.respondent_name ?? "Not supplied").replace(/[<>]/g, "")}</p><p><strong>Submission ID:</strong> ${String(session.id)}</p><p>This is a notification only. Open the authorised Franchise Kart report workspace to review the private evidence ledger. No private diagnosis or execution plan is included in this email.</p></div>`
  ) : "not_configured";
  return { owner, fk };
}

function hasMeaningfulAnswer(value: unknown): boolean {
  if (typeof value === "string") return value.trim().length > 0;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "boolean") return true;
  if (Array.isArray(value)) return value.some(hasMeaningfulAnswer);
  if (value && typeof value === "object") return Object.values(value as Record<string, unknown>).some(hasMeaningfulAnswer);
  return false;
}
function isValidChoiceSet(question: any, choices: unknown): boolean {
  if (!Array.isArray(choices) || choices.length === 0 || choices.some((v: unknown) => typeof v !== "string")) return false;
  const options = Array.isArray(question.options) ? question.options : [];
  const allowed = new Set(options.map((option: any) => option?.value).filter((v: unknown) => typeof v === "string"));
  if (choices.some((choice: string) => !allowed.has(choice)) || new Set(choices).size !== choices.length) return false;
  if (question.selection_mode !== "multiple" && choices.length !== 1) return false;
  if (question.max_selections && choices.length > question.max_selections) return false;
  return true;
}
function isValidQuestionAnswer(question: any, rawAnswer: unknown): boolean {
  if (!question || typeof question.type !== "string") return false;
  if (["text", "long_text", "repeatable_list", "file_or_text"].includes(question.type)) {
    if (typeof rawAnswer !== "string") return false;
    const maxLength = question.type === "text" ? 2_000 : question.type === "file_or_text" ? 5_000 : 20_000;
    return rawAnswer.trim().length > 0 && rawAnswer.length <= maxLength;
  }
  if (!["multiple_choice", "multi_part", "service_status", "repeatable_choice"].includes(question.type)) return false;
  if (typeof rawAnswer === "string" && rawAnswer.length > 25_000) return false;
  let answer: any = rawAnswer;
  if (typeof rawAnswer === "string") {
    try { answer = JSON.parse(rawAnswer); } catch { return false; }
  }
  if (!answer || typeof answer !== "object") return false;
  if (question.type === "service_status") {
    const serviceOptions = Array.isArray(question.service_options) ? question.service_options : [];
    const statusOptions = Array.isArray(question.status_options) ? question.status_options : [];
    const services = answer.services;
    const statuses = answer.statuses;
    if (!Array.isArray(services) || services.length === 0 || services.some((id: unknown) => typeof id !== "string")) return false;
    const allowedServices = new Set(serviceOptions.map((item: any) => item.value));
    const allowedStatuses = new Set(statusOptions.map((item: any) => item.value));
    if (services.some((id: string) => !allowedServices.has(id)) || new Set(services).size !== services.length) return false;
    if (!statuses || typeof statuses !== "object") return false;
    if (Object.keys(statuses).some((id) => !services.includes(id))) return false;
    return services.every((id: string) => typeof statuses[id] === "string" && allowedStatuses.has(statuses[id]));
  }
  if (question.type === "repeatable_choice") {
    const options = Array.isArray(question.options) ? question.options : [];
    const allowed = new Set(options.map((item: any) => item.value));
    const rows = answer.rows;
    if (!Array.isArray(rows) || rows.length === 0 || rows.length > 20) return false;
    const ids = new Set<string>();
    return rows.every((row: any) => {
      if (!row || typeof row.id !== "string" || !row.id || ids.has(row.id) ||
          typeof row.label !== "string" || row.label.trim().length === 0 || row.label.length > 100 ||
          typeof row.choice !== "string" || !allowed.has(row.choice)) return false;
      ids.add(row.id);
      return true;
    });
  }
  if (question.type === "multiple_choice") {
    const choices = Array.isArray(answer.choices) ? answer.choices :
      typeof answer.choice === "string" ? [answer.choice] : null;
    if (!isValidChoiceSet(question, choices)) return false;
    return answer.explanation === undefined || typeof answer.explanation === "string";
  }
  const parts = Array.isArray(question.parts) ? question.parts : [];
  if (parts.length === 0 || !answer.parts || typeof answer.parts !== "object") return false;
  const suppliedPartIds = Object.keys(answer.parts);
  if (suppliedPartIds.some((id) => !parts.some((part: any) => part.id === id))) return false;
  for (const part of parts) {
    const value = answer.parts[part.id];
    const choices = value && Array.isArray(value.choices) ? value.choices : [];
    if (part.optional === true && choices.length === 0) continue;
    const pseudoQuestion = { options: part.options, selection_mode: part.selection_mode, max_selections: part.max_selections };
    if (!value || !isValidChoiceSet(pseudoQuestion, value.choices)) return false;
  }
  return true;
}
function isValidClosureDraft(questionnaire: any, value: any): boolean {
  if (!value || typeof value !== "object" || !value.documents || typeof value.documents !== "object") return false;
  const checklist = Array.isArray(questionnaire?.document_checklist) ? questionnaire.document_checklist : [];
  // Checklist length is template-defined; the Raahat-specific source validator checks its 20 items separately.
  if (Object.keys(value.documents).some((id) => !checklist.some((item: any) => item.id === id))) return false;
  for (const item of checklist) {
    const status = value.documents[item.id];
    if (status !== undefined && (!Array.isArray(item.status_options) || typeof status !== "string" || !item.status_options.includes(status))) return false;
  }
  if (typeof value.owner_date !== "string" || value.owner_date.length > 10 ||
      (value.owner_date !== "" && !/^\d{4}-\d{2}-\d{2}$/.test(value.owner_date))) return false;
  if (typeof value.owner_signature !== "string" || value.owner_signature.length > 200) return false;
  return typeof value.acknowledged === "boolean";
}
function isValidClosureAnswer(questionnaire: any, value: any): boolean {
  if (!isValidClosureDraft(questionnaire, value)) return false;
  const checklist = questionnaire.document_checklist;
  return checklist.every((item: any) => typeof value.documents[item.id] === "string") &&
    /^\d{4}-\d{2}-\d{2}$/.test(value.owner_date) &&
    value.owner_signature.trim().length >= 2 &&
    value.acknowledged === true;
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
  try {
    const rawBody = await req.text();
    if (new TextEncoder().encode(rawBody).byteLength > 512_000) return reply(413, { error: "request_too_large" });
    body = JSON.parse(rawBody);
  } catch { return reply(400, { error: "invalid_json" }); }
  if (typeof body?.token !== "string" || body.token.length < 32 || body.token.length > 256)
    return reply(401, { error: "invalid_resume_link" });

  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const tokenHash = await hashToken(body.token);
  const { data: session, error: sessionError } = await db.from("brand_discovery_sessions")
    .select("id,questionnaire_version_id,brand_name,brand_category,respondent_name,respondent_email,locale,status,current_section,current_question,resume_token_expires_at,submitted_at")
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
  if (body.action === "save_closure") {
    const closure = body.closure;
    if (!isValidClosureDraft(version.questionnaire, closure)) return reply(400, { error: "invalid_closure_payload" });
    const lastSectionIndex = version.questionnaire.sections.length - 1;
    const lastSection = version.questionnaire.sections[lastSectionIndex];
    const lastQuestionIndex = Math.max((lastSection?.questions?.length ?? 1) - 1, 0);
    const { error: saveError } = await db.from("brand_discovery_answers").upsert({
      session_id: session.id, question_id: "__closure__", section_id: lastSection.id,
      answer: closure, updated_at: new Date().toISOString(),
    }, { onConflict: "session_id,question_id" });
    if (saveError) return reply(500, { error: "closure_not_saved" });
    const { error: updateError } = await db.from("brand_discovery_sessions").update({
      status: "in_progress", current_section: lastSectionIndex, current_question: lastQuestionIndex,
      started_at: session.status === "invited" ? new Date().toISOString() : undefined,
      last_saved_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    }).eq("id", session.id);
    if (updateError) return reply(500, { error: "closure_saved_but_progress_not_updated" });
    return reply(200, { saved: true, closure_saved: true });
  }
  if (body.action === "save") {
    const { question_id, section_id, answer, current_section, current_question } = body;
    if (typeof question_id !== "string" || typeof section_id !== "string" ||
        answer === undefined || answer === null ||
        !Number.isInteger(current_section) || current_section < 0 ||
        !Number.isInteger(current_question) || current_question < 0 ||
        current_section >= version.questionnaire.sections.length ||
        current_question >= (version.questionnaire.sections[current_section]?.questions?.length ?? 0))
      return reply(400, { error: "invalid_answer_payload" });
    const section = version.questionnaire.sections[current_section];
    const question = section?.questions?.[current_question];
    if (!section || section.id !== section_id || !question || question.id !== question_id)
      return reply(400, { error: "question_position_mismatch" });
    if (!isValidQuestionAnswer(question, answer))
      return reply(400, { error: "invalid_answer_shape_or_choice" });
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
    const { data: closureRow, error: closureError } = await db.from("brand_discovery_answers")
      .select("answer").eq("session_id", session.id).eq("question_id", "__closure__").maybeSingle();
    if (closureError) return reply(500, { error: "could_not_verify_closure" });
    let closureValue: any = closureRow?.answer;
    if (typeof closureValue === "string") {
      try { closureValue = JSON.parse(closureValue); } catch { closureValue = null; }
    }
    if (!isValidClosureAnswer(version.questionnaire, closureValue)) {
      return reply(422, { error: "closure_incomplete" });
    }
    const required: Array<{ id: string; section_id: string }> = [];
    for (const section of version.questionnaire.sections) {
      for (const q of section.questions) if (q.required !== false) required.push({ id: q.id, section_id: section.id });
    }
    const { data: answers, error } = await db.from("brand_discovery_answers")
      .select("question_id,answer").eq("session_id", session.id);
    if (error) return reply(500, { error: "could_not_verify_completion" });
    const saved = new Map((answers ?? []).map((a: any) => [a.question_id, a.answer]));
    const questionById = new Map<string, any>();
    for (const section of version.questionnaire.sections) {
      for (const question of section.questions) questionById.set(question.id, question);
    }
    const missing = required.filter(q => !saved.has(q.id) ||
      !isValidQuestionAnswer(questionById.get(q.id), saved.get(q.id)));
    if (missing.length) return reply(422, { error: "required_answers_missing", missing_count: missing.length });
    const now = new Date().toISOString();
    const { error: submitError } = await db.from("brand_discovery_sessions").update({
      status: "submitted", submitted_at: now, updated_at: now,
    }).eq("id", session.id);
    if (submitError) return reply(500, { error: "submit_failed" });

    // Create an empty private-report record now; an allowlisted FK staff member
    // generates the evidence-first report through brand-discovery-private-report.
    const { error: reportError } = await db.from("brand_discovery_private_reports").upsert({
      session_id: session.id,
      analysis: { status: "PENDING_REVIEW", owner_reported_answers: (answers ?? []).length },
      execution_plan: { status: "NOT_GENERATED" },
      generation_status: "pending",
      updated_at: now,
    }, { onConflict: "session_id" });
    if (reportError) {
      // Submission remains accepted; staff can create the report from the session later.
      console.error("private_report_placeholder_failed", reportError.code ?? "database_error");
    }
    const emailDelivery = await sendCompletionEmails({ ...session, submitted_at: now });
    return reply(200, {
      submitted: true,
      message: "Thank you. Your responses have been received.",
      email_delivery: emailDelivery,
      private_report_status: reportError ? "pending_creation" : "pending_staff_review",
    });
  }
  return reply(400, { error: "unknown_action" });
});
