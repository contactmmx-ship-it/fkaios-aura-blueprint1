export type ObjectiveType = "information" | "software_build" | "product_creation" | "business_execution";

export type CompletionContract = {
  objectiveType: ObjectiveType;
  label: string;
  requiresUsableOutcome: boolean;
  requiresLiveArtifact: boolean;
  requiredEvidence: string[];
};

export function classifyObjective(raw: string): ObjectiveType {
  const text = raw.toLowerCase();
  const product = ["build","create","develop","launch","ship","make","deliver"].some(v => text.includes(v)) &&
    ["app","application","website","web app","portal","platform","saas","software","system","product","dashboard","crm","tool","marketplace"].some(v => text.includes(v));
  if (product) return "product_creation";
  if (["code","coding","component","function","api","endpoint","schema","migration","refactor"].some(v => text.includes(v))) return "software_build";
  if (["research","analyse","analyze","report","identify","compare","market study","intelligence"].some(v => text.includes(v))) return "information";
  return "business_execution";
}

export function completionContract(raw: string): CompletionContract {
  const objectiveType = classifyObjective(raw);
  if (objectiveType === "product_creation") return { objectiveType, label: "Finished usable product", requiresUsableOutcome: true, requiresLiveArtifact: true, requiredEvidence: ["build artifact", "deployment/live URL", "integration check", "acceptance verification"] };
  if (objectiveType === "software_build") return { objectiveType, label: "Verified software artifact", requiresUsableOutcome: true, requiresLiveArtifact: false, requiredEvidence: ["artifact", "tests", "verification"] };
  if (objectiveType === "information") return { objectiveType, label: "Evidence-backed answer/report", requiresUsableOutcome: false, requiresLiveArtifact: false, requiredEvidence: ["sources", "verification"] };
  return { objectiveType, label: "Executed business outcome", requiresUsableOutcome: true, requiresLiveArtifact: false, requiredEvidence: ["action evidence", "outcome verification"] };
}
