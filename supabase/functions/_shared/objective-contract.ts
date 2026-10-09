export type ObjectiveType = "information" | "software_build" | "product_creation" | "business_execution";

export type CompletionContract = {
  objectiveType: ObjectiveType;
  label: string;
  requiresUsableOutcome: boolean;
  requiresLiveArtifact: boolean;
  requiredEvidence: string[];
};

// Whole-word matching only. The earlier substring test classified the Kids
// DPS research objective (20cbf892, 9 Oct 2026) as product_creation: "deliver"
// ("Deliver one consolidated report") plus "tool" (inside "tools") and
// "system" matched, so the planner asked builder-engine for a website instead
// of researching and writing the report. A product objective now needs a build
// verb that governs a product noun within a few words ("build a website",
// "create an internal CRM tool"), and a requested report or plan is an
// information objective even when the text mentions tools or systems in
// passing.
const PRODUCT_NOUNS = "app|apps|application|website|web\\s+app|portal|platform|saas|software|dashboard|crm|tool|marketplace|landing\\s+page|site";
const PRODUCT_REQUEST = new RegExp(
  `\\b(?:build|create|develop|launch|ship|make|design)\\s+(?:[a-z0-9-]+\\s+){0,3}(?:${PRODUCT_NOUNS})\\b`,
);
const INFORMATION_DELIVERABLE = /\b(?:report|research|analy[sz]e|analysis|market\s+study|intelligence|compare|comparison|identify|swot|action\s+plan|feasibility|due\s+diligence)\b/;

export function classifyObjective(raw: string): ObjectiveType {
  const text = raw.toLowerCase();
  if (PRODUCT_REQUEST.test(text)) return "product_creation";
  if (INFORMATION_DELIVERABLE.test(text)) return "information";
  if (/\b(?:code|coding|component|function|api|endpoint|schema|migration|refactor)\b/.test(text)) return "software_build";
  return "business_execution";
}

export function completionContract(raw: string): CompletionContract {
  const objectiveType = classifyObjective(raw);
  if (objectiveType === "product_creation") return { objectiveType, label: "Finished usable product", requiresUsableOutcome: true, requiresLiveArtifact: true, requiredEvidence: ["build artifact", "deployment/live URL", "integration check", "acceptance verification"] };
  if (objectiveType === "software_build") return { objectiveType, label: "Verified software artifact", requiresUsableOutcome: true, requiresLiveArtifact: false, requiredEvidence: ["artifact", "tests", "verification"] };
  if (objectiveType === "information") return { objectiveType, label: "Evidence-backed answer/report", requiresUsableOutcome: false, requiresLiveArtifact: false, requiredEvidence: ["sources", "verification"] };
  return { objectiveType, label: "Executed business outcome", requiresUsableOutcome: true, requiresLiveArtifact: false, requiredEvidence: ["action evidence", "outcome verification"] };
}

// orchestration_projects.output_type for each objective type (the planner
// writes it; the objective loop reads it back to detect a stale plan).
export function projectOutputType(objectiveType: ObjectiveType): string {
  if (objectiveType === "product_creation") return "product";
  if (objectiveType === "software_build") return "software";
  if (objectiveType === "information") return "report";
  return "business_outcome";
}

// A live planning pass whose output type no longer matches the objective's
// classification was planned under a superseded contract (for example the
// substring classifier fixed above). It has to be replanned: executing it
// would deliver the wrong kind of result. Finished projects are history and
// are never reopened.
export function planContractMismatch(
  project: { status?: unknown; output_type?: unknown } | null | undefined,
  rawRequest: string,
): boolean {
  if (!project) return false;
  if (project.status === "complete" || project.status === "failed") return false;
  if (typeof project.output_type !== "string" || !project.output_type) return false;
  return project.output_type !== projectOutputType(classifyObjective(rawRequest));
}
