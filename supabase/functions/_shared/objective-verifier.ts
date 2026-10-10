// INDEPENDENT OBJECTIVE VERIFICATION — judges the deliverable against the
// ORIGINAL objective and its success criteria, never against the workers'
// own claims of success.
//   1. Deterministic checks (empty, placeholders, refusals, leaked errors).
//   2. A verifier model selected for the "verification" task class with the
//      producing models on the avoid list, so where any other model exists
//      the verifier is not the model that did the work. The independence
//      level actually achieved is recorded, never assumed.
//   3. Anti-hallucination: a criterion counts as met only if the verifier
//      quotes text that really appears in the deliverable.
// The verdict is written to fkaios_verification_evidence and stamped onto the
// execution steps that produced the work (verified / rejected) — the only
// way an outcome becomes learning data.

import { buildDefaultRouterConfig, callLLMOnResources } from "./llm-router.ts";
import { selectResources } from "./resource-selection.ts";
import { markStepsVerified, recordLLMAttempts } from "./execution-evidence.ts";
import { parseRef } from "./resource-identity.ts";

// deno-lint-ignore no-explicit-any
type Db = any;

export const VERIFIER_VERSION = "objective_verifier:v1";
export const PASS_QUALITY = 0.6;

export interface CriterionResult {
  criterion: string;
  met: boolean;
  evidence_quote: string | null;
  issue: string | null;
}

export interface Verdict {
  passed: boolean;
  quality: number;
  criteria: CriterionResult[];
  issues: string[];
  needsHumanDecision: boolean;
  humanDecisionReason: string | null;
  deterministic: { ok: boolean; problems: string[] };
  verifierRef: string | null;
  independence: "different_provider" | "different_model" | "same_model" | "producers_unknown" | "none";
  available: boolean;
  evidenceId?: string | null;
}

const PLACEHOLDER = /\[(insert|todo|tbd|placeholder|your)\b[^\]]{0,60}\]|lorem ipsum|\bTBD\b|\{\{[^}]+\}\}/i;
const REFUSAL = /\b(as an ai( language model)?|i (cannot|can't|am unable to) (access|browse|provide)|i don't have access to)\b/i;
const LEAKED_ERROR = /"(error|status)"\s*:\s*"(no_data_source|error|failed)"|no_data_source/i;

export function deterministicChecks(deliverable: string): { ok: boolean; problems: string[] } {
  const problems: string[] = [];
  const text = deliverable.trim();
  if (text.length < 40) problems.push("deliverable is empty or trivially short");
  if (PLACEHOLDER.test(text)) problems.push("deliverable contains placeholder text");
  if (REFUSAL.test(text)) problems.push("deliverable contains a model refusal or capability disclaimer instead of the work");
  if (LEAKED_ERROR.test(text)) problems.push("deliverable contains a leaked error/no-data marker");
  return { ok: problems.length === 0, problems };
}

/**
 * Hard contract guard for the Kids DPS preschool-franchise competitor comparison.
 * The independent model is not allowed to waive missing required brands, URLs, or source-date status.
 */
export function kidsDpsCompetitorChecks(objective: string, criteria: string[], deliverable: string): { ok: boolean; problems: string[] } {
  const contract = [objective, ...criteria].join("\n").toLowerCase();
  const isKidsDps = contract.includes("kids dps") || contract.includes("preschool franchise");
  const asksCompetitors = contract.includes("competitor") || contract.includes("brand comparison");
  if (!isKidsDps || !asksCompetitors) return { ok: true, problems: [] };

  const brands = ["Kidzee", "EuroKids", "Bachpan", "Little Millennium", "Shemrock", "Hello Kids", "Tree House", "KLAY"];
  const rows = deliverable.split(/\\r?\\n/).filter((line) => line.trim().startsWith("|"));
  const problems: string[] = [];
  for (const brand of brands) {
    const row = rows.find((line) => line.toLowerCase().includes(brand.toLowerCase()));
    if (!row) {
      problems.push("competitor comparison missing a dedicated table row for " + brand);
      continue;
    }
    if (!row.includes("http://") && !row.includes("https://")) {
      problems.push("competitor row for " + brand + " has no direct source URL");
    }
    const lower = row.toLowerCase();
    const hasYear = /\\b(19|20)[0-9]{2}\\b/.test(row);
    if (!hasYear && !lower.includes("date unavailable") && !lower.includes("undated")) {
      problems.push("competitor row for " + brand + " has no source date or explicit date-unavailable label");
    }
  }
  return { ok: problems.length === 0, problems };
}

/** Normalises contract acceptance criteria (strings or {metric,target,unit,operator}) to plain sentences. */
export function contractCriteria(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((c) => {
    if (typeof c === "string") return c.trim();
    if (c && typeof c === "object") {
      const o = c as Record<string, unknown>;
      if (o.metric) return `${o.metric}: ${o.operator ?? ""} ${o.target ?? ""} ${o.unit ?? ""}`.replace(/\s+/g, " ").trim();
      if (o.criterion) return String(o.criterion);
      return JSON.stringify(o);
    }
    return String(c);
  }).filter((s) => s.length > 0);
}

export function buildVerifierPrompt(objective: string, criteria: string[], deliverable: string, evidence: string): { system: string; user: string } {
  const system = "You are the FKAIOS independent verifier. You did not produce this work. Judge it strictly against the original objective. Return ONLY valid JSON.";
  const user = `ORIGINAL OBJECTIVE:
${objective}

CONTRACT SUCCESS CRITERIA (may be empty):
${criteria.length ? criteria.map((c, i) => `${i + 1}. ${c}`).join("\n") : "(none recorded)"}

RECORDED EXECUTION EVIDENCE (what the workers actually retrieved; claims in the deliverable must be supported by this or by the objective itself):
${evidence || "(none)"}

DELIVERABLE TO VERIFY:
<<<DELIVERABLE
${deliverable}
DELIVERABLE>>>

Instructions:
1. List every explicit requirement in the ORIGINAL OBJECTIVE (counts, required items, required quotes, format, constraints such as "only use X"), plus every contract criterion. Use them as the criteria.
2. For each criterion decide met true/false. If met, copy an exact, contiguous, verbatim substring (5-30 words) from the DELIVERABLE that shows it. Do not paraphrase, add ellipses, normalize punctuation, or combine non-adjacent phrases in evidence_quote; the quote must appear exactly in the deliverable. If not met, describe the concrete issue.
3. Add a criterion "No claims unsupported by the recorded evidence" and judge it.
4. Evidence-grounding rules: treat RECORDED EXECUTION EVIDENCE as the source-of-truth boundary. Do not infer publication dates from a URL, search date, current date, or model memory. A source date is verified only when explicitly present in recorded evidence or on the cited source as actually retrieved; otherwise require "date unavailable" and mark any fabricated/guessed date as a failure. Do not upgrade secondary, promotional, social-media, or aggregator claims into independently verified empirical facts. Mark market-size figures, outlet counts, investments, legal obligations, and demand claims unsupported unless evidence directly supports the precise claim.\n5. For a competitor-comparison criterion naming specific brands, each named brand must have its own row; compare available brand-specific dimensions and include a direct source link and supported publication date for each sourced claim. Generic labels such as "major incumbent", "standard curriculum", "franchise model", or an unrelated aggregator link do not satisfy a brand-specific comparison. Where reliable data is unavailable, state "not verified" rather than filling the cell with a guess.\n6. For legal/regulatory criteria, distinguish policy goals, model guidelines, recommendations, and binding requirements. Do not call a guideline universally mandatory across India unless the evidence establishes that legal status; identify state/local variation and require local legal confirmation where applicable.\n7. Set needs_human_decision true ONLY if completing the objective requires a decision, approval, payment, credential or physical action that no AI system can take.
5. IMPORTANT: Do NOT set needs_human_decision merely because the report identifies missing client information, unknown financials, unconfirmed IP/trademark status, or unanswered questions. If the ORIGINAL OBJECTIVE explicitly asks to list missing information, that list is a deliverable, not a blocker. Verify the report and mark those items as outstanding assumptions/inputs; require a human decision only if the requested deliverable itself cannot be produced without that action.
5. quality: 0.0-1.0 overall quality of the deliverable for the objective.

JSON schema:
{"criteria":[{"criterion":string,"met":boolean,"evidence_quote":string|null,"issue":string|null}],"needs_human_decision":boolean,"human_decision_reason":string|null,"quality":number,"issues":[string]}`;
  return { system, user };
}

function norm(s: string): string {
  // Compare visible Markdown text, not link destinations or formatting syntax.
  // This verifies source citations when a quote includes the visible source
  // label but not the URL target.
  return s
    .replace(/\[([^\]]+)\]\((?:[^()]|\([^()]*\))*\)/g, "$1")
    .replace(/[*_~\`]/g, "")
    .toLowerCase()
    .replace(/[“”"'’]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
function extractJson(text: string): Record<string, unknown> | null {
  const t = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  for (const candidate of [t, t.slice(t.indexOf("{"), t.lastIndexOf("}") + 1)]) {
    try {
      const v = JSON.parse(candidate);
      if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
    } catch { /* next */ }
  }
  return null;
}

/**
 * Require a concrete external action for a human gate. Output-quality problems
 * belong to rectification, not Founder approval.
 */
export function requiresHumanDecision(flag: boolean, reason: string): boolean {
  if (!flag) return false;
  const text = reason.trim();
  if (!text) return false;
  const externalAction = /\b(approve|approval|authorize|authorization|payment|pay|purchase|spend|budget|credential|api key|secret|password|sign(?:ature|ing)?|contract signature|physical action|in[- ]person|legal consent|delete data|security setting)\b/i.test(text);
  const correctionOnly = /\b(raw json|intermediate output|deliverable|report|output quality|format|formatting|acceptability|acceptable|re-execut(?:e|ed|ion)|rectif(?:y|ication)|retry|verification|verifier|failed criteria|missing sections|quality issue)\b/i.test(text);
  const externalCommitment = /\b(payment|pay|purchase|spend|budget|credential|api key|secret|password|sign(?:ature|ing)?|contract signature|physical action|in[- ]person|legal consent|delete data|security setting)\b/i.test(text);
  if (correctionOnly && !externalCommitment) return false;
  return externalAction;
}
/**
 * Detect system-owned verification/recovery blockers that can be resumed without
 * asking the Founder to accept an unfinished deliverable. Explicit external
 * actions remain human gates.
 */
export const MAX_AUTOMATIC_RECTIFICATIONS = 6;

export function isRecoverableOutputBlocker(summary: string, completedRectifications = 0): boolean {
  const text = summary.trim();
  const falseHumanGate = /^Human decision required:/i.test(text) &&
    /raw json|intermediate output|final report|deliverable|re-execut|acceptable|format/i.test(text);
  const exhaustedVerification = /^Objective replanned [0-9]+ times without reaching achieved\/blocked\/failed\./i.test(text) &&
    /independent verification rejected the deliverable|supporting quote was not found|deliverable/i.test(text);
  const externalAction = /payment|pay|purchase|spend|budget|credential|api key|secret|password|contract signature|physical action|in-person|delete data|security setting/i.test(text);
  // Allow a bounded final recovery cycle, then leave the unresolved quality
  // failure parked for review instead of resetting the counter forever.
  if (exhaustedVerification && completedRectifications >= MAX_AUTOMATIC_RECTIFICATIONS) return false;
  return (falseHumanGate || exhaustedVerification) && !externalAction;
}

/** Parses and hardens the verifier's answer. A quote that is not in the deliverable turns a "met" into "not met". */
export function parseVerdict(text: string, deliverable: string, deterministic: { ok: boolean; problems: string[] }): Omit<Verdict, "verifierRef" | "independence" | "available"> | null {
  const obj = extractJson(text);
  if (!obj || !Array.isArray(obj.criteria)) return null;
  const hay = norm(deliverable);
  const criteria: CriterionResult[] = (obj.criteria as Array<Record<string, unknown>>).map((c) => {
    const criterion = String(c.criterion ?? "").slice(0, 400);
    const quote = typeof c.evidence_quote === "string" && c.evidence_quote.trim() ? c.evidence_quote.trim() : null;
    let met = c.met === true;
    let issue = typeof c.issue === "string" && c.issue.trim() ? c.issue.trim() : null;
    if (met) {
      const q = quote ? norm(quote) : "";
      if (!q || q.length < 8 || !hay.includes(q)) {
        met = false;
        issue = `verifier's supporting quote was not found in the deliverable${quote ? `: "${quote.slice(0, 120)}"` : ""}`;
      }
    }
    return { criterion, met, evidence_quote: quote, issue };
  }).filter((c) => c.criterion.length > 0);
  if (!criteria.length) return null;
  const qualityRaw = Number(obj.quality);
  const quality = Number.isFinite(qualityRaw) ? Math.max(0, Math.min(1, qualityRaw)) : 0;
  const issues = [
    ...deterministic.problems,
    ...criteria.filter((c) => !c.met).map((c) => `${c.criterion}: ${c.issue ?? "not met"}`),
    ...(Array.isArray(obj.issues) ? (obj.issues as unknown[]).map(String) : []),
  ].slice(0, 20);
  const humanDecisionReason = String(obj.human_decision_reason ?? "").trim();
  const needsHumanDecision = requiresHumanDecision(obj.needs_human_decision === true, humanDecisionReason);
  const passed = deterministic.ok && !needsHumanDecision && criteria.every((c) => c.met) && quality >= PASS_QUALITY;
  return {
    passed, quality, criteria, issues, needsHumanDecision,
    humanDecisionReason: needsHumanDecision ? (humanDecisionReason || "verifier reported a required human decision") : null,
    deterministic,
  };
}

export function isIndependentVerificationLevel(level: unknown): boolean {
  return level === "different_model" || level === "different_provider";
}

export function independenceLevel(verifierRef: string | null, producerRefs: string[]): Verdict["independence"] {
  if (!verifierRef) return "none";
  if (producerRefs.length === 0) return "producers_unknown"; // never claim independence that was not measured
  if (producerRefs.includes(verifierRef)) return "same_model";
  const vp = parseRef(verifierRef)?.provider;
  return producerRefs.some((p) => parseRef(p)?.provider === vp) ? "different_model" : "different_provider";
}

/**
 * Keep one active verification record per objective/requirement while retaining
 * prior attempts as superseded history. Never allow a passing verdict to escape
 * if its evidence could not be persisted.
 */
export async function persistVerificationEvidence(
  db: Db,
  input: { objectiveId: string | null; requirementKey: string; row: Record<string, unknown> },
): Promise<string | null> {
  if (input.objectiveId) {
    const { error: supersedeError } = await db
      .from("fkaios_verification_evidence")
      .update({ status: "superseded" })
      .eq("objective_id", input.objectiveId)
      .eq("requirement_key", input.requirementKey)
      .neq("status", "superseded");
    if (supersedeError) throw new Error(`Failed superseding prior verification evidence: ${supersedeError.message}`);
  }
  const { data, error } = await db
    .from("fkaios_verification_evidence")
    .insert(input.row)
    .select("id")
    .single();
  if (error) throw new Error(`Failed persisting verification evidence: ${error.message}`);
  return data?.id ?? null;
}

export async function verifyObjective(db: Db, input: {
  /** null only for self-tests (evidence key self_test:...). */
  objectiveId: string | null;
  requirementKey?: string;
  projectId: string | null;
  objective: string;
  criteria: string[];
  deliverable: string;
  evidence: string;
  producerRefs: string[];
  producingTaskIds: string[];
}): Promise<Verdict> {
  const baseChecks = deterministicChecks(input.deliverable);
  const competitorChecks = kidsDpsCompetitorChecks(input.objective, input.criteria, input.deliverable);
  const deterministic = {
    ok: baseChecks.ok && competitorChecks.ok,
    problems: [...baseChecks.problems, ...competitorChecks.problems].slice(0, 30),
  };
  const selection = await selectResources(db, "verification", { avoid: input.producerRefs });
  const { system, user } = buildVerifierPrompt(input.objective, input.criteria, input.deliverable.slice(0, 40000), input.evidence.slice(0, 12000));
  const startedAt = new Date();
  const result = await callLLMOnResources(
    { systemPrompt: system, userContent: user, functionName: "objective-verifier", functionClass: "founder_intelligence", temperature: 0 },
    buildDefaultRouterConfig(),
    selection.resources,
  );
  await recordLLMAttempts(db, { objectiveId: input.objectiveId, projectId: input.projectId, stepKind: "verification", taskClass: "verification" }, result.log, selection, result.content ?? null, startedAt);

  const verifierRef = result.resource?.ref ?? null;
  const independence = independenceLevel(verifierRef, input.producerRefs);
  if (result.status !== "success") {
    return { passed: false, quality: 0, criteria: [], issues: [`verifier unavailable: ${result.log.failure_reason ?? result.status}`], needsHumanDecision: false, humanDecisionReason: null, deterministic, verifierRef, independence, available: false };
  }
  const parsed = parseVerdict(result.content ?? "", input.deliverable, deterministic);
  if (!parsed) {
    return { passed: false, quality: 0, criteria: [], issues: ["verifier returned no parseable verdict"], needsHumanDecision: false, humanDecisionReason: null, deterministic, verifierRef, independence, available: false };
  }
  // A quality score from the same producing model is not an independent
  // verification. Persist the rejected attempt for audit, then let the bounded
  // objective loop retry verification on a later scheduler cycle.
  if (!isIndependentVerificationLevel(independence)) {
    const independenceIssue = "Independent verification unavailable: the selected verifier is the same model as a producer, or producer identity is unknown.";
    const requirementKey = input.requirementKey ?? VERIFIER_VERSION;
    const evidenceId = await persistVerificationEvidence(db, {
      objectiveId: input.objectiveId,
      requirementKey,
      row: {
        objective_id: input.objectiveId,
        project_id: input.projectId,
        requirement_key: requirementKey,
        evidence_type: "independent_objective_verification",
        verifier: verifierRef ?? "unknown",
        status: "failed",
        observed_result: { criteria: parsed.criteria, quality: parsed.quality, issues: [independenceIssue], independence, deterministic, producer_refs: input.producerRefs, needs_human_decision: false },
        verification_notes: independenceIssue + " (independence: " + independence + ")",
        verified_at: new Date().toISOString(),
      },
    });
    return { passed: false, quality: 0, criteria: parsed.criteria, issues: [independenceIssue], needsHumanDecision: false, humanDecisionReason: null, deterministic, verifierRef, independence, available: false, evidenceId };
  }
  const verdict: Verdict = { ...parsed, verifierRef, independence, available: true };

  const requirementKey = input.requirementKey ?? VERIFIER_VERSION;
  verdict.evidenceId = await persistVerificationEvidence(db, {
    objectiveId: input.objectiveId,
    requirementKey,
    row: {
      objective_id: input.objectiveId,
      project_id: input.projectId,
      requirement_key: requirementKey,
      evidence_type: "independent_objective_verification",
      verifier: verifierRef ?? "unknown",
      status: verdict.passed ? "passed" : "failed",
      observed_result: { criteria: verdict.criteria, quality: verdict.quality, issues: verdict.issues, independence, deterministic, producer_refs: input.producerRefs, needs_human_decision: verdict.needsHumanDecision },
      verification_notes: verdict.passed ? `All ${verdict.criteria.length} criteria met with quotes found in the deliverable (independence: ${independence}).` : `Failed: ${verdict.issues.slice(0, 3).join(" | ")}`,
      verified_at: new Date().toISOString(),
    },
  });

  // Only verified outcomes train routing: stamp the producing steps.
  if (input.producingTaskIds.length) {
    await markStepsVerified(db, { taskIds: input.producingTaskIds }, verdict.passed ? "verified" : "rejected", verdict.evidenceId ?? null, verdict.quality);
  }
  return verdict;
}
