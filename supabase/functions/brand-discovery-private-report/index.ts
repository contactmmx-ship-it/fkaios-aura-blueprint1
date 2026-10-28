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

function answerText(value: unknown, question?: any): string {
  let parsed: any = value;
  if (typeof value === "string") {
    try { parsed = JSON.parse(value); }
    catch { return value.trim(); }
  }
  if (parsed === null || parsed === undefined) return "";
  if (typeof parsed !== "object") return String(parsed);

  const labelFor = (options: any[], id: unknown) => {
    if (typeof id !== "string") return "";
    const option = (Array.isArray(options) ? options : []).find((item: any) => item?.value === id);
    return typeof option?.label === "string" ? option.label : id;
  };
  if (Array.isArray(parsed.choices) || typeof parsed.choice === "string") {
    const choices = Array.isArray(parsed.choices) ? parsed.choices : [parsed.choice];
    const labels = choices.map((id: unknown) => labelFor(question?.options, id)).filter(Boolean);
    const explanation = typeof parsed.explanation === "string" ? parsed.explanation.trim() : "";
    return [labels.join(", "), explanation].filter(Boolean).join(" — ");
  }
  if (parsed.parts && typeof parsed.parts === "object") {
    const labels = (Array.isArray(question?.parts) ? question.parts : []).flatMap((part: any) => {
      const choices = parsed.parts[part.id]?.choices;
      if (!Array.isArray(choices) || choices.length === 0) return [];
      const values = choices.map((id: unknown) => labelFor(part.options, id)).filter(Boolean).join(", ");
      return values ? [`${part.label}: ${values}`] : [];
    });
    const explanation = typeof parsed.explanation === "string" ? parsed.explanation.trim() : "";
    return [...labels, explanation].filter(Boolean).join(" — ");
  }
  if (Array.isArray(parsed.services)) {
    const services = Array.isArray(question?.service_options) ? question.service_options : [];
    const statuses = Array.isArray(question?.status_options) ? question.status_options : [];
    return parsed.services.map((id: unknown) => {
      const service = labelFor(services, id);
      const status = labelFor(statuses, parsed.statuses?.[id]);
      return service ? `${service}: ${status || "status not recorded"}` : "";
    }).filter(Boolean).join("; ");
  }
  if (Array.isArray(parsed.rows)) {
    const options = Array.isArray(question?.options) ? question.options : [];
    return parsed.rows.map((row: any) => {
      const choice = labelFor(options, row?.choice);
      return [typeof row?.label === "string" ? row.label.trim() : "", choice].filter(Boolean).join(": ");
    }).filter(Boolean).join("; ");
  }
  if (Array.isArray(parsed)) return parsed.map(answerText).filter(Boolean).join("; ");
  return JSON.stringify(parsed);
}

/**
 * This deliberately creates an evidence-first report without calling an LLM.
 * It does not infer business performance from unanswered questions or claim
 * that owner statements are verified evidence. Any future AI analysis must
 * preserve these provenance labels and require human review before advice.
 */
function buildEvidenceReport(questionnaire: any, answers: any[], session: any) {
  const answerMap = new Map(answers.map((row) => [row.question_id, row.answer]));
  const questions = (questionnaire?.sections ?? []).flatMap((section: any) =>
    (section.questions ?? []).map((question: any) => ({ ...question, section_title: section.title })));
  const ownerReported = questions.filter((q: any) => answerMap.has(q.id)).map((q: any) => ({
    question_number: q.number ?? null,
    question_id: q.id,
    section: q.section_title,
    question: q.prompt,
    answer: answerText(answerMap.get(q.id), q),
    evidence_status: "OWNER_REPORTED_NOT_INDEPENDENTLY_VERIFIED",
  }));
  const unanswered = questions.filter((q: any) => q.required !== false && !answerMap.has(q.id)).map((q: any) => ({
    question_number: q.number ?? null,
    question_id: q.id,
    section: q.section_title,
    question: q.prompt,
    status: "MISSING_RESPONSE",
  }));
  const closure = answerMap.get("__closure__") as any;
  const reportedDocumentAvailability = closure && typeof closure === "object" && closure.documents && typeof closure.documents === "object"
    ? closure.documents
    : {};
  const checklist = Array.isArray(questionnaire?.document_checklist)
    ? questionnaire.document_checklist.map((item: any) => ({
        item_id: typeof item === "object" ? item.id : null,
        item: typeof item === "string" ? item : (item?.label ?? JSON.stringify(item)),
        respondent_reported_availability: typeof item === "object" && typeof item.id === "string"
          ? (typeof reportedDocumentAvailability[item.id] === "string" ? reportedDocumentAvailability[item.id] : "NO_OWNER_RESPONSE_RECORDED")
          : "NO_OWNER_RESPONSE_RECORDED",
        receipt_status: "NOT_INDEPENDENTLY_CONFIRMED",
        review_status: "NOT_REVIEWED_BY_THIS_REPORT_FUNCTION",
        verification_status: "NOT_VERIFIED",
        note: "Availability is a respondent report only. It does not prove a file was received, reviewed, authenticated or reconciled.",
      }))
    : [];
  return {
    report_version: 1,
    brand: session.brand_name,
    category: session.brand_category,
    submitted_at: session.submitted_at,
    generated_at: new Date().toISOString(),
    method: "RULE_BASED_EVIDENCE_INVENTORY_NO_EXTERNAL_AI",
    executive_summary: {
      statement: "This report inventories submitted owner statements and evidence gaps. It is not a validated business diagnosis.",
      owner_responses_recorded: ownerReported.length,
      required_responses_missing: unanswered.length,
      documents_pending_verification: checklist.length,
      financial_or_operational_claims_independently_verified: 0,
    },
    evidence_ledger: {
      owner_reported: ownerReported,
      independently_verified: [],
      hypotheses: [],
      unknowns: unanswered,
      document_checklist: checklist,
    },
    diagnosis: {
      status: "HUMAN_REVIEW_REQUIRED",
      conclusions: [],
      guardrail: "Do not infer profitability, demand, causes, or readiness from unverified owner statements alone.",
    },
    execution_plan: {
      status: "DRAFT_ACTIONS_ONLY",
      actions: [
        {
          priority: 1,
          action: "Review the submitted answers for completeness and internal contradictions.",
          owner: "Franchise Kart reviewer — assign by name before execution",
          timing: "Before diagnosis",
          verification: "Reviewer records each issue and links it to the relevant question ID.",
        },
        {
          priority: 2,
          action: "Request and verify the listed supporting documents relevant to the brand.",
          owner: "Franchise Kart reviewer and brand owner — confirm responsibility",
          timing: "After initial review",
          verification: "Record received / missing / unclear / verified status with date and evidence reference.",
        },
        {
          priority: 3,
          action: "Convert only evidence-supported findings into a measurable transformation plan.",
          owner: "Franchise Kart accountable lead — assign by name",
          timing: "After evidence review",
          verification: "Each action has a baseline, target, due date, accountable owner, dependency, and proof method.",
        },
      ],
      do_not_treat_as_approved_plan: true,
    },
    disclaimer: "Generated from stored questionnaire answers only. No source documents were independently examined by this function; all owner statements remain unverified until reviewed.",
  };
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("Origin");
  if (origin && (!allowedOrigin || origin !== allowedOrigin)) return reply(403, { error: "origin_not_allowed" });
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return reply(405, { error: "method_not_allowed" });

  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const allowlist = (Deno.env.get("FK_BRAND_DISCOVERY_ADMIN_EMAILS") ?? "")
    .split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);
  const auth = req.headers.get("Authorization") ?? "";
  if (!url || !serviceKey || allowlist.length === 0) return reply(500, { error: "admin_not_configured" });
  if (!auth.startsWith("Bearer ")) return reply(401, { error: "authentication_required" });

  const db = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: userData, error: userError } = await db.auth.getUser(auth.slice(7));
  const email = userData?.user?.email?.toLowerCase();
  if (userError || !email || !allowlist.includes(email)) return reply(403, { error: "not_authorized" });

  let body: any;
  try { body = await req.json(); } catch { return reply(400, { error: "invalid_json" }); }
  const action = body?.action;
  if (action === "list_templates") {
    const { data, error } = await db.from("brand_discovery_questionnaire_versions")
      .select("id,slug,version,brand_category,title,locale,status")
      .eq("status", "active").order("slug").order("version", { ascending: false });
    if (error) return reply(500, { error: "could_not_list_active_templates" });
    return reply(200, { templates: data ?? [] });
  }
  if (action === "list") {
    const { data, error } = await db.from("brand_discovery_sessions")
      .select("id,brand_name,brand_category,respondent_name,respondent_email,status,submitted_at,updated_at")
      .eq("status", "submitted").order("submitted_at", { ascending: false }).limit(100);
    if (error) return reply(500, { error: "could_not_list_submissions" });
    return reply(200, { sessions: data ?? [] });
  }
  if (action !== "get_report" || typeof body.session_id !== "string")
    return reply(400, { error: "unknown_action_or_missing_session_id" });

  const { data: session, error: sessionError } = await db.from("brand_discovery_sessions")
    .select("id,questionnaire_version_id,brand_name,brand_category,respondent_name,respondent_email,status,submitted_at")
    .eq("id", body.session_id).maybeSingle();
  if (sessionError || !session) return reply(404, { error: "session_not_found" });
  if (session.status !== "submitted") return reply(409, { error: "session_not_submitted" });

  const { data: version, error: versionError } = await db.from("brand_discovery_questionnaire_versions")
    .select("questionnaire").eq("id", session.questionnaire_version_id).maybeSingle();
  const { data: answers, error: answersError } = await db.from("brand_discovery_answers")
    .select("question_id,section_id,answer,updated_at").eq("session_id", session.id);
  if (versionError || answersError || !version) return reply(500, { error: "could_not_load_report_inputs" });

  const report = buildEvidenceReport(version.questionnaire, answers ?? [], session);
  const { error: upsertError } = await db.from("brand_discovery_private_reports").upsert({
    session_id: session.id,
    analysis: { executive_summary: report.executive_summary, evidence_ledger: report.evidence_ledger, diagnosis: report.diagnosis, disclaimer: report.disclaimer },
    execution_plan: report.execution_plan,
    generation_status: "complete",
    generated_at: report.generated_at,
    updated_at: report.generated_at,
  }, { onConflict: "session_id" });
  if (upsertError) return reply(500, { error: "could_not_save_private_report" });

  // This endpoint is authenticated and allowlisted. The respondent endpoint
  // never selects or returns this table.
  return reply(200, { report });
});
